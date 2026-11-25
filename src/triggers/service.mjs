import { opendir } from "node:fs/promises";
import { SafetyError } from "../errors.mjs";
import { agentWithTools } from "../runs/engine.mjs";
import { ignoredDirectories } from "../tools/files.mjs";
import { nextSchedule, scheduleFormatter } from "./schedule.mjs";

const kinds = ["manual", "once", "interval", "schedule", "file_appears"];
const bad = (message) => { throw new SafetyError("invalid_trigger", message); };
const day = [0, 1, 2, 3, 4, 5, 6];
const iso = (ms) => new Date(ms).toISOString();

function specFor(kind, raw, pathGuard) {
  if (!kinds.includes(kind) || !raw || typeof raw !== "object") bad("Select a trigger and enter its settings");
  const catchUp = raw.catchUp ?? "run_once";
  if (!["run_once", "skip"].includes(catchUp)) bad("Select a catch-up policy");
  switch (kind) {
    case "manual": return { catchUp };
    case "once": {
      if (typeof raw.at !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw.at) ||
          !Number.isFinite(Date.parse(raw.at))) bad("Enter an explicit date and time");
      return { catchUp, at: iso(Date.parse(raw.at)) };
    }
    case "interval":
      if (!Number.isInteger(raw.minutes) || raw.minutes < 1 || raw.minutes > 10080) bad("Enter an interval of 1 to 10,080 minutes");
      return { catchUp, minutes: raw.minutes };
    case "schedule": {
      const timeZone = raw.timeZone ?? "UTC";
      const days = raw.days ?? day;
      if (typeof timeZone !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time ?? "") ||
          !Array.isArray(days) || !days.length || days.some((value) => !day.includes(value))) bad("Enter a time, time zone, and days");
      try { scheduleFormatter(timeZone); } catch { bad("Select a valid time zone"); }
      return { catchUp, time: raw.time, timeZone, days: [...new Set(days)] };
    }
    case "file_appears": {
      const scope = { mountId: raw.mountId, folder: raw.folder ?? "" };
      pathGuard.resolve(scope, "");
      return { catchUp, ...scope };
    }
    default: bad("Unknown trigger");
  }
}

function decode({ spec_json, cursor_json, enabled, ...row }) {
  return { ...row, spec: JSON.parse(spec_json), cursor: JSON.parse(cursor_json), enabled: Boolean(enabled) };
}

