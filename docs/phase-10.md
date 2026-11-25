# Phase 10 — Agent console

Build with `npm ci` and `npm run build`, then start with `npm start`. Open `http://127.0.0.1:8787/` and sign in with DSM or a provisioned local administrator. The Docker build includes the UI. For development, run the API on 8787 and start `npm run dev:ui` in a second terminal.

The console includes the agent table, editor, tools library, live log, Energy meters, approvals and restore, brains, personality files, and history. Pausing the log freezes its display while the run continues. File moves always require approval. Duplicate Finder can start from a preset when a writable share is available.

React and React DOM render the console. Vite bundles browser assets in the Docker build stage. The selected Hexagon components and tokens come from the local design system so a private npm token is unnecessary. See the [Hexagon notice](../ui/src/hexagon/NOTICE.md). [Vite documentation](https://v7.vite.dev/guide/)

Run `npm test` for backend and console coverage. The browser check used a disposable local Docker instance, fake Ollama, and a temporary share. It covered local sign-in, brain registration, agent creation, tool attachment, live logs, kill, file approval and restore, Markdown editing, and light and dark layouts at desktop and phone widths.

Live DSM, Ollama, Synology shares and the hosted release remain pending.
