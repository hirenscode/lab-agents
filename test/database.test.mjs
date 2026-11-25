import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openDatabase, SCHEMA_VERSION } from "../src/db/database.mjs";
import { MigrationError } from "../src/errors.mjs";
import { initializeDataDirectory } from "../src/storage.mjs";
import { fakeClock } from "../test-support/fake-clock.mjs";

function makeDataDir(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "lab-agents-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

function tables(database) {
  return database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all().map(({ name }) => name);
}

test("migration creates the data layout and survives restart without reapplying", (t) => {
  const dataDir = makeDataDir(t);
  const path = initializeDataDirectory(dataDir);
  assert.ok(existsSync(join(dataDir, "agents")));
  assert.equal(path, join(dataDir, "lab-agents.sqlite"));

  const clock = fakeClock();
  const appliedAt = clock.now().toISOString();
  const database = openDatabase(path, clock.now);
  try {
    assert.deepEqual(tables(database), [
      "agent_tools", "agents", "approvals", "audit_log", "brains", "duplicate_hashes", "local_admins", "run_events",
      "runs", "schema_version", "sessions", "tool_instances", "triggers", "users",
    ]);
    database.prepare("INSERT INTO users (dsm_username, role, created_at) VALUES (?, ?, ?)")
      .run("owner", "user", appliedAt);
  } finally {
    database.close();
  }

  clock.advance(1_000);
  const reopened = openDatabase(initializeDataDirectory(dataDir), clock.now);
  try {
    const versions = reopened.prepare("SELECT version, applied_at FROM schema_version").all();
    assert.equal(versions.length, SCHEMA_VERSION);
    assert.equal(versions[0].version, 1);
    assert.equal(versions[0].applied_at, appliedAt);
    assert.equal(reopened.prepare("SELECT dsm_username FROM users").get().dsm_username, "owner");
  } finally {
    reopened.close();
  }
});

test("database rejects agent tools and runs assigned to a different owner", () => {
  const database = openDatabase(":memory:");
  try {
    database.exec(`
      INSERT INTO users (id, dsm_username, role, created_at)
        VALUES (1, 'first', 'user', '2026-01-01'), (2, 'second', 'user', '2026-01-01');
      INSERT INTO agents (id, owner_id, name, created_at) VALUES (1, 1, 'First agent', '2026-01-01');
      INSERT INTO tool_instances (id, owner_id, type, name, scope_json, permission, created_at)
        VALUES (1, 1, 'datetime', 'Clock', '{}', 'read', '2026-01-01'),
               (2, 2, 'datetime', 'Other clock', '{}', 'read', '2026-01-01');
    `);
    const addTool = database.prepare("INSERT INTO agent_tools (agent_id, tool_instance_id, owner_id) VALUES (1, ?, ?)");
    addTool.run(1, 1);
    assert.throws(() => addTool.run(2, 1), /FOREIGN KEY constraint failed/);
    assert.throws(() => addTool.run(2, 2), /FOREIGN KEY constraint failed/);

    const addRun = database.prepare("INSERT INTO runs (agent_id, owner_id) VALUES (1, ?) RETURNING state");
    assert.equal(addRun.get(1).state, "queued");
    assert.throws(() => addRun.get(2), /FOREIGN KEY constraint failed/);
  } finally {
    database.close();
  }
});

test("a failed migration rolls back its schema and version record together", (t) => {
  const path = join(makeDataDir(t), "conflict.sqlite");
  const existing = new DatabaseSync(path);
  existing.exec("CREATE TABLE agents (id INTEGER PRIMARY KEY)");
  existing.close();

  assert.throws(() => openDatabase(path), MigrationError);
  const inspected = new DatabaseSync(path);
  try {
    assert.deepEqual(tables(inspected), ["agents"]);
  } finally {
    inspected.close();
  }
});

test("a newer schema version is rejected without changing its history", (t) => {
  const path = join(makeDataDir(t), "newer.sqlite");
  const database = openDatabase(path);
  database.prepare("INSERT INTO schema_version VALUES (?, '2026-01-01')").run(SCHEMA_VERSION + 1);
  database.close();

  assert.throws(() => openDatabase(path), {
    name: MigrationError.name,
    message: "Unsupported schema_version history",
  });
  const inspected = new DatabaseSync(path);
  try {
    assert.equal(inspected.prepare("SELECT max(version) AS version FROM schema_version").get().version, SCHEMA_VERSION + 1);
  } finally {
    inspected.close();
  }
});
