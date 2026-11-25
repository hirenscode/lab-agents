CREATE TABLE duplicate_hashes (
  identity TEXT PRIMARY KEY,
  partial_hash TEXT,
  full_hash TEXT,
  touched_at INTEGER NOT NULL
) STRICT;
CREATE INDEX duplicate_hashes_touched ON duplicate_hashes(touched_at);
