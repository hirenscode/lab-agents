import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { recordAudit } from "../src/db/audit.mjs";
import { openDatabase } from "../src/db/database.mjs";
import { createPathGuard, QUARANTINE_DIR } from "../src/safety/path-guard.mjs";
import { moveToQuarantine, prepareQuarantineProposal } from "../src/safety/quarantine.mjs";
import { fakeClock } from "../test-support/fake-clock.mjs";

const denied = { code: "quarantine_denied" };

function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "lab-agents-quarantine-")));
  const share = join(root, "share");
  mkdirSync(join(share, "photos"), { recursive: true });
  const path = "report.txt";
  const source = join(share, "photos", path);
  writeFileSync(source, "original data");
  const scope = { mountId: "share", folder: "photos" };
  const pathGuard = createPathGuard([{ id: "share", directory: share, mode: "write" }]);
  const database = openDatabase(":memory:");
  const clock = fakeClock();
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  database.exec(`
    INSERT INTO users (id, dsm_username, role, created_at)
      VALUES (1, 'owner', 'user', '2026-01-01'), (2, 'other', 'admin', '2026-01-01');
    INSERT INTO agents (id, owner_id, name, created_at) VALUES (10, 1, 'Agent', '2026-01-01');
    INSERT INTO runs (id, agent_id, owner_id) VALUES (20, 10, 1);
  `);
  const propose = { pathGuard, scope, path, permission: "propose" };
  const proposal = prepareQuarantineProposal(propose);
  database.prepare("INSERT INTO approvals (id, run_id, proposal_json) VALUES (30, 20, ?)")
    .run(JSON.stringify(proposal));
  const approve = (decidedBy = 1) => database.prepare(`
    UPDATE approvals SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = 30
  `).run(decidedBy, clock.now().toISOString());
  const args = { ...propose, database, approvalId: 30, userId: 1, now: clock.now };
  const audit = () => database.prepare("SELECT ts, user_id, action, detail_json FROM audit_log ORDER BY id")
    .all().map(({ ts, user_id, action, detail_json }) => ({
      ts, userId: user_id, action, detail: JSON.parse(detail_json),
    }));
  return { root, share, source, database, clock, propose, proposal, args, approve, audit };
}

test("SQLite audit records the timestamp and handles only the defined identifiers and actions", (t) => {
  const { database, clock, audit } = fixture(t);
  const actor = { userId: 1, runId: 20 };
  recordAudit(database, { ...actor, action: "tool_call", toolInstanceId: 12, token: "sensitive" }, clock.now);
  clock.advance(100);
  recordAudit(database, { ...actor, action: "approval", approvalId: 30, decision: "approved" }, clock.now);
  recordAudit(database, { ...actor, action: "kill", args: ["sensitive"] }, clock.now);
  assert.deepEqual(audit(), [
    { ts: "2026-01-01T00:00:00.000Z", userId: 1, action: "tool_call", detail: { runId: 20, toolInstanceId: 12 } },
    { ts: clock.now().toISOString(), userId: 1, action: "approval", detail: { runId: 20, approvalId: 30, decision: "approved" } },
    { ts: clock.now().toISOString(), userId: 1, action: "kill", detail: { runId: 20 } },
  ]);
  const invalid = { code: "invalid_audit_event" };
  assert.throws(() => recordAudit(database, { ...actor, action: "other" }), invalid);
  assert.throws(() => recordAudit(database, { ...actor, action: "kill", runId: 0 }), invalid);
  assert.throws(() => recordAudit(database, { ...actor, action: "approval", approvalId: 30, decision: "pending" }), invalid);
  assert.equal(audit().length, 3);
});

test("quarantine denies pending approvals, different actors, and scope changes", (t) => {
  const { args, approve, source, share, audit } = fixture(t);
  assert.throws(() => moveToQuarantine(args), denied);
  approve(2);
  assert.throws(() => moveToQuarantine(args), denied);
  assert.throws(() => moveToQuarantine({ ...args, userId: 2 }), denied);
  approve();
  assert.throws(() => moveToQuarantine({ ...args, scope: { mountId: "share" } }), denied);
  assert.throws(() => moveToQuarantine({ ...args, permission: "write" }), { code: "permission_denied" });
  assert.equal(readFileSync(source, "utf8"), "original data");
  assert.ok(!existsSync(join(share, QUARANTINE_DIR)));
  assert.deepEqual(audit(), []);
});

