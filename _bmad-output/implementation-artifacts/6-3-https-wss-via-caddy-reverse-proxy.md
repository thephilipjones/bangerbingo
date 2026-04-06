# Story 6.3: HTTPS/WSS via Caddy Reverse Proxy

Status: done

## Story

As an operator,
I want TLS termination and WebSocket upgrade handled by a reverse proxy that auto-manages certificates,
So that production traffic is HTTPS/WSS without manual cert wrangling.

## Acceptance Criteria

1. **Caddy service in compose:** `docker-compose.yml` gains a `caddy` service using image `caddy:2-alpine` with ports 80 and 443 published on the host, named volumes `caddy_data` and `caddy_config` persisting certs across restarts, and `depends_on: app`.

2. **Caddyfile at repo root:** A `Caddyfile` declares a site block for `{$APP_DOMAIN}` with `reverse_proxy app:3000`. No extra WebSocket headers needed — Caddy 2 upgrades WS connections automatically.

3. **Auto TLS for public domains:** When `APP_DOMAIN` resolves publicly, Caddy obtains and renews a Let's Encrypt cert with no operator action.

4. **Tailnet / self-signed path documented:** README documents adding `tls internal` to the site block for tailnet-only hostnames, and explains accepting the self-signed cert warning in mobile browsers.

5. **HTTP → HTTPS redirect:** Caddy's default behaviour when TLS is configured returns a 308 redirect on port 80. No explicit config needed.

6. **WebSocket end-to-end:** `wss://{APP_DOMAIN}/ws` upgrade completes successfully and `session:connect` / `player:joined` events flow as in local dev.

7. **Healthcheck verification:** `curl -I https://{APP_DOMAIN}/healthz` returns HTTP 200 with a valid TLS cert (no `-k` flag needed for public domains).

8. **App port hardened:** The `app` service removes its host-facing `ports:` mapping — the app is no longer directly reachable on the host; Caddy is the sole ingress. Caddy reaches the app via `app:3000` on the internal Docker network.

9. **README deployment section updated:** Adds Caddy-specific deploy steps, `APP_DOMAIN` requirement, and tailnet `tls internal` fallback instructions.

## Tasks / Subtasks

