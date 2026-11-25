import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { StorageError } from "./errors.mjs";

export function initializeDataDirectory(dataDir) {
  try {
    mkdirSync(join(dataDir, "agents"), { recursive: true });
  } catch (cause) {
    throw new StorageError("Could not prepare DATA_DIR", { cause });
  }

  return join(dataDir, "lab-agents.sqlite");
}

export function dataDirWritable(dataDir) {
  const probe = join(dataDir, `.write-test-${randomUUID()}`);
  try {
    writeFileSync(probe, "ok", { flag: "wx" });
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
