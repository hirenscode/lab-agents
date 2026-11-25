# Phase 3 — Tool registry

The registry validates code-defined tool types, saved scopes, permissions, and arguments. Static tools are DateTime and Disk Status. File Reader and Web Fetch use the Phase 2 guards. Duplicate Finder reports size-based candidates and progress. File Mover returns a quarantine proposal for later approval.

Run `npm test` with Node 22.13+ for the registry suite. It uses temporary folders and a fake guarded fetch. The full suite and a fresh-volume boot are checked in local `linux/amd64` Docker. Live web and Synology shares remain pending.
