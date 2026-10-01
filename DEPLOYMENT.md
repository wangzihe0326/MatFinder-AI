# MatFinder AI Deployment Guide

MatFinder AI can run as a single Node.js web service that serves the frontend, API routes, and the local SQLite material database. The local SQLite database remains the source of truth; OpenAI is used only for optional explanations and comparisons.

## Production Configuration

Copy `.env.example` or `config/production.env.example` into your deployment platform's environment variable settings.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | Recommended | `development` | Set to `production` in deployed environments. |
| `PORT` | Platform-provided | `3000` | HTTP port. Render and Railway inject this automatically for web services. |
| `MATFINDER_DB_PATH` | Optional | `matfinder.db` | SQLite database path. Use an absolute path if storing the DB on a mounted disk. |
| `OPENAI_API_KEY` | Optional | none | Enables GPT material analysis and AI comparison. Local database features still work without it. |
| `OPENAI_MODEL` | Optional | `gpt-4.1-mini` | Model used for AI analysis and comparison. |
| `MATFINDER_ADMIN_TOKEN` | Audit access | none | Backend-only bearer credential for the `/audit` page and audit APIs. If absent, audit APIs remain closed. |
| `MATFINDER_TRUST_PROXY` | Render only | empty | Set to exactly `render` on Render to derive client identity from a validated `X-Forwarded-For` chain. |
| `MATFINDER_ALLOWED_ORIGINS` | Frontend-only deploys | empty | Comma-separated browser origins allowed to call `/api/*`, such as `https://matfinder-ai.vercel.app`. |
| `MATFINDER_API_BASE_URL` | Frontend-only deploys | empty | Backend API origin for static frontend hosting, such as `https://matfinder-api.onrender.com`. |

Do not commit `.env`, `.env.local`, actual admin tokens, or real API keys. Keep the admin token out of `public/config.js` and Vercel build variables.

Anonymous visitors do not see the Audit navigation item. Direct navigation to `/audit` on the same-origin backend prompts for the admin token. The browser keeps it only in current JavaScript memory; a refresh requires re-entry. The public catalog works when the token is absent.

## Health Check

The server exposes three separate operational signals:

```txt
GET /api/live    -> process can serve HTTP; no database or OpenAI query
GET /api/health  -> read-only SQLite technical health; Render/Docker health path
GET /api/ready   -> verified catalog-stats generation AND an eligible public engineering commercial grade exists
```

Successful responses, respectively:

```txt
{"status":"alive"}
{"status":"ok"}
{"status":"ready"}
```

`/api/health` returns 503 with `{"status":"unhealthy","reason":"database_unavailable"}`
if the SQLite read fails. `/api/ready` returns 503 with
`{"status":"not_ready","reason":"no_verified_public_grades"}` when no eligible
public commercial grade exists, even while `/api/health` remains 200. A database
failure makes `/api/ready` return 503 with reason `database_unavailable`.
Missing catalog data cannot be repaired by restarting a technically healthy
instance, so Render and Docker continue using `/api/health` as their health path.
These public responses do not include database counts, memory, configuration,
or repository diagnostics. OpenAI and audit-admin credentials do not affect them.
The product-grade existence result is cached for at most five seconds per
process; the technical SQLite read still runs on every health/readiness probe.

## SQLite Deployment Notes

After all maintenance writers have finished, seal the database in DELETE journal
mode and run `npm run build:catalog-stats -- <absolute-database-path>`. The default
path is the repository's `matfinder.db`. This offline command reserves the SQLite
writer, reads public materials in keyset batches of 30, evaluates complete evidence,
streams the database bytes with a 64 KiB buffer, and atomically publishes
`<database-path>.catalog-stats.json`. It does not change material data. WAL, SHM
and journal side files are rejected; checkpoint/seal during maintenance before
finalization. Maintenance success alone does not establish stats readiness.

Publish the finalized DB, its sidecar and the exact application sources together.
The fixed semantic policy manifest is `material-quality.js`, `evidence-model.js`,
and `material-repository.js`: evaluator rules, evidence interpretation, public
membership and aggregate count semantics. Artifact parsing, hashing, publication
and bootstrap mechanics are governed by the artifact format rather than included
in P. `catalog-policy.js` synchronously captures bounded source bytes before
loading these modules, verifies them after load, and retains the loaded identity
for the process. Each source file is capped at 256 KiB. A preloaded module without
this binding is rejected; an in-process builder must use this bootstrap and rejects
source changes since load. Runtime compares the artifact against its loaded P,
never labels cached P1 with later disk P2, and does not hash source on requests.
Identity includes line endings. A Git commit ID is not a substitute. Source-checkout sidecars are ignored;
Docker generates a fresh artifact after `COPY` and fails its build on errors.

Finalization holds a database read descriptor plus the SQLite writer reservation.
After asynchronous checks and temporary-file validation, the builder synchronously
rehashes held-file bytes and compares descriptor/path state (device, file ID where
available, size and modification/change times), policy bytes and sealing. It repeats
validation after atomic replacement and guard release before reporting success.
A post-replace failure restores the previous sidecar; without a predecessor it
removes the new sidecar. If restoration fails, it removes the new sidecar and reports
failure. No builder correctness claim depends on later runtime rejection.
Supported maintenance keeps source and DB stable while finalizing; persistent
replacement/content changes observed through the final check fail closed. This is
not cryptographic atomicity against hostile filesystem mutate-and-restore races or
a promise that a different process cannot write after the builder's final check.

Admin audit SQL quality summaries are DEFERRED / OUT OF AD-08 PUBLIC PARITY SCOPE.
They are authenticated, separate from public material quality, canonical detail,
recommendation eligibility, readiness and catalog aggregates. AD-08 does not rewrite
that diagnostic approximation. Public canonical ownership applies to those public
and runtime surfaces, not audit inventory summaries.

