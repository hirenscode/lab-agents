import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { createDsmAuth } from "./auth/dsm.mjs";
import { createSessions } from "./auth/sessions.mjs";
import { createBrainRegistry } from "./brains/registry.mjs";
import { ConfigError } from "./errors.mjs";
import { createRunEngine } from "./runs/engine.mjs";
import { createPathGuard } from "./safety/path-guard.mjs";
import { createToolRegistry } from "./tools/registry.mjs";
import { createTriggerService } from "./triggers/service.mjs";

function inside(root, path) {
  const offset = relative(root, path);
  return offset !== ".." && !offset.startsWith(".." + sep) && !isAbsolute(offset);
}
function assertDataIsolation(mounts, directory) {
  const data = realpathSync.native(directory);
  for (const { directory: path } of mounts) {
    if (typeof path !== "string" || !isAbsolute(path)) throw new ConfigError("Tool mounts must use absolute paths");
    const canonical = realpathSync.native(path);
    if (inside(canonical, data) || inside(data, canonical)) {
      throw new ConfigError("Tool mounts must be separate from the app data directory");
    }
  }
}

export function openServices(database, config, { now, brainClientFactory }) {
  assertDataIsolation(config.mounts, config.dataDir);
  const pathGuard = createPathGuard(config.mounts);
  const tools = createToolRegistry({ pathGuard, dataDir: config.dataDir, now });
  const brains = createBrainRegistry(database, { clientFactory: brainClientFactory, now });
  const sessions = createSessions(database, {
    dsm: createDsmAuth(config.dsmUrl), adminUsers: config.adminUsers, secure: config.secureCookies, now,
  });
  const engine = createRunEngine(database, { pathGuard, tools, brains, now });
  const triggers = createTriggerService(database, {
    engine, pathGuard, now,
    available: (agent) => brains.list().some((brain) => brain.enabled && brain.online && brain.models.length &&
      (!agent.brain_pref || agent.config.ifUnavailable === "fallback" || brain.id === agent.brain_pref)),
  });
  engine.start();
  triggers.start();
  brains.start(async () => { engine.resumeWaiting(); await triggers.tick(); });
  return {
    database, pathGuard, tools, brains, sessions, engine, triggers,
    async close() { await Promise.all([triggers.close(), brains.close(), engine.close()]); },
  };
}
