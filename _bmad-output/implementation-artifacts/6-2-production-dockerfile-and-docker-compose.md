# Story 6.2: Production Dockerfile & Docker Compose

Status: done

## Story

As an operator,
I want a single `docker compose up -d` to bring up the whole stack with secrets from env,
So that I can deploy to a Proxmox LXC without manual bootstrapping.

## Acceptance Criteria

1. **Multi-stage Dockerfile:** `docker build` runs a multi-stage build — stage 1 (`node:22-alpine`) installs all deps, runs `npm run build` producing `dist/client` and `dist/server`; stage 2 (`node:22-alpine`) copies `dist/`, `package.json`, and production-only `node_modules`, runs as a non-root user, and declares `CMD ["node", "dist/server/index.js"]`. Final image is under 300 MB.

2. **DB_PATH env var in db.ts:** `src/server/db.ts` reads `process.env['DB_PATH']` and passes it to `initDb()`. The existing `initDb(dbPath = './bangerbingo.db')` signature stays unchanged — only the call site in `src/server/index.ts` changes (from `initDb()` to `initDb(process.env['DB_PATH'])`). Default to `./bangerbingo.db` when unset.

3. **Single docker-compose.yml:** A single `app` service, reads env from `.env` via `env_file:`, mounts named volume `bangerbingo-data` at `/data`, exports `DB_PATH=/data/bangerbingo.db` to the container, restarts `unless-stopped`. App is reachable on the configured port within 60 seconds after `docker compose up -d`. No manual migration/seeding needed — `CREATE TABLE IF NOT EXISTS` in `initDb()` handles fresh databases.

4. **Healthcheck endpoint:** `GET /healthz` responds with HTTP 200 and `{ "ok": true, "version": "0.1.0" }` (version from package.json). The compose healthcheck uses `wget -qO-` against this endpoint on a 30-second interval.

