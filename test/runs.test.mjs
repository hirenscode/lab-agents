import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.mjs";
import { createPathGuard } from "../src/safety/path-guard.mjs";
import { createToolRegistry } from "../src/tools/registry.mjs";
import { createRunEngine } from "../src/runs/engine.mjs";
import { trimMessages } from "../src/runs/energy.mjs";
import { streamRunEvents } from "../src/runs/sse.mjs";
import { waitFor } from "../test-support/wait.mjs";

const answer = (content, tool_calls) => ({ message: { content, tool_calls }, usage: { prompt: 4, output: 2 } });
const call = (id, args = {}) => ({ function: { name: `tool_${id}`, arguments: args } });

function fixture(t, { type, script, energy, toolOverride } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "lab-runs-"));
  const db = openDatabase(":memory:");
  db.exec("INSERT INTO users(id,dsm_username,role,created_at) VALUES(1,'one','user','now'),(2,'two','user','now')");
  db.prepare("INSERT INTO agents(id,owner_id,name,config_json,created_at) VALUES(10,1,'Agent',?,'now')")
    .run(JSON.stringify({ task: "Do the work", energy }));
  if (type) {
    db.prepare("INSERT INTO tool_instances(id,owner_id,type,name,scope_json,permission,created_at) VALUES(12,1,?,'Tool',?,?,'now')")
      .run(type, type === "file_mover" ? '{"mountId":"files"}' : "{}", type === "file_mover" ? "propose" : "read");
    db.exec("INSERT INTO agent_tools(agent_id,tool_instance_id,owner_id) VALUES(10,12,1)");
  }
  const pathGuard = createPathGuard([{ id: "files", directory: folder, mode: "write" }]);
  const tools = createToolRegistry({ pathGuard, dataDir: folder });
  if (toolOverride) tools.run = toolOverride;
  let online = true;
  const observed = [];
  db.exec("INSERT INTO brains(id,name,url,priority) VALUES(1,'Fake','http://127.0.0.1:11434',1)");
  const brain = { id: 1 };
  const brains = { async select() {
    return online ? { brain, model: "fake", client: { async chat(input) {
      observed.push(input.messages);
      return script ? script(input, observed.length) : answer("finished");
    } } } : null;
  } };
  const engine = createRunEngine(db, { brains, tools, pathGuard });
  t.after(async () => { await engine.close(); db.close(); rmSync(folder, { recursive: true, force: true }); });
  return { engine, folder, observed, online: (value) => { online = value; },
    state: (id, name) => waitFor(() => { const run = engine.get(1, id); return run.state === name && run; }),
  };
}

test("scripted run calls tools, records usage and streams terminal events", async (t) => {
  const { engine, state, observed } = fixture(t, { type: "datetime", script: (_input, step) => step === 1
    ? answer("", [call(12)]) : answer("finished") });
  const { id } = engine.spawn(1, 10);
  const done = await state(id, "done");
  assert.equal(done.step, 2);
  assert.equal(done.tokens.output, 4);
  assert.equal(observed[1].at(-1).role, "tool");
  assert.throws(() => engine.get(2, id), { code: "not_found" });
  const frames = [];
  await streamRunEvents(engine, 1, id, { write: (frame) => frames.push(frame), end() {} });
  assert.match(frames.join(""), /event: run/);
  assert.match(frames.join(""), /finished/);
});

test("run waits for a brain and resumes when it becomes available", async (t) => {
  const { engine, state, online } = fixture(t);
  online(false);
  const { id } = engine.spawn(1, 10);
  await state(id, "waiting_for_brain");
  online(true);
  engine.resumeWaiting();
  await state(id, "done");
});

test("run Energy bounds repeated calls and trimming preserves whole tool turns", async (t) => {
  const { engine, state } = fixture(t, { type: "datetime", energy: { maxSteps: 1 }, script: () => answer("", [call(12)]) });
  const { id } = engine.spawn(1, 10);
  assert.match((await state(id, "failed")).error, /limit reached/);
  const context = [
    { role: "system", content: "System" }, { role: "user", content: "question" },
    { role: "assistant", content: "", tool_calls: [call(12), call(12)] },
    { role: "tool", content: "answer" },
  ];
  assert.deepEqual(trimMessages(context, 512).map(({ role }) => role), ["system", "user"]);
});

test("one heavy chat per brain queues a second run and kill aborts a tool", async (t) => {
  const start = Promise.withResolvers();
  const complete = Promise.withResolvers();
  const toolStarted = Promise.withResolvers();
  const killed = Promise.withResolvers();
  const { engine, state } = fixture(t, {
    type: "datetime",
    async script(_input, step) { if (step === 1) { start.resolve(); await complete.promise; return answer("", [call(12)]); } return answer("finished"); },
    toolOverride(_config, _args, _ctx, signal) {
      toolStarted.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { killed.resolve(); reject(signal.reason); }, { once: true }));
    },
  });
  const first = engine.spawn(1, 10);
  await start.promise;
  const second = engine.spawn(1, 10);
  await waitFor(() => engine.get(1, second.id).queuePosition === 1);
  complete.resolve();
  await toolStarted.promise;
  assert.equal(engine.kill(1, first.id).state, "killed");
  await killed.promise;
  await state(second.id, "done");
});

test("stored approval gates file movement and resumes the model afterward", async (t) => {
  const { engine, state, folder, observed } = fixture(t, { type: "file_mover", script: (_input, step) => step === 1
    ? answer("", [call(12, { path: "note.txt" })]) : answer("complete") });
  const source = join(folder, "note.txt");
  writeFileSync(source, "safe");
  const { id } = engine.spawn(1, 10);
  const pending = await state(id, "awaiting_approval");
  assert.ok(existsSync(source));
  assert.throws(() => engine.decide(2, id, pending.approvals[0].id, "approved"), { code: "not_found" });
  engine.decide(1, id, pending.approvals[0].id, "approved");
  assert.ok(!existsSync(source));
  await state(id, "done");
  assert.match(observed[1].at(-1).content, /approved/);
});
