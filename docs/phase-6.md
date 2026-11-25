# Phase 6 — API and authentication

Start with `npm start`. Configure `DSM_URL` and `DSM_ADMIN_USERS` in the process environment or Compose configuration. The API discovers the DSM authentication endpoint, sends credentials in a POST body, and issues an independent HttpOnly session. State-changing requests require the session's CSRF token. Users have access to their own agents, tools, runs, approvals and events.

Create or rotate a local administrator with `npm run admin:create -- USERNAME`. Supply the password through standard input and use at least 12 characters. Choose the local login provider when DSM is unavailable. The CLI works inside the Docker container using its existing data volume.

Run `npm test` for fake DSM, two-user isolation, session, CSRF, and rate-limit tests. The real DSM and hosted release pipeline remain pending. [Synology DSM Login Web API Guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Os/DSM/All/enu/DSM_Login_Web_API_Guide_enu.pdf)
