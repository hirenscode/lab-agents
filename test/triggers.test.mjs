import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.mjs";
import { createRunEngine } from "../src/runs/engine.mjs";
import { createPathGuard } from "../src/safety/path-guard.mjs";
import { createTriggerService } from "../src/triggers/service.mjs";
import { nextSchedule } from "../src/triggers/schedule.mjs";
import { fakeClock } from "../test-support/fake-clock.mjs";

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "lab-triggers-"));
  const share = join(folder, "share");
  mkdirSync(share);
  const clock = fakeClock();
  const pathGuard = createPathGuard([{ id: "share", directory: share, mode: "read" }]);
  let db;
  let engine;
  let service;
  let available = true;
  const errors = [];
  function connect() {
    db = openDatabase(join(folder, "db.sqlite"));
    engine = createRunEngine(db, { pathGuard, brains: { async select() { return null; } }, now: clock.now });
    service = createTriggerService(db, { engine, pathGuard, now: clock.now, available: () => available,
      onError: (error) => errors.push(error) });
  }
  async function close() { await service.close(); await engine.close(); db.close(); }
  connect();
  db.exec(`
    INSERT INTO users(id,dsm_username,role,created_at) VALUES(1,'one','user','now'),(2,'two','user','now');
    INSERT INTO agents(id,owner_id,name,config_json,created_at) VALUES(10,1,'Agent','{"task":"Inspect the share"}','now');
  `);
  t.after(async () => { await close(); rmSync(folder, { recursive: true, force: true }); assert.deepEqual(errors, []); });
  return {
    clock, share,
    get triggers() { return service; },
    get engine() { return engine; },
    rows: () => db.prepare("SELECT trigger_id,occurrence FROM runs ORDER BY id").all(),
    restart: async () => { await close(); connect(); },
    availability: (value) => { available = value; },
  };
}

test("manual stays idle, once disables itself, and interval persists across restart", async (t) => {
  const f = fixture(t);
  const manual = f.triggers.save(1, 10, { kind: "manual" });
  assert.equal(manual.next_run_at, null);
  const once = f.triggers.save(1, 10, { kind: "once", spec: { at: "2026-01-01T00:01:00Z" } });
  const interval = f.triggers.save(1, 10, { kind: "interval", spec: { minutes: 1 } });
  assert.throws(() => f.triggers.list(2, 10), { code: "not_found" });
  f.clock.advance(60_000);
  await f.triggers.tick();
  await f.triggers.tick();
  assert.deepEqual(f.rows().map(({ trigger_id }) => trigger_id), [once.id, interval.id]);
  assert.equal(f.triggers.list(1, 10).find(({ id }) => id === once.id).enabled, false);
  await f.restart();
  f.clock.advance(60_000);
  await f.triggers.tick();
  assert.deepEqual(f.rows().map(({ trigger_id }) => trigger_id), [once.id, interval.id, interval.id]);
  f.engine.spawn(1, 10);
  assert.equal(f.rows().at(-1).trigger_id, null);
});

test("scheduled times use their IANA zone and skip a missing DST clock time", async (t) => {
  const spec = { time: "02:30", timeZone: "America/Los_Angeles", days: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(new Date(nextSchedule(Date.parse("2026-03-08T09:00:00Z"), spec)).toISOString(), "2026-03-09T09:30:00.000Z");
  const f = fixture(t);
  const trigger = f.triggers.save(1, 10, { kind: "schedule", spec: { time: "00:10", timeZone: "UTC" } });
  f.clock.advance(600_000);
  await f.triggers.tick();
  assert.equal(f.rows()[0].trigger_id, trigger.id);
});

test("missed triggers advance once and can skip when a brain is offline", async (t) => {
  const f = fixture(t);
  const once = f.triggers.save(1, 10, { kind: "interval", spec: { minutes: 1 } });
  const missed = f.triggers.save(1, 10, { kind: "interval", spec: { minutes: 1, catchUp: "skip" } });
  f.clock.advance(5 * 60_000);
  await f.triggers.tick();
  assert.deepEqual(f.rows().map(({ trigger_id }) => trigger_id), [once.id]);
  f.availability(false);
  f.clock.advance(60_000);
  await f.triggers.tick();
  assert.equal(f.rows().some(({ trigger_id }) => trigger_id === missed.id), false);
});

test("folder polling sees new files once and preserves its baseline on restart", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.share, "already.txt"), "old");
  const trigger = f.triggers.save(1, 10, { kind: "file_appears", spec: { mountId: "share" } });
  await f.triggers.tick();
  await f.restart();
  f.clock.advance(10_000);
  writeFileSync(join(f.share, "new.txt"), "new");
  await f.triggers.tick();
  await f.triggers.tick();
  assert.deepEqual(f.rows().map(({ trigger_id }) => trigger_id), [trigger.id]);
});
