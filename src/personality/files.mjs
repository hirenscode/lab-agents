import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync,
  readdirSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SafetyError } from "../errors.mjs";
import { energySettings } from "../runs/energy.mjs";

export const personalityFiles = ["soul", "avatar", "energy", "memory", "learning", "history", "mind"];
const editable = new Set(personalityFiles.slice(0, 5));
const maxText = 65_536;
const maxMind = 2_500_000;
const fence = String.fromCharCode(96).repeat(3);
const mindPrefix = "\n" + fence + "json\n";
const mindSuffix = "\n" + fence + "\n";
const hash = (content) => createHash("sha256").update(content).digest("hex");
const denied = (code, message) => { throw new SafetyError(code, message); };

function directory(path) {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  if (!lstatSync(path).isDirectory()) denied("path_denied", "Agent file directory is invalid");
  return path;
}

function readFile(path, limit, tail = false) {
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || (!tail && info.size > limit)) denied("invalid_file", "Agent file is too large or invalid");
    const buffer = Buffer.alloc(Math.min(info.size, limit) + 1);
    const offset = tail ? Math.max(0, info.size - limit) : 0;
    const count = readSync(fd, buffer, 0, buffer.length, offset);
    if (count > limit) denied("invalid_file", "Agent file is too large");
    return buffer.subarray(0, count).toString("utf8");
  } finally { closeSync(fd); }
}

function atomicWrite(path, content, verify = () => {}) {
  const temporary = join(dirname(path), "." + randomUUID() + ".tmp");
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600, flush: true });
    verify();
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function parseEnergy(content, fallback) {
  const fields = Object.create(null);
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const field = /^\s*(maxSteps|maxSeconds|maxTokens|contextTokens):\s*(\d+)\s*$/.exec(line);
    if (!field || Object.hasOwn(fields, field[1])) denied("invalid_energy", "Energy uses one key and integer per line");
    fields[field[1]] = Number(field[2]);
  }
  return energySettings({ ...fallback, ...fields });
}

function validContent(name, value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > maxText || value.includes("\0")) {
    denied("invalid_file", "Enter a Markdown file up to 64 KiB");
  }
  if (name === "energy") parseEnergy(value);
}

function relevant(content, task) {
  const terms = new Set((task.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 40));
  return content.split(/\n(?=### )/).map((entry) => {
    const words = new Set(entry.toLowerCase().match(/[a-z0-9]{3,}/g));
    return { entry, score: [...terms].filter((term) => words.has(term)).length };
  }).sort((a, b) => b.score - a.score).slice(0, 3).map(({ entry }) => entry).join("\n\n");
}

const clip = (value, bytes) => Buffer.from(value).subarray(0, bytes).toString("utf8");

