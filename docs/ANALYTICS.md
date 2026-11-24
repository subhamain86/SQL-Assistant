# Usage Analytics — V17.7.3 (provider "service")

> V17.7.3 introduces optional Usage Analytics for measuring SQL Assistant adoption and utilization. The Analytics dashboard is available from the hamburger menu and protected by centralized administrator authentication. Analytics capture usage metadata only and do not capture SQL content, credentials, database results, or customer data.

*Hamburger menu → Analytics* opens an **Administrator Authentication** dialog. Only after the analytics service accepted the one centralized **Analytics administrator password** does the page request and show the dashboard. Analytics is **optional and off by default**; if it is off, unconfigured or its service is down, SQL Assistant works exactly as before.

## 1. How it works
A static page cannot keep a password secret and cannot combine the usage of many people, so the password is checked — and the numbers are computed — by a small dependency-free Node ≥ 20 service (`server/analytics-service.mjs`). The page sends usage metadata to `POST /v1/events`; the dashboard asks `GET /v1/admin/summary` with a short-lived, revocable session token that the page keeps **in memory only**. The page never contains the password, a hash of it, or a way to derive it.

## 2. What is measured — and what never is
**Collected** (the service refuses any other field): `session_start` / `session_end`; `active {ms}` (milliseconds of **active** use); `feature {f}` (one of a fixed list of page / action names); `generation {k, ok, rv}` (which builder and whether valid SQL came out); on every event a random per-device id, a random per-session id, the application version, a time and — only if enabled — a user label.

**Never collected:** generated SQL, SQL you typed, descriptions, database results, schema content, customer data, credentials, passwords, connection strings, URLs, page text, user agent. The tracker has no function that accepts free text.

**Unique users.** The device id is random, created once and kept in browser storage, so the same browser profile is one unique user across all its sessions. With `analytics.collectUserIdentity: true` and a GitHub sign-in the GitHub login is sent as the user label so one person on two devices counts once. The service keeps only salted hashes.

## 3. Active usage time
Time counts only while **the tab is visible, the window is focused and the last interaction is newer than the inactivity timeout** (`analytics.inactivityTimeout`, seconds, 5 … 3600, default 300). It pauses in the background and when idle and resumes at the next interaction; the service also refuses to credit more active time than has really passed since the session was first seen.

## 4. The dashboard (all days, weeks and months are UTC)
Unique Users · Daily / Weekly / Monthly Active Users (relative to the end of the chosen range) · Total Sessions · Average and Total Active Usage Time · SQL Queries Generated · Successful / Failed Generations · Success Rate; the daily / weekly / monthly utilization, the usage trend, the most-used features and the application versions; a date-range filter (presets or custom, at most 800 days).

## 5. Configuration (public; no rebuild)
`sql-assistant-data/analytics.config.json` next to `index.html`. The file is public — a password-, secret-, hash- or token-like key makes it invalid as a whole.

| Key | Default | Meaning |
|---|---|---|
| `analytics.enabled` | `false` | master switch |
| `analytics.provider` | `"service"` | `"service"` or `"none"` |
| `analytics.serviceUrl` | — | https address of the service (http only for localhost) |
| `analytics.inactivityTimeout` | `300` | seconds; 5 … 3600 |
| `analytics.collectUserIdentity` | `false` | also send the GitHub login as the user label |
| `analytics.applicationVersion` | this build | the version label reported |
| `analytics.adminAuthenticationEnabled` | `true` | `false` = the in-app dashboard is not available at all (usage is still collected) |
| `analytics.adminSessionTimeout` | `900` | seconds; the dashboard locks after this long without interaction (10 … 28800) |

Deploy: the Pages workflow writes the file from repository **variables** when `SQLA_ANALYTICS_URL` is set; otherwise place the file by hand (`docs/analytics.config.example.json`). `release/` ships no configuration.

## 6. The service and the administrator password
1. `node server/analytics-service.mjs hash-password` prints `scrypt$…` (typed hidden; at least 12 characters).
2. Run the service (Node ≥ 20, behind HTTPS; `package-analytics-service.yml` or `node scripts/package-service.mjs analytics` packages it for any host) with `SQLA_ANALYTICS_ALLOWED_ORIGINS` (required) and either `SQLA_ANALYTICS_ADMIN_PASSWORD_HASH` (platform secret) or a password file written by `node server/analytics-service.mjs set-admin-password`. `.github/workflows/deploy-analytics.yml` is an Azure App Service reference deployment (needs credentials; optional).
3. Set the variable `SQLA_ANALYTICS_URL` and re-run the Pages workflow.

There is **no default password** and no setup endpoint (`503 admin-not-configured` until one is set). **Rotation:** the dashboard form (current password re-checked; success ends every session), the command line, or a new platform secret — no rebuild. A wrong password gives exactly "Invalid administrator password". Five wrong attempts per caller address lock that caller (30 s, doubling per round up to 15 min).

## 7. Failure behaviour
Analytics off, invalid configuration, service unreachable or administration not set up never affect SQL Assistant; unsent usage is queued (bounded, metadata only) and retried with back-off.

## 8. Limits
Telemetry is unauthenticated by nature (origin allow-list and rate limits only keep casual abuse out); one shared administrator password; one service instance (in-memory sessions, JSON file store); a browser profile with blocked storage counts as a new user per session; beacon delivery at page exit is best effort (unsent usage stays queued).

## 10. Running the service on any host (V17.7.5)
The service is a single file with no dependencies. `package-analytics-service.yml` (or `node scripts/package-service.mjs analytics`) produces `sqla-analytics-service/`: `server.mjs`, `README.md`, `Dockerfile`, `sqla-analytics.service` (systemd), `env.example`, `SHA256SUMS`; no workflow deploys it and none needs a credential. Set the variables of section 6 on **your** host (`SQLA_ANALYTICS_ALLOWED_ORIGINS`, `SQLA_ANALYTICS_ADMIN_PASSWORD_HASH` from `node server.mjs hash-password`, a persistent `SQLA_ANALYTICS_DATA_DIR`, `SQLA_ANALYTICS_TRUST_PROXY=1` behind a proxy), run `node server.mjs` (or the systemd unit, or the container), then set the repository variable `SQLA_ANALYTICS_URL` and re-run the Pages workflow. Azure App Service remains possible as your own deployment; it is not part of the repository's workflows. The serverless provider (`docs/ANALYTICS_SERVERLESS.md`) needs no service at all.
