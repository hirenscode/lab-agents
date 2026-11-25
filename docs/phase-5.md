# Phase 5 — Agent runs

Runs persist their state, checkpoints, Energy usage, tool events, and approval requests in SQLite. The engine serializes Ollama chat per brain, resumes when a brain returns, and aborts active work when killed. Tool results are bounded and the context budget keeps tool calls with their responses. The SSE helper streams persisted events for the authenticated API in Phase 6.

Run `npm test` to exercise scripted model runs, queueing, kill, Energy limits, approval and resume. Tests use local fixtures and scripted brains. A real Ollama and Synology deployment remain pending.
