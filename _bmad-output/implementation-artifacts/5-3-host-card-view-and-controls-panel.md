# Story 5.3: Host Card View & Controls Panel

Status: done

## Story

As a host,
I want to see my bingo card alongside playback controls,
so that I can play the game and manage the round without switching between views.

## Acceptance Criteria

1. When `round:start` arrives on the host's WS, the host's game view renders a 5×5 bingo card using the same `BingoCard.svelte` component from Story 5-2 (`src/client/components/BingoCard.svelte`). The host can mark tiles exactly like a guest.

2. On mobile (< 768px), a persistent "Controls ▲" handle is fixed at the bottom of the screen. Tapping it opens the Controls Panel as a partial bottom sheet with ~40% of the card still visible above.

3. The Controls Panel displays: current track name + artist; Prev (disabled — no server endpoint), Play/Pause toggle, and Next buttons (Next is the largest); a live player list; and an End Round button (small, low-prominence, right-aligned).

4. On desktop (≥ 768px), the card occupies ~60% of the width on the left and the controls panel occupies ~40% on the right, always simultaneously visible with no overlay.

5. Host taps Play → client calls `POST /api/rooms/:code/round/play` and button switches to Pause icon. Host taps Pause → client calls `POST /api/rooms/:code/round/pause` and button switches to Play icon.

6. Host taps Next → client calls `POST /api/rooms/:code/round/next`.

7. Host taps End Round → a confirmation dialog appears. On confirm: a cancellable toast appears at top of screen for 2 seconds with an "Undo" action. If not cancelled, client calls `POST /api/rooms/:code/round/end`.

8. `POST /api/rooms/:code/round/end` (new server endpoint): cancels all pending timers, sets `roomState.currentRound = undefined`, broadcasts `{ type: 'round:end' }` to all clients, returns HTTP 200.

9. All clients (host and guests) receive `round:end`. Host navigates back to the lobby. Guest `RoomPage` resets to waiting state (tiles cleared, status line reset) without navigation.

10. Player list in the Controls Panel updates in real time as `player:joined` and `player:left` events arrive on the host's WS.

## Tasks / Subtasks

- [x] Add `POST /rooms/:code/round/end` to `src/server/rooms.ts` (AC: 8)
  - [x] Require auth, verify room ownership (same pattern as `round/pause`)
  - [x] Call `clearRoundTimers(round)`, set `roomState.currentRound = undefined`
  - [x] `broadcast(code, { type: 'round:end' })`
  - [x] Return `ctx.json({})` with HTTP 200

- [x] Update `src/server/ws.ts` host connection handler to send `round:start` on reconnect when a round is active (AC: 1)
  - [x] After the existing `ws.send(session:connect)` line (line 150), check `roomState.currentRound?.active`
  - [x] If active: `const hostCard = roomState.currentRound.cards.get(sessionUserId) ?? []`
  - [x] Send `{ ...roomState.currentRound.roundStartPayload, card: hostCard }` to the host WS

- [x] Update `Page` type in `src/client/lib/ws.ts` to include `'hostroom'`

- [x] Update `src/client/App.svelte` (AC: 9)
  - [x] `handleRoundStarted()` → set `page = 'hostroom'` instead of `'lobby'`
  - [x] Add `handleRoundEnded()` → `page = 'lobby'`
  - [x] Import `HostRoomPage` from `./pages/HostRoomPage.svelte`
  - [x] Add `{:else if page === 'hostroom'}` branch: `<HostRoomPage code={currentRoomCode} onRoundEnded={handleRoundEnded} />`

- [x] Create `src/client/components/HostControlsPanel.svelte` (AC: 3–7)
  - [x] Props: `code: string`, `currentTrack: { title: string; artist: string } | null`, `players: string[]`, `isPlaying: boolean`, `onRoundEnded: () => void`
  - [x] Play/Pause button: if `isPlaying`, show Pause (calls `POST /api/rooms/:code/round/pause`); else show Play (calls `/round/play`)
  - [x] Next button (largest, prominent): calls `POST /api/rooms/:code/round/next`
  - [x] Prev button: rendered, **disabled** — no server endpoint exists yet
  - [x] Player list: render `players` array, show count
  - [x] End Round: confirmation dialog → 2s toast with "Undo" → if not undone, `POST /api/rooms/:code/round/end` → call `onRoundEnded()`
  - [x] Use `fetch()` directly for all REST calls (no new api.ts functions needed)

