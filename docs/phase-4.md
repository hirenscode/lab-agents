# Phase 4 — Brain layer

The Ollama client reads streaming chat, reports usage, supports cancellation, and retries once when Ollama specifically rejects the thinking option. The registry persists LAN endpoints and priorities, checks available models, and selects a tool-capable fallback when needed. Optional private-subnet discovery probes only the Ollama version endpoint and returns candidates for manual registration.

Run `npm test` with Node 22.13+. Tests use a fake HTTP Ollama on loopback. The real NAS and a live model remain pending. [Ollama chat API](https://docs.ollama.com/api/chat)
