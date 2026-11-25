import { BrainError, createOllamaClient, lanEndpoint } from "./ollama.mjs";

function parse(row, health) {
  const { models_json, enabled, last_seen, ...brain } = row;
  return { ...brain, models: JSON.parse(models_json), enabled: Boolean(enabled), lastSeen: last_seen, online: health.get(row.id) === true };
}

export function createBrainRegistry(database, { clientFactory = createOllamaClient, now = () => new Date() } = {}) {
  const health = new Map();
  const capabilities = new Map();
  const lifetime = new AbortController();
  let timer;
  let inFlight;
  const list = () => database.prepare("SELECT * FROM brains ORDER BY priority, id").all().map((row) => parse(row, health));
  const get = (id) => list().find((brain) => brain.id === id);

  function save({ id, name, url, priority = 10, enabled = true }) {
    if (typeof name !== "string" || !name.trim() || name.length > 80 || !Number.isSafeInteger(priority) || priority < 0 ||
        typeof enabled !== "boolean") throw new BrainError("invalid_brain", "Invalid brain name, priority, or enabled state");
    const endpoint = lanEndpoint(url);
    if (id !== undefined) {
      if (!get(id)) throw new BrainError("invalid_brain", "Brain was not found");
      database.prepare("UPDATE brains SET name=?, url=?, priority=?, enabled=?, models_json='[]', last_seen=NULL WHERE id=?")
        .run(name.trim(), endpoint, priority, Number(enabled), id);
      health.delete(id);
      capabilities.clear();
      return get(id);
    }
    const saved = database.prepare("INSERT INTO brains(name,url,priority,enabled) VALUES(?,?,?,?)")
      .run(name.trim(), endpoint, priority, Number(enabled));
    return get(Number(saved.lastInsertRowid));
  }

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = Promise.all(list().filter((brain) => brain.enabled).map(async (brain) => {
      try {
        const models = await clientFactory(brain.url).models(lifetime.signal);
        if (lifetime.signal.aborted || !get(brain.id)?.enabled || get(brain.id)?.url !== brain.url) return;
        database.prepare("UPDATE brains SET models_json=?, last_seen=? WHERE id=?")
          .run(JSON.stringify(models), now().toISOString(), brain.id);
        health.set(brain.id, true);
      } catch {
        if (!lifetime.signal.aborted && get(brain.id)?.url === brain.url) health.set(brain.id, false);
      }
    })).finally(() => { inFlight = undefined; });
    return inFlight;
  }

  return {
    list, get, save, refresh,
    start(callback, interval = 30_000) {
      const tick = async () => {
        await refresh();
        if (!lifetime.signal.aborted) await callback?.();
      };
      timer = setInterval(() => { void tick().catch(() => {}); }, interval);
      timer.unref();
      void tick().catch(() => {});
    },
    async close() {
      clearInterval(timer);
      lifetime.abort();
      await inFlight;
    },
    async select({ preferred, model, strict = false, needsTools = false, exclude = [], signal } = {}) {
      const candidates = list().filter((brain) => brain.enabled && brain.online && !exclude.includes(brain.id));
      if (preferred) candidates.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
      for (const brain of candidates) {
        signal?.throwIfAborted();
        if (strict && preferred && brain.id !== preferred) continue;
        const client = clientFactory(brain.url);
        // A preferred model applies on its preferred brain; a fallback brain may use its own model.
        const choices = model && (!preferred || brain.id === preferred)
          ? brain.models.filter((name) => name === model || name === model + ":latest") : brain.models;
        for (const current of choices) {
          if (needsTools) {
            const key = `${brain.id}:${current}`;
            let entry = capabilities.get(key);
            if (!entry || Date.now() > entry.until) {
              try {
                entry = { supported: (await client.capabilities(current, signal)).includes("tools"), until: Date.now() + 30_000 };
                capabilities.set(key, entry);
              } catch {
                signal?.throwIfAborted();
                continue;
              }
            }
            if (!entry.supported) continue;
          }
          return { brain, model: current, client };
        }
      }
      return null;
    },
    async discover(cidr, signal) {
      const match = /^(\d+\.\d+\.\d+)\.0\/24$/.exec(cidr ?? "");
      if (!match || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(match[1])) {
        throw new BrainError("invalid_brain", "Configure a private IPv4 /24 for discovery");
      }
      lanEndpoint(`http://${match[1]}.1:11434`);
      const found = [];
      let host = 1;
      await Promise.all(Array.from({ length: 16 }, async () => {
        while (host < 255) {
          signal?.throwIfAborted();
          const url = `http://${match[1]}.${host++}:11434`;
          const deadline = AbortSignal.timeout(300);
          const probe = signal ? AbortSignal.any([deadline, signal]) : deadline;
          try {
            const version = await clientFactory(url).version(probe);
            found.push({ url, version });
          } catch { signal?.throwIfAborted(); }
        }
      }));
      return found.sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
    },
  };
}
