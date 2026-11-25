import Fastify from "fastify";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = process.env.APP_VERSION || pkg.version;
const DATA_DIR = process.env.DATA_DIR || "./data";

// Phase 0 check: can we write to the mounted /data volume? (Synology folder permissions are the usual culprit.)
function dataWritable() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const probe = join(DATA_DIR, ".write-test");
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

const page = (v, ok) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Lab Agents</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 24px;color:#111827}
.ok{color:#166534}.bad{color:#b91c1c}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>Lab Agents</h1><p>Version <code>${v}</code>. The image runs on this NAS.</p>
<p class="${ok ? "ok" : "bad"}">Data folder: ${ok ? "writable" : "NOT writable (check the PUID/PGID settings)"}</p></body></html>`;

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/healthz", async (_req, reply) => {
    const writable = dataWritable();
    return reply.code(writable ? 200 : 503).send({
      status: writable ? "ok" : "degraded",
      name: pkg.name,
      version: VERSION,
      dataDirWritable: writable,
      time: new Date().toISOString(),
    });
  });

  app.get("/", async (_req, reply) => reply.type("text/html").send(page(VERSION, dataWritable())));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = buildServer();
  const port = Number(process.env.PORT || 8787);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
