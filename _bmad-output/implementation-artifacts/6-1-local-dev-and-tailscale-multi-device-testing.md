# Story 6.1: Local Dev & Tailscale Multi-Device Testing

Status: review

## Story

As a developer,
I want to run the full stack locally with a single command and reach it from other browsers and my phone,
So that I can test host+guest flows end-to-end before deploying.

## Acceptance Criteria

1. **Single-command setup:** On a fresh clone, `cp .env.example .env` + fill Spotify creds + `npm install && npm run dev` is sufficient to start Vite (5173) and Hono (3000) concurrently. No further setup commands required. (NFR17)
2. **Hono binds to `0.0.0.0`:** `serve()` from `@hono/node-server` is called with `hostname: '0.0.0.0'` explicitly so LAN / Tailscale peers can reach it.
3. **Vite binds to all interfaces:** `vite.config.ts` sets `server.host: true`; existing `/auth`, `/api`, `/ws` proxy entries to `http://127.0.0.1:3000` remain unchanged.
4. **Multi-browser local play:** Host on `http://127.0.0.1:5173/` in Chrome and guests on `http://127.0.0.1:5173/room/:code` in Firefox/Safari can play a full session locally with no extra tunnel/proxy setup.
5. **Tailscale phone join:** With Macbook on the tailnet, phone (also on tailnet) opens `http://<macbook-tailnet-hostname>:5173/room/:code`, joins as guest, receives a card, marks tiles, and sees real-time WS events from the host's browser.
6. **README Spotify-on-Tailscale guidance:** README documents either (a) registering a secondary Spotify redirect URI matching the tailnet hostname, or (b) using the primary `http://127.0.0.1:5173/auth/callback` on the Macbook and testing Spotify-dependent flows from the Macbook only.
7. **README "Local Development" section:** README contains a Local Development section covering: (a) single-command setup flow, (b) multi-browser host+guest flow on Macbook, (c) Tailscale phone testing with a tailnet hostname example, (d) Troubleshooting sub-section covering port collisions (3000/5173), tailnet TLS cert warnings on phone, and Spotify 400 errors from unregistered redirect URIs.
8. **`.env.example` is the source of truth:** Every variable consumed by [src/server/config.ts](src/server/config.ts) is listed in `.env.example` with a brief comment explaining its purpose and a safe placeholder value.

## Tasks / Subtasks

