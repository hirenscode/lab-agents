import { BrainError } from "../brains/ollama.mjs";
import { SafetyError } from "../errors.mjs";
import { streamRunEvents } from "../runs/sse.mjs";
import { createAgentStore, identifier } from "./agents.mjs";

const failures = {
  unauthorized: 401, bad_credentials: 401, otp_required: 401, otp_wrong: 401, otp_enforced: 401,
  account_disabled: 403, account_denied: 403, ip_blocked: 403, csrf_denied: 403, forbidden: 403, local_denied: 403,
  dsm_unavailable: 503, rate_limited: 429, not_found: 404, in_use: 409, file_conflict: 409, permission_denied: 403,
};

export function installApi(app, services, config, now) {
  const lifetime = new AbortController();
  let discovery = false;
  app.addHook("preClose", async () => { lifetime.abort(); });

  app.register(async (api) => {
    const current = () => services();
    const signedIn = (request) => {
      const session = current().sessions.session(request);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) current().sessions.verifyCsrf(request, session);
      return session;
    };
    const route = (method, path, handler, { admin = false } = {}) => api.route({
      method, url: path, async handler(request, reply) {
        const session = signedIn(request);
        if (admin && session.user.role !== "admin") throw new SafetyError("forbidden", "Administrator access is required");
        reply.header("cache-control", "no-store");
        const service = current();
        return handler(request, reply, { ...service, session, user: session.user, agents: createAgentStore(service.database, service.brains, now) });
      },
    });

    api.setErrorHandler((error, req, reply) => {
      if (error instanceof SafetyError || error instanceof BrainError) {
        return reply.code(failures[error.code] ?? 400).send({ code: error.code, message: error.message });
      }
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ code: "invalid_input", message: "The request is invalid" });
      }
      req.log.error({ errorName: error.name, errorCode: error.code }, "API request failed");
      return reply.code(500).send({ code: "internal_error", message: "Lab Agents could not complete the request" });
    });

    api.post("/login", (request, reply) => {
      const origin = request.headers.origin;
      if (request.headers["sec-fetch-site"] === "cross-site" || (origin && origin !== `${request.protocol}://${request.host}`)) {
        throw new SafetyError("csrf_denied", "Requests must come from Lab Agents");
      }
      return current().sessions.login(request, reply);
    });
    route("GET", "/session", (_req, _reply, { session: { user, csrfToken } }) => ({ user, csrfToken }));
    route("POST", "/logout", (req, reply, { sessions, session }) => sessions.logout(req, reply, session));
    route("GET", "/tool-types", (_req, _reply, { tools }) => tools.list());
    route("GET", "/mounts", () => config.mounts.map(({ id, mode }) => ({ id, mode })));

    const ownedTool = (database, owner, id) => {
      const found = database.prepare("SELECT * FROM tool_instances WHERE owner_id=? AND id=?").get(owner, id);
      if (!found) throw new SafetyError("not_found", "Tool was not found");
      return found;
    };
    route("GET", "/tools", (_req, _reply, { database, user, tools }) =>
      database.prepare("SELECT * FROM tool_instances WHERE owner_id=? ORDER BY id").all(user.id)
        .map(({ id, type, name, permission, scope_json }) => {
          const config = { id, type, name, permission, scope: JSON.parse(scope_json) };
          try { return { id, ...tools.instance(config) }; }
          catch { return { ...config, description: "Scope needs review" }; }
        }));
    route("POST", "/tools", (req, reply, { database, user, tools }) => {
      const saved = tools.instance(req.body);
      const result = database.prepare("INSERT INTO tool_instances(owner_id,type,name,scope_json,permission,created_at) VALUES(?,?,?,?,?,?)")
        .run(user.id, saved.type, saved.name, JSON.stringify(saved.scope), saved.permission, now().toISOString());
      return reply.code(201).send({ id: Number(result.lastInsertRowid), ...saved });
    });
    route("PUT", "/tools/:id", (req, _reply, { database, user, tools }) => {
      const id = identifier(req.params.id);
      const old = ownedTool(database, user.id, id);
      const saved = tools.instance({ ...(req.body ?? {}), type: old.type, permission: old.permission });
      database.prepare("UPDATE tool_instances SET name=?,scope_json=? WHERE id=? AND owner_id=?")
        .run(saved.name, JSON.stringify(saved.scope), id, user.id);
      return { id, ...saved };
    });
    route("DELETE", "/tools/:id", (req, reply, { database, user }) => {
      const id = identifier(req.params.id);
      ownedTool(database, user.id, id);
      if (database.prepare("SELECT 1 FROM agent_tools WHERE tool_instance_id=? LIMIT 1").get(id)) {
        throw new SafetyError("in_use", "Remove the tool from its agents first");
      }
      database.prepare("DELETE FROM tool_instances WHERE id=? AND owner_id=?").run(id, user.id);
      return reply.code(204).send();
    });

    route("GET", "/agents", (_req, _reply, { agents, user }) => agents.list(user.id));
    route("POST", "/presets/duplicate-finder", (req, reply, { database, user, tools, agents }) => {
      const scope = req.body?.scope;
      const scanner = tools.instance({ type: "dup_finder", scope, permission: "read", name: "Scan duplicates" });
      const mover = tools.instance({ type: "file_mover", scope: { ...scope, requireDuplicate: true }, permission: "propose", name: "Propose quarantine" });
      const add = database.prepare("INSERT INTO tool_instances(owner_id,type,name,scope_json,permission,created_at) VALUES(?,?,?,?,?,?)");
      database.exec("BEGIN IMMEDIATE");
      let agent;
      try {
        const toolIds = [scanner, mover].map((tool) => Number(add
          .run(user.id, tool.type, tool.name, JSON.stringify(tool.scope), tool.permission, now().toISOString()).lastInsertRowid));
        agent = agents.save(user.id, {
          name: req.body?.name ?? "Dupe Hunter",
          description: "Finds byte-identical files and proposes moves to quarantine.",
          task: "Scan for byte-identical files. Say which copy should stay and why. Propose moves only for confirmed duplicates you can name, one file per approval. Keep at least one copy of every group.",
          toolIds,
        }, undefined, { transaction: false });
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
      return reply.code(201).send(agent);
    });
    route("POST", "/agents", (req, reply, { agents, user }) => reply.code(201).send(agents.save(user.id, req.body)));
    route("GET", "/agents/:id", (req, _reply, { agents, user }) => agents.get(user.id, identifier(req.params.id)));
    route("PUT", "/agents/:id", (req, _reply, { agents, user }) => agents.save(user.id, req.body, identifier(req.params.id)));
    route("DELETE", "/agents/:id", (req, reply, { agents, user }) => {
      agents.archive(user.id, identifier(req.params.id));
      return reply.code(204).send();
    });
    route("GET", "/agents/:id/files", (req, _reply, { agents, user, personality }) =>
      personality.list(agents.get(user.id, identifier(req.params.id))));
    route("GET", "/agents/:id/files/:name", (req, _reply, { agents, user, personality }) =>
      personality.get(agents.get(user.id, identifier(req.params.id)), req.params.name));
    route("PUT", "/agents/:id/files/:name", (req, _reply, { agents, user, personality }) =>
      personality.write(agents.get(user.id, identifier(req.params.id)), req.params.name, req.body?.content, req.body?.revision));
    route("GET", "/agents/:id/files/:name/versions", (req, _reply, { agents, user, personality }) =>
      personality.versions(agents.get(user.id, identifier(req.params.id)), req.params.name));
    route("POST", "/agents/:id/files/:name/revert", (req, _reply, { agents, user, personality }) =>
      personality.revert(agents.get(user.id, identifier(req.params.id)), req.params.name, req.body?.version, req.body?.revision));
    route("GET", "/agents/:id/triggers", (req, _reply, { triggers, user }) =>
      triggers.list(user.id, identifier(req.params.id)));
    route("POST", "/agents/:id/triggers", (req, reply, { triggers, user }) =>
      reply.code(201).send(triggers.save(user.id, identifier(req.params.id), req.body)));
    route("PUT", "/agents/:id/triggers/:triggerId", (req, _reply, { triggers, user }) =>
      triggers.save(user.id, identifier(req.params.id), req.body, identifier(req.params.triggerId)));
    route("DELETE", "/agents/:id/triggers/:triggerId", (req, reply, { triggers, user }) => {
      triggers.remove(user.id, identifier(req.params.id), identifier(req.params.triggerId));
      return reply.code(204).send();
    });
    route("POST", "/agents/:id/runs", (req, reply, { engine, user }) =>
      reply.code(201).send(engine.spawn(user.id, identifier(req.params.id), req.body?.task)));
    route("GET", "/runs", (req, _reply, { engine, user }) =>
      engine.list(user.id, req.query.agentId === undefined ? undefined : identifier(req.query.agentId)));
    route("GET", "/runs/:id", (req, _reply, { engine, user }) => engine.get(user.id, identifier(req.params.id)));
    route("POST", "/runs/:id/kill", (req, _reply, { engine, user }) => engine.kill(user.id, identifier(req.params.id)));
    route("GET", "/runs/:id/events", (req, _reply, { engine, user }) => engine.events(user.id, identifier(req.params.id)));
    route("POST", "/runs/:id/approvals/:approvalId", (req, _reply, { engine, user }) =>
      engine.decide(user.id, identifier(req.params.id), identifier(req.params.approvalId), req.body?.decision));
    route("POST", "/runs/:id/approvals/:approvalId/restore", (req, _reply, { engine, user }) =>
      engine.restore(user.id, identifier(req.params.id), identifier(req.params.approvalId)));
    route("GET", "/runs/:id/stream", async (req, reply, { engine, user }) => {
      const id = identifier(req.params.id);
      engine.get(user.id, id);
      const header = req.headers["last-event-id"];
      const after = header ? identifier(header) : 0;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
      raw.flushHeaders();
      const disconnect = new AbortController();
      raw.once("close", () => disconnect.abort());
      try {
        await streamRunEvents(engine, user.id, id, raw, { after, signal: AbortSignal.any([disconnect.signal, lifetime.signal]) });
      } catch { raw.destroy(); }
    });

    route("GET", "/brains", (_req, _reply, { brains, user }) => brains.list().map((brain) => {
      if (user.role === "admin") return brain;
      const { url: _url, ...visible } = brain;
      return visible;
    }));
    route("POST", "/brains", (req, reply, { brains }) => {
      const { id: _id, ...input } = req.body ?? {};
      const saved = brains.save(input);
      void brains.refresh().catch(() => {});
      return reply.code(201).send(saved);
    }, { admin: true });
    route("PUT", "/brains/:id", (req, _reply, { brains }) => {
      const saved = brains.save({ ...req.body, id: identifier(req.params.id) });
      void brains.refresh().catch(() => {});
      return saved;
    }, { admin: true });
    route("POST", "/brains/discover", async (_req, _reply, { brains }) => {
      if (discovery) throw new SafetyError("rate_limited", "Discovery is already running");
      discovery = true;
      try { return await brains.discover(config.discoveryCidr, lifetime.signal); }
      finally { discovery = false; }
    }, { admin: true });
  }, { prefix: "/api" });
}
