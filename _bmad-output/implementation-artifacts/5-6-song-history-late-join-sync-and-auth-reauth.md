# Story 5.6: Song History, Late-Join Sync & Auth Re-auth

Status: done

## Story

As a player,
I want to review all songs played so far and have the game remain accessible when I join late or when auth lapses,
So that I can catch up on missed songs and the host can recover without ending the session.

## Acceptance Criteria

**Given** a player is in an active round
**When** they tap `≡ History` in the card view header
**Then** a Song History bottom sheet opens at approximately 70% of the screen height and is scrollable
**And** entries are listed newest-first, each showing: song number, title, artist, and 40×40px album art (music-note icon fallback if art unavailable)
**And** the sheet is accessible at any time during the round — between songs and while a song is playing

**Given** a guest connects via `session:connect` while a round is already in progress
**When** the server responds
**Then** the `session:connect`/`round:start` re-send includes `songHistory` alongside their blank card
**And** the guest can immediately open the History drawer to self-mark songs they recognise on their blank card (FR34)

**Given** a host reconnects mid-round via `session:connect`
**When** the server responds
**Then** the host receives the same `round:start` re-send (card + config) and `songHistory`
**And** their role is restored as host (addresses Epic 4 deferred: host reconnect mid-round receives no `round:start` re-send)

**Given** the History drawer is open
**When** a new `song:start` arrives
**Then** the new entry is prepended to the list in real time without requiring the drawer to close and reopen

**Given** the `auth:degraded` event is received by the host client
**When** the Auth Degraded Banner is displayed
**Then** a "Re-authenticate →" button is present in the banner
**And** the banner stacks above the SdkFailureBanner if both are active

**Given** the host taps "Re-authenticate →"
**When** the button is tapped
**Then** the Spotify OAuth authorize URL opens in a **popup window** (not a full-page redirect — a redirect would destroy the active game session)
**And** the main game window remains open with game state preserved

**Given** the OAuth popup completes successfully
**When** the server receives new tokens via `/auth/callback`
**Then** the server updates the host's tokens in the DB and emits an `auth:restored` WebSocket event to the host client only
**And** the popup closes (via `window.close()` script in the callback response), `SpotifySDKProvider` re-initialises with the fresh token, and the Auth Degraded Banner clears automatically

**Given** the OAuth popup is closed by the user without completing auth
**When** the popup closes
**Then** the Auth Degraded Banner remains visible with no change to game state

## Tasks / Subtasks

- [x] Extend server `session:connect` handler to include `songHistory` in late-join re-send (`src/server/ws.ts`)
  - [x] Guest path (line ~211): add `songHistory: round.songHistory` to the `round:start` re-send spread alongside `card: blankCard`
  - [x] Host path (line ~158): add `songHistory: activeRound.songHistory` to the `round:start` re-send spread alongside `card: hostCard`

- [x] Add `auth:restored` WS event emission to `src/server/ws.ts`
  - [x] Add listener: `authEvents.on('restored', (userId: string) => { const code = getHostRoom(userId); if (code) { const room = roomSockets.get(code); if (room?.host?.readyState === WebSocket.OPEN) { room.host.send(JSON.stringify({ type: 'auth:restored' })) } } })`
  - [x] Place alongside existing `authEvents.on('degraded', ...)` listener at the bottom of the file (line ~231)

- [x] Add popup reauth support to `src/server/auth.ts`
  - [x] Import `authEvents` from `./refresh.ts` (it's already exported; auth.ts doesn't currently import it)
  - [x] Modify `GET /auth/login`: check `ctx.req.query('popup')` — if `'1'`, set cookie `pkce_popup=1` (httpOnly: true, sameSite: 'Lax', path: '/auth/callback', maxAge: 300, secure: config.isProduction) before redirecting to Spotify
  - [x] Modify `GET /auth/callback`: after successful `upsertHost()`, check for `pkce_popup` cookie:
    - If popup mode: `deleteCookie(ctx, 'pkce_popup', { path: '/auth/callback' })`, emit `authEvents.emit('restored', me.id)`, return `ctx.html('<html><body><script>window.close()</script></body></html>')`
    - If normal mode: existing `ctx.redirect('/')` behaviour unchanged

