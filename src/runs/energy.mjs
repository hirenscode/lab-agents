import { SafetyError } from "../errors.mjs";

const limits = {
  maxSteps: [12, 1, 50],
  maxSeconds: [300, 1, 3600],
  maxTokens: [16000, 64, 128000],
  contextTokens: [8192, 512, 8192],
};

export function energySettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SafetyError("invalid_energy", "Enter valid Energy settings");
  const result = {};
  for (const [name, [fallback, min, max]] of Object.entries(limits)) {
    const amount = value[name] ?? fallback;
    if (!Number.isSafeInteger(amount) || amount < min || amount > max) {
      throw new SafetyError("invalid_energy", `${name} must be between ${min} and ${max}`);
    }
    result[name] = amount;
  }
  return result;
}

function cost(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

export function trimMessages(messages, contextTokens, tools = []) {
  const groups = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const previous = groups.at(-1);
      if (previous?.[0].tool_calls?.length) previous.push(message);
    } else {
      groups.push([message]);
    }
  }
  const first = groups[0]?.[0];
  const essential = first?.role === "system" ? [{ ...first }] : [];
  if (essential.length) groups.shift();
  let remaining = contextTokens - 48 - cost(tools);
  if (remaining <= 96) throw new SafetyError("context_limit", "Tool descriptions exceed the context budget");
  if (essential.length) {
    const maxSystem = Math.max(32, Math.floor(remaining / 3));
    let content = essential[0].content;
    while (cost({ role: "system", content }) > maxSystem && content.length) {
      content = content.slice(0, Math.floor(content.length / 2));
    }
    essential[0].content = content;
    remaining -= cost(essential[0]);
  }
  const user = groups.findIndex(([message]) => message.role === "user");
  if (user >= 0) {
    const [group] = groups.splice(user, 1);
    let content = group[0].content;
    const budget = Math.max(32, Math.floor(remaining / 2));
    while (cost({ role: "user", content }) > budget && content.length) content = content.slice(0, Math.floor(content.length / 2));
    const task = { role: "user", content };
    essential.push(task);
    remaining -= cost(task);
  }
  const kept = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (group[0].tool_calls && group.length !== group[0].tool_calls.length + 1) continue;
    const bytes = cost(group);
    if (bytes > remaining) break;
    kept.unshift(...group);
    remaining -= bytes;
  }
  return [...essential, ...kept];
}
