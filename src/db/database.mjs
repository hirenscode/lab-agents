import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MigrationError, StorageError } from "../errors.mjs";

const migrations = [
  new URL("./migrations/001-initial.sql", import.meta.url),
  new URL("./migrations/002-run-checkpoints.sql", import.meta.url),
  new URL("./migrations/003-auth.sql", import.meta.url),
];
export const SCHEMA_VERSION = migrations.length;

function migrate(database, now) {
  // Reserve the write lock before reading migration history so concurrent starts
  // cannot both decide to apply the same migration.
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const applied = database.prepare("SELECT version FROM schema_version ORDER BY version").all();
    if (applied.length > migrations.length || applied.some(({ version }, index) => version !== index + 1)) {
      throw new MigrationError("Unsupported schema_version history");
    }

    const record = database.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)");
    for (let index = applied.length; index < migrations.length; index++) {
      database.exec(readFileSync(migrations[index], "utf8"));
      record.run(index + 1, now().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(path, now = () => new Date()) {
  let database;
  try {
    database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    database.exec("PRAGMA busy_timeout = 5000");
  } catch (cause) {
    database?.close();
    throw new StorageError("Could not open the Lab Agents database", { cause });
  }

  try {
    migrate(database, now);
    return database;
  } catch (cause) {
    database.close();
    if (cause instanceof MigrationError) throw cause;
    throw new MigrationError("Could not migrate the Lab Agents database", { cause });
  }
}