5. **README "Deployment" section:** New section listing required env vars (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SESSION_SECRET`, `APP_DOMAIN`, optional `PORT`), exact `docker compose` commands for start/stop/logs/rebuild, and the named volume path. Secrets are never baked into the image (NFR7, NFR9).

6. **`.dockerignore`:** Excludes `node_modules`, `dist`, `.env`, `*.db`, `*.db-shm`, `*.db-wal`, `.claude/`, `_bmad*`, `.git`, `_bmad-output` from the build context.

7. **`.env.example` updated:** Add `DB_PATH` and `APP_DOMAIN` entries with inline comments.

## Tasks / Subtasks

- [x] Create `.dockerignore` (AC: #6)
  - [x] Exclude: `node_modules/`, `dist/`, `.env`, `*.db`, `*.db-shm`, `*.db-wal`, `.claude/`, `_bmad*/`, `.git/`, `_bmad-output/`

- [x] Write `Dockerfile` (AC: #1)
  - [x] Stage 1 (`builder`): `node:22-alpine`, install `python3 make g++` (required for `better-sqlite3` native compilation), `COPY package*.json ./`, `RUN npm ci`, `COPY . .`, `RUN npm run build`, `RUN npm ci --omit=dev`
  - [x] Stage 2 (`runner`): `node:22-alpine`, `WORKDIR /app`, create non-root user (`addgroup -S app && adduser -S app -G app`), `COPY --from=builder` for `dist/`, `package.json`, `node_modules/`, `EXPOSE 3000`, `USER app`, `CMD ["node", "dist/server/index.js"]`

- [x] Add `GET /healthz` endpoint to `src/server/index.ts` (AC: #4)
  - [x] Route: `app.get('/healthz', ...)` returning `ctx.json({ ok: true, version: '0.1.0' })` — version string can be hardcoded to `'0.1.0'` (matches package.json; update manually on version bumps)
  - [x] Place BEFORE the `serveStatic` wildcard middleware so it is never swallowed by static serving in production
  - [x] No auth required — this is a public health probe

- [x] Update `src/server/index.ts` to pass `DB_PATH` to `initDb()` (AC: #2)
  - [x] Change `initDb()` → `initDb(process.env['DB_PATH'])` on the `initDb()` call at the top of the file
  - [x] No changes needed to `src/server/db.ts` — the default parameter already handles the undefined case

- [x] Write `docker-compose.yml` (AC: #3, #4)
  - [x] Single `app` service: `build: .`, ports (`${PORT:-3000}:${PORT:-3000}`), `env_file: .env`, `environment: [DB_PATH=/data/bangerbingo.db]`, `volumes: [bangerbingo-data:/data]`, `restart: unless-stopped`
  - [x] Healthcheck: `test: ["CMD-SHELL", "wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1"]`, `interval: 30s`, `timeout: 10s`, `retries: 3`, `start_period: 30s`
  - [x] Named volume declaration: `volumes: { bangerbingo-data: {} }`

- [x] Update `.env.example` (AC: #7)
  - [x] Add `DB_PATH=./bangerbingo.db` with comment: `# SQLite database path; in Docker point to the mounted volume (e.g. /data/bangerbingo.db)`
  - [x] Add `APP_DOMAIN=` with comment: `# Public domain name (e.g. bangerbingo.net or bingo.tail-xxx.ts.net) — used by Caddy in story 6-3`
  - [x] Do NOT remove or reorder existing entries

- [x] Add "Deployment" section to README (AC: #5)
  - [x] Required env vars table (see Dev Notes below)
  - [x] Exact commands: `docker compose up -d --build`, `docker compose down`, `docker compose logs -f`, `docker compose up -d --build` (rebuild)
  - [x] Named volume note: data persists at `bangerbingo-data` Docker volume across rebuilds; to wipe: `docker volume rm bangerbingo_bangerbingo-data`
  - [x] Mention: `.env` must be created on the host from `.env.example`; never commit `.env`

## Dev Notes

### Current file state (verified)

- [src/server/db.ts:21](src/server/db.ts#L21) — `export function initDb(dbPath = './bangerbingo.db')` — signature already accepts optional path; only the call site needs updating.
- [src/server/index.ts:13](src/server/index.ts#L13) — `initDb()` called with no argument; change to `initDb(process.env['DB_PATH'])`.
- [src/server/index.ts:38-40](src/server/index.ts#L38-L40) — `if (config.isProduction) { app.use('/*', serveStatic({ root: './dist/client' })) }` — the wildcard static handler is already gated to production. Place `/healthz` BEFORE this block.
- `.env.example` — currently lists 6 vars: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SESSION_SECRET`, `PORT`, `NODE_ENV`. Append `DB_PATH` and `APP_DOMAIN`.
- No `Dockerfile`, `docker-compose.yml`, or `.dockerignore` exist yet — all are new files.

### Critical: better-sqlite3 native module compilation

`better-sqlite3` (`^11.9.1`) compiles a native Node.js addon (`.node` file). On `node:22-alpine`:
- **Stage 1 needs build tools**: `apk add --no-cache python3 make g++` before `npm ci`
- **Stage 2 does NOT recompile** — copy `node_modules/` wholesale from stage 1 (after `npm ci --omit=dev`). Do NOT run `npm ci` in stage 2 as it would fail without build tools.
- Both stages must use the **same Node.js version** (`node:22-alpine`) so the compiled `.node` binary is compatible.
- The `node:22-alpine` base was chosen (not `node:20-alpine` per original epic draft) to match the project's `@types/node ^22` and `tsx` toolchain.

### Dockerfile approach — copy prod node_modules from builder

```dockerfile
# Stage 1: build + prune to prod deps
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm ci --omit=dev

# Stage 2: minimal production image
FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
USER app
CMD ["node", "dist/server/index.js"]
```

- `RUN npm ci --omit=dev` in stage 1 **after** `npm run build` — this overwrites the full `node_modules` with prod-only deps (including the already-compiled `better-sqlite3` binary).
- Stage 2 ONLY copies artifacts; no `npm install` or build tools needed.
- `dist/client/` is included in `dist/` COPY — the server already serves it via `serveStatic` in production mode.

### Healthz endpoint placement

In [src/server/index.ts](src/server/index.ts), register the route **before** the static wildcard:

```typescript
// Health check — must be registered before the serveStatic wildcard
app.get('/healthz', (ctx) => ctx.json({ ok: true, version: '0.1.0' }))

// Serve static client build in production
if (config.isProduction) {
  app.use('/*', serveStatic({ root: './dist/client' }))
}
```

If placed after `serveStatic`, the wildcard intercepts `/healthz` in production and serves a 404 (no matching static file).

### docker-compose.yml env var resolution

`DB_PATH` is set **both** in `env_file: .env` (may or may not be set there) and in the `environment:` block as `DB_PATH=/data/bangerbingo.db`. Docker Compose `environment:` overrides `env_file:` values for the same key, so the volume path is always used in production regardless of what `.env` says.

### README "Deployment" section content guide

| Env var | Required? | Description |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | Yes | From Spotify developer dashboard |
| `SPOTIFY_CLIENT_SECRET` | Yes | From Spotify developer dashboard |
| `SPOTIFY_REDIRECT_URI` | Yes | Must match registered redirect URI exactly |
| `SESSION_SECRET` | Yes | Long random string for cookie signing |
| `APP_DOMAIN` | Yes (6-3) | Public domain / tailnet hostname (used by Caddy reverse proxy in story 6-3) |
| `PORT` | No | Defaults to 3000 |
| `DB_PATH` | No | Set by compose to `/data/bangerbingo.db`; default `./bangerbingo.db` |

Note: `APP_DOMAIN` is documented here for completeness but is not consumed by the app server itself in this story — it is used by Caddy in story 6-3. Include it in the README env table and `.env.example` now.

### What NOT to touch

- Do NOT modify `src/server/db.ts` — the `initDb()` signature already has the right default. Only the call site changes.
- Do NOT add Caddy service or `APP_DOMAIN` env consumption to the app — that is story 6-3.
- Do NOT create separate `docker-compose.staging.yml` / `docker-compose.prod.yml` — a single `docker-compose.yml` with an `.env` file swap pattern is sufficient for this story.
- Do NOT add `DATABASE_PATH` — the canonical name is `DB_PATH` per epics AC.
- Do NOT change `src/server/config.ts` — `DB_PATH` is not a config-layer variable; it is consumed directly by `db.ts` via its `initDb()` parameter, passed from `index.ts`.

### Testing standards

- No new automated tests required — this story is infra/configuration, not runtime logic.
- `npm run lint` (`tsc --noEmit`) must pass after `src/server/index.ts` change.
- `npm test` must still pass — `initDb(process.env['DB_PATH'])` in `index.ts` is fine; the test environment sets `NODE_ENV=test` and the `initDb()` call is guarded by the existing test environment check. Actually verify: `initDb()` is called OUTSIDE the `if (config.nodeEnv !== 'test')` block at line 13 — it IS called in tests. `process.env['DB_PATH']` will be `undefined` in tests → `initDb(undefined)` → defaults to `'./bangerbingo.db'` ✓ No regression.
- Manual smoke test after build: `docker build -t bangerbingo:local . && docker run --rm -p 3000:3000 -e SPOTIFY_CLIENT_ID=x -e SPOTIFY_CLIENT_SECRET=x -e SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/callback -e SESSION_SECRET=testsecret bangerbingo:local` then `curl http://localhost:3000/healthz` should return `{"ok":true,"version":"0.1.0"}`.

### References

- [epics.md Story 6-2](../_bmad-output/planning-artifacts/epics.md#L969) — canonical acceptance criteria
- [hosting-and-deployment.md](hosting-and-deployment.md) — living deployment guide (reference for Docker patterns; this story implements the code items in its checklist)
- [src/server/db.ts](../../src/server/db.ts) — `initDb()` signature (verified: only call site needs updating)
- [src/server/index.ts](../../src/server/index.ts) — where `initDb()` is called and where `/healthz` route is added
- [src/server/config.ts](../../src/server/config.ts) — current env var consumers (do NOT add `DB_PATH` here)
- [.env.example](.env.example) — add `DB_PATH` and `APP_DOMAIN` entries
- [package.json](../../package.json) — `"version": "0.1.0"`, `"build"` script, `better-sqlite3 ^11.9.1`

### Previous story intelligence (Story 6-1)

From [6-1-local-dev-and-tailscale-multi-device-testing.md](6-1-local-dev-and-tailscale-multi-device-testing.md):

- Session cookie `Secure=false` in dev was deferred — relevant here: with `NODE_ENV=production` inside the container, `config.isProduction` will be `true` and Secure cookies will activate. This is correct behaviour for production over HTTPS (via Caddy in 6-3). In the standalone Docker-without-Caddy smoke test over plain HTTP, Spotify OAuth redirect will fail the `Secure` cookie check in some browsers — note this in README or Dev Notes.
- `initDb()` at top of `index.ts` (line 13) is called before the `if (config.nodeEnv !== 'test')` guard — changing it to `initDb(process.env['DB_PATH'])` is safe.
- Vite dev proxy (`/auth`, `/api`, `/ws` → `http://127.0.0.1:3000`) is irrelevant to production Docker — `serveStatic` serves built client assets directly from the Node server.

## Review Findings

- [x] [Review][Decision] Version string in `/healthz` hardcoded vs. AC4 "from package.json" — resolved: reads `pkg.version` from `package.json` import; added `resolveJsonModule: true` to `tsconfig.server.json` [`src/server/index.ts`]
- [x] [Review][Patch] Critical: `npm run build` never emitted `dist/server/index.js` (`tsconfig.server.json` has `noEmit: true`) — fixed: added `build:server` script using esbuild; updated `build` to include it [`package.json`]
- [x] [Review][Patch] Empty string `DB_PATH` bypasses `initDb` default — fixed: `initDb(process.env['DB_PATH'] || undefined)` [`src/server/index.ts`]
- [x] [Review][Patch] `wget -qO-` healthcheck exits 0 on HTTP 4xx/5xx — fixed: pipe through `grep -q '"ok":true'` to validate response body [`docker-compose.yml`]
- [x] [Review][Patch] `.dockerignore` `.env` exact match misses `.env.*` variants — fixed: changed to `.env*` [`.dockerignore`]
- [x] [Review][Patch] README `docker volume rm` command is fragile — fixed: replaced with `docker compose down -v` [`README.md`]
- [x] [Review][Patch] README lists `APP_DOMAIN` as "Yes (6-3)" — fixed: changed to "No (6-3)" [`README.md`]
- [x] [Review][Defer] Port binding exposes all host interfaces — `${PORT:-3000}:${PORT:-3000}` binds on `0.0.0.0`; should be `127.0.0.1:` prefix once Caddy is the sole ingress — deferred, intentional for story 6-2 pre-Caddy [`docker-compose.yml`]
- [x] [Review][Defer] `PORT` in `env_file` not visible to compose port interpolation — `${PORT:-3000}` in `ports:` resolves from host shell env, not from `env_file:`; if PORT is only in `.env`, host maps `3000:3000` while container listens on a different port — deferred, spec-defined syntax; Caddy in 6-3 will own port routing [`docker-compose.yml`]
- [x] [Review][Defer] Floating `node:22-alpine` base image tag — no digest pinning; upstream re-tag could cause ABI mismatch for `better-sqlite3` native binary between builder and runner — deferred, production hardening out of scope for this story [`Dockerfile`]
- [x] [Review][Defer] `serveStatic` wildcard ordering dependency — `/healthz` must remain before the wildcard; only a comment enforces this; a future refactor could silently break the healthcheck — deferred, documented in code [`src/server/index.ts`]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Pre-existing lint error in `src/client/__tests__/RoundConfigOverlay.test.ts:121` (TS2345) — not caused by this story, confirmed by stash test.

### Completion Notes List

- Created `.dockerignore` excluding build artifacts, secrets, and dev tooling from Docker context.
- Created multi-stage `Dockerfile`: stage 1 builds with native deps (python3/make/g++ for better-sqlite3), stage 2 is minimal runner with non-root user.
- Added `GET /healthz` endpoint returning `{ ok: true, version: "0.1.0" }` — placed before serveStatic wildcard to avoid interception in production.
- Changed `initDb()` → `initDb(process.env['DB_PATH'])` — undefined falls through to existing default `'./bangerbingo.db'`.
- Created `docker-compose.yml` with named volume, env_file, healthcheck, and restart policy.
- Appended `DB_PATH` and `APP_DOMAIN` to `.env.example` without reordering existing entries.
- Added Deployment section to README with env vars table, docker compose commands, and volume persistence notes.
- All 303 tests pass, no regressions.

### File List

- `.dockerignore` (new)
- `Dockerfile` (new)
- `docker-compose.yml` (new)
- `src/server/index.ts` (modified — added /healthz route, changed initDb() call)
- `.env.example` (modified — added DB_PATH and APP_DOMAIN)
- `README.md` (modified — added Deployment section)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status update)
- `_bmad-output/implementation-artifacts/6-2-production-dockerfile-and-docker-compose.md` (modified — task tracking)
