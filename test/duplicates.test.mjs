import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.mjs";
import { createPathGuard } from "../src/safety/path-guard.mjs";
import { createDuplicateScanner } from "../src/duplicates/scan.mjs";
import { createDuplicateWorker } from "../src/duplicates/process.mjs";
import { createToolRegistry } from "../src/tools/registry.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "lab-dupes-"));
  const folder = join(dir, "photos");
  mkdirSync(folder);
  const mounts = [{ id: "photos", directory: folder, mode: "write" }];
  const guard = createPathGuard(mounts);
  const filename = join(dir, "hashes.sqlite");
  const db = openDatabase(filename);
  const scope = { mountId: "photos" };
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, filename, folder, mounts, scope, guard };
}

test("duplicate finder checks the full contents, skips NAS system folders, and reuses its cache", async (t) => {
  const { db, folder, scope, guard } = fixture(t);
  const bytes = Buffer.alloc(140_000, 7);
  writeFileSync(join(folder, "first.bin"), bytes);
  writeFileSync(join(folder, "copy.bin"), bytes);
  bytes[70_000] = 9;
  writeFileSync(join(folder, "different.bin"), bytes);
  for (let i = 1; i <= 320; i++) writeFileSync(join(folder, `unique-${i}`), Buffer.alloc(i));
  for (const name of ["@eaDir", "#recycle", "#snapshot"]) {
    mkdirSync(join(folder, name));
    writeFileSync(join(folder, name, "ignored.bin"), bytes);
  }
  const scan = createDuplicateScanner(db);
  const progress = [];
  const first = await scan({ pathGuard: guard, scope, emit: (event) => progress.push(event) });
  assert.equal(first.scanned, 323);
  assert.equal(first.duplicateGroups, 1);
  assert.deepEqual(first.groups[0].samples.sort(), ["copy.bin", "first.bin"]);
  assert.ok(progress.some(({ phase }) => phase === "full"));
  const next = await scan({ pathGuard: guard, scope });
  assert.equal(next.hashed, 0);
  assert.equal(next.cacheHits, 6);
});

test("the nice worker streams progress and stops on abort", async (t) => {
  const { filename, folder, mounts, scope } = fixture(t);
  writeFileSync(join(folder, "a"), "same");
  writeFileSync(join(folder, "b"), "same");
  const scan = createDuplicateWorker(filename, mounts);
  assert.equal((await scan({ scope })).duplicateGroups, 1);
  const stop = new AbortController();
  await assert.rejects(scan({ scope, signal: stop.signal, emit: () => stop.abort() }), { name: "AbortError" });
});

test("duplicate-only mover requires an identical file to keep", async (t) => {
  const { folder, scope, guard } = fixture(t);
  writeFileSync(join(folder, "a"), "same");
  writeFileSync(join(folder, "b"), "same");
  writeFileSync(join(folder, "different"), "else");
  const tools = createToolRegistry({ pathGuard: guard, dataDir: folder });
  const mover = { type: "file_mover", name: "Move", scope: { ...scope, requireDuplicate: true }, permission: "propose" };
  await assert.rejects(tools.run(mover, { path: "a", keepPath: "different" }), { code: "duplicate_required" });
  const { proposal } = await tools.run(mover, { path: "a", keepPath: "b" });
  assert.equal(proposal.keep.path, "b");
});