test("approved quarantine renames the file, writes a manifest, and records the move once", (t) => {
  const { args, approve, source, proposal, share, clock, audit } = fixture(t);
  approve();
  const receipt = moveToQuarantine(args);
  assert.equal(receipt.path, join(share, QUARANTINE_DIR, proposal.entryId, "file"));
  assert.equal(readFileSync(receipt.path, "utf8"), "original data");
  assert.ok(!existsSync(source));
  const manifest = JSON.parse(readFileSync(join(dirname(receipt.path), "manifest.json"), "utf8"));
  assert.deepEqual(manifest, {
    action: "quarantine_move", approvalId: 30, userId: 1, runId: 20, proposal, recordedAt: clock.now().toISOString(),
  });

  writeFileSync(source, "new file at the original path");
  assert.deepEqual(moveToQuarantine(args), receipt);
  assert.equal(readFileSync(source, "utf8"), "new file at the original path");
  assert.deepEqual(audit(), [{
    ts: clock.now().toISOString(), userId: 1, action: "quarantine_move", detail: { runId: 20, approvalId: 30 },
  }]);
});

test("a file replaced after approval stays at its source and the move is rolled back", (t) => {
  const { args, approve, source, share, proposal, audit } = fixture(t);
  approve();
  renameSync(source, join(dirname(source), "original.txt"));
  writeFileSync(source, "replacement");

  assert.throws(() => moveToQuarantine(args), denied);
  assert.equal(readFileSync(source, "utf8"), "replacement");
  assert.equal(readFileSync(join(dirname(source), "original.txt"), "utf8"), "original data");
  assert.ok(!existsSync(join(share, QUARANTINE_DIR, proposal.entryId, "file")));
  assert.deepEqual(audit(), []);
});

test("quarantine rejects aliased sources and a symlink in place of the quarantine directory", (t) => {
  const { args, approve, source, propose, root, share, audit } = fixture(t);
  symlinkSync(source, join(dirname(source), "alias.txt"));
  assert.throws(() => prepareQuarantineProposal({ ...propose, path: "alias.txt" }), denied);

  const otherDirectory = join(root, "other");
  mkdirSync(otherDirectory);
  symlinkSync(otherDirectory, join(share, QUARANTINE_DIR));
  approve();
  assert.throws(() => moveToQuarantine(args), denied);
  assert.equal(readFileSync(source, "utf8"), "original data");
  assert.deepEqual(audit(), []);
});

test("quarantine can retry an audit failure without moving an unaudited file", (t) => {
  const { args, approve, source, database, audit } = fixture(t);
  approve();
  database.exec(`
    CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log
    BEGIN SELECT RAISE(ABORT, 'Audit unavailable'); END;
  `);
  assert.throws(() => moveToQuarantine(args), /Audit unavailable/);
  assert.equal(readFileSync(source, "utf8"), "original data");
  assert.deepEqual(audit(), []);
  database.exec("DROP TRIGGER fail_audit");
  assert.equal(readFileSync(moveToQuarantine(args).path, "utf8"), "original data");
  assert.equal(audit().length, 1);
});

test("replaying an intact quarantine manifest restores a missing audit record", (t) => {
  const { args, approve, database, audit } = fixture(t);
  approve();
  const receipt = moveToQuarantine(args);
  database.exec("DELETE FROM audit_log");
  assert.deepEqual(moveToQuarantine(args), receipt);
  assert.equal(audit().length, 1);
});

test("quarantine refuses a preexisting directory with group access", (t) => {
  const { args, approve, source, share, audit } = fixture(t);
  const quarantine = join(share, QUARANTINE_DIR);
  mkdirSync(quarantine);
  chmodSync(quarantine, 0o770);
  approve();
  assert.throws(() => moveToQuarantine(args), denied);
  assert.equal(readFileSync(source, "utf8"), "original data");
  assert.deepEqual(audit(), []);
});
