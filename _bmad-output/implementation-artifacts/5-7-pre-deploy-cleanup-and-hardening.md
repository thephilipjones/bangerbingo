# Story 5.7: Pre-Deploy Cleanup & Hardening

Status: done

## Story

As the project owner preparing for Epic 6 (Deploy & Harden),
I want the highest-priority pre-deploy blockers from the Epic 5 retro resolved now,
So that Epic 6 can focus on packaging and deployment without being blocked by known security and DRY debt.

## Context

Written retroactively after the fact to capture small-scope hardening work pulled out of the Epic 5 retro action items (items 1–4) and completed ahead of Epic 6. The Epic 5 retrospective (2026-04-04) flagged four pre-deploy blockers that were small enough to close immediately rather than carry into Epic 6 as part of a larger story:

1. Session cookie was unsigned raw `user_id` (forgeable) — Epic 3 debt
2. `playlistId` path param was unsanitized at the router boundary — Epic 4 debt
3. `getValidAccessToken` / token-refresh block was duplicated in 4 sites (auth fresh-token inline) — Epic 4 retro prep item, not done in Epic 5
4. Server Spotify fire-and-forget calls swallowed errors silently — Epic 5 debt

Bonus (same commit): `startRefreshScheduler()` was being invoked at module-import time, so it would start a live interval in the test environment.

## Acceptance Criteria

**Given** a request arrives with `Cookie: session=<raw_user_id>` (unsigned)
**When** `requireAuth` middleware runs
**Then** the request is rejected with 401 Unauthorized
**And** only cookies in the format `<user_id>.<hmac_sha256_signature>` signed with `SESSION_SECRET` are accepted

**Given** the `/auth/callback` endpoint completes the PKCE exchange successfully
**When** it sets the `session` cookie
**Then** the cookie value is `signUserId(userId)` (HMAC-SHA256 of the user id, keyed on `SESSION_SECRET`)
**And** the WS handshake path also calls `verifySession()` on the session cookie

**Given** an authenticated host calls `GET /api/music/tracks/:playlistId`
**When** the `playlistId` does not match `^[A-Za-z0-9]{20,30}$`
**Then** the server returns 400 `Invalid playlist ID` without making any Spotify API call

**Given** any route needs a fresh Spotify access token before calling the Spotify API
**When** the route runs
**Then** it calls `withFreshToken(host)` which centralises the 60-second pre-expiry refresh, the `refreshWithRetry` call, the degraded-host check, and the re-read from DB
**And** degraded hosts cause the route to return 503 `Spotify authentication degraded — please re-authenticate`

**Given** the server issues a fire-and-forget `PUT /me/player/play` or `PUT /me/player/pause` to Spotify
**When** the promise rejects
**Then** the error is logged via `console.error('[spotify:play]', err)` / `console.error('[spotify:pause]', err)`
**And** the request does not crash the server

**Given** the server module is imported under `NODE_ENV=test`
**When** import completes
**Then** `startRefreshScheduler()` is NOT invoked
**And** no live interval leaks across the test suite

## Tasks / Subtasks

- [x] Session cookie signing (`src/server/auth.ts`)
  - [x] Add `signUserId(id)` using `crypto.createHmac('sha256', config.sessionSecret).update(id).digest('hex')`, returning `${id}.${sig}`
  - [x] Add `verifySession(cookie)` that splits on the last `.`, recomputes the HMAC, and compares with `crypto.timingSafeEqual`
  - [x] Update `requireAuth` middleware to call `verifySession` on the cookie, reject with 401 on invalid/missing signature
  - [x] Update `/auth/callback` to set the cookie value to `signUserId(me.id)` instead of the raw id

- [x] Apply session verification to WS handshake (`src/server/ws.ts`)
  - [x] Import `verifySession` from `./auth.ts`
  - [x] Replace raw cookie read with `cookies['session'] ? verifySession(cookies['session']) : null`

- [x] Extract `withFreshToken` helper (`src/server/auth.ts`)
  - [x] Export `async function withFreshToken(host: Host): Promise<Host | null>` — returns host unchanged if token valid for ≥60s, else calls `refreshWithRetry`, re-reads from DB, returns null when host is degraded
  - [x] Replace inline refresh blocks in `src/server/music/router.ts` (3 sites: presets, search, tracks)
  - [x] Replace inline refresh block in `src/server/rooms.ts` (`POST /rooms/:code/round`)
  - [x] Degraded branch returns 503 (was 401 in some sites) — align on 503 with the human-readable message

- [x] Validate `playlistId` format (`src/server/music/router.ts`)
  - [x] In `GET /api/music/tracks/:playlistId`, reject with 400 `Invalid playlist ID` when `playlistId` does not match `^[A-Za-z0-9]{20,30}$`

