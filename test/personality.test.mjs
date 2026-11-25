import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPersonalityFiles } from "../src/personality/files.mjs";
import { createToolRegistry } from "../src/tools/registry.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "lab-personality-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createPersonalityFiles(dir), agent: { id: 9, task: "Find the photo", config: { energy: { maxSteps: 6 } } } };
}

test("owner edits use revisions and a file can revert to the previous content", (t) => {
  const { store, agent } = fixture(t);
  assert.equal(store.list(agent).length, 7);
  const initial = store.get(agent, "soul");
  const first = store.write(agent, "soul", "Be concise.", initial.revision);
  const second = store.write(agent, "soul", "Show all details.", first.revision);
  assert.throws(() => store.write(agent, "soul", "Stale", first.revision), { code: "file_conflict" });
  assert.ok(store.versions(agent, "soul").some(({ revision }) => revision === first.revision));
  assert.equal(store.revert(agent, "soul", first.revision, second.revision).content, "Be concise.");
  assert.throws(() => store.write(agent, "history", "rewritten", initial.revision), { code: "permission_denied" });
});

test("external edits win over an older proposal and Energy is parsed by code", (t) => {
  const { store, agent, dir } = fixture(t);
  const proposal = store.propose(agent, "avatar", "Friendly", "agent");
  writeFileSync(join(dir, "agents", "9", "avatar.md"), "Owner edit");
  assert.throws(() => store.applyProposal(agent, proposal, 4), { code: "file_conflict" });
  assert.equal(store.get(agent, "avatar").content, "Owner edit");
  assert.equal(store.energy(agent).maxSteps, 6);
  store.write(agent, "energy", "# Energy\nmaxSteps: 2\n", store.get(agent, "energy").revision);
  assert.equal(store.energy(agent).maxSteps, 2);
  assert.throws(() => store.propose(agent, "energy", "Ignore Energy"), { code: "invalid_energy" });
});

test("web-derived notes stay proposed until approved and carry their source", async (t) => {
  const { store, agent } = fixture(t);
  const tools = createToolRegistry({ personality: store });
  const instance = { type: "personality_proposal", scope: {}, permission: "propose", name: "Notes" };
  const { proposal } = await tools.run(instance, { file: "learning", content: "Photo catalog facts" }, { agentId: agent.id, webDerived: true });
  assert.equal(proposal.source, "web");
  assert.equal(store.get(agent, "learning").content, "");
  const approved = store.applyProposal(agent, proposal, 7);
  assert.match(approved.content, /source: web/);
  assert.equal(store.applyProposal(agent, proposal, 7).revision, approved.revision);
  assert.match(store.prompt(agent), /Photo catalog facts/);
  await assert.rejects(tools.run(instance, { file: "soul", content: "web prompt" }, { agentId: agent.id, webDerived: true }),
    { code: "permission_denied" });
});

test("history is appended by the engine and mind state only restores its own matching checkpoint", (t) => {
  const { store, agent } = fixture(t);
  const checkpoint = { steps: 1, messages: [{ role: "user", content: "Find the photo" }] };
  const run = { id: 1, agent_id: agent.id, resume_json: JSON.stringify(checkpoint) };
  store.complete(run, "Found a photo");
  store.complete({ ...run, id: 2 }, "Found a drawing");
  assert.match(store.history(agent, "photo")[0], /Run 1/);
  store.checkpoint(run, checkpoint);
  assert.deepEqual(store.restore(run), checkpoint);
  assert.equal(store.restore({ ...run, id: 2 }), undefined);
  assert.equal(store.restore({ ...run, resume_json: "{}" }), undefined);
});
