import { SafetyError } from "../errors.mjs";
import { agentWithTools } from "../runs/engine.mjs";
import { energySettings } from "../runs/energy.mjs";
import { assertToolMix } from "../tools/registry.mjs";

function bad(message) {
  throw new SafetyError("invalid_input", message);
}

export function identifier(value) {
  if ((typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value)))
      || !Number.isSafeInteger(Number(value)) || Number(value) < 1) bad("Invalid identifier");
  return Number(value);
}

export function text(value, limit, label, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > limit) bad(`Enter a valid ${label}`);
  return value.trim();
}

export function createAgentStore(database, brains, now) {
  const get = (owner, id) => agentWithTools(database, owner, id);
  function save(ownerId, input, id) {
    if (!input || typeof input !== "object") bad("Enter an agent");
    if (id !== undefined) get(ownerId, id);
    const name = text(input.name, 80, "name");
    const description = text(input.description, 300, "description", true);
    const task = text(input.task, 4000, "task");
    const model = text(input.model, 120, "model", true);
    const brainId = input.brainId == null ? null : identifier(input.brainId);
    if (brainId !== null && !brains.get(brainId)) bad("Select a registered brain");
    const ifUnavailable = input.ifUnavailable ?? "fallback";
    if (!["wait", "skip", "fallback"].includes(ifUnavailable)) bad("Select a brain fallback policy");
    const config = { description, task, model, ifUnavailable, energy: energySettings(input.energy) };
    const requested = input.toolIds ?? [];
    if (!Array.isArray(requested) || requested.length > 8) bad("Choose up to eight saved tools");
    const ids = [...new Set(requested.map(identifier))];
    const select = database.prepare("SELECT id,type,permission FROM tool_instances WHERE id=? AND owner_id=?");
    const tools = ids.map((item) => select.get(item, ownerId));
    if (tools.some((tool) => !tool)) bad("Select tool instances you own");
    assertToolMix(tools);

    database.exec("BEGIN IMMEDIATE");
    try {
      if (id === undefined) {
        id = Number(database.prepare("INSERT INTO agents(owner_id,name,brain_pref,config_json,created_at) VALUES(?,?,?,?,?)")
          .run(ownerId, name, brainId, JSON.stringify(config), now().toISOString()).lastInsertRowid);
      } else {
        database.prepare("UPDATE agents SET name=?,brain_pref=?,config_json=? WHERE id=? AND owner_id=?")
          .run(name, brainId, JSON.stringify(config), id, ownerId);
        database.prepare("DELETE FROM agent_tools WHERE agent_id=? AND owner_id=?").run(id, ownerId);
      }
      const attach = database.prepare("INSERT INTO agent_tools(agent_id,tool_instance_id,owner_id) VALUES(?,?,?)");
      for (const toolId of ids) attach.run(id, toolId, ownerId);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return get(ownerId, id);
  }
  return {
    get, save,
    list(owner) {
      return database.prepare("SELECT id FROM agents WHERE owner_id=? AND archived_at IS NULL ORDER BY id").all(owner)
        .map(({ id }) => get(owner, id));
    },
    archive(owner, id) {
      get(owner, id);
      database.prepare("UPDATE agents SET archived_at=? WHERE owner_id=? AND id=?").run(now().toISOString(), owner, id);
    },
  };
}
