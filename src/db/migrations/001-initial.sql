CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  dsm_username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE brains (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_seen TEXT,
  models_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(models_json))
) STRICT;

CREATE TABLE tool_instances (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  permission TEXT NOT NULL CHECK (permission IN ('read', 'propose', 'write')),
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_id)
) STRICT;

CREATE TABLE agents (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  brain_pref INTEGER REFERENCES brains(id),
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (id, owner_id)
) STRICT;

CREATE TABLE agent_tools (
  agent_id INTEGER NOT NULL,
  tool_instance_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  PRIMARY KEY (agent_id, tool_instance_id),
  FOREIGN KEY (agent_id, owner_id) REFERENCES agents(id, owner_id),
  FOREIGN KEY (tool_instance_id, owner_id) REFERENCES tool_instances(id, owner_id)
) STRICT;

CREATE TABLE triggers (
  id INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL CHECK (kind IN ('once', 'schedule', 'interval', 'file_appears', 'manual')),
  spec_json TEXT NOT NULL CHECK (json_valid(spec_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  next_run_at TEXT
) STRICT;

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'waiting_for_brain', 'awaiting_approval', 'done', 'failed', 'killed')),
  started_at TEXT,
  ended_at TEXT,
  brain_id INTEGER REFERENCES brains(id),
  step INTEGER NOT NULL DEFAULT 0 CHECK (step >= 0),
  tokens_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tokens_json)),
  error TEXT,
  FOREIGN KEY (agent_id, owner_id) REFERENCES agents(id, owner_id)
) STRICT;

CREATE TABLE run_events (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT
) STRICT;

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json))
) STRICT;