- [x] Create `src/client/pages/HostRoomPage.svelte` (AC: 1–10)
  - [x] Props: `code: string`, `onRoundEnded: () => void`
  - [x] Create raw host WS in `onMount`: `new WebSocket(wsUrl)` where `wsUrl = \`\${wsProtocol}//\${window.location.host}/ws?code=\${code}\``  (session cookie sent automatically)
  - [x] Handle `session:connect` → extract `data.players`, set `players` state
  - [x] Handle `round:start` → `tiles = initTiles(data.card)`, `roundConfig = { titleRevealDelay: data.titleRevealDelay }`, `statusLine = 'Waiting for next song…'`
  - [x] Handle `song:start` → `applyMask`, update `statusLine`, set `currentTrack = { title, artist }`, set `isPlaying = true`
  - [x] Handle `song:reveal` → `startReveal` + `setTimeout(finishReveal, 300)` (same revealTimer pattern as RoomPage)
  - [x] Handle `song:pause` / `songs:exhausted` → `statusLine = 'Waiting for next song…'`, `isPlaying = false`
  - [x] Handle `round:win` → `applyWinPath`
  - [x] Handle `round:end` → call `onRoundEnded()`
  - [x] Handle `player:joined` / `player:left` → update `players` with `applyPlayerEvent` from `../lib/ws.ts`
  - [x] Handle tile click → `toggleMark` (same as RoomPage)
  - [x] Mobile layout (< 768px): card fills viewport; fixed "Controls ▲" handle at bottom; tapping opens `HostControlsPanel` as a slide-up overlay
  - [x] Desktop layout (≥ 768px): CSS grid `grid-template-columns: 3fr 2fr`; card left, panel right, always visible
  - [x] `onDestroy`: `clearTimeout(revealTimer)`, `ws.close()`

- [x] Update `src/client/pages/RoomPage.svelte` (guest) to handle `round:end` (AC: 9)
  - [x] In `ws.onmessage`, add `else if (data.type === 'round:end')` branch
  - [x] On `round:end`: `tiles = []`, `statusLine = 'Waiting for the host to start a round...'`, `roundConfig = null`

- [x] Add server tests for `POST /api/rooms/:code/round/end` in `src/server/__tests__/rooms.test.ts`
  - [x] 200: success — clears currentRound, broadcasts `round:end`
  - [x] 403: wrong host (different user_id)
  - [x] 404: room not found
  - [x] 404: no active round

## Dev Notes

### CRITICAL: How the host gets to the game view (navigation flow)

The current flow: Dashboard → Lobby (creates WS via `connectAsHost`) → RoundConfig → `handleRoundStarted()` → back to Lobby.

**Story 5-3 changes this**: `handleRoundStarted()` now navigates to `'hostroom'` instead of `'lobby'`. App.svelte renders `HostRoomPage` which creates its own host WS.

**The timing problem**: By the time RoundConfigPage calls `onRoundStarted()`, LobbyPage has already been destroyed (`onDestroy` runs, closes WS). The server tried to send `round:start` to the host's WS during the REST call, but `roomState.host` was null (LobbyPage's WS was closed). So `round:start` was never delivered to the host.

**The fix (ws.ts server change)**: When a host WS connects and `roomState.currentRound?.active` is true, immediately send `round:start` with the host's card. This gives HostRoomPage the round data on connection. The host WS always reconnects with `isReconnect=true` in this flow (LobbyPage connected first, then disconnected).

The new host WS connection sequence (what HostRoomPage will receive):
1. `{ type: 'session:connect', role: 'host', players: [...] }` — always
2. `{ type: 'round:start', roundNumber, card, titleRevealDelay, ... }` — only when an active round exists

### Host WS: raw WebSocket, NOT connectAsHost

`connectAsHost` (in `src/client/lib/ws.ts`) sets handlers for lobby events only (`session:connect`, `player:joined`, `player:left`, `auth:degraded`, `onDisconnected`). `HostRoomPage` needs to handle these PLUS game events. Create a raw WebSocket in `HostRoomPage.onMount` and handle everything in one `ws.onmessage` block:

