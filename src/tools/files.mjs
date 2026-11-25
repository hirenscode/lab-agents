import { constants, realpathSync } from "node:fs";
import { open, opendir, lstat } from "node:fs/promises";
import { posix } from "node:path";
import { SafetyError } from "../errors.mjs";
import { QUARANTINE_DIR } from "../safety/path-guard.mjs";

export const ignoredDirectories = new Set([QUARANTINE_DIR, "@eaDir", "#recycle", "#snapshot"]);

export async function openScopedFile(pathGuard, scope, path, signal) {
  const resolved = pathGuard.resolve(scope, path, { signal }).path;
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    signal?.throwIfAborted();
    if (!(await file.stat()).isFile()) throw new SafetyError("path_denied", "Expected a regular file");
    if (process.platform === "linux" && realpathSync.native(`/proc/self/fd/${file.fd}`) !== resolved) {
      throw new SafetyError("path_denied", "The opened file changed location");
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

export async function* walkFiles(pathGuard, scope, signal) {
  const directories = [""];
  while (directories.length) {
    signal?.throwIfAborted();
    const folder = directories.pop();
    let resolved;
    try { resolved = pathGuard.resolve(scope, folder, { signal }); } catch (error) {
      if (!folder || signal?.aborted || error.code !== "path_denied") throw error;
      continue;
    }
    const { path, requestedPath } = resolved;
    if (path !== requestedPath) continue;
    const directory = await opendir(path);
    for await (const entry of directory) {
      signal?.throwIfAborted();
      if (ignoredDirectories.has(entry.name)) continue;
      const relative = posix.join(folder, entry.name);
      if (entry.isDirectory()) directories.push(relative);
      if (!entry.isFile()) continue;
      try {
        const target = pathGuard.resolve(scope, relative, { signal });
        if (target.path !== target.requestedPath) continue;
        const info = await lstat(target.path, { bigint: true });
        if (info.isFile()) yield { path: relative, info };
      } catch (error) {
        if (signal?.aborted || !["ENOENT", "ENOTDIR", "path_denied"].includes(error.cause?.code ?? error.code)) throw error;
      }
    }
  }
}

export async function scanCandidates({ pathGuard, scope, emit, signal }) {
  const groups = new Map();
  let scanned = 0;
  for await (const entry of walkFiles(pathGuard, scope, signal)) {
    const size = String(entry.info.size);
    const group = groups.get(size) ?? [];
    group.push(entry.path);
    groups.set(size, group);
    scanned++;
    if (scanned % 100 === 0) await emit?.({ scanned });
  }
  signal?.throwIfAborted();
  await emit?.({ scanned });
  return {
    scanned,
    groups: [...groups].filter(([, files]) => files.length > 1)
      .slice(0, 20).map(([size, files]) => ({ size, count: files.length, samples: files.slice(0, 4) })),
  };
}
