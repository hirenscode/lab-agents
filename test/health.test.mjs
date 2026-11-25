import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { StorageError } from "../src/errors.mjs";
import { buildServer } from "../src/server.mjs";
import { fakeClock } from "../test-support/fake-clock.mjs";

function fixture(t, { version, blocked = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "lab-agents-"));
  const dataDir = join(directory, "data");
  if (blocked) writeFileSync(dataDir, "Not a directory");
  const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dataDir, APP_VERSION: version });
  const clock = fakeClock();
  const app = buildServer({ config, now: clock.now });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  return { app, clock, config, dataDir, directory };
}

test("GET /healthz reports that storage is ready and leaves no write probe", async (t) => {
  const { app, clock, config, dataDir } = fixture(t);
  await app.ready();
  clock.advance(1_000);
  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    name: "lab-agents",
    version: config.version,
    dataDirWritable: true,
    databaseReady: true,
    time: clock.now().toISOString(),
  });
  assert.deepEqual(readdirSync(dataDir).sort(), ["agents", "lab-agents.sqlite"]);
});

test("GET /healthz returns 503 when the data location stops accepting writes", async (t) => {
  const { app, dataDir, directory } = fixture(t);
  await app.ready();
  renameSync(dataDir, join(directory, "old-data"));
  writeFileSync(dataDir, "Not a directory");

  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().status, "degraded");
  assert.equal(response.json().dataDirWritable, false);
});

test("GET / serves the landing page and escapes the configured version", async (t) => {
  const { app } = fixture(t, { version: "<test>&" });
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Lab Agents/);
  assert.match(response.body, /Version <code>&lt;test&gt;&amp;<\/code>/);
});

test("startup fails when the data directory cannot be initialized", async (t) => {
  const { app } = fixture(t, { blocked: true });
  await assert.rejects(app.ready(), StorageError);
});