- [x] Update Vite dev server binding (AC: #3)
  - [x] In [vite.config.ts](vite.config.ts), change `server.host` from `'127.0.0.1'` to `true`
  - [x] Verify proxy entries for `/auth`, `/api`, `/ws` still target `http://127.0.0.1:3000` (unchanged)
- [x] Make Hono server bind to all interfaces (AC: #2)
  - [x] In [src/server/index.ts](src/server/index.ts), pass `hostname: '0.0.0.0'` to `serve({ fetch, port, hostname })`
  - [x] Update the server's console log line — current literal `http://127.0.0.1:${config.port}` misleads when running from a phone; log the port with a note that the server is reachable on all LAN/tailnet interfaces
- [x] Annotate `.env.example` with comments (AC: #8)
  - [x] Add a one-line comment above each variable describing purpose + safe placeholder
  - [x] Keep every var currently consumed by [src/server/config.ts](src/server/config.ts): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SESSION_SECRET`, `PORT`, `NODE_ENV`
  - [x] Do NOT add vars not consumed by config.ts (no DB_PATH yet — that arrives in Story 6-2)
- [x] Extend [README.md](README.md) with a "Local Development" section (AC: #1, #4, #5, #6, #7)
  - [x] Sub-heading: "Local Development" (place after current "Getting Started" / "Scripts" block)
  - [x] Sub-section: "Multi-browser host+guest testing on one Macbook" — point hosts to Chrome, guests to Firefox/Safari, all at `http://127.0.0.1:5173/`
  - [x] Sub-section: "Testing from your phone over Tailscale" — include an example URL like `http://<macbook-tailnet-hostname>:5173/room/:code`; note that Vite now binds to all interfaces and Hono binds to `0.0.0.0`
  - [x] Sub-section: "Spotify auth from a Tailscale peer" — documents the two options in AC #6
  - [x] Sub-section: "Troubleshooting" — covers: (a) port already in use (3000/5173), (b) phone browser warning on tailnet (no TLS in dev — this is expected), (c) Spotify 400 INVALID_CLIENT / redirect_uri_mismatch when the tailnet URL is not registered
- [ ] Manual verification (AC: #4, #5) — **deferred to user**
  - [ ] Fresh clone OR clean working tree: `npm install && npm run dev` → both processes start
  - [ ] Open host in Chrome at `http://127.0.0.1:5173/`, connect Spotify, create room
  - [ ] Open guest in Firefox AND Safari at the room URL, join, mark tiles
  - [ ] From a phone on the same Tailscale tailnet, open `http://<macbook-tailnet-hostname>:5173/room/:code`, verify card loads, tile taps roundtrip via WS
  - [ ] Record results in Completion Notes

### Review Findings

- [x] [Review][Patch] Verify Vite `server.allowedHosts` is not required for tailnet hostname [vite.config.ts:12] — FIXED: added `allowedHosts: true` to server config to preempt Vite 6.x host-check blocking tailnet hostnames.
- [x] [Review][Patch] File List missing `src/client/pages/HostRoomPage.svelte` [6-1 story doc] — FIXED: added to File List + documented latent-bug fix in Completion Notes.
- [x] [Review][Defer] Session cookie `Secure=false` in dev will silently break if someone runs `NODE_ENV=production` over plain-HTTP tailnet [src/server/auth.ts:87,96,186] — deferred, pre-existing. Not a 6-1 concern; relevant to Epic 6-2/6-3 deploy hardening.

## Dev Notes

### Current state (verified)

- [vite.config.ts:12](vite.config.ts#L12) — `server.host` is currently `'127.0.0.1'`. That is the only reason LAN/tailnet peers can't reach Vite today.
- [src/server/index.ts:44](src/server/index.ts#L44) — `serve({ fetch: app.fetch, port: config.port }, ...)`. `@hono/node-server`'s `serve()` defaults to `0.0.0.0` when `hostname` is omitted, so it *probably* already listens on all interfaces — but AC #2 says be explicit. Pass `hostname: '0.0.0.0'` so future readers don't have to guess.
- [.env.example](.env.example) — already lists all six vars consumed by `config.ts`. Only missing piece is inline comments.
- [README.md](README.md) — has "Getting Started" but no "Local Development" section with multi-browser / Tailscale guidance.

### Patterns from previous stories

- Story 5-7 (pre-deploy hardening) scoped narrowly and did not add infra/config surface beyond what the AC demanded. Apply the same restraint here: do NOT introduce `DB_PATH`, Docker, healthcheck, or HTTPS concerns — those belong to stories 6-2, 6-3.
- The `hosting-and-deployment.md` living doc (see `_bmad-output/implementation-artifacts/hosting-and-deployment.md`) references `DATABASE_PATH` and Cloudflare Tunnel — those are Epic 6-2/6-3 concerns, NOT this story.
- Spotify API constraints: Spotify removed `localhost` redirect URIs in late-2025 (already documented in README). Use `127.0.0.1` in examples, NOT `localhost`. Tailscale hostname is IP-based-ish and Spotify *will* reject unregistered redirect URIs with a 400 — the README section should surface this clearly.

### What NOT to touch

- Do NOT rewrite the existing README "Getting Started" block — append a new "Local Development" section.
- Do NOT modify proxy targets in `vite.config.ts` — they must stay `http://127.0.0.1:3000`. The Hono server is reached by Vite over loopback; only client→Vite traffic needs to come in over the tailnet.
- Do NOT introduce `DB_PATH` / `APP_DOMAIN` — those land in 6-2 / 6-3.
- Do NOT add a `.env.tailscale` or similar; the single `.env` is sufficient.

### Project Structure Notes

- Vite config: `vite.config.ts` at repo root
- Server entry: `src/server/index.ts`
- Env template: `.env.example` at repo root
- Docs: `README.md` at repo root

### Testing standards

- No new automated tests required for this story — the acceptance evidence is the manual verification checklist in Tasks. The changes are dev-ergonomics config, not runtime logic.
- `npm run lint` (tsc --noEmit) must still pass after changes.
- `npm test` must still pass (no regressions).

### References

- [epics.md:925](../_bmad-output/planning-artifacts/epics.md#L925) — Story 6-1 acceptance criteria (canonical)
- [epics.md:77](../_bmad-output/planning-artifacts/epics.md#L77) — FR41/FR42/FR43, NFR6/NFR13/NFR17
- [src/server/config.ts](src/server/config.ts) — env var consumers (source of truth for `.env.example`)
- [vite.config.ts](vite.config.ts) — current dev server config
- [README.md](README.md) — existing Getting Started section to extend
- [_bmad-output/implementation-artifacts/hosting-and-deployment.md](_bmad-output/implementation-artifacts/hosting-and-deployment.md) — Epic 6 living doc (reference only — do NOT implement its Docker/Cloudflare bits in this story)

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- `npm run lint` → clean (tsc --noEmit, no errors)
- `npm test` → 235/235 passing across 12 files (no regressions)

### Completion Notes List

- **All code + doc tasks complete** (AC #1, #2, #3, #6, #7, #8).
- **AC #4 and AC #5 (multi-browser + Tailscale phone join) require manual verification by the user** — these need a Macbook+phone on a tailnet and a live Spotify auth flow, which the dev agent can't execute. Kept the "Manual verification" task block unchecked and flagged `deferred to user`. Once you've run through the checklist, tick the boxes, note any findings here, and flip Status to `review`.
- Hono's `serve()` in `@hono/node-server` already defaults to `0.0.0.0` when `hostname` is omitted, but AC #2 required making it explicit — done. Console log no longer claims `http://127.0.0.1:${port}` since that misled over tailnet.
- Did NOT introduce `DB_PATH`, Docker, HTTPS, or `APP_DOMAIN` — those are Epic 6-2 / 6-3 concerns, as flagged in Dev Notes "What NOT to touch".
- README's "Local Development" section was **appended** after "Getting Started" (before "Scripts"), leaving the existing onboarding flow intact.
- **Latent bug fix bundled in:** `HostRoomPage.svelte` was calling `GET /api/auth/token` for the Spotify Web Playback SDK, but `authRouter` is mounted at `/auth` (not `/api/auth`), so the original path never resolved. Changed to `/auth/token`. Included in this story per user decision during code review since the bug surfaces immediately when the host tries to play a track.
- **Post-review patch:** added `allowedHosts: true` to `vite.config.ts` server config. Vite 6.x can reject non-loopback Host headers with "Blocked request. This host is not allowed.", which would defeat AC #5 (tailnet phone join). Setting `allowedHosts: true` is the explicit dev-only bypass.

### File List

- `vite.config.ts` — modified (`server.host: true`, `allowedHosts: true` for tailnet access)
- `src/server/index.ts` — modified (`hostname: '0.0.0.0'` + updated log line)
- `.env.example` — modified (inline comments for each variable)
- `README.md` — modified (added "Local Development" section with multi-browser, Tailscale, Spotify-on-tailnet, and Troubleshooting subsections)
- `src/client/pages/HostRoomPage.svelte` — modified (fetch path `/api/auth/token` → `/auth/token`; see Completion Notes)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (story 6-1 → in-progress)
- `_bmad-output/implementation-artifacts/6-1-local-dev-and-tailscale-multi-device-testing.md` — modified (task checkboxes, Dev Agent Record, Status)
