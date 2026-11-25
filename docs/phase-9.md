# Phase 9 — Duplicate Finder

The Duplicate Finder preset attaches a scan tool and a duplicate-only quarantine proposal tool to the selected writable share. Scans group by size, partial SHA-256, and full SHA-256, with progress and a compact summary. A separate Node process runs at lowered priority with `nice`. SQLite caches hashes by file identity and timestamps. NAS system folders are skipped.

Each proposal names a duplicate to keep. The tool verifies both files' bytes when proposing and checks the kept file again when applying approval. The owner reviews each move. Restore uses the quarantine manifest and stops if the original path is occupied.

Run `npm test` for the large fixture, hash cache, worker cancellation, duplicate proof, quarantine and restore. NAS I/O performance and a real model's choices remain pending.