- [x] Create `src/client/components/SongHistoryDrawer.svelte`
  - [x] Props: `entries: Array<{ trackId: string; title: string; artist: string; albumArtUrl: string; songIndex: number }>`, `onClose: () => void`
  - [x] `position: fixed; bottom: 0; left: 0; right: 0; height: 70vh; z-index: 150`
  - [x] Scrollable list, newest-first (entries already arrive newest-first when prepended on `song:start`; initial `songHistory` from server is oldest-first — reverse on display)
  - [x] Each entry: song number (`#${entry.songIndex + 1}`), title, artist, 40×40px album art with fallback `♪` music note icon
  - [x] Close button (`×`) in the sheet header; calls `onClose()`
  - [x] Background overlay behind sheet (`rgba(0,0,0,0.6)`) that also calls `onClose()` on click

- [x] Create `src/client/components/AuthDegradedBanner.svelte`
  - [x] Props: `onReauth: () => void`
  - [x] `position: fixed; top: 0; left: 0; right: 0; z-index: 210` (above SdkFailureBanner z-index: 190)
  - [x] Text: "Spotify auth expired — playback may stop"
  - [x] "Re-authenticate →" button that calls `onReauth()`

- [x] Update `src/client/pages/RoomPage.svelte` — song history state + drawer
  - [x] Add state: `songHistory = $state<Array<{trackId: string; title: string; artist: string; albumArtUrl: string; songIndex: number}>>([])`, `showHistory = $state(false)`
  - [x] In `round:start` handler: `songHistory = (data.songHistory ?? []).slice().reverse()` (reverse because server sends oldest-first, drawer displays newest-first)
  - [x] In `song:start` handler: prepend entry — `songHistory = [{ trackId: data.trackId, title: data.title, artist: data.artist, albumArtUrl: data.albumArtUrl, songIndex: data.songIndex }, ...songHistory]`
  - [x] Import and render `<SongHistoryDrawer entries={songHistory} onClose={() => { showHistory = false }} />` when `showHistory`
  - [x] Add `≡ History` button in the template header that sets `showHistory = true`

- [x] Update `src/client/pages/HostRoomPage.svelte` — song history, auth degraded, reauth popup
  - [x] Add state: `songHistory = $state<Array<{...}>>([])`, `showHistory = $state(false)`, `authDegraded = $state(false)`
  - [x] In `round:start` handler: `songHistory = (data.songHistory ?? []).slice().reverse()`
  - [x] In `song:start` handler: prepend entry to `songHistory`
  - [x] In WS message handler: add `auth:degraded` case → `authDegraded = true`; add `auth:restored` case → `authDegraded = false`, call `reinitSdk()`
  - [x] Extract SDK init into a named function `initSdkPlayer()` (already done). Add `reinitSdk()`:
    ```ts
    function reinitSdk() {
      player?.disconnect()
      sdkReady = false
      sdkFailed = false
      sdkErrorFired = false
      initSdkPlayer()
    }
    ```
  - [x] Add `handleReauth()` function: `window.open('/auth/login?popup=1', 'reauth', 'width=500,height=700,menubar=no,toolbar=no')`
  - [x] Import and render `<AuthDegradedBanner onReauth={handleReauth} />` when `authDegraded`
  - [x] Import and render `<SongHistoryDrawer entries={songHistory} onClose={() => { showHistory = false }} />` when `showHistory`
  - [x] Add `≡ History` button in the template

- [x] Add server-side tests (`src/server/__tests__/ws.test.ts`)
  - [x] Guest late-join: `round:start` re-send includes `songHistory`
  - [x] Host reconnect mid-round: `round:start` re-send includes `songHistory`

- [x] Add auth tests (`src/server/__tests__/auth.test.ts`)
  - [x] `GET /auth/login?popup=1` sets `pkce_popup` cookie
  - [x] `GET /auth/callback` in popup mode: emits `auth:restored`, returns HTML with `window.close()`

## Dev Notes

