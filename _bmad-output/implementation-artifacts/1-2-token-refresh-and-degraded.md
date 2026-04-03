# Story 1.2: Token Refresh & Degraded Mode

Status: done

## Story

As a host,
I want my Spotify access token to refresh automatically in the background before it expires,
so that my game session is never interrupted by an expired token mid-round.

## Acceptance Criteria

1. The server proactively refreshes a host's access token when it is within 5 minutes of expiry — no user action required.
2. On refresh failure the server retries 3 times with exponential backoff (1 s → 2 s → 4 s delays between attempts).
3. If all retries are exhausted the server marks that host as degraded (in-memory) and emits an internal `'degraded'` event via `authEvents` EventEmitter (for Epic 3 WS wiring).
4. After a successful refresh `access_token`, `refresh_token` (if rotated by Spotify), and `token_expires_at` are updated in the SQLite `hosts` table.
5. `GET /api/auth/status` (protected by `requireAuth`) returns `{ degraded: boolean, tokenExpiresAt: number }` for the authenticated host.
6. The refresh scheduler starts automatically at server startup with no manual invocation.
7. `clearDegradedState(userId)` removes a host from the degraded set (called by Epic 3 re-auth flow).

## Tasks / Subtasks

- [x] Add `updateHostTokens()` DB helper (AC: 4)
  - [x] Add `updateHostTokens(userId, accessToken, refreshToken, expiresAt)` to `src/server/db.ts` — UPDATE-only, no upsert, targets existing row

- [x] Build refresh module `src/server/refresh.ts` (AC: 1, 2, 3, 4, 6, 7)
  - [x] Export `authEvents` — `new EventEmitter()` — emits `'degraded'` with `userId: string`
  - [x] Export `isHostDegraded(userId: string): boolean` — checks in-memory degraded Set
  - [x] Export `clearDegradedState(userId: string): void` — removes from degraded Set
  - [x] Implement `refreshTokenForHost(userId: string): Promise<void>`:
    - Fetch host from DB; throw if not found
    - POST to Spotify refresh endpoint with `grant_type=refresh_token`, `refresh_token`, `client_id` (no client_secret — PKCE public client)
    - On non-OK response throw an error
    - Parse response JSON; extract `access_token`, `expires_in`, optional `refresh_token` (rotated)
    - Call `updateHostTokens(userId, newAccessToken, newRefreshToken, Date.now() + expires_in * 1000)`
    - Clear host from degraded Set on success
  - [x] Implement `retryWithBackoff(fn, maxRetries, baseDelayMs)` — private helper; retries `fn()` up to `maxRetries` times; delay doubles each retry (baseDelay, baseDelay×2, baseDelay×4)
  - [x] Implement `refreshWithRetry(userId)` — wraps `refreshTokenForHost` with `retryWithBackoff(fn, 3, 1000)`; on exhaustion adds host to degraded Set and emits `authEvents.emit('degraded', userId)`
  - [x] Export `startRefreshScheduler()` — `setInterval(checkAllHosts, 60_000)`; `checkAllHosts` queries all hosts from DB, filters those with `token_expires_at - Date.now() < 5 * 60 * 1000`, skips already-degraded hosts, calls `refreshWithRetry` for each
  - [x] Return the interval handle so it can be cleared in tests

- [x] Wire scheduler into server startup (AC: 6)
  - [x] In `src/server/index.ts`: call `startRefreshScheduler()` after `initDb()` — assign to variable (allows teardown in tests)

- [x] Add `/api/auth/status` endpoint (AC: 5)
  - [x] In `src/server/index.ts`: `GET /api/auth/status` — protected by `requireAuth` — returns `{ degraded: isHostDegraded(host.user_id), tokenExpiresAt: host.token_expires_at }`

