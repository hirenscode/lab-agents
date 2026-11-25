# Phase 1 — Foundation

The Fastify server validates configuration, emits structured logs, and initializes storage before listening. An injectable clock supplies timestamps for migrations and health responses. The package scripts, Dockerfile, and GitHub Actions workflow use the same server entry point.

## Run locally

Use Node 22.13 or later. From the repository root, run:

```sh
npm ci
npm test
npm start
```

Open `http://localhost:8787/` for the landing page or `http://localhost:8787/healthz` for storage health.

| Setting | Local default |
| --- | --- |
| `PORT` | `8787` |
| `DATA_DIR` | `./data` |
| `NODE_ENV` | `development` |
| `APP_VERSION` | The version in `package.json` |

Docker uses `/data`. Startup creates `lab-agents.sqlite` and the `agents/` directory inside the configured data directory. A storage initialization failure exits before the server listens. Check the startup log for the cause and, on a bind mount, confirm the configured UID and GID can write there.

## SQLite

Migration 1 creates the initial Lab Agents tables and records its application time in `schema_version` in the same transaction. Foreign keys require each run and each tool attached to an agent to use the agent's owner. The built-in `node:sqlite` module keeps SQLite out of the npm dependency list.

## Verification

- All 11 tests passed with `npm test` on Node 22.14.0. They cover configuration, database migration and rollback, restart persistence, ownership constraints, and the Fastify routes.
- The `linux/amd64` image started as a non-root user with an empty Docker volume and passed its health check. A restart on the same volume preserved the migration timestamp.
- Pending verification on the Synology NAS, against Ollama, and through the hosted GitHub Actions and GHCR pipeline.
