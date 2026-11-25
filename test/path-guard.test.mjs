import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPathGuard, QUARANTINE_DIR } from "../src/safety/path-guard.mjs";
import { assertPermission } from "../src/safety/permissions.mjs";

const denied = { code: "path_denied" };

function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "lab-agents-path-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const share = join(root, "share");
  for (const folder of ["photos", "photos-other", QUARANTINE_DIR]) mkdirSync(join(share, folder), { recursive: true });
  writeFileSync(join(share, "photos", "family photo.txt"), "a");
  writeFileSync(join(share, "photos-other", "outside.txt"), "b");
  writeFileSync(join(share, QUARANTINE_DIR, "hidden.txt"), "c");
  mkdirSync(join(root, "external"));
  writeFileSync(join(root, "external", "secret.txt"), "d");
  const guard = createPathGuard([{ id: "share", directory: share, mode: "read" }]);
  return { root, share, guard, scope: { mountId: "share", folder: "photos" } };
}

test("path guard resolves a file and symlinks inside the scoped folder", (t) => {
  const { share, guard, scope } = fixture(t);
  const photo = join(share, "photos", "family photo.txt");
  symlinkSync(photo, join(share, "photos", "alias.txt"));
  assert.equal(guard.resolve(scope, "family photo.txt").path, photo);
  assert.equal(guard.resolve(scope, "alias.txt").path, photo);
  assert.equal(guard.resolve(scope, "").path, join(share, "photos"));
});

test("path guard rejects traversal, absolute paths, and encoded components", (t) => {
  const { guard, scope } = fixture(t);
  for (const path of [
    "../photos-other/outside.txt", "nested/../family photo.txt", "/etc/passwd", "C:/Windows/example",
    "..\\external", "%2e%2e/outside.txt", "%252e%252e/outside.txt", "folder%2foutside.txt", "bad\0name",
  ]) {
    assert.throws(() => guard.resolve(scope, path), denied, path);
  }
  assert.throws(() => guard.resolve({ ...scope, folder: ".." }, "secret.txt"), denied);
});

test("path guard rejects symlinks beyond the scope, mount, or quarantine boundary", (t) => {
  const { root, share, guard, scope } = fixture(t);
  const photos = join(share, "photos");
  symlinkSync(join(share, "photos-other"), join(photos, "nearby"), "dir");
  symlinkSync(join(root, "external"), join(photos, "external"), "dir");
  symlinkSync(join(root, "external"), join(share, "external"), "dir");
  symlinkSync(join(share, QUARANTINE_DIR), join(share, "quarantine-alias"), "dir");
  assert.throws(() => guard.resolve(scope, "nearby/outside.txt"), denied);
  assert.throws(() => guard.resolve(scope, "external/secret.txt"), denied);
  assert.throws(() => guard.resolve({ mountId: "share", folder: "external" }, "secret.txt"), denied);
  assert.throws(() => guard.resolve({ mountId: "share" }, "quarantine-alias/hidden.txt"), denied);
  assert.throws(() => guard.resolve({ mountId: "share" }, `${QUARANTINE_DIR}/hidden.txt`), denied);
  assert.throws(() => createPathGuard([
    { id: "reserved", directory: join(share, QUARANTINE_DIR), mode: "read" },
  ]), denied);
});

test("path guard denies unknown mounts, write access on a read-only mount, and aborted requests", (t) => {
  const { guard, scope } = fixture(t);
  assert.throws(() => guard.resolve({ mountId: "missing" }, "family photo.txt"), denied);
  assert.throws(() => guard.resolve(scope, "family photo.txt", { access: "write" }), denied);
  const abort = new Error("Run killed");
  assert.throws(() => guard.resolve(scope, "family photo.txt", { signal: AbortSignal.abort(abort) }), abort);
});

test("permissions grant only their declared action and deny unknown modes", () => {
  for (const permission of ["read", "propose", "write"]) assert.doesNotThrow(() => assertPermission(permission, permission));
  for (const [granted, required] of [["write", "propose"], ["propose", "write"], ["read", "write"], ["other", "other"]]) {
    assert.throws(() => assertPermission(granted, required), { code: "permission_denied" });
  }
});
