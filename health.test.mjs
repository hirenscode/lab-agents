import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lab-agents-"));
const { buildServer } = await import("../src/server.mjs");

test("GET /healthz reports ok and a version", async () => {
  const app = buildServer();
  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.dataDirWritable, true);
  assert.ok(body.version);
  await app.close();
});

test("GET / serves the landing page", async () => {
  const app = buildServer();
  const res = await app.inject({ method: "GET", url: "/" });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Lab Agents/);
  await app.close();
});