```svelte
// In HostRoomPage.svelte onMount:
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${wsProtocol}//${window.location.host}/ws?code=${code}`
ws = new WebSocket(wsUrl)
// Session cookie is sent automatically — server identifies as host

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data)
    if (data.type === 'session:connect') {
      players = data.players ?? []
    } else if (data.type === 'round:start') {
      tiles = initTiles(data.card)
      roundConfig = { titleRevealDelay: data.titleRevealDelay }
      statusLine = 'Waiting for next song…'
    } else if (data.type === 'song:start') {
      // ... same as RoomPage
    } else if (data.type === 'player:joined') {
      players = applyPlayerEvent(players, data)
    } else if (data.type === 'player:left') {
      players = applyPlayerEvent(players, data)
    } else if (data.type === 'round:end') {
      onRoundEnded()
    }
    // ... other events
  } catch { /* ignore */ }
}
ws.onerror = () => { wsError = true }
ws.onclose = (event) => { if (event.code !== 1000) wsError = true }
```

### Do NOT modify existing connectAsHost or connectAsGuest functions

These are used by LobbyPage and JoinPage respectively. Adding `onMessage` pass-through to `connectAsHost` would be scope creep. HostRoomPage creates its own raw WS.

### BingoCard.svelte reuse

Same component as Story 5-2. Import path: `../components/BingoCard.svelte`. Props: `tiles: ClientTile[]`, `onTileClick: (index: number) => void`.

All bingo state logic imports from `../lib/bingo.ts`: `initTiles`, `applyMask`, `startReveal`, `finishReveal`, `toggleMark`, `applyWinPath`. Types: `ClientTile`, `TitleRevealDelay`.

### applyPlayerEvent reuse

`applyPlayerEvent` is already exported from `src/client/lib/ws.ts`. Import and use for player list updates:
```ts
import { applyPlayerEvent } from '../lib/ws.ts'
// ...
players = applyPlayerEvent(players, { type: data.type, name: data.name })
```

### round/end server endpoint pattern

Follow the exact same pattern as `round/pause` at line 298 of `src/server/rooms.ts`:
- `requireAuth` middleware (exposes `ctx.var.host`)
- Get room by code, verify `room.host_user_id === host.user_id`
- Get `roomState` and `round` from `roomSockets`
- Check `round?.active` → 404 if not active
- `clearRoundTimers(round)` then `roomState.currentRound = undefined`
- `broadcast(code, { type: 'round:end' })`
- Return `ctx.json({})` with 200

### Mobile Controls Panel: slide-up bottom sheet

On mobile (< 768px): 
- Fixed "Controls ▲" button at bottom (full-width bar, explicit text label)
- Panel state: `let panelOpen = $state(false)`
- When open: render panel as `position: fixed; bottom: 0; left: 0; right: 0; height: ~60vh; background: #1a1a1a; z-index: 10`
- Card should still peek above (`~40%` visible): the fixed bar + panel don't cover the full card
- Handle label toggles: "Controls ▲" (closed) → "Controls ▼" (open)
- Panel slide animation: CSS `transition: transform 300ms ease`

### Desktop Controls Panel: split layout

On desktop (≥ 768px):
```css
.host-game {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 24px;
  max-width: 960px;
  margin: 0 auto;
  padding: 16px;
  min-height: 100vh;
  align-items: start;
}
```
Card is in left column, `HostControlsPanel` in right column. Panel is always visible.

### Prev button: disabled

The UX spec (UX-DR7) requires a Prev button in the panel. No server endpoint exists (`round/prev` is not implemented). Render Prev as `<button disabled>Prev</button>` with `opacity: 0.4`. Do NOT wire to any endpoint.

### End Round flow: dialog + cancellable toast

```
1. Host taps "End Round"
2. Show confirmation dialog: "End this round?" with Confirm/Cancel
3. On confirm: dismiss dialog, show 2-second toast at top: "Ending round…  [Undo]"
4. Start a 2s timeout. If "Undo" tapped → dismiss toast, clear timeout, do nothing.
5. If timeout fires → call POST /api/rooms/:code/round/end → on success, call onRoundEnded()
```

Toast implementation suggestion (no external library):
```svelte
let toastVisible = $state(false)
let undoTimer: ReturnType<typeof setTimeout> | undefined

function handleEndRoundConfirmed() {
  showDialog = false
  toastVisible = true
  undoTimer = setTimeout(async () => {
    toastVisible = false
    await fetch(`/api/rooms/${code}/round/end`, { method: 'POST' })
    onRoundEnded()
  }, 2000)
}

function handleUndo() {
  toastVisible = false
  clearTimeout(undoTimer)
}
```

### Player list: initial state vs live updates

`session:connect` provides the initial player list. `player:joined` / `player:left` events update it. The `session:connect` for host includes `players: getPlayerList(code)` which returns only guests (not the host themselves). The Controls Panel shows this guest list as "X players".

### isPlaying state transitions

Track `isPlaying: boolean` state in HostRoomPage:
- `round:start` → `isPlaying = false` (round just started, song not yet playing)
- `song:start` → `isPlaying = true`
- `song:pause` → `isPlaying = false`
- `songs:exhausted` → `isPlaying = false`

Pass `isPlaying` as prop to `HostControlsPanel` for Play/Pause toggle.

### revealTimer pattern: same as RoomPage

