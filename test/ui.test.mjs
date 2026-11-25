import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildServer } from "../src/server.mjs";
import { loadConfig } from "../src/config.mjs";
import { latestRun, makeTrigger, triggerLabel } from "../ui/src/model.mjs";

test("the console serves its HTML and hashed bundles with local-only page policy", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "lab-ui-"));
  const bundle = join(root, "bundle");
  mkdirSync(join(bundle, "assets"), { recursive: true });
  writeFileSync(join(bundle, "index.html"), '<title>Agent Console</title><script type="module" src="/assets/index-hash.js"></script>');
  writeFileSync(join(bundle, "assets", "index-hash.js"), "/* fixture bundle */");
  writeFileSync(join(bundle, "assets", "unlisted.json"), "{}");
  const app = buildServer({ config: loadConfig({ DATA_DIR: join(root, "data"), NODE_ENV: "test" }), uiDirectory: bundle });
  t.after(async () => { await app.close(); rmSync(root, { force: true, recursive: true }); });
  const home = await app.inject("/");
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /Agent Console/);
  assert.match(home.headers["content-security-policy"], /connect-src 'self'/);
  const asset = await app.inject("/assets/index-hash.js");
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers["cache-control"], /immutable/);
  for (const path of ["/assets/unlisted.json", "/assets/missing.js", "/assets/%2e%2e%2findex.html"]) {
    assert.equal((await app.inject(path)).statusCode, 404);
  }
  assert.equal((await app.inject("/api/agents")).statusCode, 401);
});

test("console uses the active run and converts user form values into trigger API shapes", () => {
  const runs = [{ id: 3, agent_id: 2, state: "done" }, { id: 2, agent_id: 1, state: "running" },
    { id: 1, agent_id: 2, state: "waiting_for_brain" }];
  assert.equal(latestRun(runs, 2).id, 1);
  assert.deepEqual(makeTrigger("interval", { minutes: "30", catchUp: "skip" }), {
    kind: "interval", spec: { minutes: 30, catchUp: "skip" },
  });
  assert.equal(triggerLabel({ enabled: true, kind: "interval", spec: { minutes: 30 } }), "Every 30 min");
});