Startup verifies the small artifact and streams the actual database once before
listening. Missing, malformed, mismatched or unsupported generations permit a
degraded server: catalog browsing remains available, stats return 503 without fake
zeroes, and ready returns `catalog_stats_unavailable`. Health remains technical.
The two catalog endpoints share same-connection data-version and file-state checks.
Detected live writes/replacement invalidate the process for its remaining lifetime:
pages no longer claim the old generation, stats/ready fail closed. Stop the process,
finish maintenance, regenerate/publish the matching artifact, then restart. An old
matching DB/artifact/code pair can be restored only through restart/revalidation.
No online rebuilding or general cache-freshness mechanism is provided.

- The Docker image uses the `matfinder.db` file shipped in the repository.
- The deployed server reads SQLite directly from Node.js at startup; Python is not required for production runtime or Docker build.
- Current app behavior is read-only. Rebuild/redeploy after changing material data.
- Run `npm run migrate:materials` only as a local data maintenance step when intentionally regenerating `matfinder.db`.
- If you later add admin editing, mount persistent storage and set `MATFINDER_DB_PATH` to that mounted file path.

## Docker

Build locally:

```bash
docker build -t matfinder-ai .
```

Run locally:

```bash
docker run --rm -p 3000:3000 --env-file .env.local matfinder-ai
```

Then open:

```txt
http://localhost:3000
http://localhost:3000/api/health
```

Without `OPENAI_API_KEY`, search, filters, local recommendation, details, and comparison table continue to work. GPT analysis/comparison panels will show that OpenAI is not configured.

## Render

Official references: [Render deploys](https://render.com/docs/deploys/), [Render health checks](https://render.com/docs/health-checks), [Render environment variables](https://render.com/docs/environment-variables).

Recommended backend deployment:

1. Push the repository to GitHub.
2. In Render, create a new Web Service from the repository.
3. Choose Docker deployment. Render can also use the included `render.yaml` Blueprint.
4. Set the health check path to `/api/health`.
5. Add environment variables:
   - `NODE_ENV=production`
   - `MATFINDER_DB_PATH=/app/matfinder.db`
   - `OPENAI_MODEL=gpt-4.1-mini`
   - `MATFINDER_TRUST_PROXY=render`
   - `MATFINDER_ADMIN_TOKEN=<long random backend-only token>` if audit access is needed
   - `MATFINDER_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app` if using a separate Vercel frontend
   - `OPENAI_API_KEY=<your key>` if AI explanations should be enabled
6. Deploy and verify `/api/health`.

Render will route traffic to the new instance after the health check passes.

After deployment, verify how Render constructs `X-Forwarded-For` with a controlled request containing a forged prefix. The limiter uses the rightmost validated forwarded address in `render` trust mode and falls back to the socket address for malformed or oversized chains. Do not use `render` trust mode when the Node port is directly reachable from untrusted clients. In-process limits reset on restart and apply per instance; review the design before scaling beyond one instance.

The AI API permits three quick actions per client, then refills one action every two minutes. A separate process-wide budget and a maximum of two active provider calls still apply when client IPs vary. Requests over 8 KiB, invalid fields, and non-public material IDs are rejected before provider use; provider calls time out after 20 seconds. Rate-limited requests return HTTP 429 with `Retry-After`.

## Railway

Official references: [Railway Express guide](https://docs.railway.com/guides/express), [Railway variables](https://docs.railway.com/develop/variables), [Railway variables reference](https://docs.railway.com/reference/variables).

Recommended backend deployment:

1. Push the repository to GitHub.
2. Create a Railway project and deploy from the repo.
3. Railway should detect `Dockerfile`; `railway.json` also pins Dockerfile-based deployment.
4. Add variables:
   - `NODE_ENV=production`
   - `MATFINDER_DB_PATH=/app/matfinder.db`
   - `OPENAI_MODEL=gpt-4.1-mini`
   - `MATFINDER_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app` if using a separate Vercel frontend
   - `OPENAI_API_KEY=<your key>` if AI explanations should be enabled
5. Generate or attach a public domain.
6. Open `/api/health` on the Railway domain.

## Vercel Frontend

Official references: [Vercel environment variables](https://vercel.com/docs/environment-variables), [Vercel CLI deploy](https://vercel.com/docs/cli/deploy).

Vercel is recommended for the static frontend only. Deploy the API/backend to Render or Railway first.

Admin audit access is supported on the same-origin Render-hosted app. This deployment does not enable cross-origin `Authorization` for the separate Vercel frontend.

1. Deploy the backend and copy its public URL, for example `https://matfinder-ai.onrender.com`.
2. In Vercel, import the same repository as a static frontend project.
3. Set environment variable:
   - `MATFINDER_API_BASE_URL=https://your-backend-domain`
4. Use build command:
   - `npm run build:frontend-config`
5. Use output directory:
   - `public`
6. Deploy.
7. After Vercel gives you a production URL, add that exact origin to the backend `MATFINDER_ALLOWED_ORIGINS` value and redeploy/restart the backend if needed.

The build command writes `public/config.js`, and the browser will call:

```txt
https://your-backend-domain/api/materials
https://your-backend-domain/api/material-analysis
https://your-backend-domain/api/material-comparison
```

If `MATFINDER_API_BASE_URL` is empty, the frontend uses same-origin `/api/...`, which is correct for the single-service Render/Railway/Docker deployment.

## Smoke Tests

Run before deployment:

```bash
npm start
```

In another terminal:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/materials
```

Optional OpenAI check:

```bash
npm run smoke:openai
```

The OpenAI check requires a valid `OPENAI_API_KEY` with available quota.
