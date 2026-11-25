import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPathGuard } from "../src/safety/path-guard.mjs";
import { createToolRegistry, assertToolMix } from "../src/tools/registry.mjs";

function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "lab-tools-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "docs"));
  writeFileSync(join(dataDir, "docs", "letter.txt"), "test");
  writeFileSync(join(dataDir, "docs", "copy.txt"), "copy");
  mkdirSync(join(dataDir, "docs", "@eaDir"));
  writeFileSync(join(dataDir, "docs", "@eaDir", "ignored.txt"), "test");
  const pathGuard = createPathGuard([{ id: "data", directory: dataDir, mode: "write" }]);
  const web = [];
  const registry = createToolRegistry({
    dataDir, pathGuard, now: () => new Date("2026-01-01T00:00:00Z"),
    async fetchAllowed(url, options) {
      web.push({ url, allowed: options.allowedDomains });
      return { statusCode: 200, body: Buffer.from("result") };
    },
  });
  const fs = { mountId: "data", folder: "docs" };
  const tool = (type, scope = {}, permission = "read") => ({ type, scope, name: type, permission });
  return { registry, dataDir, fs, tool, web };
}

test("tool registry exposes all six versioned types and validates scopes and arguments", async (t) => {
  const { registry, fs, tool } = fixture(t);
  assert.deepEqual(registry.list().map(({ id }) => id), ["datetime", "disk_status", "file_reader", "web_fetch", "dup_finder", "file_mover"]);
  assert.ok(registry.list().every(({ version }) => version === 1));
  assert.throws(() => registry.instance(tool("unknown")));
  assert.throws(() => registry.instance(tool("file_reader", { ...fs, folder: "../" })));
  assert.throws(() => registry.instance(tool("file_reader", { mountId: "foreign" })));
  assert.throws(() => registry.instance(tool("file_mover", fs)));
  assert.match(registry.definition({ ...tool("file_reader", fs), id: 3 }).function.description, /data\/docs/);
  await assert.rejects(registry.run(tool("file_reader", fs), { path: "letter.txt", extra: true }));
  assert.throws(() => assertToolMix([tool("web_fetch"), tool("file_mover", fs, "propose")]));
  assert.throws(() => assertToolMix(Array.from({ length: 9 }, () => tool("datetime"))));
});

test("static tools return the current time and data disk space", async (t) => {
  const { registry, tool } = fixture(t);
  assert.equal((await registry.run(tool("datetime"), { timeZone: "America/Los_Angeles" })).utc, "2026-01-01T00:00:00.000Z");
  assert.ok(BigInt((await registry.run(tool("disk_status"), {})).totalBytes) > 0n);
});

test("file reader is bounded and mover creates an approval proposal only", async (t) => {
  const { registry, fs, tool, dataDir } = fixture(t);
  writeFileSync(join(dataDir, "docs", "long.txt"), "x".repeat(4020));
  const { text, truncated } = await registry.run(tool("file_reader", fs), { path: "long.txt" });
  assert.equal(text.length, 4000);
  assert.equal(truncated, true);
  await assert.rejects(registry.run(tool("file_reader", fs), { path: "../secret" }));
  const { proposal } = await registry.run(tool("file_mover", fs, "propose"), { path: "letter.txt" });
  assert.equal(proposal.kind, "quarantine");
  assert.equal(readFileSync(join(dataDir, "docs", "letter.txt"), "utf8"), "test");
});

test("web tool passes its normalized scope to the guarded fetch", async (t) => {
  const { registry, tool, web } = fixture(t);
  const result = await registry.run(tool("web_fetch", { allowedDomains: ["EXAMPLE.COM."] }), { url: "https://example.com/" });
  assert.equal(result.source, "web");
  assert.deepEqual(web, [{ url: "https://example.com/", allowed: ["example.com"] }]);
});

test("duplicate candidate scan streams progress and obeys abort", async (t) => {
  const { registry, fs, tool } = fixture(t);
  const instance = tool("dup_finder", fs);
  const events = [];
  const found = await registry.run(instance, {}, { emit: (event) => events.push(event) });
  assert.equal(found.scanned, 2);
  assert.equal(found.groups[0].count, 2);
  assert.deepEqual(events, [{ scanned: 2 }]);
  const kill = new AbortController();
  await assert.rejects(registry.run(instance, {}, { emit: () => kill.abort(new Error("killed")) }, kill.signal), /killed/);
  const cases = [tool("datetime"), tool("disk_status"), tool("file_reader", fs), tool("web_fetch"),
    instance, tool("file_mover", fs, "propose")];
  for (const config of cases) {
    await assert.rejects(registry.run(config, {}, {}, kill.signal), /killed/);
  }
});
