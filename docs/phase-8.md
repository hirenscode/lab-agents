# Phase 8 — Agent files

Each agent has Markdown files for Soul, Avatar, Energy, Memory, Learning, History, and Mind under its own data directory. Owner edits use revisions and save the previous version for revert. Energy settings are parsed and enforced by the run engine. History is append-only through the engine and can be queried with History Search. Mind mirrors the current checkpoint and is checked against the stored run before use.

The Personality Proposal tool creates a pending approval. Web-derived proposals are restricted to Memory and Learning and keep their web source after explicit approval. Agent-controlled text remains reference data in the model context. The proposal revision protects later user edits.

Run `npm test` for file edits, conflicts, revert, provenance, history, and checkpoint coverage. Live NAS filesystem behavior remains pending.