Copy the exact pattern from `src/client/pages/RoomPage.svelte`:
```ts
let revealTimer: ReturnType<typeof setTimeout> | undefined
// In song:reveal handler:
tiles = startReveal(tiles, data.trackId)
clearTimeout(revealTimer)
revealTimer = setTimeout(() => { tiles = finishReveal(tiles, data.trackId) }, 300)
// In onDestroy:
clearTimeout(revealTimer)
```

### Guest RoomPage: round:end handling

Add `round:end` case to the existing `ws.onmessage` in `RoomPage.svelte`:
```ts
} else if (data.type === 'round:end') {
  tiles = []
  statusLine = 'Waiting for the host to start a round...'
  roundConfig = null
}
```
No navigation needed for guests — they stay on the 'room' page and return to waiting state.

### Server test pattern for round/end

Follow the exact pattern used for `POST /api/rooms/:code/round/pause` tests starting at line 895 of `src/server/__tests__/rooms.test.ts`. Tests need:
- `initDb(':memory:')` + `roomSockets.clear()` in `beforeEach`
- `seedRoom()` and `seedActiveRound()` helpers (already defined in test file)
- Test that `round:end` is broadcast (capture `sent` array on mock WS)
- Test that `roomState.currentRound` is cleared after the call

### ws.ts server change: send round:start on host reconnect

Add to `src/server/ws.ts` in the host path, after the `session:connect` send (after line 150):

```ts
// Send round:start if there is an active round (needed for HostRoomPage initial load)
const activeRound = roomState.currentRound
if (activeRound?.active) {
  const hostCard = activeRound.cards.get(sessionUserId) ?? []
  ws.send(JSON.stringify({ ...activeRound.roundStartPayload, card: hostCard }))
}
```

This enables HostRoomPage to receive round state immediately on WS connection without a separate fetch.

### Do NOT break existing tests

Currently 208 tests passing. New tests for `round/end` should follow the existing describe/beforeEach pattern. The `round:start` ws.ts change must not break `src/server/__tests__/ws.test.ts` — check if those tests verify the exact messages sent on reconnect.

### File list of changes

- `src/server/rooms.ts` — add `POST /rooms/:code/round/end`
- `src/server/ws.ts` — send `round:start` to reconnecting host if active round
- `src/client/lib/ws.ts` — add `'hostroom'` to `Page` type
- `src/client/App.svelte` — `handleRoundStarted` → hostroom, add handleRoundEnded, import/render HostRoomPage
- `src/client/components/HostControlsPanel.svelte` (new)
- `src/client/pages/HostRoomPage.svelte` (new)
- `src/client/pages/RoomPage.svelte` — handle `round:end` event
- `src/server/__tests__/rooms.test.ts` — add `round/end` describe block

### References

- `POST /round/pause` pattern: `src/server/rooms.ts` lines 298–318
- `broadcast` helper: `src/server/ws.ts` lines 62–74
- `clearRoundTimers`: `src/server/rooms.ts` lines 14–20
- `RoundState` interface: `src/server/ws.ts` lines 29–45
- `RoomState` interface: `src/server/ws.ts` lines 49–56
- `session:connect` host send: `src/server/ws.ts` line 150 — add round:start send AFTER this line
- Guest late-join `round:start` pattern: `src/server/ws.ts` lines 194–207 — mirror for host
- `BingoCard.svelte` usage: `src/client/pages/RoomPage.svelte` lines 3–11, 72–77
- `applyPlayerEvent`: `src/client/lib/ws.ts` lines 17–24
- `connectAsHost` (reference only, NOT used in HostRoomPage): `src/client/lib/ws.ts` lines 39–66
- `Page` type: `src/client/lib/ws.ts` line 3
- `handleRoundStarted` target: `src/client/App.svelte` line 46–48
- Round config page `onRoundStarted` callback: `src/client/pages/RoundConfigPage.svelte`
- Server test pattern: `src/server/__tests__/rooms.test.ts` lines 895–1000
- Tile state logic: `src/client/lib/bingo.ts` (full file)
- `revealTimer` pattern: `src/client/pages/RoomPage.svelte` lines 20, 43–48, 61
- Brand colours: `#1db954` (Spotify green), `#1a1a1a` (card bg), `#121212` (page bg)
- Touch target minimum: 44×44px (WCAG AA, UX-DR21)
- Mobile breakpoint: `< 768px` slide-up; `≥ 768px` split (UX-DR5, UX-DR6)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

No blockers. All 212 tests pass (208 pre-existing + 4 new for round/end endpoint).

### Completion Notes List