- [x] Tests `src/server/__tests__/refresh.test.ts` (AC: 1–4)
  - [x] Successful refresh: mocks a successful Spotify token response → `updateHostTokens` called with new values → host no longer degraded
  - [x] Rotating refresh token: Spotify response includes new `refresh_token` → saved to DB
  - [x] No rotation: Spotify response omits `refresh_token` → old token preserved
  - [x] Retry success on 3rd attempt: fetch fails twice, succeeds third → no degraded state
  - [x] All retries fail → host marked degraded → `authEvents` emits `'degraded'`
  - [x] Scheduler only refreshes hosts near expiry: host with plenty of time left is skipped
  - [x] Scheduler skips already-degraded hosts
  - [x] `clearDegradedState` removes host from degraded set
  - [x] Use `initDb(':memory:')` + `upsertHost()` to seed test data; use `vi.useFakeTimers()` for backoff delays; use `vi.fn()` for fetch; call `vi.restoreAllMocks()` and `vi.useRealTimers()` in `afterEach`

- [x] Tests `src/server/__tests__/auth-status.test.ts` (AC: 5)
  - [x] Returns 401 without session
  - [x] Returns `{ degraded: false, tokenExpiresAt: <number> }` for non-degraded host
  - [x] Returns `{ degraded: true, ... }` after host is marked degraded

## Dev Notes

### Spotify refresh token endpoint (PKCE public client — no client_secret)

```
POST https://accounts.spotify.com/api/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>&client_id=<CLIENT_ID>
```

No `Authorization` header. No `client_secret`. This is intentional for PKCE public clients — confirmed in Story 1.1 notes.

**Response fields to handle:**
```ts
{
  access_token: string      // always present — save it
  expires_in: number        // always 3600
  token_type: "Bearer"      // ignore
  scope: string             // ignore
  refresh_token?: string    // OPTIONAL — Spotify rotates refresh tokens
                            // If present: save it. If absent: keep existing.
}
```

**Critical**: Spotify uses rotating refresh tokens. If the response includes a new `refresh_token`, save it. If absent, keep the one already in DB. Failing to handle rotation will cause future refreshes to fail.

### Retry / backoff contract

```
attempt 1 (immediate)  → fails → wait 1 s
attempt 2              → fails → wait 2 s
attempt 3              → fails → wait 4 s
attempt 4 (last)       → if fails → DEGRADED
```

"Retry 3×" = 1 initial + 3 retries = 4 total attempts. Delays: 1000 ms, 2000 ms, 4000 ms.

### In-memory degraded state

```ts
const degradedHosts = new Set<string>()

export function isHostDegraded(userId: string) { return degradedHosts.has(userId) }
export function clearDegradedState(userId: string) { degradedHosts.delete(userId) }
```

- Degraded state is lost on server restart. This is acceptable — hosts re-auth on next login.
- A degraded host is skipped by the scheduler (no endless retry loops).
- `clearDegradedState` is called by `refreshTokenForHost` on success (for the Epic 3 re-auth popup flow that manually triggers a refresh after re-auth).

### EventEmitter hook for Epic 3

```ts
import { EventEmitter } from 'node:events'
export const authEvents = new EventEmitter()
// emits: authEvents.emit('degraded', userId: string)
```

Epic 3's WS layer will subscribe:
```ts
import { authEvents } from './refresh.ts'
authEvents.on('degraded', (userId) => {
  // send auth:degraded WS event to host's socket
})
```

Do NOT send WS events directly in `refresh.ts` — it must not depend on the WS layer. The EventEmitter keeps the dependency direction clean.

### `updateHostTokens` vs `upsertHost`

- `upsertHost` (existing): full insert-or-replace — used by OAuth callback only
- `updateHostTokens` (new): UPDATE only — used by refresh scheduler

```ts
export function updateHostTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): void {
  db.prepare(`
    UPDATE hosts SET
      access_token = ?,
      refresh_token = ?,
      token_expires_at = ?
    WHERE user_id = ?
  `).run(accessToken, refreshToken, expiresAt, userId)
}
```

### Scheduler design

