# Phase 2 — Safety primitives

Run `npm ci` and `npm test` from the repository root with Node 22.13 or later. To start the existing server, run `npm start`. Phase 3 integrates these modules into the tool registry.

## Paths and permissions

Configure a path guard with server-owned mount records `{ id, directory, mode }`, using an absolute directory and mode `read` or `write`. A tool scope selects `{ mountId, folder }` with an optional relative folder. Supply paths relative to that folder. The guard rejects absolute paths, dot components, percent escapes, and paths that resolve beyond the mount or the scoped folder. It also reserves the quarantine directory. Set Docker bind mounts to read-only when the tool needs only read access.

A tool permission is one of `read`, `propose`, or `write`. The permission must match the requested action. An approved quarantine move uses the `propose` permission and a writable mount.

## Web requests

`createUrlGuard()` returns a GET function that accepts a URL, an exact hostname allow-list, and an optional abort signal. It checks every DNS answer for public address space and passes only those answers to the connection. The guard rechecks same-host redirects, refuses redirects to another hostname, and verifies HTTPS certificates. Defaults allow 256 KiB of response body, three redirects, and ten seconds for the full request. Treat the returned response body as untrusted data. [Node HTTP client](https://nodejs.org/download/release/v22.11.0/docs/api/http.html) · [IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry) · [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry)

## Audit and quarantine

The audit writer records the actor, run, action, and timestamp in the existing SQLite database. It accepts structured IDs and approval decisions as event details.

A quarantine proposal records the scoped path and file identity. Application requires a stored approval from the run owner and rechecks the current scope and file. On success the file moves by atomic rename into `.lab-agents-quarantine/<entry-id>/file` on its source mount. The adjacent `manifest.json` records the original location and approval. Retrying a completed approval reuses the same entry and can recover a missing audit record.

The rename requires the source and quarantine to be on the same filesystem. On Linux it uses opened directory handles. Quarantine assumes trusted local writers on writable mounts, because another process with write access can replace the final filename between the identity check and rename.

## Verification

- All 33 tests passed locally and in a `linux/amd64` Docker container. The Phase 2 image also booted with a fresh volume and passed its health check.
- URL tests used fake DNS and HTTP responses. Quarantine tests used temporary files and SQLite approvals.
- Pending verification with real web requests, Synology shares, and the hosted release pipeline.