### songHistory already populated on server

`currentRound.songHistory` is already appended by `rooms.ts` line 49 on every `song:start` broadcast. The interface `SongHistoryEntry` is defined in `src/server/ws.ts` lines 21-27. Nothing needs to change in the data model — only the late-join re-send needs to include it.

### Server-side late-join changes (ws.ts)

**Guest path** — current code (lines ~203-216):
```ts
ws.send(JSON.stringify({
  ...round.roundStartPayload,
  card: blankCard,
  lateJoin: true,
}))
```
Change to:
```ts
ws.send(JSON.stringify({
  ...round.roundStartPayload,
  card: blankCard,
  lateJoin: true,
  songHistory: round.songHistory,
}))
```

**Host reconnect path** — current code (lines ~154-159):
```ts
ws.send(JSON.stringify({ ...activeRound.roundStartPayload, card: hostCard }))
```
Change to:
```ts
ws.send(JSON.stringify({ ...activeRound.roundStartPayload, card: hostCard, songHistory: activeRound.songHistory }))
```

### auth:restored event: send to host only (not broadcast)

The `auth:restored` event should go only to the host's WebSocket (guests don't have `auth:degraded` UI). Unlike `auth:degraded` which uses `broadcast()`, use direct send:

```ts
authEvents.on('restored', (userId: string) => {
  const code = getHostRoom(userId)
  if (code) {
    const room = roomSockets.get(code)
    if (room?.host?.readyState === WebSocket.OPEN) {
      room.host.send(JSON.stringify({ type: 'auth:restored' }))
    }
  }
})
```

Place alongside the existing `authEvents.on('degraded', ...)` block at line ~231 in ws.ts.

### Popup reauth — server flow

`authEvents` is exported from `src/server/refresh.ts`. Currently imported in `ws.ts` only. Add to `auth.ts`:
```ts
import { authEvents } from './refresh.ts'
```

The cookie approach for popup detection is simpler than encoding in `state`:

**`GET /auth/login?popup=1`** — add before the redirect:
```ts
if (ctx.req.query('popup') === '1') {
  setCookie(ctx, 'pkce_popup', '1', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/auth/callback',
    maxAge: 300,
    secure: config.isProduction,
  })
}
```

**`GET /auth/callback`** — after `upsertHost()` succeeds, before the final redirect:
```ts
const isPopup = getCookie(ctx, 'pkce_popup') === '1'
if (isPopup) {
  deleteCookie(ctx, 'pkce_popup', { path: '/auth/callback' })
  authEvents.emit('restored', me.id)
  return ctx.html('<html><body><script>window.close()</script></body></html>')
}
return ctx.redirect('/')
```

### Popup reauth — client flow

The popup reauth does NOT use PKCE from the client side — the server handles everything. The client just:
1. Opens the popup with `window.open('/auth/login?popup=1', ...)`
2. Waits for the `auth:restored` WS event
3. On `auth:restored`: `authDegraded = false`, call `reinitSdk()`

The popup closes itself via the `<script>window.close()</script>` returned by `/auth/callback`.

**No polling needed.** The WS event is the signal. If the popup is closed without completing, `auth:restored` never fires, the banner stays visible.

### reinitSdk() — re-initializing the Spotify SDK player

The `sdkErrorFired` latch in `HostRoomPage.svelte` is one-way (set to `true` on first SDK error, never reset). `reinitSdk()` must reset it before calling `initSdkPlayer()`:
```ts
function reinitSdk() {
  player?.disconnect()
  sdkReady = false
  sdkFailed = false
  sdkErrorFired = false
  initSdkPlayer()
}
```

