import { BlockList, isIP } from "node:net";

export class BrainError extends Error {
  name = "BrainError";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const lan = new BlockList();
for (const [address, prefix] of [["10.0.0.0", 8], ["127.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]]) {
  lan.addSubnet(address, prefix);
}
lan.addSubnet("fc00::", 7, "ipv6");
lan.addAddress("::1", "ipv6");

export function lanEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new BrainError("invalid_brain", "Enter a local HTTP or HTTPS endpoint"); }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ip = isIP(host);
  const local = ip ? lan.check(host, ip === 6 ? "ipv6" : "ipv4") : host === "localhost" || host === "host.docker.internal";
  if (!local || !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new BrainError("invalid_brain", "Enter an HTTP or HTTPS origin on the local network");
  }
  return url.origin;
}

async function limitedText(response, cap = 524288) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > cap) throw new BrainError("invalid_response", "Ollama response exceeded its limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export function createOllamaClient(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  const origin = lanEndpoint(endpoint);
  async function request(path, body, caller, budget = timeoutMs) {
    const timeout = AbortSignal.timeout(budget);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    try {
      return await fetchImpl(new URL(path, origin), {
        signal, redirect: "error", method: body ? "POST" : "GET",
        ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch {
      caller?.throwIfAborted();
      throw new BrainError("unavailable", "Ollama is unavailable");
    }
  }

  function failure(response) {
    if (response.status === 404) return new BrainError("model_missing", "Ollama model is missing");
    if (response.status === 429 || response.status >= 500) return new BrainError("unavailable", "Ollama is unavailable");
    return new BrainError("invalid_response", "Ollama refused the request");
  }

  async function json(path, body, caller) {
    const response = await request(path, body, caller, Math.min(timeoutMs, 5000));
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw failure(response);
    }
    try { return JSON.parse(await limitedText(response)); } catch {
      caller?.throwIfAborted();
      throw new BrainError("invalid_response", "Ollama sent an invalid response");
    }
  }

  return {
    async version(signal) {
      const data = await json("/api/version", undefined, signal);
      if (typeof data.version !== "string" || !/^\d+\.\d+/.test(data.version)) {
        throw new BrainError("invalid_response", "Endpoint did not identify as Ollama");
      }
      return data.version;
    },
    async models(signal) {
      const data = await json("/api/tags", undefined, signal);
      if (!Array.isArray(data.models)) throw new BrainError("invalid_response", "Ollama sent an invalid model list");
      return [...new Set(data.models.map((entry) => entry.name ?? entry.model).filter((name) => typeof name === "string"))];
    },
    async capabilities(model, signal) {
      const data = await json("/api/show", { model }, signal);
      return Array.isArray(data.capabilities) ? data.capabilities : [];
    },
    async chat({ model, messages, tools = [], numCtx = 8192, numPredict = 1024, signal, onDelta }) {
      const budget = AbortSignal.timeout(timeoutMs);
      const total = signal ? AbortSignal.any([signal, budget]) : budget;
      const body = { model, messages, tools, stream: true, think: false, options: { num_ctx: numCtx, num_predict: numPredict } };
      try {
        let response = await request("/api/chat", body, total);
        if (response.status === 400 && /think/i.test(await limitedText(response, 8192))) {
          delete body.think;
          response = await request("/api/chat", body, total);
        }
        if (!response.ok) {
          if (!response.bodyUsed) await response.body?.cancel().catch(() => {});
          throw failure(response);
        }

        let content = "";
        let done;
        const toolCalls = [];
        let bytes = 0;
        let carry = "";
        const decoder = new TextDecoder();
        const consume = async (line) => {
          if (!line.trim()) return;
          const record = JSON.parse(line);
          if (record.error) throw new BrainError("invalid_response", "Ollama rejected the stream");
          const delta = record.message?.content;
          if (typeof delta === "string" && delta) {
            content += delta;
            await onDelta?.(delta);
          }
          if (Array.isArray(record.message?.tool_calls)) toolCalls.push(...record.message.tool_calls);
          if (record.done) done = record;
        };
        for await (const chunk of response.body ?? []) {
          total.throwIfAborted();
          bytes += chunk.length;
          if (bytes > 2_000_000) throw new BrainError("invalid_response", "Ollama stream exceeded its limit");
          const lines = (carry + decoder.decode(chunk, { stream: true })).split("\n");
          carry = lines.pop();
          for (const line of lines) await consume(line);
        }
        await consume(carry + decoder.decode());
        if (!done) throw new BrainError("unavailable", "Ollama stream ended early");
        return {
          message: { role: "assistant", content, ...(toolCalls.length && { tool_calls: toolCalls }) },
          usage: { prompt: done.prompt_eval_count ?? 0, output: done.eval_count ?? 0 },
        };
      } catch (err) {
        signal?.throwIfAborted();
        if (budget.aborted || err.name === "AbortError" || err.name === "TypeError") throw new BrainError("unavailable", "Ollama is unavailable");
        if (err instanceof SyntaxError) throw new BrainError("invalid_response", "Ollama sent invalid stream data");
        throw err;
      }
    },
  };
}
