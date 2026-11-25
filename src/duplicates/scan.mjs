import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { SafetyError } from "../errors.mjs";
import { openScopedFile, walkFiles } from "../tools/files.mjs";

const sample = 64 * 1024;
const chunkSize = 256 * 1024;
const keyFor = (info) => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join("/");

function push(groups, key, entry) {
  const group = groups.get(key) ?? [];
  group.push(entry);
  groups.set(key, group);
}

async function digest(file, size, phase, signal) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(chunkSize);
  const ranges = phase === "partial" && size > sample * 2
    ? [[0, sample], [size - sample, size]] : [[0, size]];
  for (const [start, end] of ranges) {
    let position = start;
    while (position < end) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, end - position), position);
      if (!bytesRead) return null;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      await setImmediate();
    }
  }
  return hash.digest("hex");
}

export function createDuplicateScanner(database, { now = () => Date.now() } = {}) {
  const select = database.prepare("SELECT partial_hash,full_hash FROM duplicate_hashes WHERE identity=?");
  const remember = database.prepare(`
    INSERT INTO duplicate_hashes(identity,partial_hash,full_hash,touched_at) VALUES(?,?,?,?)
    ON CONFLICT(identity) DO UPDATE SET partial_hash=coalesce(excluded.partial_hash,partial_hash),
      full_hash=coalesce(excluded.full_hash,full_hash),touched_at=excluded.touched_at
  `);

  return async ({ pathGuard, scope, emit, signal }) => {
    const sized = new Map();
    let scanned = 0;
    let hashed = 0;
    let cacheHits = 0;
    const report = async (phase) => {
      signal?.throwIfAborted();
      await emit?.({ phase, scanned, hashed, cacheHits });
      signal?.throwIfAborted();
    };

    for await (const entry of walkFiles(pathGuard, scope, signal)) {
      if (++scanned > 200000) throw new SafetyError("scan_limit", "Use a folder with at most 200,000 files per scan");
      push(sized, String(entry.info.size), entry);
      if (scanned % 100 === 0) await report("inventory");
    }
    await report("inventory");

    async function groupByHash(input, phase) {
      const result = new Map();
      for (const [groupKey, group] of input) {
        if (group.length < 2) continue;
        for (const entry of group) {
          signal?.throwIfAborted();
          let file;
          try {
            file = await openScopedFile(pathGuard, scope, entry.path, signal);
            const before = await file.stat({ bigint: true });
            const key = keyFor(before);
            if (key !== keyFor(entry.info) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) continue;
            const cached = select.get(key)?.[phase + "_hash"];
            const hash = cached ?? await digest(file, Number(before.size), phase, signal);
            if (!hash || keyFor(await file.stat({ bigint: true })) !== key) continue;
            if (cached) cacheHits++;
            else hashed++;
            remember.run(key, phase === "partial" ? hash : null, phase === "full" ? hash : null, now());
            push(result, groupKey + ":" + hash, entry);
          } catch (error) {
            signal?.throwIfAborted();
            if (!["ENOENT", "ENOTDIR", "ELOOP", "path_denied"].includes(error.cause?.code ?? error.code)) throw error;
          } finally { await file?.close(); }
          if ((hashed + cacheHits) % 50 === 0) await report(phase);
        }
      }
      await report(phase);
      return result;
    }

    const partial = await groupByHash(sized, "partial");
    const full = await groupByHash(partial, "full");
    const confirmed = [...full.values()].filter((group) => group.length > 1);
    const groups = confirmed.slice(0, 20).map((group) => ({
      size: String(group[0].info.size), count: group.length, samples: group.slice(0, 6).map(({ path }) => path),
    }));
    database.prepare("DELETE FROM duplicate_hashes WHERE touched_at<?").run(now() - 30 * 86_400_000);
    return { scanned, hashed, cacheHits, duplicateGroups: confirmed.length, groups };
  };
}

export async function verifyDuplicatePair(pathGuard, scope, path, keepPath, signal) {
  const fail = () => { throw new SafetyError("duplicate_required", "Choose two unchanged, byte-identical files and keep one"); };
  if (!keepPath || keepPath === path) fail();
  const move = await openScopedFile(pathGuard, scope, path, signal);
  let keep;
  try {
    keep = await openScopedFile(pathGuard, scope, keepPath, signal);
    const source = await move.stat({ bigint: true });
    const other = await keep.stat({ bigint: true });
    if (source.size !== other.size || source.size > BigInt(Number.MAX_SAFE_INTEGER)) fail();
    const size = Number(source.size);
    const from = await digest(move, size, "full", signal);
    const to = await digest(keep, size, "full", signal);
    if (!from || from !== to || keyFor(source) !== keyFor(await move.stat({ bigint: true })) ||
        keyFor(other) !== keyFor(await keep.stat({ bigint: true }))) fail();
    const record = (info) => ({
      device: String(info.dev), inode: String(info.ino), size: String(info.size),
      modified: String(info.mtimeNs), changed: String(info.ctimeNs),
    });
    return { file: record(source), keep: { path: keepPath, file: record(other) } };
  } finally {
    await keep?.close();
    await move.close();
  }
}
