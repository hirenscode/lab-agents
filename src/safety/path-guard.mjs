import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep, win32 } from "node:path";
import { SafetyError } from "../errors.mjs";

export const QUARANTINE_DIR = ".lab-agents-quarantine";
const realpath = realpathSync.native;

function reserved(parts) {
  return parts.some((part) => part.toLowerCase() === QUARANTINE_DIR);
}

function relativePath(value) {
  if (value === "") return value;

  if (typeof value !== "string" || isAbsolute(value) || win32.isAbsolute(value)
      || /[\\\x00]|%[\da-f]{2}/i.test(value)) {
    throw new SafetyError("path_denied", "Expected an unencoded relative path");
  }

  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..") || reserved(parts)) {
    throw new SafetyError("path_denied", "Path contains a forbidden component");
  }
  return value;
}

function directory(path) {
  if (!statSync(path).isDirectory()) {
    throw new SafetyError("path_denied", "Expected a directory");
  }
  return path;
}

function inside(root, path) {
  const child = relative(root, path);
  if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`) || reserved(child.split(sep))) {
    throw new SafetyError("path_denied", "Resolved path is outside the allowed folder");
  }
  return path;
}

export function createPathGuard(mounts) {
  const byId = new Map();
  for (const { id, directory: path, mode } of mounts) {
    if (typeof id !== "string" || id.length === 0 || byId.has(id)
        || typeof path !== "string" || !isAbsolute(path) || !["read", "write"].includes(mode)) {
      throw new SafetyError("path_denied", "Invalid mount configuration");
    }
    const canonical = directory(realpath(path));
    if (reserved(canonical.split(sep))) {
      throw new SafetyError("path_denied", "Quarantine cannot be configured as a tool mount");
    }
    byId.set(id, { path: canonical, mode });
  }

  return {
    resolve(scope, input, { access = "read", signal } = {}) {
      signal?.throwIfAborted();
      const mount = byId.get(scope?.mountId);
      if (!mount || !["read", "write"].includes(access)
          || (access === "write" && mount.mode !== "write")) {
        throw new SafetyError("path_denied", "Mount does not allow the requested access");
      }

      const folder = relativePath(scope.folder ?? "");
      const name = relativePath(input);
      try {
        if (realpath(mount.path) !== mount.path) {
          throw new SafetyError("path_denied", "The configured mount changed");
        }
        const scopePath = directory(inside(mount.path, realpath(join(mount.path, folder))));
        const requestedPath = join(scopePath, name);
        const path = inside(scopePath, realpath(requestedPath));
        signal?.throwIfAborted();
        return { mountPath: mount.path, scopePath, requestedPath, path };
      } catch (cause) {
        if (cause instanceof SafetyError || signal?.aborted) throw cause;
        throw new SafetyError("path_denied", "Could not resolve the scoped path", { cause });
      }
    },
  };
}