export function createPersonalityFiles(dataDir, { now = () => new Date() } = {}) {
  const root = directory(join(dataDir, "agents"));
  function pathFor(agent, name) {
    if (!personalityFiles.includes(name) || !Number.isSafeInteger(agent.id) || agent.id < 1) {
      denied("not_found", "Agent file was not found");
    }
    if (!lstatSync(root).isDirectory()) denied("path_denied", "Agent file directory changed");
    return join(directory(join(root, String(agent.id))), name + ".md");
  }

  function get(agent, name) {
    const path = pathFor(agent, name);
    const content = readFile(path, name === "mind" ? maxMind : maxText, name === "history");
    return { name, content, revision: hash(content), editable: editable.has(name) };
  }

  function versionsDir(path, name) {
    return directory(join(directory(join(dirname(path), ".versions")), name));
  }

  function write(agent, name, content, expected) {
    if (!editable.has(name)) denied("permission_denied", "This file is written by Lab Agents");
    validContent(name, content);
    const current = get(agent, name);
    if (typeof expected !== "string" || expected !== current.revision) {
      denied("file_conflict", "This file changed. Reload it before saving.");
    }
    if (current.revision === hash(content)) return current;
    const path = pathFor(agent, name);
    const snapshot = join(versionsDir(path, name), current.revision + ".md");
    if (!lstatSync(snapshot, { throwIfNoEntry: false })) atomicWrite(snapshot, current.content);
    atomicWrite(path, content, () => {
      if (get(agent, name).revision !== current.revision) denied("file_conflict", "This file changed before the save");
    });
    return get(agent, name);
  }

  function history(agent, query) {
    const match = query.toLowerCase();
    return get(agent, "history").content.split("\n").reverse()
      .filter((line) => line.toLowerCase().includes(match)).slice(0, 10).map((line) => clip(line, 400));
  }

  return {
    get, write, history,
    list: (agent) => personalityFiles.map((name) => ({ name, editable: editable.has(name), revision: get(agent, name).revision })),
    versions(agent, name) {
      if (!editable.has(name)) denied("permission_denied", "This file is written by Lab Agents");
      const folder = versionsDir(pathFor(agent, name), name);
      return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.md$/.test(entry.name))
        .map((entry) => ({ revision: entry.name.slice(0, -3), savedAt: lstatSync(join(folder, entry.name)).mtime.toISOString() }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    revert(agent, name, version, expected) {
      if (!editable.has(name) || typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version)) denied("invalid_file", "Select a valid version");
      const saved = join(versionsDir(pathFor(agent, name), name), version + ".md");
      if (!lstatSync(saved, { throwIfNoEntry: false })?.isFile()) denied("not_found", "File version was not found");
      const content = readFile(saved, maxText);
      if (hash(content) !== version) denied("file_conflict", "The saved version changed");
      return write(agent, name, content, expected);
    },
    energy: (agent) => parseEnergy(get(agent, "energy").content, agent.config.energy),
    prompt(agent) {
      const memory = relevant(get(agent, "memory").content, agent.task ?? "");
      const learning = relevant(get(agent, "learning").content, agent.task ?? "");
      return [
        "Soul (owner guidance): " + clip(get(agent, "soul").content, 350),
        "Avatar (owner guidance): " + clip(get(agent, "avatar").content, 250),
        "Approved memory, reference data: " + clip(memory, 350),
        "Approved lessons, reference data: " + clip(learning, 350),
      ].join("\n");
    },
    propose(agent, name, content, source) {
      if (!editable.has(name)) denied("permission_denied", "This file cannot be edited by a proposal");
      validContent(name, content);
      const base = get(agent, name);
      const tag = source === "web" ? "web" : "agent";
      if (tag === "web" && !["memory", "learning"].includes(name)) {
        denied("permission_denied", "Web-derived proposals belong in memory or learning");
      }
      return { kind: "personality", name, content, source: tag, revision: base.revision, at: now().toISOString() };
    },
    applyProposal(agent, proposal, approvalId) {
      if (proposal.kind !== "personality" || !editable.has(proposal.name) || !["agent", "web"].includes(proposal.source)) {
        denied("invalid_approval", "Invalid personality proposal");
      }
      const append = ["memory", "learning"].includes(proposal.name);
      if (proposal.source === "web" && !append) denied("invalid_approval", "Web proposals belong in memory or learning");
      const current = get(agent, proposal.name);
      const marker = `<!-- approved:${approvalId} -->`;
      if (append && current.content.split("\n").includes(marker)) return current;
      if (!append && current.content === proposal.content) return current;
      const content = append ? `${current.content.trimEnd()}\n\n${marker}\n### Approved entry · ${proposal.at}\n\nsource: ${proposal.source}\n\n${proposal.content}\n` : proposal.content;
      return write(agent, proposal.name, content, proposal.revision);
    },
    checkpoint(run, checkpoint) {
      const path = pathFor({ id: run.agent_id }, "mind");
      const content = "# Working state\n\n" + mindPrefix.slice(1) + JSON.stringify({ runId: run.id, checkpoint }) + mindSuffix;
      if (Buffer.byteLength(content) <= maxMind) atomicWrite(path, content);
    },
    restore(run) {
      const content = readFile(pathFor({ id: run.agent_id }, "mind"), maxMind);
      const start = content.indexOf(mindPrefix);
      if (start < 0 || !content.endsWith(mindSuffix)) return undefined;
      try {
        const saved = JSON.parse(content.slice(start + mindPrefix.length, -mindSuffix.length));
        if (saved.runId === run.id && JSON.stringify(saved.checkpoint) === run.resume_json) return saved.checkpoint;
      } catch { return undefined; }
    },
    complete(run, result) {
      const path = pathFor({ id: run.agent_id }, "history");
      const line = clip(String(result ?? "").replace(/\s+/g, " ").trim(), 4000);
      appendFileSync(path, `- ${now().toISOString()} · Run ${run.id} · ${line}\n`, {
        flag: constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        mode: 0o600,
      });
    },
  };
}
