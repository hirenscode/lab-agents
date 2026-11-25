ALTER TABLE runs ADD COLUMN created_at TEXT;
ALTER TABLE runs ADD COLUMN task TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN resume_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(resume_json));
CREATE INDEX runs_owner_agent ON runs(owner_id, agent_id, id);
CREATE INDEX run_events_run ON run_events(run_id, id);
CREATE INDEX approvals_run ON approvals(run_id, id);