- [x] Create `Caddyfile` at repo root (AC: #2, #3, #4)
  - [x] Single site block: `{$APP_DOMAIN} { reverse_proxy app:3000 }`
  - [x] Add commented-out `tls internal` line with note for tailnet use

- [x] Update `docker-compose.yml` (AC: #1, #8)
  - [x] Remove `ports:` from the `app` service (app no longer exposed on host)
  - [x] Add `caddy` service: `image: caddy:2-alpine`, `ports: ["80:80", "443:443"]`, `env_file: .env`, `volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy_data:/data, caddy_config:/config]`, `depends_on: [app]`, `restart: unless-stopped`
  - [x] Add `caddy_data` and `caddy_config` to the top-level `volumes:` block

- [x] Update README "Deployment" section (AC: #4, #9)
  - [x] Document that `APP_DOMAIN` must be set in `.env` and must resolve to the host
  - [x] Add `docker compose up -d` now starts both `app` and `caddy`
  - [x] Add tailnet `tls internal` variant with instructions for accepting self-signed cert warning
  - [x] Note: app is no longer directly accessible on port 3000 from outside the host; all traffic goes through Caddy

### Review Findings

- [x] [Review][Patch] `depends_on: app` missing `condition: service_healthy` — Caddy may start proxying before the app passes its healthcheck; use `condition: service_healthy` [docker-compose.yml]
- [x] [Review][Patch] No `restart: unless-stopped` on `app` service — false positive; already present in code [docker-compose.yml]
- [x] [Review][Patch] No 443/UDP port published — Caddy 2 advertises HTTP/3 via `Alt-Svc` by default but UDP traffic is silently dropped; add `"443:443/udp"` [docker-compose.yml]
- [x] [Review][Patch] `env_file: .env` on `caddy` service exposes all app secrets (SPOTIFY_CLIENT_SECRET, SESSION_SECRET, etc.) into the Caddy container; only `APP_DOMAIN` is needed — use explicit `environment:` instead [docker-compose.yml]
- [x] [Review][Patch] No healthcheck on `caddy` service — silent failures (ACME challenge failure, startup crash) are invisible to `docker compose ps` [docker-compose.yml]
- [x] [Review][Patch] `docker compose down -v` destroys TLS certs (`caddy_data`) with no warning — README should note the Let's Encrypt rate-limit risk (5 certs/domain/week) [README.md]
- [x] [Review][Patch] Minor doc inconsistency: Caddyfile comment says "uncomment the next line" but README says 'uncomment `tls internal`' — align wording [Caddyfile]
- [x] [Review][Defer] No firewall/NAT note for Let's Encrypt HTTP-01 — README notes domain must resolve but omits that port 80 must be publicly reachable; silent ACME failure if firewalled [README.md] — deferred, minor doc enhancement
- [x] [Review][Defer] `APP_DOMAIN` unset gives cryptic Caddy parse error with no operator guidance — no validation in compose or startup [docker-compose.yml] — deferred, operational edge case
- [x] [Review][Defer] `SPOTIFY_REDIRECT_URI` in `.env.example` not updated for HTTPS production use — out of scope for story 6-3 — deferred, pre-existing
- [x] [Review][Defer] No `caddy reload` instruction after Caddyfile edit for tailnet path — operators may not know to restart the caddy container [README.md] — deferred, minor doc enhancement
- [x] [Review][Defer] WebSocket connections dropped on `app` container restart — pre-existing behavior, no alternative path now that port binding is removed — deferred, pre-existing
- [x] [Review][Defer] `caddy_config` volume purpose undocumented in README — deferred, minor
- [x] [Review][Defer] `wget` not explicitly installed in Dockerfile for `app` healthcheck — pre-existing, works on Alpine by default — deferred, pre-existing

## Dev Notes

### What this story does NOT touch

- `src/server/index.ts` — no changes; `/healthz` is already registered and the server listens on `0.0.0.0:3000` inside the container
- `.env.example` — `APP_DOMAIN` is already present (added in 6-2)
- `Dockerfile` — no changes

### Current docker-compose.yml state (after 6-2)

```yaml
services:
  app:
    build: .
    ports:
      - "${PORT:-3000}:${PORT:-3000}"   # ← REMOVE this entire ports block
    env_file: .env
    environment:
      - DB_PATH=/data/bangerbingo.db
    volumes:
      - bangerbingo-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  bangerbingo-data:
```

The `healthcheck` uses `localhost:${PORT:-3000}` inside the container — this works correctly after removing `ports:`, because the check runs inside the `app` container where the server is listening on port 3000 regardless.

### Target docker-compose.yml

```yaml
services:
  app:
    build: .
    # No host ports — Caddy proxies to app:3000 on the internal Docker network
    env_file: .env
    environment:
      - DB_PATH=/data/bangerbingo.db
    volumes:
      - bangerbingo-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    env_file: .env
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    restart: unless-stopped

volumes:
  bangerbingo-data:
  caddy_data:
  caddy_config:
```

Key points:
- `app` has no `ports:` — only reachable via `app:3000` on the internal compose network
- `caddy` uses `env_file: .env` so `{$APP_DOMAIN}` in the Caddyfile resolves from `.env`
- `caddy_data:/data` holds Let's Encrypt certs; `caddy_config:/config` holds Caddy's auto-save config

### Caddyfile

```
{$APP_DOMAIN} {
    reverse_proxy app:3000
    # For tailnet-only hostnames (e.g. bingo.tail-abc123.ts.net), uncomment the next line:
    # tls internal
}
```

**Why no extra WebSocket config:** Caddy 2's `reverse_proxy` directive automatically handles HTTP Upgrade requests (including `Connection: Upgrade` / `Upgrade: websocket`) — no `header_up` or matcher syntax needed. The `/ws` endpoint at `app:3000` will receive the upgrade request exactly as it does in local dev.

**`{$APP_DOMAIN}` syntax:** This is Caddy's environment variable placeholder syntax (braces + dollar sign). Caddy reads it at startup from its own process environment, which comes from `env_file: .env` in compose.

### Tailnet `tls internal` explanation for README

When `APP_DOMAIN` is a Tailscale hostname (e.g. `bingo.tail-abc123.ts.net`), Let's Encrypt cannot verify domain ownership via HTTP-01 challenge (the host isn't publicly reachable). Adding `tls internal` makes Caddy issue a local self-signed cert instead. Browsers and iOS Safari will show a "Not Secure" warning; the user must accept it once. On iOS Safari: tap "Show Details" → "visit this website".

### Deferred items from 6-2 addressed by this story

From `deferred-work.md` (line 216-217):
- ✅ Port binding on `0.0.0.0`: fixed by removing `ports:` from `app` service entirely — Caddy is now the sole ingress
- ✅ PORT env_file interpolation issue: moot once `ports:` is removed from `app`; Caddy always listens on 80/443

### What stays the same

- App server internal healthcheck still uses `localhost:${PORT:-3000}` — this works fine inside the container
- `bangerbingo-data` volume and `DB_PATH` setup unchanged
- `Dockerfile` unchanged — app image is identical
- `src/server/index.ts` unchanged — no app-level TLS or header changes needed

### Testing

- No automated tests for this story — it is pure infrastructure config
- `npm run lint` (`tsc --noEmit`) must still pass (no TS file changes expected)
- Manual smoke test: `docker compose up -d --build` → `curl -I https://{APP_DOMAIN}/healthz` returns HTTP 200 with valid cert
- WebSocket smoke test: open `https://{APP_DOMAIN}` in a browser, open room, confirm WS connect event fires (check browser DevTools Network tab for `wss://` connection)

### References

- [Epic 6-3 acceptance criteria](../_bmad-output/planning-artifacts/epics.md#L1011)
- [docker-compose.yml](../../docker-compose.yml) — current state after 6-2
- [Dockerfile](../../Dockerfile) — do not modify
- [src/server/index.ts](../../src/server/index.ts) — do not modify; /healthz at line 38
- [.env.example](../../.env.example) — APP_DOMAIN already present at line 16
- [deferred-work.md](deferred-work.md) — 6-2 deferred items resolved by this story (port binding)
- Caddy docs: `reverse_proxy` WebSocket support is built-in; `{$VAR}` is env placeholder syntax; `tls internal` for self-signed

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None.

### Completion Notes List

- Created `Caddyfile` at repo root with `{$APP_DOMAIN}` site block, `reverse_proxy app:3000`, and commented `tls internal` for tailnet use.
- Updated `docker-compose.yml`: removed `ports:` from `app` service (app no longer host-exposed), added `caddy` service with `caddy:2-alpine` image, ports 80/443, named volumes `caddy_data`/`caddy_config`, and `depends_on: app`.
- Updated README Deployment section: `APP_DOMAIN` marked required, added Caddy/TLS setup section covering public domain auto-TLS, tailnet self-signed path with iOS Safari instructions, HTTP→HTTPS redirect, and WebSocket behaviour. `caddy_data` volume noted for cert persistence.
- No TypeScript files changed. Pre-existing lint error in `RoundConfigOverlay.test.ts` is unrelated to this story and predates it.
- No automated tests: this story is pure infrastructure config. Manual smoke test: `docker compose up -d --build` → `curl -I https://{APP_DOMAIN}/healthz`.

### File List

- `Caddyfile` (new)
- `docker-compose.yml` (modified)
- `README.md` (modified)

## Change Log

| Date | Change |
|---|---|
| 2026-04-06 | Initial implementation: Caddyfile, docker-compose.yml Caddy service, README deployment docs |
