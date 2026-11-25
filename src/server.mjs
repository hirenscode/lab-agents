import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { openDatabase } from "./db/database.mjs";
import { installApi } from "./api/routes.mjs";
import { openServices } from "./services.mjs";
import { serveConsole } from "./ui.mjs";
import { dataDirWritable, initializeDataDirectory } from "./storage.mjs";

const page = (version, writable) => {
  const displayVersion = version.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Lab Agents</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 24px;color:#111827}
.ok{color:#166534}.bad{color:#b91c1c}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>Lab Agents</h1><p>Version <code>${displayVersion}</code>. The image runs on this NAS.</p>
<p class="${writable ? "ok" : "bad"}">Data folder: ${writable ? "writable" : "NOT writable (check the PUID/PGID settings)"}</p></body></html>`;
};

export function buildServer({ config = loadConfig(), now = () => new Date(), brainClientFactory, uiDirectory } = {}) {
  const app = Fastify({ logger: config.nodeEnv !== "test" });
  let database;
  let services;
  installApi(app, () => services, config, now);

  app.addHook("onReady", async () => {
    const databasePath = initializeDataDirectory(config.dataDir);
    database = openDatabase(databasePath, now);
    services = openServices(database, config, { now, brainClientFactory });
  });

  app.addHook("onClose", async () => {
    try { await services?.close(); } finally { database?.close(); }
  });

  app.get("/healthz", async (_request, reply) => {
    const writable = dataDirWritable(config.dataDir);
    let databaseReady = false;
    try {
      databaseReady = Boolean(database.prepare("SELECT 1 FROM schema_version LIMIT 1").get());
    } catch (err) {
      app.log.error({ err }, "Database health check failed");
    }
    const healthy = writable && databaseReady;
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      name: config.name,
      version: config.version,
      dataDirWritable: writable,
      databaseReady,
      time: now().toISOString(),
    });
  });

  if (!serveConsole(app, uiDirectory)) {
    app.get("/", async (_request, reply) => reply
      .type("text/html")
      .send(page(config.version, dataDirWritable(config.dataDir))));
  }

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let app;
  try {
    const config = loadConfig();
    app = buildServer({ config });
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    if (app) {
      app.log.error({ err }, "Lab Agents could not start");
      await app.close();
    } else {
      console.error(JSON.stringify({ level: "error", message: err.message }));
    }
    process.exitCode = 1;
  }
}
