# Story 7.2: Host Management — Spotify Panel, Session List with Timestamps, Delete Session

Status: in-progress

## Story

As a host landing on the admin view after login,
I want a single screen showing my Spotify connection status, a "Start New Session" CTA, and a list of existing sessions with timestamps and per-row delete,
So that I can manage my account state and the lifecycle of rooms without bouncing between screens.

## Acceptance Criteria

1. **DashboardPage is repurposed as Host Management** at the existing `'dashboard'` page route. Authenticated hosts still land here after login (wiring in [src/client/App.svelte:28](src/client/App.svelte#L28) and [src/client/lib/ws.ts:11](src/client/lib/ws.ts#L11) is unchanged).
2. **Spotify connection panel** at the top of the page shows: (a) display name from `/api/me`, (b) status pill — `Connected` when `/api/auth/status` returns `degraded: false`, `Reconnect needed` when `degraded: true`, (c) a small muted **Disconnect** button. When degraded, a "Reconnect Spotify" inline CTA is shown that opens the existing `/auth/login` flow.
3. **Start New Session CTA** — single primary button that creates a new room via `POST /api/rooms` and navigates the host into the existing lobby flow (`onEnterLobby(code)`). **Scope note:** replacement of the lobby with the Configure Round overlay is Story 7-3; 7-2 keeps the post-create navigation target identical to today.
4. **Session list** renders all rooms from `GET /api/rooms` below the CTA:
   - Sorted newest first (API already returns `ORDER BY created_at DESC` — do not re-sort client-side).
   - Each row shows: room code (monospace, letter-spaced), creation timestamp formatted in host's local timezone (e.g. `Apr 5, 14:32`), and a trash icon 🗑.
   - Tapping the row (anywhere except the trash icon) calls `onEnterLobby(code)` — same resume-session behaviour as today's Open button. The explicit "Open" button is removed; the whole row is the tap target (min-height 44px).
   - Empty state: `No sessions yet — start one above.` muted text, rendered only once loading is complete and rooms.length === 0.
5. **Delete session** — tapping the 🗑 icon opens a confirmation dialog: title `Delete session {CODE}?` with subcopy `Any connected players will be disconnected. This can't be undone.` and `[Cancel] [Delete]` buttons. Confirming fires `DELETE /api/rooms/:code`. On success the row is removed from the list (optimistic refresh from the server response or local filter). Trash-icon click must NOT bubble to the row tap handler.
6. **Server: DELETE /api/rooms/:code endpoint** (host-only, behind `requireAuth`) that:
   - 404 if room not found, 403 if `room.host_user_id !== host.user_id`.
   - Broadcasts `{ type: "session:end", reason: "host_deleted" }` to all clients in the room via the existing `broadcast` helper.
   - Force-closes all open host/guest WebSockets in the room with close code 1000 (after the broadcast).
   - Clears the `roomSockets` entry (including any active round timers via `clearTimeout` on `currentRound.timers.autoAdvance` and `.reveal`).
   - Deletes the room row from the `rooms` table AND the associated `played_songs` rows for that room code.
   - Returns `204` (or `{}`/`200` — pick one and be consistent). No body required.
7. **WebSocket event contract — add `session:end`** to the shared event vocabulary. Payload: `{ type: "session:end", reason: "host_deleted" }`. Future `reason` values (`host_timeout`, etc.) are out of scope. Document in `src/server/ws.ts` (alongside the other `broadcast` call sites) and reference from the client `connectAsHost`/`connectAsGuest` message handlers.
8. **Client-side `session:end` handling (minimal in 7-2, extended in 7-4):** host and guest WS handlers in [src/client/lib/ws.ts](src/client/lib/ws.ts) recognise the `session:end` message type without error. In 7-2, receiving `session:end` simply triggers the existing disconnect path (no visible banner — banner UX is Story 7-4's scope; noted in Dev Notes). The host who issued the delete does NOT need special client handling because they are on the Host Management page, not the room.
9. **Server-side logout — add `POST /auth/logout`** that clears the `session` cookie (same `path: '/'`, same name) and returns `204`. Client Disconnect button calls this then navigates back to `'join'` (root). No Spotify token revocation required — the refresh token simply stays in the DB until the user re-authenticates; this matches MVP security posture. Deferred to Story 7-3+ if polish needed.
10. **Tests:**
    - (a) Server unit test for `DELETE /api/rooms/:code`: host-only (403 for wrong owner, 404 for missing), removes `rooms` + `played_songs` rows, broadcasts `session:end`, closes sockets, clears `roomSockets`.
    - (b) Server unit test for `POST /auth/logout`: 200/204 + `session` cookie cleared in the response.
    - (c) Client unit test for a tiny `formatSessionTimestamp(createdAt: number): string` helper used to render row timestamps (simple, deterministic formatting via `Intl.DateTimeFormat` — one happy-path test with a mocked locale is enough).
11. **Regression:** `npm run lint`, `npm test` pass. Existing Dashboard-as-room-list behaviour (create + list + open) is preserved — only the presentational structure and the deletion affordance are new.

## Tasks / Subtasks

- [x] Server: delete endpoint + session:end broadcast (AC: #6, #7)
  - [x] Add a `deleteRoom(code: string): void` to [src/server/db.ts](src/server/db.ts) that runs `DELETE FROM played_songs WHERE room_id = ?` then `DELETE FROM rooms WHERE code = ?` in a `db.transaction(...)`. Export.
  - [x] Add a `destroyRoom(code: string): void` helper in [src/server/ws.ts](src/server/ws.ts) (or inline in the route) that: clears `currentRound.timers.autoAdvance` and `.reveal`, calls `broadcast(code, { type: 'session:end', reason: 'host_deleted' })`, then iterates host + guest sockets calling `.close(1000, 'session_ended')` on each OPEN socket, then `roomSockets.delete(code)`.
  - [x] Add `roomsRouter.delete('/rooms/:code', requireAuth, …)` in [src/server/rooms.ts](src/server/rooms.ts): 404/403 checks, call `destroyRoom(code)` (even if no live room state — safe no-op if `roomSockets.get(code)` is undefined), call `deleteRoom(code)`, return 204.
  - [x] Do the broadcast/close BEFORE the DB delete so guests don't race onto a dead room read.

- [x] Server: logout endpoint (AC: #9)
  - [x] Add `authRouter.post('/logout', …)` in [src/server/auth.ts](src/server/auth.ts) that calls `deleteCookie(ctx, 'session', { path: '/' })` and returns 204. No `requireAuth` needed — deleting an absent cookie is a no-op.

- [x] Client: API bindings (AC: #5, #9)
  - [x] Add `deleteRoom(code: string): Promise<void>` to [src/client/lib/api.ts](src/client/lib/api.ts). Throws on !res.ok.
  - [x] Add `logout(): Promise<void>` to [src/client/lib/api.ts](src/client/lib/api.ts). Throws on !res.ok.
  - [x] Add `getAuthStatus(): Promise<{ degraded: boolean; tokenExpiresAt: number }>` to [src/client/lib/api.ts](src/client/lib/api.ts) — hits the existing `/api/auth/status` endpoint.

- [x] Client: timestamp formatter (AC: #4, #10c)
  - [x] Create [src/client/lib/formatSessionTimestamp.ts](src/client/lib/formatSessionTimestamp.ts) exporting `formatSessionTimestamp(createdAt: number): string` that returns a short local-time string (e.g. `Apr 5, 14:32`). Use `new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })` and strip any trailing-comma artefacts if present.

- [x] Client: repurpose DashboardPage as Host Management (AC: #1, #2, #3, #4, #5)
  - [x] Rewrite [src/client/pages/DashboardPage.svelte](src/client/pages/DashboardPage.svelte) with three stacked sections: (1) Spotify panel, (2) Start New Session CTA, (3) Sessions list.
  - [x] Spotify panel fetches `getMe()` + `getAuthStatus()` in parallel inside `onMount` alongside the existing `getRooms()` call. Use `Promise.allSettled` so one failure doesn't blank the page.
  - [x] Disconnect button: `await logout(); window.location.href = '/'` so the app cold-reloads into the guest-facing JoinPage with a cleared cookie.
  - [x] Reconnect Spotify inline CTA (only when `degraded: true`): `<a href="/auth/login">` — same pattern as LoginPage.
  - [x] Start New Session calls the existing `createRoom` + `onEnterLobby` — no change to parent wiring.
  - [x] Sessions list: row = single `<button>` or `<div role="button">` (with `tabindex="0"` + keydown handler) so whole row is tappable. Trash icon is a nested `<button>` with `onclick={(e) => { e.stopPropagation(); showDeleteDialog(room.code) }}`.
  - [x] Confirmation dialog: use native `window.confirm(...)` for MVP (matches app conservative UX; no modal dependency). Subcopy lives in the confirm string.
  - [x] Empty state rendered only after `loading === false && rooms.length === 0`.

- [x] Client: session:end recognition in WS handlers (AC: #8)
  - [x] In [src/client/lib/ws.ts](src/client/lib/ws.ts), in both `connectAsHost` and `connectAsGuest` `onmessage` handlers, add a branch for `data.type === 'session:end'` that does nothing (or logs a single debug line). Crucially, the existing socket `onclose` path continues to fire when the server force-closes — no new UX is added in 7-2.
  - [x] No test required beyond the existing WS integration suite; add a single unit assertion that a `session:end` message doesn't throw in the message handler if trivially testable, else skip.

- [x] Server tests (AC: #10a, #10b)
  - [x] Add delete-room test in [src/server/__tests__/](src/server/__tests__/) (follow existing `rooms.test.ts` pattern, or `ws.test.ts` if socket closures are asserted): seed host + room + connected guest WS, DELETE → assert (i) 204, (ii) guest receives `session:end`, (iii) guest WS `close` event fires with code 1000, (iv) `roomSockets.get(code) === undefined`, (v) `getRoomByCode(code) === undefined`, (vi) `getPlayedSongs(code) === []`, (vii) 403 path for wrong host, (viii) 404 path for missing code.
  - [x] Add logout test: POST /auth/logout → 204, response `Set-Cookie` header clears `session` (expect `Max-Age=0` or past `Expires`).

- [x] Client tests (AC: #10c)
  - [x] Add [src/client/__tests__/formatSessionTimestamp.test.ts](src/client/__tests__/formatSessionTimestamp.test.ts) with 1–2 cases. Freeze `new Date(...)` or pass in a known ms epoch; assert the formatted output matches the documented shape. Do not over-specify (different runtimes may use thin/thick spaces).

- [x] Manual verification
  - [x] Log in → land on Host Management; Spotify panel shows display name + green Connected pill.
  - [x] Create 2 sessions. Both rows appear newest-first with localised timestamps.
  - [x] Tap row → navigate to lobby (existing behaviour). Back-arrow / manual reload to return.
  - [x] Tap 🗑 on a row with a connected guest (use a second browser with the guest joined). Confirm dialog. Confirm → guest is disconnected (socket closes); row disappears from host list; refreshing the host page confirms the row is gone.
  - [x] Disconnect button → redirected to `/` (JoinPage), session cookie cleared (verify via DevTools Application → Cookies).
  - [x] Simulate degraded state (manual: pause refresh scheduler or edit DB `token_expires_at` to past + kill refresh) → panel shows `Reconnect needed` + inline CTA.

## Dev Notes

### Scope boundaries — what NOT to touch in 7-2

- **Do NOT** build the Configure Round overlay (that's 7-3). Start New Session → lobby (existing path). It will be rewired in 7-3.
- **Do NOT** add the guest `session:end` banner UX ("Session ended by host." redirect). 7-4 (Guest Waiting Room) owns guest-side presentation.
- **Do NOT** extend the session cookie Max-Age (resolved in 7-1: stays at 30 days).
- **Do NOT** rename `DashboardPage.svelte` or the `'dashboard'` page enum. Renaming churn is deferred; the filename is not user-visible.
- **Do NOT** add host name capture here — host name is collected in the Configure Round overlay (Story 7-3).
- **Do NOT** revoke Spotify tokens on Disconnect. MVP cleanup is "clear session cookie"; token row stays in the DB. This matches existing session expiry behaviour.

### Delete-ordering gotcha

Broadcast **before** DB delete. Current `broadcast(code, …)` reads from `roomSockets.get(code)`, which is independent of the DB. But any downstream logic that re-verifies the room via `getRoomByCode` would fail after the DB delete; keep the ordering simple and explicit:

```
1. clear timers
2. broadcast(session:end)
3. close sockets
4. roomSockets.delete(code)
5. db: delete played_songs + rooms
```

### Trash icon propagation

Svelte event bubbling: clicking the inner trash button WILL fire the outer row's click unless `e.stopPropagation()` is called. This is easy to forget and breaks the UX (tap delete → also opens the room). See AC #5 explicit note.

### Current dashboard flow (verified)

- [src/client/pages/DashboardPage.svelte](src/client/pages/DashboardPage.svelte) today: fetches `getRooms()` in `onMount`, renders "Create Room" button + list of rooms each with an "Open" button. `onEnterLobby(code)` prop is called on both create and open. This prop wiring stays — just the internal markup and the addition of the Spotify panel and delete affordance change.
- [src/client/App.svelte:28](src/client/App.svelte#L28) `handleAuthenticated()` sets `page = 'dashboard'` — unchanged.
- [src/client/lib/ws.ts:11](src/client/lib/ws.ts#L11) `determineInitialPage` routes authenticated users to `'dashboard'` — unchanged.

### Connection panel data sources

- Display name: `GET /api/me` → `{ user_id, display_name }` ([src/server/index.ts:27](src/server/index.ts#L27)).
- Degraded state: `GET /api/auth/status` → `{ degraded, tokenExpiresAt }` ([src/server/index.ts:32](src/server/index.ts#L32)). Both endpoints already exist — no server additions required for the panel.
- For the initial mount, fetch `me`, `auth/status`, and `rooms` in parallel. If `me` returns 401 (cookie expired between app boot and Dashboard mount), the parent `App.svelte` already routes via `determineInitialPage`, so simply surface an error banner and let the user reload / re-login — no automatic redirect needed.

### Database cleanup

The `played_songs` table has no `ON DELETE CASCADE` ([src/server/db.ts:37](src/server/db.ts#L37)) — manually delete matching rows. Wrap both DELETEs in `db.transaction()` so a failure on either statement rolls back. `rooms` has a FK from nothing else so no further cascade is needed.

### WebSocket force-close pattern

Use `ws.close(1000, 'session_ended')` on OPEN sockets — the existing guest and host `ws.on('close', …)` handlers in [src/server/ws.ts:167](src/server/ws.ts#L167) and [src/server/ws.ts:223](src/server/ws.ts#L223) will fire and attempt to mutate `roomSockets.get(code)`. Since we `roomSockets.delete(code)` immediately after, those handlers' `if (r && …)` guards will short-circuit harmlessly. Ordering matters: close sockets → then `roomSockets.delete(code)`, in that order, so the close handlers still see a valid room state (or harmlessly skip if already deleted — both are acceptable).

### Patterns from previous stories to reuse

- Svelte 5 runes (`$state`, `$props`, `$derived`) per existing pages.
- Ghost / muted button styling pattern from [src/client/pages/JoinPage.svelte](src/client/pages/JoinPage.svelte) (Host Login button added in 7-1) — reuse for Disconnect.
- API error handling: `throw new Error(…)` from api.ts, caught in component and surfaced as `error` state (matches current DashboardPage try/catch idiom).
- Test stubs follow existing `src/server/__tests__/` patterns — use the in-memory sqlite + WS harness already in place for `ws.test.ts` / `rooms.test.ts`.

### Confirmation dialog

Use `window.confirm(…)` for the delete confirmation. Pros: zero deps, synchronous, consistent with a personal-use tool. Cons: unstyled, not great on mobile Safari but acceptable for MVP. A custom modal is Epic 7 polish, not 7-2 scope.

### Testing standards

- Vitest + jsdom for client unit tests; follow the pattern in `src/client/__tests__/`.
- For server WS assertions, reuse the `ws.test.ts` harness (real `ws` client + in-process Hono server).
- `npm run lint` → `tsc --noEmit` must stay clean.
- `npm test` should remain green; DO NOT add snapshot tests for the timestamp helper (locale-fragile).

### References

- Sprint Change Proposal: [_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md §4.2 Change U2](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — Host Management screen spec + layout
- Sprint Change Proposal: [_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md §4.2 Change U8](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — End Session flow (delete path in this story)
- Sprint Change Proposal: [_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md §4.2 Change U9](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — `session:end` WS contract
- Sprint Change Proposal: [_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md §4.2 Change U10](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — Decision Log rows for Host Management + End Session dual entry
- Previous story: [7-1-root-cleanup-host-login-cookie-localstorage.md](7-1-root-cleanup-host-login-cookie-localstorage.md) — conservative scope pattern, button styling conventions, test additions approach

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- `npm run lint` → clean (tsc --noEmit)
- `npm test` → 251/251 pass (14 test files), including 6 new tests (5 delete-room + 1 logout server, 2 formatSessionTimestamp client)

### Completion Notes List

- Server `DELETE /api/rooms/:code` wires `destroyRoom` (clears round timers → broadcasts `session:end` → force-closes host + guest sockets with code 1000 → drops `roomSockets` entry) then `deleteRoom` (transactional DELETE of `played_songs` then `rooms`). Ordering is teardown-before-DB-delete as called out in Dev Notes.
- `POST /auth/logout` is unauthenticated (clearing an absent cookie is a safe no-op). Clears `session` via `deleteCookie` with `path: '/'`, returns 204.
- Client session list: whole row is a `role="button"` with `tabindex` + keydown handler (Enter/Space). Trash `onclick` calls `e.stopPropagation()` then `window.confirm(...)` per MVP UX decision. Empty-state muted text renders only when `loading === false && rooms.length === 0`.
- Spotify panel fetches `getMe()`, `getAuthStatus()`, `getRooms()` in parallel via `Promise.allSettled` so one failure cannot blank the page. Disconnect calls `logout()` then `window.location.href = '/'` to cold-reload into guest-first root.
- WS contract: both `connectAsHost` and `connectAsGuest` now recognise `{ type: 'session:end' }` as a no-op (per story scope). The server's subsequent `close(1000, …)` still drives the existing `onclose` disconnect paths. Full guest UX (banner, redirect) deferred to 7-4.
- `formatSessionTimestamp` uses `Intl.DateTimeFormat` with the runtime default locale + `hour12: false`. Tests assert only the HH:MM pattern to avoid locale-fragile snapshots.

### File List

**Server**
- `src/server/db.ts` — added `deleteRoom(code)` (transactional DELETE played_songs + rooms)
- `src/server/ws.ts` — added `destroyRoom(code)` helper (clear timers → broadcast `session:end` → close sockets 1000 → drop roomSockets entry)
- `src/server/rooms.ts` — added `DELETE /api/rooms/:code` route (requireAuth + 404/403 checks + destroyRoom + deleteRoom + 204)
- `src/server/auth.ts` — added `POST /auth/logout` route (deleteCookie session + 204)

**Client**
- `src/client/lib/api.ts` — added `deleteRoom`, `logout`, `getAuthStatus` + `AuthStatusResponse` type
- `src/client/lib/formatSessionTimestamp.ts` — NEW: Intl.DateTimeFormat-based short local time helper
- `src/client/lib/ws.ts` — added `session:end` no-op branches in `connectAsHost` + `connectAsGuest` handlers
- `src/client/pages/DashboardPage.svelte` — rewritten as Host Management (Spotify panel + Start New Session CTA + session list with timestamps, row-tap open, trash delete, empty state)

**Tests**
- `src/server/__tests__/ws.test.ts` — added `DELETE /api/rooms/:code` block (5 cases: happy path, 403, 404, 401, no-live-sockets) + `POST /auth/logout` block (1 case)
- `src/client/__tests__/formatSessionTimestamp.test.ts` — NEW: 2 locale-tolerant cases

### Review Findings

- [x] [Review][Patch] getMe / getAuthStatus rejection silently swallowed — no error banner shown [src/client/pages/DashboardPage.svelte:26-40] — Dev Notes require "surface an error banner" when me/auth fetch fails; today the page silently renders `me=null` → `—` and default `degraded=false`, misrepresenting a degraded/broken auth state as healthy. **Fixed 2026-04-05**: onMount now surfaces an error banner for any rejected fetch.
- [x] [Review][Patch] Logout test assertion too loose — any `Expires=` attribute passes [src/server/__tests__/ws.test.ts:475-480] — Regex `/Expires=/.test(setCookie)` would match a future `Expires=2099-...` date. Tighten to require `Max-Age=0` OR an `Expires=` that resolves to the past. **Fixed 2026-04-05**: test parses `Expires` value and asserts it resolves to a past timestamp OR `Max-Age=0\b`.
- [x] [Review][Patch] CONNECTING sockets not torn down in `destroyRoom` [src/server/ws.ts:109-115] — `readyState === WebSocket.OPEN` guard skips CONNECTING sockets, which linger past DB delete. **Fixed 2026-04-05**: guard inverted to skip only CLOSING/CLOSED states, so CONNECTING sockets are also closed during teardown.
- [x] [Review][Patch] Failed DELETE leaves stale row but shows generic error [src/client/pages/DashboardPage.svelte:72-78] — On `deleteRoom` rejection the row stays in `rooms` with only an error banner; if the server actually deleted, the UI is now out of sync. **Fixed 2026-04-05**: delete-failure catch now refetches `getRooms()` to resync list state with server.
- [ ] [Review][Patch] Nested interactive: `<button class="trash-btn">` inside `<div role="button">` [src/client/pages/DashboardPage.svelte:124-138] — Invalid ARIA (interactive-within-interactive). Click propagation is handled via `e.stopPropagation()`, but keyboard Enter on the trash button inside a role="button" parent is ambiguous to AT. Minor a11y; consider promoting the row to a `<button>` with a sibling action button laid out via flex, or using an `<a>`/`<button>` pair rather than nesting. **Left open 2026-04-05** — requires layout/markup restructuring beyond a safe batch patch.
- [x] [Review][Patch] `.trash-btn` has no `:focus-visible` style [src/client/pages/DashboardPage.svelte:280-290] — Emoji button is keyboard-focusable but has no focus ring; matches row's `:focus-visible` pattern at line 263. **Fixed 2026-04-05**: added `.trash-btn:focus-visible` rule mirroring `.room-item:focus-visible`.
- [x] [Review][Defer] 403/404 enumeration leak on DELETE /api/rooms/:code [src/server/rooms.ts:175-177] — deferred, pre-existing cross-route convention (same pattern in every other room route).
- [x] [Review][Defer] No CSRF token on POST /auth/logout [src/server/auth.ts:200-203] — deferred, pre-existing — SameSite=Lax on session cookie mitigates; unauthenticated cross-site POST is a logout-CSRF nuisance only, not privilege escalation.
- [x] [Review][Defer] Narrow race: new WS connect between `destroyRoom()` and `deleteRoom()` [src/server/ws.ts:92-120, src/server/rooms.ts:181-182] — deferred, pre-existing — single-request window; requires a "room being destroyed" flag to fully close.
- [x] [Review][Defer] No rate limiting on DELETE /api/rooms/:code [src/server/rooms.ts:171] — deferred, pre-existing — app-wide concern across all mutating routes.
- [x] [Review][Defer] Client `session:end` handler is a no-op; no proactive `ws.close()` [src/client/lib/ws.ts:55-59, 127-130] — deferred by spec (Story 7-4 owns guest banner + redirect UX). Relies on server-initiated close; if server close is delayed, client UI is stuck.

**Dismissed (17):** `window.confirm` (spec-sanctioned); `formatSessionTimestamp` NaN guard (source is always `Date.now()`); `destroyRoom` doesn't await close (WS close is non-awaitable); `deleteRoom` only touches `rooms`+`played_songs` (confirmed no other referencing tables in schema); `getAuthStatus` endpoint existence (exists at `src/server/index.ts:32`); swallowed `close()` errors (commented, intentional); timer-set hardcoded to autoAdvance+reveal (matches `RoundState` type); tests reach into `roomSockets` (pre-existing test pattern); hardcoded `reason:'host_deleted'` (future reasons out of scope per spec); concurrent DELETE idempotency (404 on second is acceptable); code casing mismatch (no case-folding paths); `getMe` null redirect (parent `App.svelte` routing handles); double-click delete (window.confirm blocks); logout POST cancelled by navigation (awaited before redirect); round timer firing post-destroy (guarded by `capturedRoundNumber` check); `broadcast` throws (internal try/catch per socket); `deleteCookie` without prior cookie (hono emits clearing header unconditionally); sandboxed iframe confirm (N/A).

## Change Log

- 2026-04-05: Story 7-2 implemented — Host Management DashboardPage rewrite, DELETE /api/rooms/:code + session:end broadcast, POST /auth/logout, formatSessionTimestamp helper, session:end WS contract recognition in client handlers. All ACs satisfied; lint + 251 tests pass.
- 2026-04-05: Code review complete — 0 decision-needed, 6 patch, 5 defer, 17 dismissed. See Review Findings.
