# Story 3.4: Login & Lobby Screens

Status: done

## Story

As a host,
I want a login screen to connect my Spotify account and a lobby to wait in between rounds,
So that I can manage my session and guests can see the game is active before a round starts.

## Acceptance Criteria

1. A host with no session cookie sees the login screen with a "Connect Spotify" button (links to `/auth/login`) and a small muted disclaimer: "Use desktop Chrome or Firefox for audio".
2. A host with a valid session cookie navigating to `/` skips the login screen and lands directly on the dashboard.
3. After authenticating and creating/opening a room, the host sees the lobby screen with a spinning vinyl SVG (~80px, CSS-only animation).
4. The lobby displays music trivia facts that cycle every 12 seconds with a 400ms fade transition; facts do not repeat until all are exhausted, then the cycle restarts.
5. The lobby displays a live player count that updates in real time as guests join or leave (via WS `player:joined`/`player:left` events).
6. The lobby displays a "Configure Round →" CTA that is prominent and always visible to the host.
7. The room code is displayed large (32px), monospace, bold, persistently visible in the header on all screens; clicking/tapping it copies it to the clipboard.
8. The host's WS connection is established when they enter the room lobby, receiving `session:connect` with `role: "host"` and initial player list.

## Tasks / Subtasks

- [x] `DashboardPage.svelte` — host room management (AC: 2, 3, 6, 7, 8)
  - [x] Replace the existing "Dashboard (coming soon)" placeholder in `App.svelte`
  - [x] Display list of existing rooms (from `GET /api/rooms`), each with code + "Open" button
  - [x] "Create Room" button → `POST /api/rooms` → navigate into room lobby for the new room
  - [x] On room open/create: transition to `LobbyPage.svelte`, passing room code as prop

- [x] `LobbyPage.svelte` (AC: 3–8)
  - [x] Spinning vinyl SVG: simple CSS `animation: spin 3s linear infinite` on a vinyl disc shape; ~80px
  - [x] Load trivia facts from `src/client/lib/trivia.ts` (static JSON array, ~50 facts); shuffle on mount; cycle through with `setInterval(12000)`, 400ms CSS `transition: opacity`; reshuffle and restart on exhaustion
  - [x] Live player count `$state` — initialised from `session:connect` players array, updated on `player:joined`/`player:left` WS events
  - [x] "Configure Round →" CTA button — navigates to `RoundConfigPage` (placeholder for Epic 4)
  - [x] Header: room code rendered at 32px monospace bold; click handler → `navigator.clipboard.writeText(code)` with brief "Copied!" tooltip

