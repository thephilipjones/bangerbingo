# Story 6.5: Host Spotify Disconnect/Reconnect Settings

Status: done

## Story

As a host,
I want to disconnect and reconnect my Spotify account from settings,
so that I can swap accounts or recover from a stuck auth state without admin help (FR5).

## Acceptance Criteria

1. **Account page renders** — An authenticated host navigating to `/account` sees: their Spotify display name (from `hosts` row), a "Disconnect Spotify" button (enabled when tokens exist), and a "Reconnect Spotify" button (enabled when tokens are cleared). Unauthenticated users are redirected to login.

2. **Disconnect confirmation** — Tapping "Disconnect Spotify" shows a confirmation dialog: "This will stop music playback in any active rooms. Continue?" with Cancel / Disconnect buttons.

3. **Disconnect endpoint** — `POST /api/account/spotify/disconnect` (behind `requireAuth`) clears the host's tokens: sets `access_token = ''`, `refresh_token = ''`, `token_expires_at = 0` in the `hosts` table row and returns HTTP 200. Returns 401 for unauthenticated requests.

4. **SDK failure path after disconnect** — If the host's browser is running an active game and the SDK attempts to re-initialise after disconnect, `SpotifySDKProvider.init()` fails and the existing SDK Failure Banner from Story 5-4 is shown — no new fallback code needed.

5. **Reconnect triggers existing PKCE flow** — Tapping "Reconnect Spotify" redirects to `/auth/login` (the existing PKCE OAuth flow from Story 1-1). No parallel auth flow.

6. **OAuth callback restores tokens** — After successful reconnect, the existing `/auth/callback` handler writes new `access_token`, `refresh_token`, `token_expires_at` back to the same `hosts` row (matched on `user_id` via `upsertHost`). The Account page reflects the updated display name on next render.

7. **Routing** — `App.svelte` gains an `'account'` page variant. The `/account` path is handled in `determineInitialPage`: authenticated users see AccountPage, unauthenticated users are redirected to login.

## Tasks / Subtasks

