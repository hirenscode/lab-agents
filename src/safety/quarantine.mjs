import { randomUUID } from "node:crypto";
import {
  closeSync, constants, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { recordAudit } from "../db/audit.mjs";
import { SafetyError } from "../errors.mjs";
import { QUARANTINE_DIR } from "./path-guard.mjs";
import { assertPermission } from "./permissions.mjs";

function denied(message) {
  return new SafetyError("quarantine_denied", message);
}

function identity(info) {
  if (!info?.isFile()) throw denied("Only regular files can be quarantined");
  return {
    device: String(info.dev),
    inode: String(info.ino),
    size: String(info.size),
    modified: String(info.mtimeNs),
    changed: String(info.ctimeNs),
  };
}

function matches(info, expected, fields = Object.keys(info)) {
  return fields.every((key) => info[key] === expected?.[key]);
}

function resolveFile(pathGuard, scope, path, signal) {
  const target = pathGuard.resolve(scope, path, { access: "write", signal });
  if (target.requestedPath !== target.path) throw denied("Quarantine requires the file's direct path");
  return target;
}

export function prepareQuarantineProposal({ pathGuard, scope, path, permission, signal }) {
  assertPermission(permission, "propose");
  const target = resolveFile(pathGuard, scope, path, signal);
  return {
    kind: "quarantine",
    entryId: randomUUID(),
    scope: { mountId: scope.mountId, folder: scope.folder ?? "" },
    path,
    source: relative(target.mountPath, target.path),
    file: identity(lstatSync(target.path, { bigint: true })),
  };
}

function approvedRow(database, approvalId, userId) {
  const row = database.prepare(`
    SELECT approvals.run_id AS runId, approvals.proposal_json AS proposal
    FROM approvals JOIN runs ON runs.id = approvals.run_id
    WHERE approvals.id = ? AND approvals.status = 'approved'
      AND approvals.decided_at IS NOT NULL AND approvals.decided_by = ? AND runs.owner_id = ?
  `).get(approvalId, userId, userId);
  if (!row) throw denied("Quarantine requires approval from the run owner");
  return row;
}

function withDirectory(path, expected, operation) {
  if (realpathSync.native(path) !== expected) throw denied("A quarantine directory or source folder changed");
  if (process.platform !== "linux") return operation(path);

  // On Linux the rename can address the opened directories even if a path alias changes.
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const handle = `/proc/self/fd/${fd}`;
    if (realpathSync.native(handle) !== expected) throw denied("A quarantine directory or source folder changed");
    return operation(handle);
  } finally {
    closeSync(fd);
  }
}

function ensureDirectory(path) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const info = lstatSync(path);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw denied("Quarantine directories must be private to the service user");
  }
}