- [x] Host WS connection (AC: 8)
  - [x] In `LobbyPage.svelte` `onMount`: open WS to `/ws?code=<code>` (session cookie sent automatically by browser)
  - [x] Handle `session:connect` → set initial player list
  - [x] Handle `player:joined` / `player:left` → update player count and list
  - [x] Handle `auth:degraded` → show re-auth banner (stub for Epic 5's full banner; a dismissible `<p>` is sufficient here)
  - [x] `onDestroy`: close WS

- [x] `src/client/lib/trivia.ts` — static trivia data (AC: 4)
  - [x] Export `TRIVIA_FACTS: string[]` — ~50 music trivia facts (write them; keep them fun, music-themed, mix of eras and genres)
  - [x] Shuffle function: Fisher-Yates

- [x] Tests (AC: 1–7)
  - [x] Dashboard renders "Connect Spotify" when `getMe()` returns null (login screen)
  - [x] Dashboard skips login when `getMe()` returns a user
  - [x] Lobby: trivia cycles (advance timer, check fact changes, check no repeat until exhausted)
  - [x] Lobby: player count increments on `player:joined` message, decrements on `player:left`
  - [x] Room code: click triggers `navigator.clipboard.writeText` with correct code

## Dev Notes

### Vinyl SVG
A minimal CSS-animated vinyl disc — no external asset needed:
```svelte
<div class="vinyl" aria-hidden="true">
  <svg viewBox="0 0 80 80" width="80" height="80">
    <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#333" stroke-width="2"/>
    <circle cx="40" cy="40" r="20" fill="#222"/>
    <circle cx="40" cy="40" r="4" fill="#444"/>
  </svg>
</div>

<style>
  .vinyl { animation: spin 3s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
```

### Trivia cycling with fade
```svelte
let factIndex = $state(0)
let facts = shuffle([...TRIVIA_FACTS])
let visible = $state(true)

setInterval(() => {
  visible = false
  setTimeout(() => {
    factIndex = (factIndex + 1) % facts.length
    if (factIndex === 0) facts = shuffle([...TRIVIA_FACTS])
    visible = true
  }, 400)
}, 12000)
```
CSS: `.fact { transition: opacity 0.4s; opacity: 0; } .fact.visible { opacity: 1; }`

### Host WS URL
Host connects to `/ws?code=<roomCode>` — the session cookie is sent automatically by the browser (httpOnly, SameSite=Lax). Server identifies them as host via cookie lookup + room ownership check (Story 3-2).

### Room code clipboard copy
```ts
async function copyCode() {
  await navigator.clipboard.writeText(code)
  copied = true
  setTimeout(() => copied = false, 1500)
}
```
Show a brief "Copied!" inline next to the code when `copied` is true.

### Existing LoginPage
`LoginPage.svelte` already implements the Spotify connect button + iOS disclaimer (Story 1-1). This story wires it into the new routing structure — no changes to `LoginPage.svelte` itself.

### RoundConfigPage placeholder
`LobbyPage.svelte` needs a "Configure Round →" button. For now, navigate to a stub `RoundConfigPage.svelte` that just says "Round config (Epic 4)". Epic 4 replaces this.

## References
- Login screen: "Connect Spotify" button + iOS disclaimer, session-skip [Source: ux-spec.md UX-DR16, src/client/pages/LoginPage.svelte]
- Lobby: spinning vinyl, 12s trivia cycle, 400ms fade, live player count, Configure Round CTA [Source: ux-spec.md UX-DR11]
- Room code: 32px monospace bold, persistent, copyable [Source: ux-spec.md UX-DR23]
- Host WS `session:connect` with `role: "host"` [Source: 3-2 story]
- `player:joined` / `player:left` WS events defined in Story 3-2 [Source: 3-2 story]

## File List

- `src/client/lib/trivia.ts` (created) — 50 music trivia facts + Fisher-Yates shuffle
- `src/client/lib/api.ts` (modified) — added `getRooms()`, `createRoom()`, `RoomSummary`, `CreateRoomResponse`
- `src/client/lib/ws.ts` (modified) — added `determineInitialPage()`, `applyPlayerEvent()`, `copyRoomCode()`, `connectAsHost()`, `HostHandlers`, `Page` type
- `src/client/pages/DashboardPage.svelte` (created) — host dashboard: room list, create room, onEnterLobby callback
- `src/client/pages/LobbyPage.svelte` (created) — full lobby: vinyl, trivia cycling, player count, WS, configure CTA, header with copyable code
- `src/client/pages/RoundConfigPage.svelte` (created) — stub placeholder for Epic 4
- `src/client/App.svelte` (modified) — updated routing (root `/` without auth → login), wired DashboardPage, LobbyPage, RoundConfigPage
- `src/client/__tests__/dashboard.test.ts` (created) — 29 tests covering AC 1–7 via pure-function units

### Review Findings

- [x] [Review][Patch] `connectAsHost` has no `onerror`/`onclose` handler — silent WS failure, stale player list, no user feedback [src/client/lib/ws.ts]
- [x] [Review][Patch] `creating` flag not reset on success path in `handleCreateRoom` — button stays disabled if component doesn't immediately unmount [src/client/pages/DashboardPage.svelte]
- [x] [Review][Patch] Trivia inner 400ms `setTimeout` not cleared on component destroy — can write to dead reactive state [src/client/pages/LobbyPage.svelte]
- [x] [Review][Patch] `handleCopyCode` does not catch `copyRoomCode` rejection — clipboard API denial causes unhandled rejection, no user feedback [src/client/pages/LobbyPage.svelte]
- [x] [Review][Patch] `facts` is plain `let`, not `$state` — reshuffle at wrap-around not tracked by Svelte; fragile dependency on `visible` re-render to pick up new array [src/client/pages/LobbyPage.svelte]
- [x] [Review][Patch] Room code header absent from `RoundConfigPage` — violates AC7 ("persistently visible in the header on all screens") [src/client/pages/RoundConfigPage.svelte]
- [x] [Review][Defer] Authenticated host navigating to `/room/CODE` lands on dashboard, intent discarded [src/client/lib/ws.ts] — deferred, pre-existing design decision (same behavior as before this story)
- [x] [Review][Defer] Create Room button not disabled while room list is loading — minor concurrent UX gap [src/client/pages/DashboardPage.svelte] — deferred, no spec requirement
- [x] [Review][Defer] `applyPlayerEvent` does not deduplicate player names — inflated count if server sends duplicate `player:joined` [src/client/lib/ws.ts] — deferred, server prevents duplicates at connection time
- [x] [Review][Defer] `player:joined` before `session:connect` ordering race — client overwrites optimistic state [src/client/pages/LobbyPage.svelte] — deferred, server sends `session:connect` synchronously on connect

## Change Log

- 2026-04-03: Implemented story 3.4 — Login & Lobby Screens. Created DashboardPage (room list + create flow), LobbyPage (spinning vinyl, 12s trivia cycling with 400ms fade, live player count via WS, persistent copyable room code header, Configure Round CTA), RoundConfigPage stub. Extended ws.ts with connectAsHost/applyPlayerEvent/copyRoomCode/determineInitialPage; extended api.ts with getRooms/createRoom. Fixed app routing: unauthenticated users at root now see LoginPage (not JoinPage). All 111 tests pass.

## Dev Agent Record

### Implementation Notes

- `determineInitialPage()` extracted to `ws.ts` as a pure function — enables routing tests in node environment without DOM; used by App.svelte onMount.
- `applyPlayerEvent()` is a pure reducer — no Svelte reactivity leakage; used in LobbyPage and independently testable.
- `copyRoomCode()` thin wrapper around `navigator.clipboard.writeText` — testable via stub.
- `connectAsHost()` mirrors `connectAsGuest()` structure; host URL omits `name=` param (server identifies host via session cookie).
- Trivia cycling uses `setInterval(12000)` + inner `setTimeout(400)` exactly matching the Dev Notes spec; facts array reshuffled in-place when `factIndex` wraps to 0.
- App routing change: `page = 'login'` (was `'join'`) for unauthenticated users at non-room paths. Guests navigate via `/room/CODE` links shared by host.
- 29 new tests; total suite: 111 tests, 8 files, all passing. TypeScript clean.

### Completion Notes

All ACs satisfied:
- AC1: root `/` without session → LoginPage with "Connect Spotify" + iOS disclaimer ✅
- AC2: root `/` with session → DashboardPage (skips login) ✅
- AC3: LobbyPage spinning vinyl SVG, CSS-only `spin 3s linear infinite` at 80px ✅
- AC4: trivia cycles every 12s, 400ms opacity fade, reshuffles on exhaustion ✅
- AC5: player count updates live on `player:joined` / `player:left` WS events ✅
- AC6: "Configure Round →" CTA button, prominent, always visible ✅
- AC7: room code 32px monospace bold in fixed header; click writes to clipboard with "Copied!" tooltip ✅
- AC8: host WS opens on lobby mount to `/ws?code=<code>`, receives `session:connect` with `role: "host"` ✅