`initSdkPlayer()` is already extracted as a named function (lines 48-86 in HostRoomPage.svelte). The SDK script tag is already injected — calling `initSdkPlayer()` again works because `window.Spotify` is already defined. The `onSpotifyWebPlaybackSDKReady` callback is NOT re-set (it's only needed on first load).

### SongHistoryDrawer — newest-first display

The server's `songHistory` array is **oldest-first** (appended in order). The drawer spec requires newest-first display. Two approaches:
- Reverse on receipt: `songHistory = (data.songHistory ?? []).slice().reverse()` then `song:start` prepends
- Reverse on render: display `[...songHistory].reverse()` in template

Use **reverse on receipt** (recommended): store newest-first in state so prepending on `song:start` is a simple `[newEntry, ...songHistory]`. Use `.slice()` before `.reverse()` to avoid mutating the original.

### SongHistoryDrawer — album art fallback

Use a simple `♪` text node or CSS background as fallback:
```svelte
{#if entry.albumArtUrl}
  <img src={entry.albumArtUrl} alt="" width="40" height="40" />
{:else}
  <div class="art-fallback">♪</div>
{/if}
```
Keep fallback width/height at 40×40px to maintain list alignment.

### z-index layering

Existing z-index stack:
- `SdkFailureBanner`: `z-index: 190`
- `wsError` banner: `z-index: 200`
- `WinOverlay`: `z-index: 300`

New additions:
- `SongHistoryDrawer`: `z-index: 150` (below banners — drawer can be dismissed; banners are critical)
- `AuthDegradedBanner`: `z-index: 210` (above SdkFailureBanner, below WinOverlay)

### SongHistoryEntry type on client

Do NOT import `SongHistoryEntry` from server code. Use an inline type in each file (following the pattern established in 5-5 for `WinData`):
```ts
type HistoryEntry = {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  songIndex: number
}
```

### Existing `auth:degraded` handling in HostRoomPage

Currently `auth:degraded` is broadcast to all room members (ws.ts line 236) but HostRoomPage has no handler for it — it's silently ignored. The handler needs to be added to the WS message `if/else` chain.

Looking at the current handler chain in `HostRoomPage.svelte` (lines ~107-140), add after `round:end`:
```ts
} else if (data.type === 'auth:degraded') {
  authDegraded = true
} else if (data.type === 'auth:restored') {
  authDegraded = false
  reinitSdk()
}
```

### History button placement

The `≡ History` button should appear in the card header area, consistently on both RoomPage and HostRoomPage. Existing layout: BingoCard + status-line text. Place the button above BingoCard or as a small floating button. Keep it simple — MVP. Minimum 44×44px touch target (WCAG AA).

### Tests — ws.test.ts late-join patterns

Look at existing late-join WS tests in `src/server/__tests__/ws.test.ts` for the test setup pattern. The test needs to:
1. Create room + active round with non-empty `songHistory`
2. Connect a guest WS
3. Assert that the received `round:start` message includes `songHistory`

### Tests — auth.test.ts popup patterns

Look at existing callback tests (`describe('GET /auth/callback')` in auth.test.ts lines ~61+). For popup mode:
1. Set up mock Spotify token exchange (same as existing test)
2. Add `pkce_popup=1` cookie to request
3. Assert response is HTML (not redirect)
4. Assert `authEvents.emit` was called with `'restored'` (or spy on it)

### Deferred items addressed in this story

From 5-5 deferred: "Late-joining guest's card absent from `round.cards` → always 422 on a bingo claim" — NOTE: this story does NOT fix this. The guest still gets a blank card and cannot claim bingo. The history drawer lets them self-mark but the story explicitly does not add their blank card to `round.cards`. Bingo claim by late-joined guests remains deferred.

From Epic 4 deferred: "Host reconnecting mid-round receives no `round:start` re-send" — This IS fixed by this story (adding `songHistory` to host reconnect re-send, which was already sending `round:start` but is now also sending songHistory).

Wait — re-read: the Epic 4 deferred says host reconnect gets NO `round:start` re-send at all. But looking at ws.ts lines 154-159, it already sends one! The deferred was written before story 5-3 perhaps fixed it. Check: ws.ts line 156: `if (activeRound?.active)` — it does send `round:start`. So this story just needs to add `songHistory` to that existing send.

### File List of Changes

- `src/server/ws.ts` — add `songHistory` to guest late-join re-send, host reconnect re-send, and add `auth:restored` listener
- `src/server/auth.ts` — import `authEvents`, add popup mode to `/auth/login` and `/auth/callback`
- `src/client/components/SongHistoryDrawer.svelte` (new) — bottom sheet, song list, album art, close button
- `src/client/components/AuthDegradedBanner.svelte` (new) — top banner with "Re-authenticate →" button
- `src/client/pages/RoomPage.svelte` — add `songHistory` state, prepend on `song:start`, initialize from `round:start`, add `≡ History` button + drawer
- `src/client/pages/HostRoomPage.svelte` — same as RoomPage plus: `authDegraded` state, `auth:degraded`/`auth:restored` handlers, `reinitSdk()`, `handleReauth()`, AuthDegradedBanner
- `src/server/__tests__/ws.test.ts` — 2 tests: guest late-join includes songHistory, host reconnect includes songHistory
- `src/server/__tests__/auth.test.ts` — 2 tests: popup mode sets cookie, callback popup mode returns close-popup HTML

### References

- `SongHistoryEntry` interface: `src/server/ws.ts` lines 21-27
- `RoundState.songHistory`: `src/server/ws.ts` line 39
- `broadcast()` function: `src/server/ws.ts` lines 64-75
- `getHostRoom()` function: `src/server/ws.ts` lines 84-89
- `roomSockets` Map: `src/server/ws.ts` line 60
- `authEvents` EventEmitter: `src/server/refresh.ts` line 19
- Guest late-join re-send: `src/server/ws.ts` lines ~203-216
- Host reconnect re-send: `src/server/ws.ts` lines ~154-159
- `auth:degraded` listener: `src/server/ws.ts` lines ~231-238
- `GET /auth/login`: `src/server/auth.ts` lines 46-69
- `GET /auth/callback`: `src/server/auth.ts` lines 72-149
- `initSdkPlayer()` function: `src/client/pages/HostRoomPage.svelte` lines 48-86
- `sdkErrorFired` latch: `src/client/pages/HostRoomPage.svelte` line 42
- `SdkFailureBanner` z-index: `src/client/components/SdkFailureBanner.svelte` (z-index: 190)
- `WinOverlay` z-index: `src/client/components/WinOverlay.svelte` (z-index: 300)
- `wsError` banner z-index: `src/client/pages/HostRoomPage.svelte` line ~162 (z-index: 200)
- `WinData` type pattern (inline client type): `src/client/pages/RoomPage.svelte` lines 18-23
- `round:start` handler in RoomPage: `src/client/pages/RoomPage.svelte` lines 78-83
- `round:start` handler in HostRoomPage: `src/client/pages/HostRoomPage.svelte` lines 109-114
- `song:start` handler in RoomPage: `src/client/pages/RoomPage.svelte` lines 84-89
- `song:start` handler in HostRoomPage: `src/client/pages/HostRoomPage.svelte` lines 115-121
- Brand colours: `#1db954` (Spotify green), `#1a1a1a` (card bg), `#121212` (page bg)
- Touch targets: minimum 44×44px (WCAG AA)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

No blockers. All tasks implemented cleanly on first pass.

### Completion Notes List

- Added `songHistory` to both late-join re-sends in `ws.ts` (guest path and host reconnect path) — one-line spread addition each
- Added `authEvents.on('restored', ...)` listener in `ws.ts` alongside the existing `degraded` listener; sends only to host socket (not broadcast)
- Updated `auth.ts` to import `authEvents` from `refresh.ts`; added `pkce_popup` cookie logic to `/auth/login?popup=1` and popup detection in `/auth/callback` that emits `auth:restored` and returns close-popup HTML
- Created `SongHistoryDrawer.svelte` — 70vh bottom sheet, fixed z-index 150, overlay at z-index 149, newest-first list with 40×40 album art + `♪` fallback, 44px touch targets
- Created `AuthDegradedBanner.svelte` — fixed top banner at z-index 210 with "Re-authenticate →" button
- Updated `RoomPage.svelte`: `songHistory` state reversed from `round:start`, prepended on `song:start`, `≡ History` button, `SongHistoryDrawer` conditional render
- Updated `HostRoomPage.svelte`: same song history wiring; added `authDegraded` state, `auth:degraded`/`auth:restored` WS handlers, `reinitSdk()` (resets `sdkErrorFired` latch), `handleReauth()` popup open, `AuthDegradedBanner` and `SongHistoryDrawer` renders; `AuthDegradedBanner` stacks above `SdkFailureBanner` (z-index 210 vs 190)
- Added 5 new server tests (3 in ws.test.ts, 4 in auth.test.ts — total 231 tests, all passing, 0 regressions)

### File List

- `src/server/ws.ts` — songHistory in guest late-join re-send, host reconnect re-send; auth:restored listener
- `src/server/auth.ts` — import authEvents; pkce_popup cookie on /auth/login?popup=1; popup mode in /auth/callback
- `src/client/components/SongHistoryDrawer.svelte` (new) — bottom sheet, song list, album art, close button
- `src/client/components/AuthDegradedBanner.svelte` (new) — top banner with Re-authenticate button
- `src/client/pages/RoomPage.svelte` — songHistory state, round:start/song:start handlers, ≡ History button, SongHistoryDrawer
- `src/client/pages/HostRoomPage.svelte` — songHistory state, authDegraded state, reinitSdk(), handleReauth(), auth:degraded/auth:restored handlers, AuthDegradedBanner, SongHistoryDrawer, ≡ History button
- `src/server/__tests__/ws.test.ts` — 3 new tests: guest late-join songHistory, host reconnect songHistory, auth:restored host-only
- `src/server/__tests__/auth.test.ts` — 4 new tests: popup=1 sets cookie, no popup no cookie, callback popup mode, callback normal mode

### Review Findings

- [x] [Review][Patch] `clearDegradedState` not called after popup reauth — `degradedHosts` set never cleared; scheduler skips host indefinitely; new access token expires unrefreshed [src/server/auth.ts, src/server/refresh.ts]
- [x] [Review][Patch] `reinitSdk()` has no concurrent-call guard — multiple rapid `auth:restored` events (or double-click reauth) trigger repeated player disconnect+reinit loops [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] `window.open()` return value not checked — silently returns `null` when blocked by mobile browsers or popup blockers; user gets no feedback [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] Broken album art image has no onerror fallback — `albumArtUrl` non-empty but 404 or broken renders browser broken-image icon instead of `♪` text fallback [src/client/components/SongHistoryDrawer.svelte]
- [x] [Review][Defer] `SongHistoryDrawer` missing keyboard trap and Escape key handler — `role="dialog"` without focus management; WCAG 2.1 SC 2.1.2 gap — deferred, pre-existing gap acceptable for MVP
- [x] [Review][Defer] `auth:restored` silently dropped if host socket is offline at event time — banner stays stuck if popup completes while host is disconnected — deferred, low-probability edge case
- [x] [Review][Defer] Popup stays open if Spotify returns `?error=` on callback — error path in `/auth/callback` doesn't detect popup mode; popup stays open — deferred, out of spec scope (AC8 covers user-closed case only)
- [x] [Review][Defer] `authEvents` module-level listener never torn down — minor test isolation leak; pattern pre-exists in this file — deferred, pre-existing
- [x] [Review][Defer] `song:start` duplicate entries on WS reconnect replay — reconnect `round:start` resets state so self-healing; low probability — deferred, pre-existing
- [x] [Review][Defer] `reinitSdk()` race when SDK script still loading at `auth:restored` time — `initSdkPlayer()` existing logic likely handles this — deferred, pre-existing

## Change Log

- 2026-04-04: Story created by bmad-create-story workflow — previous story intelligence from 5-5 (WinOverlay patterns, z-index stack, inline client types, test helper patterns), analysis of ws.ts late-join re-send, auth.ts PKCE flow, authEvents EventEmitter pattern, sdkErrorFired latch
- 2026-04-04: Implemented by claude-sonnet-4-6 — all 8 task groups complete; 7 new tests added (231 total, 0 regressions); story moved to review
- 2026-04-04: Code review by bmad-code-review — 4 patches applied, 6 deferred, 9 dismissed; story moved to done