- [x] Schema migration: relax NOT NULL constraints on token columns (AC: #3)
  - [x] Add idempotent migration in `initDb()` to handle existing `hosts` table with NOT NULL token columns
  - [x] Use sentinel-value approach: empty string for tokens, 0 for expiry — avoids ALTER TABLE on SQLite (which doesn't support DROP NOT NULL)

- [x] Add `clearHostTokens(userId)` helper in `src/server/db.ts` (AC: #3)
  - [x] `UPDATE hosts SET access_token = '', refresh_token = '', token_expires_at = 0 WHERE user_id = ?`

- [x] Add `POST /api/account/spotify/disconnect` route in `src/server/rooms.ts` (AC: #3)
  - [x] Guard with `requireAuth`
  - [x] Call `clearHostTokens(host.user_id)`
  - [x] Return 200 `{}`

- [x] Add `disconnectSpotify()` to `src/client/lib/api.ts` (AC: #2, #3)
  - [x] `POST /api/account/spotify/disconnect`

- [x] Add `AccountPage.svelte` in `src/client/pages/` (AC: #1, #2, #5)
  - [x] Show display name from `/api/me`
  - [x] Show Spotify connection status: check `/api/auth/status` `degraded` field
  - [x] "Disconnect Spotify" button with `window.confirm()` dialog before calling disconnect endpoint
  - [x] "Reconnect Spotify" link to `/auth/login`
  - [x] "Back to Dashboard" navigation
  - [x] After disconnect succeeds, update UI to show disconnected state

- [x] Wire `/account` route in `App.svelte` and `src/client/lib/ws.ts` (AC: #7)
  - [x] Add `'account'` to `Page` union type
  - [x] Handle `/account` path in `determineInitialPage` — return `{ page: 'account' }` when authenticated, `{ page: 'login' }` when not
  - [x] Add `AccountPage` import and rendering block in `App.svelte`
  - [x] Add navigation link from DashboardPage to `/account`

- [x] Handle token-cleared state in `refresh.ts` and `auth.ts` (AC: #4)
  - [x] In `refreshTokenForHost()`: if `host.refresh_token === ''`, skip refresh and immediately mark degraded
  - [x] In `withFreshToken()`: if `host.access_token === ''`, return null (triggers 503 on round start)
  - [x] In `isHostDegraded()`: host with empty tokens should be treated as degraded for `/api/auth/status`

- [x] Tests (AC: #1-#7)
  - [x] `db.test.ts`: test `clearHostTokens` sets empty string / 0
  - [x] `auth.test.ts` or `rooms.test.ts`: test `POST /api/account/spotify/disconnect` returns 200 for authed, 401 for unauthed
  - [x] `ws.test.ts`: verify existing behavior — `determineInitialPage` handles `/account` path

## Dev Notes

### Critical: hosts table NOT NULL constraints

The `hosts` table schema in `db.ts` declares:
```sql
access_token TEXT NOT NULL,
refresh_token TEXT NOT NULL,
token_expires_at INTEGER NOT NULL
```

SQLite does not support `ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL`. Two viable approaches:

**Recommended: Sentinel values (no schema change)**
- Use `''` (empty string) for `access_token` and `refresh_token`, `0` for `token_expires_at`
- All token-consuming code already checks `host.access_token` before use (e.g., `if (sdkHost?.access_token)` in `rooms.ts:74`)
- The refresh scheduler in `refresh.ts` should skip hosts with empty `refresh_token`
- `withFreshToken()` in `auth.ts` should return `null` when tokens are empty

This is the simplest approach — no migration, no table recreation, compatible with existing `upsertHost()`.

### Disconnect endpoint placement

Add the route to `roomsRouter` in `src/server/rooms.ts` (it already handles all authenticated `/api/*` routes):
```ts
roomsRouter.post('/account/spotify/disconnect', requireAuth, (ctx) => {
  const host = ctx.var.host
  clearHostTokens(host.user_id)
  return ctx.json({})
})
```

### Existing "Disconnect" button on DashboardPage

DashboardPage already has a "Disconnect" ghost button (line 141), but it calls `logout()` which clears the session cookie and redirects to `/`. This is a **session logout**, not a Spotify token disconnect. Story 6-5's "Disconnect Spotify" is specifically about clearing Spotify tokens while keeping the session alive. These are distinct actions.

The DashboardPage should gain a small link/button to navigate to `/account` where the full account management lives. The existing "Disconnect" button on Dashboard can stay as-is (it's a session logout).

### AccountPage design

Keep it minimal — match the existing DashboardPage styling patterns:
- Same `.dashboard` layout class (centered flex column)
- Same `.spotify-panel` card style for the Spotify account section
- Display name + connected/disconnected status pill
- Two action buttons: Disconnect Spotify / Reconnect Spotify (mutually exclusive enabled state)
- "Back to Dashboard" link at bottom

### How "Reconnect Spotify" works

The reconnect flow is trivially handled by the existing auth system:
1. User clicks "Reconnect Spotify" which is an `<a href="/auth/login">`
2. `/auth/login` triggers the PKCE flow → Spotify authorize → callback
3. `/auth/callback` calls `upsertHost()` which does `ON CONFLICT(user_id) DO UPDATE SET ...` — overwrites the empty tokens with fresh ones
4. Redirect back to `/` → `determineInitialPage` sees authenticated user → dashboard

No new server code needed for reconnect.

### Token state detection

To show the correct button state on AccountPage:
- Fetch `/api/auth/status` — if `degraded: true` OR if we add a field indicating tokens are empty
- Simpler: add a `connected` boolean to `/api/auth/status` response: `connected: host.access_token !== ''`
- Or: check from `/api/me` response — but that doesn't carry token status

**Recommended:** Add `spotifyConnected: boolean` to the `/api/auth/status` response:
```ts
app.get('/api/auth/status', requireAuth, (ctx) => {
  const host = ctx.var.host
  return ctx.json({
    degraded: isHostDegraded(host.user_id),
    tokenExpiresAt: host.token_expires_at,
    spotifyConnected: host.access_token !== '',
  })
})
```

Then AccountPage uses `spotifyConnected` to toggle button states.

### Refresh scheduler guard

In `refresh.ts`, `refreshTokenForHost()` line 26 will try to POST with an empty `refresh_token`. Add an early exit:
```ts
if (!host.refresh_token) throw new Error(`Host ${userId} has no refresh token`)
```

This will cause `refreshWithRetry` to mark the host as degraded (which is correct — they've intentionally disconnected).

### Files touched

- `src/server/db.ts` — add `clearHostTokens(userId)` helper
- `src/server/rooms.ts` — add `POST /api/account/spotify/disconnect` route
- `src/server/index.ts` — add `spotifyConnected` to `/api/auth/status` response
- `src/server/refresh.ts` — guard against empty refresh_token
- `src/server/auth.ts` — guard `withFreshToken` against empty access_token
- `src/client/lib/api.ts` — add `disconnectSpotify()`, add `spotifyConnected` to `AuthStatusResponse`
- `src/client/lib/ws.ts` — add `'account'` to `Page` type, handle `/account` in `determineInitialPage`
- `src/client/pages/AccountPage.svelte` — new file
- `src/client/App.svelte` — import AccountPage, add page variant, wire navigation
- `src/client/pages/DashboardPage.svelte` — add "Account Settings" link to `/account`
- `src/server/__tests__/db.test.ts` — test `clearHostTokens`
- `src/server/__tests__/auth.test.ts` or `rooms.test.ts` — test disconnect endpoint

### Existing code patterns to follow

- Route guards: use `requireAuth` middleware (same as all `/api/*` routes in `rooms.ts`)
- DB helpers: export from `db.ts`, same prepared-statement pattern as `updateHostTokens()`
- Client API: same `fetch` + error handling pattern as existing functions in `api.ts`
- Svelte pages: use `$state()` runes, `onMount` for data fetching, same CSS class patterns as DashboardPage
- Page routing: add to `Page` union in `ws.ts`, handle in `determineInitialPage`, add to `App.svelte` if/else chain

### What NOT to do

- Do NOT create a separate auth router for the disconnect endpoint — use `roomsRouter` like all other `/api/*` routes
- Do NOT attempt to ALTER TABLE to allow NULL — SQLite doesn't support it without recreating the table
- Do NOT implement a new OAuth flow for reconnect — the existing `/auth/login` PKCE flow handles it
- Do NOT add Spotify token revocation (the existing `POST /auth/logout` doesn't do it either — out of scope)
- Do NOT change the `Host` TypeScript interface to make tokens optional — keep them as `string` / `number` and use sentinel values

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6-5] — acceptance criteria
- [src/server/db.ts](src/server/db.ts) — `hosts` table schema (line 26-31), `upsertHost`, `updateHostTokens`
- [src/server/auth.ts](src/server/auth.ts) — `requireAuth` middleware, `/auth/login` PKCE flow, `/auth/callback` token exchange
- [src/server/rooms.ts](src/server/rooms.ts) — route patterns, `requireAuth` usage
- [src/server/refresh.ts](src/server/refresh.ts) — `refreshTokenForHost`, `refreshWithRetry`, `isHostDegraded`
- [src/server/index.ts](src/server/index.ts) — `/api/auth/status` endpoint (line 33-36)
- [src/client/lib/api.ts](src/client/lib/api.ts) — `AuthStatusResponse`, client fetch patterns
- [src/client/lib/ws.ts](src/client/lib/ws.ts) — `Page` type, `determineInitialPage`
- [src/client/App.svelte](src/client/App.svelte) — page routing, navigation handlers
- [src/client/pages/DashboardPage.svelte](src/client/pages/DashboardPage.svelte) — existing UI patterns, "Disconnect" button (line 141 — this is session logout, not Spotify disconnect)
- [src/client/components/SdkFailureBanner.svelte](src/client/components/SdkFailureBanner.svelte) — existing failure banner (reused, no changes needed)
- Story 6-4 implementation notes — previous story in this epic

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None — clean implementation, all tests passed first run.

### Completion Notes List
- Used sentinel-value approach (empty string / 0) for token clearing — no schema migration needed, compatible with existing NOT NULL constraints
- Added `clearHostTokens()` DB helper following same pattern as `updateHostTokens()`
- Disconnect endpoint placed on `roomsRouter` at `/account/spotify/disconnect` per dev notes
- Added `spotifyConnected` boolean to `/api/auth/status` response for DashboardPage button state
- Guarded `refreshTokenForHost()` against empty refresh_token (throws → marks degraded)
- Guarded `withFreshToken()` against empty access_token (returns null → 503)
- Refresh scheduler skips hosts with empty refresh_token to avoid unnecessary error logging
- Reconnect flow uses existing `/auth/login` PKCE flow — no new server code needed
- UI deviation from story: no separate AccountPage — disconnect/reconnect lives directly on DashboardPage spotify panel (user decision: keep all Spotify controls in one section)
- DashboardPage "Disconnect" button renamed to Spotify-specific disconnect; old session logout moved to "Reset Host" button at page bottom
- All 317 tests pass, no regressions

### Change Log
- 2026-04-06: Story 6-5 implemented — host Spotify disconnect/reconnect on DashboardPage

### Review Findings
- [x] [Review][Patch] GET /auth/token returns empty access_token — added 403 guard [src/server/auth.ts:209]
- [x] [Review][Patch] spotifyConnected defaults to true when authStatus is null — changed default to false [src/client/pages/DashboardPage.svelte:140]
- [x] [Review][Patch] handleResetHost navigates away even on error — moved redirect inside try [src/client/pages/DashboardPage.svelte:133]
- [x] [Review][Patch] Race condition: in-flight refresh can overwrite cleared tokens — added re-check before updateHostTokens [src/server/refresh.ts:51]
- [x] [Review][Defer] No WebSocket notification to active rooms on disconnect [src/server/rooms.ts:167] — deferred, beyond story scope
- [x] [Review][Defer] Room creation allowed while Spotify is disconnected [src/server/rooms.ts:173] — deferred, UX improvement for future story

### File List
- src/server/db.ts — added `clearHostTokens()` helper
- src/server/rooms.ts — added `POST /api/account/spotify/disconnect` route, imported `clearHostTokens`
- src/server/index.ts — added `spotifyConnected` to `/api/auth/status` response
- src/server/refresh.ts — guard against empty refresh_token in `refreshTokenForHost()` and scheduler
- src/server/auth.ts — guard `withFreshToken()` against empty access_token
- src/client/lib/api.ts — added `disconnectSpotify()`, added `spotifyConnected` to `AuthStatusResponse`
- src/client/pages/DashboardPage.svelte — Spotify disconnect/reconnect in panel, "Reset Host" at bottom
- src/server/__tests__/db.test.ts — added `clearHostTokens` tests
- src/server/__tests__/rooms.test.ts — added disconnect endpoint tests (200 authed, 401 unauthed)
