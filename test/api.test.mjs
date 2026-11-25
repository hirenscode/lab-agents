import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildServer } from "../src/server.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDsmAuth } from "../src/auth/dsm.mjs";
import { saveLocalAdmin } from "../src/auth/sessions.mjs";
import { initializeDataDirectory } from "../src/storage.mjs";
import { openDatabase } from "../src/db/database.mjs";
import { fakeHttp, requestText } from "../test-support/http.mjs";

async function fakeDsm(t, { verify = () => 0, inspected = [] } = {}) {
  return fakeHttp(t, async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET") {
      response.end(JSON.stringify({ success: true, data: { "SYNO.API.Auth": { maxVersion: 7, path: "auth.cgi" } } }));
      return;
    }
    const params = new URLSearchParams(await requestText(request));
    inspected.push(params);
    const code = verify(params);
    response.end(JSON.stringify(code ? { success: false, error: { code } } : { success: true, data: { sid: "fake-sid" } }));
  });
}

function appFixture(t, dsm, extras = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lab-api-"));
  const config = loadConfig({ DATA_DIR: dir, NODE_ENV: "test", DSM_URL: dsm, DSM_ADMIN_USERS: "owner", ...extras });
  const app = buildServer({ config });
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, dir };
}

async function login(app, username, options = {}) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { username, password: "test-password-only", ...options } });
  assert.equal(res.statusCode, 200, res.body);
  return { cookie: res.headers["set-cookie"].split(";")[0], "x-csrf-token": res.json().csrfToken };
}
const agent = { name: "Clock", task: "Say the time" };

test("DSM discovery uses the highest version, sends OTP and maps authentication failures", async (t) => {
  const inspected = [];
  const endpoint = await fakeDsm(t, { inspected, verify: (form) => Number(form.get("account")) });
  const auth = createDsmAuth(endpoint);
  await auth.verify({ username: "0", password: "fixture", otp: "123456" });
  assert.equal(inspected[0].get("version"), "7");
  assert.equal(inspected[0].get("otp_code"), "123456");
  assert.equal(inspected[0].get("session"), "LabAgents");
  for (const [number, code] of Object.entries({
    400: "bad_credentials", 401: "account_disabled", 402: "account_denied", 403: "otp_required",
    404: "otp_wrong", 406: "otp_enforced", 407: "ip_blocked",
  })) {
    await assert.rejects(auth.verify({ username: number, password: "fixture" }), { code });
  }
});

test("API isolates tools, agents, runs and kills, and checks CSRF on all mutations", async (t) => {
  const { app } = appFixture(t, await fakeDsm(t));
  const owner = await login(app, "owner");
  const other = await login(app, "other");
  assert.equal((await app.inject("/api/agents")).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/agents", headers: { cookie: owner.cookie }, payload: agent })).statusCode, 403);
  const tool = await app.inject({ method: "POST", url: "/api/tools", headers: owner,
    payload: { type: "datetime", name: "Clock", scope: {}, permission: "read" } });
  assert.equal(tool.statusCode, 201);
  const created = await app.inject({ method: "POST", url: "/api/agents", headers: owner,
    payload: { ...agent, toolIds: [tool.json().id] } });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  for (const [method, url] of [["GET", `/api/agents/${id}`], ["POST", `/api/agents/${id}/runs`], ["DELETE", `/api/tools/${tool.json().id}`]]) {
    assert.equal((await app.inject({ method, url, headers: other })).statusCode, 404);
  }
  assert.deepEqual((await app.inject({ url: "/api/agents", headers: other })).json(), []);
  const spawned = await app.inject({ method: "POST", url: `/api/agents/${id}/runs`, headers: owner });
  assert.equal(spawned.statusCode, 201, spawned.body);
  const run = spawned.json().id;
  assert.equal((await app.inject({ url: `/api/runs/${run}/events`, headers: other })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: `/api/runs/${run}/kill`, headers: other })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: `/api/runs/${run}/kill`, headers: owner })).json().state, "killed");
  assert.equal((await app.inject({ method: "POST", url: "/api/brains", headers: other, payload: {} })).statusCode, 403);
});

test("local admin uses a scrypt credential with an HttpOnly session and can sign out", async (t) => {
  const { app, dir } = appFixture(t);
  const db = openDatabase(initializeDataDirectory(dir));
  await saveLocalAdmin(db, "fallback", "test-password-only");
  assert.notEqual(db.prepare("SELECT password_hash FROM local_admins").get().password_hash, "test-password-only");
  db.close();
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { username: "fallback", password: "test-password-only", provider: "local" } });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers["set-cookie"], /HttpOnly; SameSite=Strict/);
  assert.equal(res.json().user.role, "admin");
  const headers = { cookie: res.headers["set-cookie"].split(";")[0], "x-csrf-token": res.json().csrfToken };
  assert.equal((await app.inject({ method: "POST", url: "/api/logout", headers })).statusCode, 204);
  assert.equal((await app.inject({ url: "/api/session", headers })).statusCode, 401);
});

test("login rate limit and cross-origin login reject invalid requests", async (t) => {
  const { app } = appFixture(t, await fakeDsm(t, { verify: () => 400 }));
  const attempt = { method: "POST", url: "/api/login", payload: { username: "one", password: "bad" } };
  assert.equal((await app.inject({ ...attempt, headers: { origin: "https://other.invalid" } })).statusCode, 403);
  for (let i = 0; i < 5; i++) assert.equal((await app.inject(attempt)).statusCode, 401);
  assert.equal((await app.inject(attempt)).statusCode, 429);
});
