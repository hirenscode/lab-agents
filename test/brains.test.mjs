import assert from "node:assert/strict";
import { test } from "node:test";
import { createOllamaClient, lanEndpoint } from "../src/brains/ollama.mjs";
import { createBrainRegistry } from "../src/brains/registry.mjs";
import { openDatabase } from "../src/db/database.mjs";
import { fakeHttp, requestText } from "../test-support/http.mjs";

const messages = [{ role: "user", content: "hello" }];

test("Ollama parses split streaming records, tools, usage, and a narrow think fallback", async (t) => {
  const calls = [];
  const endpoint = await fakeHttp(t, async (req, res) => {
    const body = JSON.parse(await requestText(req));
    calls.push(body);
    if (body.think === false) {
      res.writeHead(400);
      res.end('{"error":"model does not support think"}');
      return;
    }
    res.write('{"message":{"content":"hel');
    res.write('lo"},"done":false}\n');
    res.end('{"message":{"tool_calls":[{"function":{"name":"tool_1","arguments":{}}}]},"done":true,"eval_count":2}');
  });
  const deltas = [];
  const result = await createOllamaClient(endpoint).chat({ model: "test", messages, onDelta: (part) => deltas.push(part) });
  assert.deepEqual(deltas, ["hello"]);
  assert.equal(result.message.tool_calls[0].function.name, "tool_1");
  assert.equal(result.usage.output, 2);
  assert.equal(calls[1].think, undefined);
});

test("Ollama maps absent models, aborts a stream and enforces a timeout", async (t) => {
  const endpoint = await fakeHttp(t, async (req, res) => {
    const { model } = JSON.parse(await requestText(req));
    if (model === "missing") { res.writeHead(404); res.end(); return; }
    if (model === "stall") return;
    res.write('{"message":{"content":"started"}}\n');
  });
  const client = createOllamaClient(endpoint);
  await assert.rejects(client.chat({ model: "missing", messages }), { code: "model_missing" });
  const stop = new AbortController();
  await assert.rejects(client.chat({ model: "test", messages, signal: stop.signal, onDelta: () => stop.abort() }), { name: "AbortError" });
  await assert.rejects(createOllamaClient(endpoint, { timeoutMs: 30 }).chat({ model: "stall", messages }), { code: "unavailable" });
});

test("brain registry tracks health, prefers selected models, and falls back to a tool-capable brain", async (t) => {
  const database = openDatabase(":memory:");
  let macOnline = true;
  const registry = createBrainRegistry(database, { clientFactory(url) {
    const mac = url.includes(".5:");
    return {
      async models() { if (mac && !macOnline) throw new Error("offline"); return [mac ? "primary" : "fallback"]; },
      async capabilities() { return mac ? ["completion"] : ["tools"]; },
    };
  } });
  t.after(async () => { await registry.close(); database.close(); });
  const mac = registry.save({ name: "Mac", url: "http://192.168.1.5:11434", priority: 1 });
  const nas = registry.save({ name: "NAS", url: "http://192.168.1.6:11434", priority: 2 });
  await registry.refresh();
  assert.equal((await registry.select({ preferred: mac.id, model: "primary" })).brain.id, mac.id);
  assert.equal((await registry.select({ preferred: mac.id, model: "primary", needsTools: true })).brain.id, nas.id);
  macOnline = false;
  await registry.refresh();
  assert.equal(await registry.select({ preferred: mac.id, strict: true }), null);
  assert.equal((await registry.select({ preferred: mac.id })).model, "fallback");
  assert.ok(registry.get(mac.id).lastSeen);
  assert.throws(() => lanEndpoint("https://ollama.com"), { code: "invalid_brain" });
});

test("private discovery returns candidates with no registry inserts", async () => {
  const db = openDatabase(":memory:");
  const registry = createBrainRegistry(db, { clientFactory: (url) => ({ async version() {
    if (url === "http://192.168.8.11:11434") return "0.9.1";
    throw new Error("absent");
  } }) });
  try {
    assert.deepEqual(await registry.discover("192.168.8.0/24"), [{ url: "http://192.168.8.11:11434", version: "0.9.1" }]);
    assert.deepEqual(registry.list(), []);
    await assert.rejects(registry.discover("8.8.8.0/24"), { code: "invalid_brain" });
  } finally { await registry.close(); db.close(); }
});