export function createTriggerService(database, {
  engine, pathGuard, now = () => new Date(), available = () => true, graceMs = 45_000, onError = () => {},
}) {
  const lifetime = new AbortController();
  let inFlight;
  let timer;
  const read = (agentId, id) => {
    const row = database.prepare("SELECT * FROM triggers WHERE id=? AND agent_id=?").get(id, agentId);
    if (!row) throw new SafetyError("not_found", "Trigger was not found");
    return decode(row);
  };
  const visible = ({ cursor: _cursor, ...trigger }) => trigger;

  function save(owner, agentId, input, id) {
    agentWithTools(database, owner, agentId);
    if (id !== undefined) read(agentId, id);
    const { kind, enabled = true } = input ?? {};
    if (typeof enabled !== "boolean") bad("Select whether the trigger is enabled");
    const spec = specFor(kind, input.spec ?? {}, pathGuard);
    const current = now().getTime();
    let next = null;
    if (kind === "once") next = spec.at;
    if (kind === "interval") next = iso(current + spec.minutes * 60_000);
    if (kind === "schedule") next = iso(nextSchedule(current, spec));
    if (id === undefined) {
      id = Number(database.prepare("INSERT INTO triggers(agent_id,kind,spec_json,enabled,next_run_at) VALUES(?,?,?,?,?)")
        .run(agentId, kind, JSON.stringify(spec), Number(enabled), next).lastInsertRowid);
    } else {
      database.prepare("UPDATE triggers SET kind=?,spec_json=?,enabled=?,next_run_at=?,cursor_json='{}' WHERE id=? AND agent_id=?")
        .run(kind, JSON.stringify(spec), Number(enabled), next, id, agentId);
    }
    return visible(read(agentId, id));
  }

  function advance(row, patch, { occurrence, timedOut = false, agent }) {
    const shouldRun = occurrence && (row.spec.catchUp === "run_once" || (!timedOut && available(agent)));
    database.exec("BEGIN IMMEDIATE");
    let created = false;
    try {
      const update = database.prepare(`
        UPDATE triggers SET next_run_at=?, enabled=?, cursor_json=?
        WHERE id=? AND enabled=1 AND next_run_at IS ? AND cursor_json=? AND spec_json=?
      `).run(patch.next, Number(patch.enabled), JSON.stringify(patch.cursor), row.id, row.next_run_at,
        JSON.stringify(row.cursor), JSON.stringify(row.spec));
      if (update.changes && shouldRun) {
        engine.spawn(agent.owner_id, agent.id, undefined, { triggerId: row.id, occurrence, defer: true });
        created = true;
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    if (created) engine.resumeWaiting();
  }

  async function pollFile(row, agent, current) {
    const signal = lifetime.signal;
    const path = pathGuard.resolve(row.spec, "", { signal }).path;
    const directory = await opendir(path);
    const names = [];
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (entry.isFile() && !ignoredDirectories.has(entry.name)) names.push(entry.name);
      if (names.length > 10000) bad("The watched folder exceeds 10,000 files");
    }
    names.sort();
    const seen = new Set(row.cursor.names ?? []);
    const changed = Boolean(row.cursor.names && names.some((name) => !seen.has(name)));
    const revision = (row.cursor.revision ?? 0) + 1;
    const timedOut = row.cursor.checked !== undefined && current - row.cursor.checked > graceMs;
    advance(row, { next: null, enabled: true, cursor: { names, revision, checked: current } }, {
      occurrence: changed ? `file:${revision}:${current}` : null, timedOut, agent,
    });
  }

  function runTick() {
    if (inFlight || lifetime.signal.aborted) return inFlight;
    inFlight = (async () => {
      const current = now().getTime();
      const rows = database.prepare(`
        SELECT t.*,a.owner_id AS owner FROM triggers t JOIN agents a ON a.id=t.agent_id
        WHERE t.enabled=1 AND a.archived_at IS NULL AND (t.kind='file_appears' OR t.next_run_at<=?) ORDER BY t.id
      `).all(iso(current));
      for (const record of rows) {
        if (lifetime.signal.aborted) break;
        const row = decode(record);
        try {
          const agent = agentWithTools(database, row.owner, row.agent_id);
          if (row.kind === "file_appears") {
            await pollFile(row, agent, current);
            continue;
          }
          const due = Date.parse(row.next_run_at);
          let next = null;
          if (row.kind === "interval") {
            const duration = row.spec.minutes * 60_000;
            next = iso(due + (Math.floor((current - due) / duration) + 1) * duration);
          }
          if (row.kind === "schedule") next = iso(nextSchedule(current, row.spec));
          advance(row, { next, enabled: row.kind !== "once", cursor: row.cursor }, {
            occurrence: row.next_run_at, timedOut: current - due > graceMs, agent,
          });
        } catch (error) {
          if (!lifetime.signal.aborted) onError(error, row.id);
        }
      }
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  return {
    save, tick: runTick,
    list(owner, agentId) {
      agentWithTools(database, owner, agentId);
      return database.prepare("SELECT * FROM triggers WHERE agent_id=? ORDER BY id").all(agentId).map((row) => visible(decode(row)));
    },
    remove(owner, agentId, id) {
      agentWithTools(database, owner, agentId);
      read(agentId, id);
      database.prepare("DELETE FROM triggers WHERE id=? AND agent_id=?").run(id, agentId);
    },
    start() {
      timer = setInterval(() => { void runTick()?.catch((error) => onError(error)); }, 15_000);
      timer.unref();
    },
    async close() {
      clearInterval(timer);
      lifetime.abort();
      await inFlight;
    },
  };
}
