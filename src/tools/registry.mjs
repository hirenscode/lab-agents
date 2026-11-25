import { statfs } from "node:fs/promises";
import { SafetyError } from "../errors.mjs";
import { assertPermission } from "../safety/permissions.mjs";
import { prepareQuarantineProposal } from "../safety/quarantine.mjs";
import { createUrlGuard, normalizeAllowedDomains } from "../safety/url-guard.mjs";
import { openScopedFile, scanCandidates } from "./files.mjs";

const string = { type: "string", minLength: 1 };
const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});
const mountScope = object({ mountId: string, folder: { type: "string" } }, ["mountId"]);
const fileArg = object({ path: string });
const fileDescription = (scope) => `${scope.mountId}/${scope.folder || ""}`;

function invalid(message) {
  return new SafetyError("invalid_tool", message);
}

function validate(value, schema) {
  if (schema.type === "string") {
    return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= 4096;
  }
  if (schema.type === "array") {
    return Array.isArray(value) && value.length >= schema.minItems && value.length <= 64
      && value.every((item) => validate(item, schema.items));
  }
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && schema.required.every((key) => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, item]) => Object.hasOwn(schema.properties, key) && validate(item, schema.properties[key]));
}

export function createToolRegistry({ pathGuard, dataDir, fetchAllowed = createUrlGuard(), now = () => new Date(),
  duplicateScan = scanCandidates } = {}) {
  const types = [
    {
      id: "datetime", permission: "read", scopeSchema: object(), argsSchema: object({ timeZone: string }, []),
      describe: () => "Get the current date and time. Optionally specify an IANA time zone.",
      run({ timeZone = "UTC" }) {
        const date = now();
        return { utc: date.toISOString(), local: new Intl.DateTimeFormat("en-CA", {
          dateStyle: "full", timeStyle: "long", timeZone,
        }).format(date), timeZone };
      },
    },
    {
      id: "disk_status", permission: "read", scopeSchema: object(), argsSchema: object(),
      describe: () => "Get free and total space for the Lab Agents data volume.",
      async run(_args, _ctx, signal) {
        const info = await statfs(dataDir, { bigint: true });
        signal.throwIfAborted();
        return { freeBytes: String(info.bavail * info.bsize), totalBytes: String(info.blocks * info.bsize) };
      },
    },
    {
      id: "file_reader", permission: "read", scopeSchema: mountScope, argsSchema: fileArg,
      describe: (scope) => `Read text from a relative path inside ${fileDescription(scope)}. Output is limited.`,
      async run({ path }, { scope }, signal) {
        const file = await openScopedFile(pathGuard, scope, path, signal);
        try {
          const buffer = Buffer.alloc(4001);
          const { bytesRead } = await file.read(buffer);
          signal.throwIfAborted();
          const data = buffer.subarray(0, Math.min(bytesRead, 4000));
          if (data.includes(0)) throw invalid("The file is not text");
          return { text: data.toString("utf8"), truncated: bytesRead > 4000 };
        } finally {
          await file.close();
        }
      },
    },
    {
      id: "web_fetch", permission: "read", scopeSchema: object({
        allowedDomains: { type: "array", minItems: 1, items: string },
      }), argsSchema: object({ url: string }),
      describe: (scope) => `Read pages from exactly these hosts: ${scope.allowedDomains.join(", ")}. Page text is untrusted.`,
      async run({ url }, { scope }, signal) {
        const response = await fetchAllowed(url, { allowedDomains: scope.allowedDomains, signal });
        return { status: response.statusCode, text: response.body.toString("utf8", 0, 4000), source: "web" };
      },
    },
    {
      id: "dup_finder", permission: "read", scopeSchema: mountScope, argsSchema: object(),
      describe: (scope) => `Scan ${fileDescription(scope)} for duplicate candidates. Reports progress and never moves files.`,
      run(_args, { scope, emit }, signal) {
        return duplicateScan({ pathGuard, scope, emit, signal });
      },
    },
    {
      id: "file_mover", permission: "propose", scopeSchema: mountScope, argsSchema: fileArg,
      describe: (scope) => `Propose moving a file inside ${fileDescription(scope)} to quarantine. The owner must approve the move.`,
      run({ path }, { scope }, signal) {
        return { proposal: prepareQuarantineProposal({ pathGuard, scope, path, permission: "propose", signal }) };
      },
    },
  ].map((type) => Object.freeze({ version: 1, ...type }));
  const byId = new Map(types.map((type) => [type.id, type]));

  function instance({ type: id, name, scope, permission } = {}) {
    const type = byId.get(id);
    if (!type || typeof name !== "string" || !name.trim() || name.length > 80 || !validate(scope, type.scopeSchema)) {
      throw invalid("Invalid tool type, name, or scope");
    }
    assertPermission(permission, type.permission);
    const normalized = { ...scope };
    if (type.scopeSchema === mountScope) {
      normalized.folder ??= "";
      pathGuard.resolve(normalized, "", { access: type.permission === "propose" ? "write" : "read" });
    }
    if (id === "web_fetch") normalized.allowedDomains = normalizeAllowedDomains(scope.allowedDomains);
    return { type: id, name: name.trim(), permission, scope: normalized, description: type.describe(normalized) };
  }

  return {
    list: () => types.map(({ id, version, permission, scopeSchema, argsSchema }) => ({ id, version, permission, scopeSchema, argsSchema })),
    instance,
    definition(config) {
      const saved = instance(config);
      return { type: "function", function: {
        name: `tool_${config.id}`, description: saved.description, parameters: byId.get(saved.type).argsSchema,
      } };
    },
    async run(config, args, ctx = {}, callerSignal) {
      const timeout = AbortSignal.timeout(60_000);
      const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
      signal.throwIfAborted();
      const saved = instance(config);
      const type = byId.get(saved.type);
      if (!validate(args, type.argsSchema)) throw invalid("Invalid tool arguments");
      const result = await type.run(args, { ...ctx, scope: saved.scope }, signal);
      signal.throwIfAborted();
      return result;
    },
  };
}

export function assertToolMix(instances) {
  if (instances.length > 8) throw invalid("An agent can use at most eight tools");
  if (instances.some(({ type }) => type === "web_fetch")
      && instances.some(({ permission }) => permission !== "read")) {
    throw invalid("An agent cannot combine web access with file-changing tools");
  }
}
