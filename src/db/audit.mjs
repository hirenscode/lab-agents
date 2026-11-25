import { SafetyError } from "../errors.mjs";

function id(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SafetyError("invalid_audit_event", "Audit identifiers must be positive integers");
  }
  return value;
}

export function recordAudit(database, event, now = () => new Date()) {
  const detail = { runId: id(event.runId) };
  const userId = id(event.userId);

  switch (event.action) {
    case "tool_call":
      detail.toolInstanceId = id(event.toolInstanceId);
      break;
    case "approval":
      detail.approvalId = id(event.approvalId);
      if (!["approved", "rejected"].includes(event.decision)) {
        throw new SafetyError("invalid_audit_event", "Unknown approval decision");
      }
      detail.decision = event.decision;
      break;
    case "quarantine_move":
      detail.approvalId = id(event.approvalId);
      break;
    case "kill":
      break;
    default:
      throw new SafetyError("invalid_audit_event", "Unknown audit action");
  }

  return database.prepare(`
    INSERT INTO audit_log (ts, user_id, action, detail_json)
    VALUES (?, ?, ?, ?)
  `).run(now().toISOString(), userId, event.action, JSON.stringify(detail)).lastInsertRowid;
}
