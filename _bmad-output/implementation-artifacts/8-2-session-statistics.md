# Story 8.2: Session Statistics

Status: done

## Story

As a player,
I want the Players List to show who has won in this session and how many times,
so that the room has a visible sense of history without anyone feeling tracked for losses.

## Background

Session-scoped win counts and a "last round winner" indicator must surface in the existing [PlayerList.svelte](src/client/components/PlayerList.svelte) (used in Lobby, `GuestWaitingRoom`, and `PlayersOverlay`). Stats are in-memory only — they live on `RoomState` in [src/server/ws.ts](src/server/ws.ts) and are wiped whenever the room is destroyed or the server restarts without rehydration of this field. Nothing goes to SQLite.

The win-detection path already exists at [rooms.ts:511-576](src/server/rooms.ts#L511-L576) (`POST /rooms/:code/round/claim`). On a valid claim the server broadcasts `round:win`. This story adds a second broadcast — `stats:updated` — fired immediately after the stats mutation, alongside `round:win`.

## Acceptance Criteria

1. **Server-side `SessionStats` on `RoomState`.** In [src/server/ws.ts](src/server/ws.ts):
   - Add exported interface `SessionStats { winsByName: Record<string, number>; lastRoundWinner: string | null }`.
   - Add required field `sessionStats: SessionStats` to `RoomState`.
   - All `roomSockets.set(code, { ... })` call sites (`rooms.ts` room-create path, host WS connect path, guest WS connect path) must initialize `sessionStats: { winsByName: {}, lastRoundWinner: null }`.
   - `rehydrateRooms` must also initialize `sessionStats: { winsByName: {}, lastRoundWinner: null }` (stats are NOT persisted — server restart resets them by design).

2. **Win increments stats on valid claim.** In [rooms.ts:511-576](src/server/rooms.ts#L511-L576) (`/round/claim` handler), after the existing `clearRoundTimers(round); round.active = false` at line 562-563 and BEFORE the `broadcast(code, { type: 'round:win', ... })` call:
   - `roomState.sessionStats.winsByName[playerName] = (roomState.sessionStats.winsByName[playerName] ?? 0) + 1`
   - `roomState.sessionStats.lastRoundWinner = playerName`
   - Use the same `playerName` string the claim request sent — for host wins this is `room.host_name`, matching AC's "host counts the same as guests" expectation. This is consistent with the existing 8-1 deferred note about display-name-as-identity.

3. **`stats:updated` broadcast after `round:win`.** Immediately after the existing `broadcast(code, { type: 'round:win', ... })` call (before `persistRoomState` / `deleteActiveRoom`), emit:
   ```ts
   broadcast(code, {
     type: 'stats:updated',
     winsByName: { ...roomState.sessionStats.winsByName },
     lastRoundWinner: roomState.sessionStats.lastRoundWinner,
   })
   ```
   Shallow-clone `winsByName` on every broadcast so downstream client state isn't aliased to a server-mutable object.

4. **Stats included on `session:connect` for late joiners.** In [ws.ts](src/server/ws.ts) `handleConnection`:
   - Host path (around line 279): append `winsByName`, `lastRoundWinner` from `roomState.sessionStats` to the `session:connect` payload.
   - Guest path (around line 328): append the same two fields.
   - A player joining mid-session must immediately render existing stats on their Players List.

5. **Stats cleared on session end.** `destroyRoom` already drops `roomSockets.get(code)` entirely, so sessionStats vanishes for free. No new code needed here — but the implementing dev MUST verify manually that creating a new room after deleting the prior one shows zero stats. Add a comment referencing this AC in `destroyRoom` only if it clarifies intent; do not add redundant code.

6. **Client-side `sessionStats` in `createGameState`.** In [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts):
   - Add state: `let winsByName = $state<Record<string, number>>({})` and `let lastRoundWinner = $state<string | null>(null)`.
   - In `processWsMessage`, add handler: `if (data.type === 'stats:updated') { winsByName = { ...(data.winsByName as Record<string, number>) }; lastRoundWinner = (data.lastRoundWinner as string | null) ?? null }`.
   - Expose `get winsByName()`, `get lastRoundWinner()`, `set winsByName(v)`, `set lastRoundWinner(v)` on the returned object (setters needed for the `session:connect` path below, which is handled outside `processWsMessage`).
   - DO NOT reset `winsByName` / `lastRoundWinner` on `round:start` — stats persist across rounds within a session.

7. **`session:connect` seeds client stats.**
   - **HostRoomPage** ([HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte), in the `session:connect` branch around line 156-158): after `game.players = data.players ?? []; hostName = data.hostName ?? null`, add:
     ```ts
     game.winsByName = (data.winsByName as Record<string, number> | undefined) ?? {}
     game.lastRoundWinner = (data.lastRoundWinner as string | null | undefined) ?? null
     ```
   - **Guest path** — the guest `session:connect` is currently swallowed by [connectAsGuest](src/client/lib/ws.ts) inside `ws.ts`, which only forwards shape via `handlers.onConnect(role, players, hostName)`. Extend `GuestHandlers.onConnect` to `onConnect(role: string, players: string[], hostName: string | null, winsByName: Record<string, number>, lastRoundWinner: string | null)` and pass `data.winsByName ?? {}` + `data.lastRoundWinner ?? null` from the ws handler. This is the path to take — do NOT add a second forwarding channel via `onMessage`.
   - **Chain to update** (five files):
     - [ws.ts:80-86](src/client/lib/ws.ts#L80-L86): `GuestHandlers.onConnect(role, players, hostName, winsByName, lastRoundWinner)`.
     - [ws.ts:124-143](src/client/lib/ws.ts#L124-L143): `connectAsGuest` calls `handlers.onConnect(data.role, data.players ?? [], data.hostName ?? null, data.winsByName ?? {}, data.lastRoundWinner ?? null)`.
     - [JoinPage.svelte:61-70](src/client/pages/JoinPage.svelte#L61-L70): `onConnect(role, players, hostName, winsByName, lastRoundWinner) { ...; onJoined(name, role, players, hostName, winsByName, lastRoundWinner, code, handedOff, pending) }`.
     - [App.svelte:38-47](src/client/App.svelte#L38-L47): `handleJoined` signature grows two params; add `let guestWinsByName = $state<Record<string, number>>({})` and `let guestLastRoundWinner = $state<string | null>(null)` state; assign in `handleJoined`.
     - [App.svelte:94](src/client/App.svelte#L94): `<RoomPage ... initialWinsByName={guestWinsByName} initialLastRoundWinner={guestLastRoundWinner} />`.
   - [RoomPage.svelte:13-21](src/client/pages/RoomPage.svelte#L13-L21): add `initialWinsByName?: Record<string, number>` and `initialLastRoundWinner?: string | null` props (both default `{}` / `null`); pass into `createGameState`.
   - [gameState.svelte.ts:43-62](src/client/lib/gameState.svelte.ts#L43-L62): add `initialWinsByName?: Record<string, number>` and `initialLastRoundWinner?: string | null` to the `createGameState` parameter object; use `initialWinsByName ?? {}` and `initialLastRoundWinner ?? null` as the initial values for the new state fields in AC #6.

8. **`PlayerList.svelte` renders win count and last-round pill.** In [PlayerList.svelte](src/client/components/PlayerList.svelte):
   - Add two optional props with safe defaults: `winsByName: Record<string, number> = {}` and `lastRoundWinner: string | null = null`.
   - For each row (including the host row), look up the player's display name in `winsByName`:
     - If `winsByName[name] > 0`, render a `<span class="win-count">` next to the name reading `×{count}` (e.g., `×2`). Place it between the player name and any existing pill (`host-pill` / `you-pill`).
     - If `name === lastRoundWinner`, render a `<span class="last-round-pill">Last round ✓</span>` after the win-count but before `host-pill` / `you-pill`.
   - Host row lookup: use `hostName ?? ''` as the key (already displayed as `{hostName ?? 'Host'}`). If `hostName` is null, skip both indicators.
   - Styling:
     - `.win-count`: font-size 0.75rem, color `#888`, padding `0 6px` (subtle — the AC emphasizes "no one feels tracked for losses", so downplay visually).
     - `.last-round-pill`: padding `2px 8px`, background `#2a2a2a`, color `#1db954`, font-size 0.6875rem, font-weight 700, border-radius 9999px, letter-spacing 0.02em (matches existing pill shape, with accent green to signal "just won").

9. **Wire stats through every `PlayerList` consumer.** Pass `winsByName={game.winsByName}`, `lastRoundWinner={game.lastRoundWinner}`, and `showStats={game.showStats}` from every call site:
   - [HostRoomPage.svelte:223](src/client/pages/HostRoomPage.svelte#L223): `<PlayersOverlay players={game.players} {hostName} selfName={null} winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} onClose={...} />`.
   - [RoomPage.svelte:118](src/client/pages/RoomPage.svelte#L118): same three props through `PlayersOverlay`.
   - [RoomPage.svelte:140](src/client/pages/RoomPage.svelte#L140): `<GuestWaitingRoom ... winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} />` — forward into its internal `PlayerList`.
   - [GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte): accept the three props and forward to its `<PlayerList ... />`.
   - [PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte): accept the three props and forward to `<PlayerList ... />`.
   - [LobbyPage.svelte:172](src/client/pages/LobbyPage.svelte#L172): pass `winsByName={{}} lastRoundWinner={null} showStats={false}` (lobby is pre-round; stats always hidden). Explicit defaults make the contract clear — do NOT omit the props here.

10. **Display gate — stats only appear once round 2 has started.** One-off sessions must stay visually clean; leaderboard UI kicks in only when the host begins a second round.
    - In [gameState.svelte.ts](src/client/lib/gameState.svelte.ts): add `let highestRoundNumber = $state(0)`. In `processWsMessage` on `round:start`, set `highestRoundNumber = Math.max(highestRoundNumber, (data.roundNumber as number) ?? 0)`. Expose a derived `showStats = $derived(highestRoundNumber >= 2)` and a `get showStats()` on the returned object. Do NOT reset `highestRoundNumber` on `round:end`; reset naturally via `cleanup()` / fresh `createGameState` call on a new session.
    - In [PlayerList.svelte](src/client/components/PlayerList.svelte): add a third optional prop `showStats: boolean = false`. If `!showStats`, never render `.win-count` or `.last-round-pill` regardless of `winsByName` / `lastRoundWinner` contents. Keep the props on the component — the server is still mutating and broadcasting stats so the data must flow through; only rendering is gated.
    - Every `PlayerList` consumer from AC #9 forwards `showStats={game.showStats}` (or `showStats={false}` explicitly for `LobbyPage`, which has no `game`).
    - Expected behavior:
      - Round 1 active, no wins yet → `highestRoundNumber = 1`, `showStats = false`. No counts, no pills.
      - Round 1 wins, winner dismisses overlay, host never starts another round (one-off game) → `highestRoundNumber` still `1`, `showStats` still `false`. Players List shows nothing new. Game closes clean.
      - Host starts round 2 → `highestRoundNumber = 2`, `showStats = true`. Round 1's winner appears with `×1` + `Last round ✓` immediately on round:start.
      - Round 2 produces a new winner → `stats:updated` fires, `Last round ✓` moves, both winners show `×N`.
      - Round 2 produces the same winner as round 1 → that player goes to `×2` + `Last round ✓`.
    - Late-joiner joining during round 2: receives `session:connect` (stats data, gate still false), then receives the replayed `round:start` with `roundNumber = 2` → gate flips true → stats render immediately.
    - Late-joiner joining between rounds (round 1 ended, round 2 not yet started): receives `session:connect` with stats but no `round:start` → gate stays false. When host starts round 2, they get `round:start` with `roundNumber = 2` → gate flips, stats render. Correct.

11. **Regression + new tests.**
    - `npm run lint` (tsc --noEmit) clean.
    - `npm test` green.
    - Add unit tests in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) inside `describe('POST /api/rooms/:code/round/claim', ...)`:
      - **`stats:updated broadcast follows round:win`** — after a valid claim, the captured `sent` array contains BOTH a `round:win` and a `stats:updated` message (in that order), and the `stats:updated.winsByName[playerName] === 1`, `stats:updated.lastRoundWinner === playerName`.
      - **`winsByName increments across multiple wins`** — set `roomState.sessionStats.winsByName['Alice'] = 1` before the claim; after a second valid Alice claim (re-seed a fresh active round on the same `roomState`), the broadcast shows `winsByName.Alice === 2`.
    - No new tests are required for the client wiring; existing Svelte component tests do not cover `PlayerList` visually. Manual check for the UI.
    - **Manual:**
      - One-off game: host starts round 1, someone wins, overlay dismissed, no round 2. PlayersOverlay shows NO win counts and NO `Last round ✓`.
      - Two-round session: round 1 wins, host starts round 2 → stats appear immediately (`×1` + `Last round ✓` for round 1's winner). Round 2 produces a new winner → `Last round ✓` moves, both winners show `×N`.
      - Same-winner-twice: counts go to `×2` after round 2 starts and Alice wins again.
      - Late-join guest during round 2: sees existing counts on first render.
      - Late-join guest BETWEEN round 1 and round 2: sees no stats until host starts round 2.
      - Delete room and create a fresh one: Players List starts empty and gate is closed.
      - Host win is counted and displayed on the host row just like a guest win (once round 2 has started).

## Tasks / Subtasks

- [x] **Server: `SessionStats` type + `RoomState` field** (AC #1)
  - [x] Add `SessionStats` interface in [src/server/ws.ts](src/server/ws.ts).
  - [x] Add `sessionStats: SessionStats` to `RoomState`.
  - [x] Initialize `sessionStats` at every `roomSockets.set(code, { ... })` call site (host WS connect, guest WS connect, `rehydrateRooms`, any room-create path in `rooms.ts`).

- [x] **Server: increment stats on valid claim** (AC #2)
  - [x] In [rooms.ts](src/server/rooms.ts) `/round/claim` handler, between `round.active = false` and the `round:win` broadcast, increment `sessionStats.winsByName[playerName]` and set `lastRoundWinner = playerName`.

- [x] **Server: broadcast `stats:updated`** (AC #3)
  - [x] After the existing `round:win` broadcast, call `broadcast(code, { type: 'stats:updated', winsByName: { ...roomState.sessionStats.winsByName }, lastRoundWinner: roomState.sessionStats.lastRoundWinner })`.

- [x] **Server: include stats in `session:connect` payloads** (AC #4)
  - [x] Host path: append `winsByName`, `lastRoundWinner` to the `session:connect` message.
  - [x] Guest path: same.

- [x] **Client: `gameState` stats state + `stats:updated` handler** (AC #6)
  - [x] Add `winsByName`, `lastRoundWinner` state in [gameState.svelte.ts](src/client/lib/gameState.svelte.ts).
  - [x] Handle `stats:updated` in `processWsMessage`.
  - [x] Expose getters and setters on the returned object.
  - [x] Confirm they are NOT reset in `round:start` or `resetRound`.

- [x] **Client: seed stats from `session:connect`** (AC #7)
  - [x] Host: wire in [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) `session:connect` handler.
  - [x] Guest: extend `GuestHandlers.onConnect` signature in [ws.ts](src/client/lib/ws.ts) to pass `winsByName` + `lastRoundWinner`.
  - [x] Add `initialWinsByName` / `initialLastRoundWinner` params to `createGameState` in [gameState.svelte.ts](src/client/lib/gameState.svelte.ts); use them as initial state.
  - [x] Add `initialWinsByName` / `initialLastRoundWinner` props to [RoomPage.svelte](src/client/pages/RoomPage.svelte) and pass them into `createGameState`.
  - [x] Forward the new args from the `connectAsGuest` call site (trace from [JoinPage.svelte](src/client/pages/JoinPage.svelte) or whatever component owns the guest WS boot) into `RoomPage`'s new props.

- [x] **Client: `PlayerList` renders counts + last-round pill** (AC #8)
  - [x] Add `winsByName` + `lastRoundWinner` props with safe defaults in [PlayerList.svelte](src/client/components/PlayerList.svelte).
  - [x] Render `×N` inline after player name when count > 0 (host row too).
  - [x] Render `Last round ✓` pill when name === lastRoundWinner.
  - [x] Add CSS for `.win-count` and `.last-round-pill`.

- [x] **Client: forward stats through every consumer** (AC #9)
  - [x] [PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte): accept + forward.
  - [x] [GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte): accept + forward.
  - [x] [HostRoomPage.svelte:223](src/client/pages/HostRoomPage.svelte#L223): pass from `game`.
  - [x] [RoomPage.svelte:118](src/client/pages/RoomPage.svelte#L118): pass from `game`.
  - [x] [RoomPage.svelte:140](src/client/pages/RoomPage.svelte#L140): pass from `game` into `GuestWaitingRoom`.
  - [x] [LobbyPage.svelte:172](src/client/pages/LobbyPage.svelte#L172): pass explicit empty defaults.

- [x] **Tests** (AC #11)
  - [x] [rooms.test.ts](src/server/__tests__/rooms.test.ts): `stats:updated` broadcast follows `round:win` with correct shape.
  - [x] [rooms.test.ts](src/server/__tests__/rooms.test.ts): winsByName increments across multiple wins for the same player.

- [x] **Client: display gate via highestRoundNumber** (AC #10)
  - [x] Add `highestRoundNumber` state + `showStats` derived in [gameState.svelte.ts](src/client/lib/gameState.svelte.ts); expose `get showStats()`.
  - [x] Update `highestRoundNumber` from every `round:start` via `Math.max`.
  - [x] Add `showStats: boolean = false` prop to [PlayerList.svelte](src/client/components/PlayerList.svelte); gate both indicators behind it.

### Review Findings

- [x] [Review][Patch] Clear `lastRoundWinner` on `/round/end` when the round ends without a winner [src/server/rooms.ts] — applied: `/round/end` handler sets `sessionStats.lastRoundWinner = null` and broadcasts `stats:updated` after `round:end`. Existing `round:end` test updated to `sent.length === 2`; new test asserts `lastRoundWinner` cleared and `winsByName` preserved.
- [x] [Review][Patch] Add client-side `hasStats` flag so the stats gate closes after rehydrate [src/client/lib/gameState.svelte.ts] — applied: `hasStats` initializes from non-empty `initialWinsByName`/`initialLastRoundWinner`, flips to true on any `stats:updated`, and is also flipped by the `winsByName`/`lastRoundWinner` setters when assigned a non-empty value (host seed path). `showStats = $derived(hasStats && highestRoundNumber >= 2)`.
- [x] [Review][Defer] Display-name collision: guest named same as host double-counts wins on both rows [src/client/components/PlayerList.svelte:33-56] — deferred, pre-existing. If a guest joins with the same name as `host_name`, `winsByName[name]` increments once but the PlayerList renders BOTH the host row and the guest row with the same `×N` and `Last round ✓`. Root cause is the project-wide identity-by-display-name pattern, which Dev Notes explicitly defers ("No player-ID refactor — identity-by-display-name is the established project pattern; a refactor is deferred").

- [ ] **Manual verification** (Philip)
  - [ ] **One-off game**: round 1 only → NO counts, NO `Last round ✓` anywhere.
  - [ ] Round 2 starts → round 1's winner immediately shows `×1` + `Last round ✓`.
  - [ ] Two rounds, different winners: second winner gets `Last round ✓`, first keeps `×1`.
  - [ ] Same winner twice: count goes to `×2`, keeps `Last round ✓`.
  - [ ] Late-join guest during round 2 sees existing stats on first render.
  - [ ] Late-join guest between rounds 1 and 2 sees NO stats until round 2 starts.
  - [ ] Delete room and create a fresh one: Players List starts empty, gate closed.
  - [ ] Host win is counted and displayed on the host row (visible only after round 2 starts).

## Dev Notes

- **One-off games stay clean.** The display gate (AC #10) is the explicit answer to "don't clutter single-round games". The server still tracks and broadcasts stats on every win — only the client rendering is gated on `highestRoundNumber >= 2`. This keeps the server contract simple and makes the gate a one-line flip if product decides to surface stats earlier later.
- **Identity keying.** Wins are keyed by the `playerName` string passed to `/round/claim`. This follows the project-wide pattern (see 8-1 Review Findings: raw display name is the stable key across join/claim/tile-mark). Do NOT introduce player IDs here — that cleanup is a dedicated future pass.
- **Host wins count.** The host is a full player in the session model — `room.host_name` is used as the claim `playerName` for host bingos, and the Players List already surfaces the host row. The same `winsByName[hostName]++` path covers host wins without any branching. Verify the manual check step.
- **No persistence.** Stats live only on in-memory `RoomState`. `persistRoomState` serializes `currentRound` (not `RoomState`-level fields), so `sessionStats` is naturally excluded. `rehydrateRooms` initializes `sessionStats` to empty — this is acceptable per the epic AC ("never persisted to SQLite").
- **Ordering matters.** Emit `stats:updated` AFTER `round:win` so clients already have `game.winData` set before the Players List re-renders. This avoids any brief inconsistency in what `PlayersOverlay` shows if the overlay is already open when the win fires.
- **WIP scope.** Continuous Mode (8-3) will eventually generate multiple wins per session naturally. For this story, a fresh round must start manually between wins (same as today). No changes to round-start flow.
- **Previous story patterns (8-1).**
  - `AudioPreset` added a new RoundConfig field with fallback defaults at every read site — mirror that defensiveness: every `data.winsByName` read on the client uses `?? {}`, every `data.lastRoundWinner` read uses `?? null`.
  - 8-1 flipped a default from `'hype'` to `'minimal'` as a review correction — when wiring tests and fixtures, keep `winsByName: {}` and `lastRoundWinner: null` as the canonical "empty" literal so grep and future diffs are consistent.
  - 8-1 added a `{:else}` catch-all to `WinOverlay`'s variant branch. Mirror: the `PlayerList` rendering should degrade gracefully when `winsByName` is somehow undefined — the default prop value (`= {}`) handles this.
- **Test seed pattern.** `seedActiveRound` + `roomState.host = { readyState: 1, send: (msg) => sent.push(msg) }` is the established fake-WS pattern for capturing broadcasts ([rooms.test.ts:1485-1486](src/server/__tests__/rooms.test.ts#L1485-L1486)). Reuse it.

### Project Structure Notes

- No new files. All changes edit existing files: [src/server/ws.ts](src/server/ws.ts), [src/server/rooms.ts](src/server/rooms.ts), [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts), [src/client/lib/ws.ts](src/client/lib/ws.ts) (only if the guest `onConnect` signature path is chosen), [src/client/components/PlayerList.svelte](src/client/components/PlayerList.svelte), [src/client/components/PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte), [src/client/components/GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte), [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte), [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte), [src/client/pages/LobbyPage.svelte](src/client/pages/LobbyPage.svelte), [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts).
- No DB migration. SQLite schema untouched.
- No changes to `persistRoomState` — `sessionStats` lives on `RoomState`, which is not part of the persisted snapshot.

### References

- Epic + acceptance criteria: [epics.md#Story 8-2: Session Statistics](_bmad-output/planning-artifacts/epics.md#L1306-L1342)
- Sprint change proposal (Relaxed Play cluster): [sprint-change-proposal-2026-04-14.md#L90-L93](_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-14.md#L90)
- Prior story for WS-event-extension pattern: [8-1-win-moment-hold-and-audio-presets.md](_bmad-output/implementation-artifacts/8-1-win-moment-hold-and-audio-presets.md)
- Claim endpoint that fires `round:win`: [rooms.ts:511-576](src/server/rooms.ts#L511-L576)
- `RoomState` + `broadcast` helper: [ws.ts:55-65](src/server/ws.ts#L55-L65), [ws.ts:143-155](src/server/ws.ts#L143-L155)
- Player list component: [PlayerList.svelte](src/client/components/PlayerList.svelte)
- `createGameState` WS dispatch: [gameState.svelte.ts:127-181](src/client/lib/gameState.svelte.ts#L127-L181)

## Scope — Explicitly OUT

- **No Continuous Mode** (8-3) — countdown, auto-start, round:countdown / round:autostart events are a later story.
- **No Casual Mode** (8-4, 8-5) — no ☕ indicator, no auto-mark, no `square:auto-marked` event.
- **No loss counts** — only wins. The Players List must never show anything that implies how often a player lost.
- **No SQLite persistence** — stats reset on server restart; documented and acceptable.
- **No stats aggregation across sessions** — a new room starts from zero even if the same host/guests are present.
- **No stats on the lobby screen** (pre-round): explicitly pass empty defaults from `LobbyPage` to preserve the current visual state.
- **No change to the `round:win` payload shape** — stats ride in a separate `stats:updated` event.
- **No player-ID refactor** — identity-by-display-name is the established project pattern; a refactor is deferred as in 8-1 review findings.
- **No keyboard / a11y work** on the new indicators beyond what the existing pills already do (project-wide a11y deferral).

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (Claude Code)

### Debug Log References

- `npm run lint` — clean (tsc --noEmit, 0 errors).
- `npm test` — 334/334 passing across 17 test files.

### Completion Notes List

- **Server**: Added `SessionStats` interface + `emptySessionStats()` helper in [ws.ts](src/server/ws.ts). `RoomState` now carries `sessionStats: SessionStats` and every `roomSockets.set` call site (host connect, guest connect, `rehydrateRooms`) initializes it. `destroyRoom` drops the room entry, so stats vanish automatically on session end (verified — no extra code needed).
- **Claim endpoint**: [rooms.ts:562-583](src/server/rooms.ts#L562-L583) now increments `sessionStats.winsByName[playerName]` and sets `lastRoundWinner = playerName` after `round.active = false`, then emits a second broadcast `stats:updated` right after `round:win` (host + guest view both update).
- **session:connect payload**: Host and guest paths in [ws.ts handleConnection](src/server/ws.ts) now include `winsByName` (shallow-cloned) and `lastRoundWinner`. Late joiners see existing stats on their first Players List render.
- **Client state**: [gameState.svelte.ts](src/client/lib/gameState.svelte.ts) gained `winsByName`, `lastRoundWinner`, `highestRoundNumber` state plus a derived `showStats = highestRoundNumber >= 2`. `processWsMessage` now handles `stats:updated` and tracks `highestRoundNumber` via `Math.max` on every `round:start`. None of the new fields reset on `round:start`/`resetRound` — stats persist across rounds within a session. `createGameState` takes optional `initialWinsByName` / `initialLastRoundWinner` for the guest `session:connect` seed path.
- **Guest seed chain**: Extended `GuestHandlers.onConnect` to 5 args (+ `winsByName`, `lastRoundWinner`). `connectAsGuest` forwards `data.winsByName ?? {}` / `data.lastRoundWinner ?? null`. [JoinPage.svelte](src/client/pages/JoinPage.svelte) → [App.svelte](src/client/App.svelte) `handleJoined` → [RoomPage.svelte](src/client/pages/RoomPage.svelte) props → `createGameState` initials. Host path seeds directly from the `session:connect` branch in [HostRoomPage.svelte:156-163](src/client/pages/HostRoomPage.svelte#L156-L163).
- **PlayerList rendering + gate**: [PlayerList.svelte](src/client/components/PlayerList.svelte) now accepts `winsByName` / `lastRoundWinner` / `showStats` props (all defaulted). Both indicators (host row + guest rows) are gated behind `showStats` via `winCount()` / `isLastRoundWinner()` helpers — no rendering unless `showStats === true` and the count/name matches. Added `.win-count` (subtle grey) and `.last-round-pill` (green-on-charcoal) CSS.
- **Consumer wiring**: [PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte) and [GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte) accept the three props and forward to `PlayerList`. [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte), [RoomPage.svelte](src/client/pages/RoomPage.svelte) pass them from `game.winsByName` / `game.lastRoundWinner` / `game.showStats`. [LobbyPage.svelte:172](src/client/pages/LobbyPage.svelte#L172) passes explicit empty defaults (`{}` / `null` / `false`) — lobby is pre-round, stats always hidden.
- **Server tests**: Added two new tests in [rooms.test.ts](src/server/__tests__/rooms.test.ts) — (1) `stats:updated` broadcast follows `round:win` with correct shape; sent array length is now 2, with `winsByName`, `lastRoundWinner` populated; (2) pre-seeding `winsByName.Alice = 1` then a second valid Alice claim produces `winsByName.Alice === 2`. Updated three pre-existing claim tests that asserted `sent.length === 1` (now 2 due to the added `stats:updated` broadcast). Updated `seedRoom` helper to initialize `sessionStats` for the new required field. Updated `ws.test.ts` host `session:connect` expectations to include `winsByName: {}, lastRoundWinner: null`. Updated `join.test.ts` `onConnect` call assertions to the new 5-arg shape.
- **Manual verification** still pending (Philip to run): see the Tasks/Subtasks → Manual verification list for the full scenario matrix (one-off game, two rounds, same-winner-twice, late-join during/between rounds, fresh room after delete, host win).

### File List

- src/server/ws.ts (M) — `SessionStats` type, `emptySessionStats()` helper, `RoomState.sessionStats` field, initialization at all `roomSockets.set` sites, `winsByName` + `lastRoundWinner` added to host + guest `session:connect` payloads.
- src/server/rooms.ts (M) — `/round/claim` handler increments `sessionStats` and broadcasts `stats:updated` after `round:win`.
- src/server/__tests__/rooms.test.ts (M) — Added two new tests (stats broadcast + multi-win increment); updated three existing claim tests for new broadcast count; updated `seedRoom` helper.
- src/server/__tests__/ws.test.ts (M) — Updated two host `session:connect` assertions to include new fields.
- src/client/lib/gameState.svelte.ts (M) — New state (`winsByName`, `lastRoundWinner`, `highestRoundNumber`); derived `showStats`; `stats:updated` handler; `round:start` updates `highestRoundNumber`; new `initialWinsByName` / `initialLastRoundWinner` params; getters/setters on returned object.
- src/client/lib/ws.ts (M) — `GuestHandlers.onConnect` extended to 5 args; `connectAsGuest` forwards `winsByName` + `lastRoundWinner`.
- src/client/__tests__/join.test.ts (M) — Updated `onConnect` mock assertions to 5-arg shape.
- src/client/pages/JoinPage.svelte (M) — `onJoined` prop signature + call updated to forward `winsByName` + `lastRoundWinner`.
- src/client/App.svelte (M) — `guestWinsByName` / `guestLastRoundWinner` state; `handleJoined` signature updated; props passed to `RoomPage`.
- src/client/pages/RoomPage.svelte (M) — `initialWinsByName` / `initialLastRoundWinner` props; passed to `createGameState`; forwarded to `PlayersOverlay` and `GuestWaitingRoom`.
- src/client/pages/HostRoomPage.svelte (M) — `session:connect` branch seeds `game.winsByName` / `game.lastRoundWinner`; forwarded to `PlayersOverlay`.
- src/client/pages/LobbyPage.svelte (M) — explicit empty `winsByName={{}}`, `lastRoundWinner={null}`, `showStats={false}` on `PlayerList`.
- src/client/components/PlayerList.svelte (M) — new `winsByName` / `lastRoundWinner` / `showStats` props; `×N` count + `Last round ✓` pill rendering (host + guest rows) gated behind `showStats`; new `.win-count` / `.last-round-pill` CSS.
- src/client/components/PlayersOverlay.svelte (M) — accepts + forwards the three new props.
- src/client/components/GuestWaitingRoom.svelte (M) — accepts + forwards the three new props.

### Change Log

- 2026-04-14 — Story 8-2 implemented. Server-side session stats (`SessionStats` type, `stats:updated` broadcast, `session:connect` seed) plus client-side `PlayerList` win counts + "Last round ✓" pill gated behind `highestRoundNumber >= 2`. Host wins counted identically to guest wins via display-name keying. No SQLite persistence; stats reset with the room.
- 2026-04-14 — Code review findings applied: (1) `/round/end` now clears `sessionStats.lastRoundWinner` and broadcasts `stats:updated`, preventing stale "Last round ✓" pill after a no-winner round; (2) client `showStats` gate strengthened with a `hasStats` flag so post-rehydrate reconnects no longer flip the PlayerList into misleading "all zeros" stats mode. One guest-host display-name-collision finding deferred (identity-by-display-name is a project-wide pattern, player-ID refactor explicitly deferred).
