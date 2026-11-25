ALTER TABLE triggers ADD COLUMN cursor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cursor_json));
ALTER TABLE runs ADD COLUMN trigger_id INTEGER REFERENCES triggers(id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN occurrence TEXT;
CREATE UNIQUE INDEX runs_occurrence ON runs(trigger_id, occurrence) WHERE trigger_id IS NOT NULL;
CREATE INDEX triggers_due ON triggers(enabled, next_run_at);