function writeManifest(path, manifest) {
  const temporary = join(dirname(path), `manifest-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600, flush: true });
    renameSync(temporary, path);
  } catch (error) {
    if (error.code !== "EEXIST" && lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
    throw error;
  }
}

function ensureAudit(database, event, now) {
  const previous = database.prepare(`
    SELECT 1 FROM audit_log
    WHERE user_id = ? AND action = ?
      AND json_extract(detail_json, '$.approvalId') = ?
      AND json_extract(detail_json, '$.runId') = ?
  `).get(event.userId, event.action, event.approvalId, event.runId);
  if (!previous) recordAudit(database, event, now);
}

function moveInEntry({ database, pathGuard, scope, proposal, event, now, signal, mountPath }, entry) {
  if (lstatSync(join(entry, "restored.json"), { throwIfNoEntry: false })) throw denied("The approved file was already restored");
  const payload = join(entry, "file");
  const manifestPath = join(entry, "manifest.json");
  const manifestInfo = lstatSync(manifestPath, { throwIfNoEntry: false });
  const existingFile = lstatSync(payload, { throwIfNoEntry: false, bigint: true });
  if (manifestInfo) {
    if (!manifestInfo.isFile()) throw denied("Invalid quarantine manifest");
    const saved = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!matches(event, saved) || JSON.stringify(saved.proposal) !== JSON.stringify(proposal)) {
      throw denied("Quarantine entry belongs to a different approval");
    }
  }

  if (existingFile) {
    if (!manifestInfo || !matches(identity(existingFile), proposal.file, ["device", "inode", "size", "modified"])) {
      throw denied("Quarantine payload does not match its approval");
    }
    ensureAudit(database, event, now);
    return;
  }

  if (scope.requireDuplicate || proposal.keep) {
    const kept = pathGuard.resolve(scope, proposal.keep?.path, { signal });
    const keptFile = identity(lstatSync(kept.path, { bigint: true }));
    if (kept.path !== kept.requestedPath || kept.path === join(mountPath, proposal.source) ||
        !matches(keptFile, proposal.keep?.file)) {
      throw denied("The duplicate chosen to stay has changed");
    }
  }
  const target = resolveFile(pathGuard, scope, proposal.path, signal);
  if (target.mountPath !== mountPath || relative(mountPath, target.path) !== proposal.source) {
    throw denied("The approved file location changed");
  }
  if (!manifestInfo) writeManifest(manifestPath, { ...event, proposal, recordedAt: now().toISOString() });
  ensureAudit(database, event, now);

  const sourceParent = dirname(target.path);
  withDirectory(sourceParent, sourceParent, (parent) => {
    const source = join(parent, basename(target.path));
    if (!matches(identity(lstatSync(source, { bigint: true })), proposal.file)) {
      throw denied("The approved file changed");
    }
    if (realpathSync.native(parent) !== sourceParent
        || realpathSync.native(entry) !== join(mountPath, QUARANTINE_DIR, proposal.entryId)) {
      throw denied("A quarantine directory or source folder changed");
    }
    signal?.throwIfAborted();
    renameSync(source, payload);
  });
}

export function moveToQuarantine({
  database, pathGuard, scope, permission, approvalId, userId, now = () => new Date(), signal,
}) {
  assertPermission(permission, "propose");
  signal?.throwIfAborted();
  if (![approvalId, userId].every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw denied("Quarantine requires valid approval and user identifiers");
  }

  // The write transaction serializes application of a persisted approval. If the
  // process stops after rename, the manifest and payload let a retry finish the audit.
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = approvedRow(database, approvalId, userId);
    const proposal = JSON.parse(row.proposal);
    const entryId = proposal?.entryId;
    if (proposal?.kind !== "quarantine"
        || typeof entryId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(entryId)
        || proposal.scope?.mountId !== scope?.mountId || proposal.scope?.folder !== (scope?.folder ?? "")) {
      throw denied("Approval does not match the current quarantine scope");
    }

    const { mountPath } = pathGuard.resolve(scope, "", { access: "write", signal });
    const event = { action: "quarantine_move", approvalId, userId, runId: row.runId };
    withDirectory(mountPath, mountPath, (mount) => {
      const quarantine = join(mount, QUARANTINE_DIR);
      const quarantinePath = join(mountPath, QUARANTINE_DIR);
      ensureDirectory(quarantine);
      withDirectory(quarantine, quarantinePath, (root) => {
        const entry = join(root, entryId);
        ensureDirectory(entry);
        withDirectory(entry, join(quarantinePath, entryId), (folder) => {
          moveInEntry({ database, pathGuard, scope, proposal, event, now, signal, mountPath }, folder);
        });
      });
    });
    database.exec("COMMIT");
    return { entryId, path: join(mountPath, QUARANTINE_DIR, entryId, "file") };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function restoreFromQuarantine({ database, pathGuard, approvalId, userId, now = () => new Date() }) {
  if (![approvalId, userId].every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw denied("Restore requires the original approval and its owner");
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const row = approvedRow(database, approvalId, userId);
    const proposal = JSON.parse(row.proposal);
    if (proposal?.kind !== "quarantine" || typeof proposal.entryId !== "string" ||
        !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(proposal.entryId) ||
        typeof proposal.path !== "string") throw denied("The approval does not contain a quarantined file");

    const parent = dirname(proposal.path);
    const target = pathGuard.resolve(proposal.scope, parent === "." ? "" : parent, { access: "write" });
    const name = basename(proposal.path);
    if (!name || name === ".." || name === "." || target.path !== target.requestedPath ||
        relative(target.mountPath, join(target.path, name)) !== proposal.source) throw denied("The approved file location changed");

    const event = { action: "quarantine_restore", userId, runId: row.runId, approvalId };
    const directory = join(target.mountPath, QUARANTINE_DIR, proposal.entryId);
    withDirectory(directory, directory, (entry) => {
      const manifestPath = join(entry, "manifest.json");
      if (!lstatSync(manifestPath).isFile()) throw denied("Invalid quarantine manifest");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (!matches({ userId, runId: row.runId, approvalId }, manifest) ||
          JSON.stringify(manifest.proposal) !== JSON.stringify(proposal)) throw denied("Quarantine manifest differs from approval");

      const payload = join(entry, "file");
      const marker = join(entry, "restored.json");
      const info = lstatSync(payload, { bigint: true, throwIfNoEntry: false });
      const restored = lstatSync(marker, { throwIfNoEntry: false })?.isFile();
      if (!info && restored) { ensureAudit(database, event, now); return; }
      if (!info || !matches(identity(info), proposal.file, ["device", "inode", "size", "modified"])) {
        throw denied("Quarantine payload does not match its manifest");
      }

      withDirectory(target.path, target.path, (folder) => {
        const original = join(folder, name);
        const existing = lstatSync(original, { bigint: true, throwIfNoEntry: false });
        if (existing && (!existing.isFile() || !matches(identity(existing), proposal.file, ["device", "inode"]))) {
          throw new SafetyError("file_conflict", "Restore stopped because the original path is occupied");
        }
        // Linking creates the original name only if it is free. The quarantined
        // data remains intact until the original name and receipt both exist.
        if (!existing) {
          try { linkSync(payload, original); }
          catch (error) {
            if (error.code === "EEXIST") throw new SafetyError("file_conflict", "Restore stopped because the original path is occupied");
            throw error;
          }
        }
        if (!restored) writeManifest(marker, { ...event, restoredAt: now().toISOString() });
        if (!matches(identity(lstatSync(original, { bigint: true })), proposal.file, ["device", "inode"])) {
          throw denied("The restore location changed");
        }
        ensureAudit(database, event, now);
        unlinkSync(payload);
      });
    });
    database.exec("COMMIT");
    return { restored: true, path: proposal.path };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