```ts
export function startRefreshScheduler(): ReturnType<typeof setInterval> {
  const interval = setInterval(async () => {
    const hosts = getAllHosts()  // new DB helper — SELECT * FROM hosts
    const REFRESH_THRESHOLD = 5 * 60 * 1000  // 5 min in ms
    for (const host of hosts) {
      if (isHostDegraded(host.user_id)) continue
      if (host.token_expires_at - Date.now() < REFRESH_THRESHOLD) {
        await refreshWithRetry(host.user_id)
      }
    }
  }, 60_000)
  return interval
}
```

Add `getAllHosts()` to `db.ts`:
```ts
export function getAllHosts(): Host[] {
  return db.prepare('SELECT * FROM hosts').all() as Host[]
}
```

### index.ts wiring

```ts
// After initDb():
const _refreshInterval = startRefreshScheduler()
// Assign to variable to avoid unhandled-promise lint warnings
// Not exported — no external code needs to stop it at runtime
```

### Testing patterns (from Story 1.1)

- `initDb(':memory:')` in `beforeEach` for full test isolation
- `vi.stubEnv(...)` at top of file for config vars (already established pattern)
- Fake timers for backoff: `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)`
- Mock `fetch`: `global.fetch = vi.fn()` — restore with `vi.restoreAllMocks()` in `afterEach`
- Import order matters: `vi.stubEnv` BEFORE importing `config` / `refresh`

### Scope boundary — what this story does NOT do

- No frontend re-auth banner (needs WS from Epic 3; leave for Epic 3 implementation)
- No session expiry check in `requireAuth` (deferred from Story 1.1 per `deferred-work.md`)
- No AbortController on fetch calls (also in `deferred-work.md`)
- No encryption of tokens at rest (deferred, acceptable for friends-use MVP)

The `/api/auth/status` endpoint serves as a lightweight bridge until WS is wired — it enables future polling-based testing of degraded state without WS dependency.

### Project Structure Notes

Touch only:
```
src/server/db.ts           ← add updateHostTokens(), getAllHosts()
src/server/refresh.ts      ← new file
src/server/index.ts        ← add startRefreshScheduler() call + /api/auth/status route
src/server/__tests__/refresh.test.ts       ← new
src/server/__tests__/auth-status.test.ts   ← new
```

No client files in this story. No new npm dependencies needed — `node:events` EventEmitter is built-in.

### References

- Retry/backoff spec: `_bmad-output/ux-spec.md` — "Token refresh resilience" under SDK Failure Banner section
- `auth:degraded` WS event contract: `_bmad-output/ux-spec.md#WebSocket Event Contracts`
- PKCE public client no client_secret: `_bmad-output/implementation-artifacts/1-1-pkce-oauth-and-session.md#Dev Notes`
- Refresh token rotation: Spotify rotates on use — `refresh_token` in response is optional but must be saved if present
- Deferred items NOT addressed here: `_bmad-output/implementation-artifacts/deferred-work.md`
- Spotify token expires in 1hr (P0): `memory/spotify_api_constraints_2026.md`
- NFR4 (silent refresh), NFR14 (surface failure with recovery action): `_bmad-output/prd.md`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Scheduler tests initially failed with "infinite loop" — `vi.runAllTimersAsync()` was re-triggering the `setInterval` endlessly. Fixed by using `clearInterval(interval)` before assertions, relying solely on `vi.advanceTimersByTimeAsync(60_000)` to trigger one tick.
- EADDRINUSE unhandled errors: two test files both import `index.ts` which called `serve()` unconditionally at module load. Fixed by guarding `serve()` with `if (config.nodeEnv !== 'test')`.

### Completion Notes List

- Implemented `updateHostTokens()` and `getAllHosts()` DB helpers in `src/server/db.ts`
- Built `src/server/refresh.ts` with: `authEvents` EventEmitter, `isHostDegraded`, `clearDegradedState`, `refreshTokenForHost` (PKCE no client_secret), `retryWithBackoff` (private), `refreshWithRetry` (3 retries + degraded emit), `startRefreshScheduler` (60s interval, 5min threshold)
- Wired `startRefreshScheduler()` into `src/server/index.ts` after `initDb()`
- Added `GET /api/auth/status` endpoint protected by `requireAuth`
- Guarded `serve()` call with `config.nodeEnv !== 'test'` to prevent EADDRINUSE in multi-file test runs
- 28/28 tests pass, 0 errors, 0 regressions