- [x] Error-log fire-and-forget Spotify calls (`src/server/rooms.ts`)
  - [x] `startSong` Spotify play call: `.catch((err) => console.error('[spotify:play]', err))`
  - [x] `/round/pause` Spotify pause call: `.catch((err) => console.error('[spotify:pause]', err))`

- [x] Guard refresh scheduler against test environment (`src/server/index.ts`)
  - [x] Move `startRefreshScheduler()` invocation inside the existing `if (config.nodeEnv !== 'test')` block
  - [x] Drop the unused `_refreshInterval` module-level binding

- [x] Update tests to cover the new behaviour
  - [x] `auth.test.ts`: sign cookies with `signUserId` in all existing cases; add 2 rejection cases (invalid signature, unsigned raw id)
  - [x] `auth-status.test.ts`: sign cookies with `signUserId`
  - [x] `music.test.ts`: sign cookies; add `returns 400 for invalid playlistId format`; update valid `playlistId` fixtures to the realistic `37i9dQZF1DXcBWIGoYBM5M` format that passes the new regex
  - [x] `rooms.test.ts`: sign cookies (introduce `sessionCookie()` helper)
  - [x] `ws.test.ts`: sign session cookies used in host handshake tests

## Dev Notes

### Signing format

Chose `${userId}.${hex_hmac}` over a versioned JSON blob: minimal code, fixed-width suffix (64 hex chars for SHA-256), constant-time compare via `timingSafeEqual` on equal-length `Buffer`s. The `lastIndexOf('.')` split tolerates user ids that might contain dots. `signBuf` is padded to 64 hex chars with zeros before decode because `timingSafeEqual` requires equal-length buffers and we already short-circuit on `sig.length !== expected.length`.

Rotation / secret change invalidates all existing sessions by design — acceptable for a friends-and-family app.

### `withFreshToken` contract

Signature: `(host: Host) => Promise<Host | null>`. Null signals degraded or DB-missing; callers must return an error response (503 for degraded). The 60_000ms pre-expiry window is preserved from the inline blocks. Callers no longer need to import `refreshWithRetry`, `isHostDegraded`, or `getHostById`.

Message alignment: previously `music/router.ts` returned 401 `Spotify authentication failed` and `rooms.ts` returned 503 `Spotify authentication degraded — please re-authenticate`. Aligned on the latter (503 + human message) for all sites. Status code change is intentional: 401 is wrong here — the session is valid, the upstream is degraded.

### `playlistId` regex

Spotify playlist IDs are base62, 22 chars in practice. Allow 20–30 to tolerate edge cases without opening up arbitrary path injection. Validation is at the router boundary, before `withFreshToken` — saves a refresh on rejected input.

### Test cookie helper

Added `sessionCookie(userId = 'host_1')` helper in `rooms.test.ts` and `music.test.ts` to avoid repeating the `` `session=${signUserId(userId)}` `` template. Kept the inline form in `auth.test.ts` where each test uses a different user id for clarity.

### File List

- `src/server/auth.ts` — add `signUserId`, `verifySession`, `withFreshToken`; update `requireAuth` and `/auth/callback`
- `src/server/ws.ts` — import `verifySession`, apply to WS handshake cookie
- `src/server/music/router.ts` — use `withFreshToken` (3 sites); add `playlistId` format validation
- `src/server/rooms.ts` — use `withFreshToken`; log errors on fire-and-forget Spotify play/pause
- `src/server/index.ts` — move `startRefreshScheduler()` inside `nodeEnv !== 'test'` guard
- `src/server/__tests__/auth.test.ts` — sign cookies; add 2 signature-rejection tests
- `src/server/__tests__/auth-status.test.ts` — sign cookies
- `src/server/__tests__/music.test.ts` — sign cookies; add invalid-playlistId test; update fixtures
- `src/server/__tests__/rooms.test.ts` — sign cookies
- `src/server/__tests__/ws.test.ts` — sign cookies

### References

- Epic 5 retro: `_bmad-output/implementation-artifacts/epic-5-retro-2026-04-04.md` (Action Items 2–4, Pre-deploy blockers section)
- `SESSION_SECRET` config validation: `src/server/config.ts`
- `refreshWithRetry`, `isHostDegraded`, `clearDegradedState`: `src/server/refresh.ts`

## Dev Agent Record

### Completion Notes

- Pulled four items from Epic 5 retro action list (items 2–4 + session cookie signing) into a single small-scope hardening pass before Epic 6 kickoff
- Bonus: `refreshScheduler` test-guard (Epic 1 debt item from retro table) folded in — same file touched
- Story written retroactively; the implementation was already on `main` at the time of story creation. Sprint status was ahead of story file

### Change Log

- 2026-04-05: Retroactive story file created to match existing sprint-status entry and implementation on `main`