- Added `POST /rooms/:code/round/end` endpoint to rooms.ts following the exact round/pause pattern: requireAuth, ownership check, clearRoundTimers, set currentRound=undefined, broadcast round:end, return 200.
- Updated ws.ts host connection handler: after sending session:connect, immediately sends round:start with the host's card if an active round exists. This enables HostRoomPage to receive round data on WS connect without a separate fetch (handles the timing gap where LobbyPage WS closes before HostRoomPage WS opens).
- Added 'hostroom' to the Page union type in client/lib/ws.ts.
- Updated App.svelte: handleRoundStarted navigates to 'hostroom' (was 'lobby'), added handleRoundEnded navigating to 'lobby', imported HostRoomPage and rendered it in the hostroom branch.
- Created HostControlsPanel.svelte: track info, Prev (disabled)/Play-Pause/Next controls, live player list, End Round with confirmation dialog + 2s cancellable toast using fetch() directly.
- Created HostRoomPage.svelte: raw WebSocket in onMount, handles all WS events (session:connect, round:start, song:start, song:reveal, song:pause, songs:exhausted, round:win, round:end, player:joined, player:left). Mobile: fixed "Controls ▲/▼" handle + slide-up 60vh panel. Desktop: CSS grid 3fr/2fr split.
- Updated RoomPage.svelte (guest): added round:end handler that clears tiles, resets statusLine, and nulls roundConfig without navigation.
- Added 4 server tests for round/end covering 200 success, 403 wrong host, 404 room not found, 404 no active round.

### File List

- `src/server/rooms.ts`
- `src/server/ws.ts`
- `src/client/lib/ws.ts`
- `src/client/App.svelte`
- `src/client/components/HostControlsPanel.svelte` (new)
- `src/client/pages/HostRoomPage.svelte` (new)
- `src/client/pages/RoomPage.svelte`
- `src/server/__tests__/rooms.test.ts`

### Review Findings

- [x] [Review][Patch] Double `onRoundEnded()` call — toast timer AND WS `round:end` handler both invoke it, causing double navigation and ignoring fetch response status [`src/client/components/HostControlsPanel.svelte`, `src/client/pages/HostRoomPage.svelte`]
- [x] [Review][Patch] `HostControlsPanel` missing `onDestroy` — `undoTimer` leaks if component unmounts during 2s undo window, firing orphaned `round/end` POST and calling `onRoundEnded` on dead closure [`src/client/components/HostControlsPanel.svelte`]
- [x] [Review][Defer] Mid-round reconnect doesn't replay current song state — `ws.ts` replays `round:start` but not `song:start`, leaving host card unmasked and `isPlaying=false` if reconnecting while a song plays [`src/server/ws.ts`] — deferred, reconnect resilience not in 5-3 ACs
- [x] [Review][Defer] `roundStartPayload` stale on reconnect — `isPlaying` and track info wrong until next server event after host WS reconnect [`src/server/ws.ts`] — deferred, same scope as above
- [x] [Review][Defer] `handlePlayPause`/`handleNext` fire-and-forget — no error handling, silent failure, stale UI state on 4xx/5xx [`src/client/components/HostControlsPanel.svelte`] — deferred, UX polish out of scope
- [x] [Review][Defer] Confirmation dialog missing keyboard focus trap — `aria-modal` declared but no focus lock or Escape handler (WCAG 2.1.2) [`src/client/components/HostControlsPanel.svelte`] — deferred, accessibility pass planned separately
- [x] [Review][Defer] 404 for "no active round" semantically incorrect — should be 409 Conflict [`src/server/rooms.ts`] — deferred, matches existing endpoint pattern
- [x] [Review][Defer] 60vh mobile sheet may obscure too much of the card — spec says ~40% of card visible; needs real-device verification [`src/client/pages/HostRoomPage.svelte`] — deferred, needs device testing
- [x] [Review][Defer] `round/end` guard rejects if `active=false` after `songs:exhausted` — host cannot end exhausted round via REST before `round:end` WS arrives [`src/server/rooms.ts`] — deferred, edge case with unclear spec intent
- [x] [Review][Defer] `currentRoomCode` could be empty string if LobbyPage flow bypassed — WS connects to `/ws?code=` [`src/client/pages/HostRoomPage.svelte`] — deferred, pre-existing flow guard gap

## Change Log

- 2026-04-04: Story created by bmad-create-story workflow — full context from Epic 5 analysis, Story 5-2 dev notes and file list, ws.ts and rooms.ts server patterns, host navigation flow analysis
- 2026-04-04: Story implemented by dev agent — host game view with bingo card + controls panel, round/end endpoint, ws.ts reconnect fix, guest round:end handling (212 tests passing)