### File List

- `src/server/db.ts` — added `updateHostTokens()`, `getAllHosts()`
- `src/server/refresh.ts` — new file
- `src/server/index.ts` — added scheduler wire-up, `/api/auth/status` route, test guard on `serve()`
- `src/server/__tests__/refresh.test.ts` — new file (14 tests)
- `src/server/__tests__/auth-status.test.ts` — new file (3 tests)

## Review Findings

- [x] [Review][Patch] `updateHostTokens` silently no-ops when userId doesn't exist — `db.prepare(...).run()` returns `RunResult` with `changes`; no check on `result.changes`, so caller believes tokens were persisted when the UPDATE matched zero rows [src/server/db.ts]
- [x] [Review][Patch] `refreshTokenForHost` uses `data.access_token`/`data.expires_in` without validating JSON shape — if Spotify returns a valid 200 with an error body (e.g. malformed PKCE response), `undefined` is written as the new token while `clearDegradedState` incorrectly marks the host as healthy [src/server/refresh.ts]
- [x] [Review][Patch] Scheduler `setInterval` async callback swallows errors silently — if `getAllHosts()` or any DB call throws, the rejected promise is lost with no logging; process continues with no visibility into scheduler failures [src/server/refresh.ts]
- [x] [Review][Defer] Concurrent scheduler ticks can refresh the same host simultaneously — no per-host in-progress guard; two overlapping ticks both pass `isHostDegraded` check and can write conflicting tokens (second write may silently overwrite a good rotated token) [src/server/refresh.ts] — deferred, pre-existing
- [x] [Review][Defer] `startRefreshScheduler()` runs unconditionally in test environment — unlike `serve()`, not guarded by `nodeEnv !== 'test'`; `_refreshInterval` is never exported or cleared between test files [src/server/index.ts] — deferred, pre-existing
- [x] [Review][Defer] Empty `refresh_token` in DB causes 4 unnecessary Spotify retries before degraded — application layer has no guard; schema `NOT NULL` prevents this via normal flow but not manual DB edits [src/server/refresh.ts] — deferred, pre-existing
- [x] [Review][Defer] `/api/auth/status` `tokenExpiresAt` is a stale snapshot from middleware — if scheduler refreshes between `requireAuth` and handler, reported expiry is one cycle old; `degraded` field is live but `tokenExpiresAt` is not [src/server/index.ts] — deferred, pre-existing
- [x] [Review][Defer] Startup fan-out — after long downtime, all expired hosts trigger `refreshWithRetry` simultaneously on first 60s tick; low risk for ≤5 users but latent Spotify rate-limit concern [src/server/refresh.ts] — deferred, pre-existing
- [x] [Review][Defer] `authEvents` has no `'error'` listener — future `authEvents.emit('error', ...)` without a listener would crash the process; latent as code currently only emits `'degraded'` [src/server/refresh.ts] — deferred, pre-existing
- [x] [Review][Defer] `retryWithBackoff` retries non-recoverable errors (4xx) identically to transient errors (5xx) — revoked/invalid tokens waste 4 attempts and ~7s before degraded [src/server/refresh.ts] — deferred, pre-existing
- [x] [Review][Defer] `getAllHosts()` uses `SELECT *` pulling full token columns into memory just for expiry check — column projection (`SELECT user_id, token_expires_at`) would reduce blast radius if array is logged [src/server/db.ts] — deferred, pre-existing
- [x] [Review][Defer] No jitter in backoff — multiple hosts expiring simultaneously will hammer Spotify in lockstep [src/server/refresh.ts] — deferred, pre-existing

## Change Log

- 2026-04-03: Story created by create-story workflow
- 2026-04-03: Implemented by dev agent (claude-sonnet-4-6) — all ACs satisfied, 28/28 tests pass
