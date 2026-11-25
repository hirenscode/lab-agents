export const activeStates = new Set(["queued", "running", "waiting_for_brain", "awaiting_approval"]);
export const completedStates = new Set(["done", "failed", "killed"]);

export const runLabels = {
  queued: "Queued", running: "Running", waiting_for_brain: "Waiting for brain", awaiting_approval: "Needs approval",
  done: "Complete", failed: "Failed", killed: "Killed", scheduled: "Scheduled", idle: "Idle",
};

export const typeInfo = {
  datetime: ["DateTime", "System", "Current date and time in a time zone."],
  disk_status: ["Disk Status", "System", "Free and total space on the app's data volume."],
  file_reader: ["File Reader", "Files", "Reads text files within an allowed folder."],
  weather: ["Weather", "Web", "Current conditions and up to seven days of forecasts by city or postal code."],
  web_fetch: ["Web Fetch", "Web", "Reads pages on the hostnames you allow."],
  dup_finder: ["Duplicate Finder", "Files", "Finds byte-identical files and reports scan progress."],
  file_mover: ["File Mover", "Files", "Proposes a move to quarantine for your approval."],
  history_search: ["History Search", "System", "Finds entries in the agent's own run history."],
  personality_proposal: ["Personality Proposal", "System", "Proposes an edit to the agent's personality files."],
};

export const zones = Intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
export const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const formatDate = (time) => time ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(time)) : "";
export function latestRun(runs, agentId) {
  const own = runs.filter((run) => run.agent_id === agentId);
  return own.find((run) => activeStates.has(run.state)) ?? own[0];
}

export function triggerLabel(trigger) {
  if (!trigger || !trigger.enabled || trigger.kind === "manual") return "Manual only";
  const spec = trigger.spec;
  if (trigger.kind === "once") return formatDate(spec.at);
  if (trigger.kind === "interval") return `Every ${spec.minutes} min`;
  if (trigger.kind === "schedule") return `${spec.days?.length === 7 ? "Daily" : "Scheduled"} at ${spec.time}`;
  return "When a file appears";
}

export function makeTrigger(kind, form) {
  const catchUp = form.catchUp;
  switch (kind) {
    case "once": return { kind, spec: { at: new Date(form.once).toISOString(), catchUp } };
    case "interval": return { kind, spec: { minutes: Number(form.minutes), catchUp } };
    case "schedule": return { kind, spec: { time: form.time, timeZone: form.timeZone, days: form.days, catchUp } };
    case "file_appears": return { kind, spec: { mountId: form.mountId, folder: form.folder, catchUp } };
    default: return { kind: "manual", spec: { catchUp } };
  }
}
