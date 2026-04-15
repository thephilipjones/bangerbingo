# Story 8.5: Casual Mode — Auto-Mark Engine

Status: done

## Story

As a player with Casual Mode on,
I want my squares to be automatically marked whenever a track changes,
so that I'm never behind just because I looked away.

## Background

**What Story 8-4 delivered:** The permission gate and toggle plumbing. `RoundConfig.allowCasualMode`, `RoomState.playerCasualModes: Map<string, boolean>`, the `player:casual-mode-changed` guest WS message, the Round Config "Allow Casual Mode" toggle, the guest toggle row, the ☕ indicator, and `casualModeNames` seeding through `session:connect`. **No auto-marking logic yet.**

**What this story delivers:** The actual sweep engine. On every track change the server looks at each player with `casualMode: true`, computes which of their tiles match a song in `played_history` (excluding `current_song`), and emits a direct `square:auto-marked` WS event to that player with the list of newly marked tile indices. Plus a catch-up sweep when a player enables Casual Mode mid-round or reconnects with it already on.

**Key architectural choice — indices, not track IDs.** The server sends tile *indices* on the player's card, not track IDs. The server already stores each player's card in [src/server/rooms.ts:324-337](src/server/rooms.ts#L324-L337) via `round.cards: Map<string, Tile[]>` (host key = `hostUserId`, guest key = `name`). Indices let the client apply marks without re-matching trackId against the card, and they let the server track which tiles have already been swept per player without any client-side bookkeeping.

**"Played history" on the server = `round.songHistory`.** Currently [src/server/rooms.ts:115-124](src/server/rooms.ts#L115-L124) pushes a `SongHistoryEntry { trackId, ... }` onto `round.songHistory` each time `startSong` starts a genuinely new song (not a resume). `round.currentSongIndex` points into `round.playlist`, so `round.playlist[round.currentSongIndex].id` is the current track's ID. All trackIds in `round.songHistory` OTHER than the current one are "played_history — current_song".

**Track change trigger point.** `startSong` is the single chokepoint for both natural progression (via `advanceToNext` at [rooms.ts:180-191](src/server/rooms.ts#L180-L191)) and host skip (via `POST /rooms/:code/round/advance` which calls `advanceToNext`). Hook the sweep into `startSong` at exactly the branch where `round.currentSongIndex !== songIndex` — i.e. when it's a real track change, not a resume from pause. This gives identical behavior for natural and skip (AC #4).

**Per-player "already swept" tracking.** Add `autoMarkedTileIndices: Map<string, Set<number>>` to `RoundState`. The sweep only emits tile indices that are NOT already in the player's set, and adds newly-emitted indices back. This makes sweeps idempotent across repeat track changes, reconnects, and catch-up flows, and gives the "newly marked tile indices" semantics the epic requires (not "all matching").

**Server does NOT know client-side manual marks.** Client-side manual marks live only in browser `localStorage` (via `onTileMark` in [RoomPage.svelte:62-66](src/client/pages/RoomPage.svelte#L62-L66)). If a player manually marked tile 7 and the server sweeps tile 7 as auto-mark, the client must treat it as idempotent — a tile that is already `marked` stays `marked` and no state change is visible. The server still emits the index (doesn't know manual state), and the client handler is a no-op for already-marked tiles. Epic AC #5 ("tile state unchanged, no duplicate mark event") is satisfied because no *new* event fires from client side; the server's emission is not observable as "duplicate" because the client renders it once.

**Direct send, not broadcast.** `square:auto-marked` is addressed to a single player (the one whose card was swept). Use the player's WebSocket directly — do not call `broadcast(...)`. This prevents leaking other players' card indices and keeps the event small.

**Host is NOT a Casual Mode user in this story.** Story 8-4 wired the toggle only via the guest WS path; there is no way for the host to enable their own `playerCasualModes` entry. The sweep iterates only over guest entries. A future story could add host Casual Mode; out of scope here.

**Reconnect behavior.** When a guest reconnects while Casual Mode is still on (their name is in `roomState.playerCasualModes` with `true`), the server should run a catch-up sweep against the newly attached socket so the reconnected client (especially on a fresh device with empty localStorage) gets re-synced. To guarantee correctness across devices, **clear the player's entry from `autoMarkedTileIndices` on guest disconnect** so the post-reconnect sweep re-emits every eligible tile. Client-side dedupe via `restoreMarks` + idempotent handler keeps visual noise away on the original device.

**Client auto-claim.** Epic AC #7 says "the auto-mark can produce a valid win." The current manual-claim flow requires the player to tap "Bingo!" — which defeats the purpose of Casual Mode ("I can enjoy the game socially without staring at my phone"). Add client-side auto-claim: when `game.hasBingo` becomes true AND `casualModeOn === true` AND we haven't already auto-claimed this round, call `game.handleBingoClick()` automatically. A small delay (~600 ms) lets the auto-mark animation land before the win overlay fires.

**Late-join path (AC #6) — enable mid-session OR join with Casual Mode already on.** Two cases:
1. **Mid-session enable:** Player toggles Casual Mode on via the normal button — `player:casual-mode-changed {enabled: true}` arrives at the server, which runs a catch-up sweep and emits `square:auto-marked {catchUp: true}` with all matching indices. Client shows toast.
2. **Reconnect with Casual Mode already on:** Server detects `playerCasualModes.get(name) === true` at guest WS attach time, runs a catch-up sweep targeting the new `ws` directly, sends `square:auto-marked {catchUp: true}`. Client shows toast.

Both cases produce the same WS event shape; only the trigger differs.

## Acceptance Criteria

1. **`RoundState.autoMarkedTileIndices` map.** In [src/server/ws.ts](src/server/ws.ts):
   - Add `autoMarkedTileIndices: Map<string, Set<number>>` to `RoundState` interface (after `timers`).
   - Not persisted — do NOT add to `persistRoomState` snapshot nor `rehydrateRooms` reconstruction. On server restart, rehydrated rounds start with `autoMarkedTileIndices: new Map()`.
   - Add the field to every `RoundState` construction site:
     - [rooms.ts:324-337](src/server/rooms.ts#L324-L337) in `startRound`: initialize `autoMarkedTileIndices: new Map()`.
     - [ws.ts:144-157](src/server/ws.ts#L144-L157) in `rehydrateRooms` currentRound reconstruction: add `autoMarkedTileIndices: new Map()`.
     - Any test fixtures that construct a `RoundState` directly (e.g. [rooms.test.ts:702-711](src/server/__tests__/rooms.test.ts#L702-L711)): add `autoMarkedTileIndices: new Map()`.

2. **`runCasualModeSweep` helper in [src/server/rooms.ts](src/server/rooms.ts).** New exported function, placed next to `startSong`:
   ```ts
   export function runCasualModeSweep(
     code: string,
     roomState: RoomState,
     options: { playerName?: string; isCatchUp?: boolean } = {}
   ): void {
     const round = roomState.currentRound
     if (!round || !round.active) return

     const currentTrackId = round.currentSongIndex >= 0
       ? round.playlist[round.currentSongIndex]?.id ?? null
       : null
     const playedIds = new Set(
       round.songHistory
         .map(e => e.trackId)
         .filter(id => id !== currentTrackId)
     )
     if (playedIds.size === 0) return

     const targetNames = options.playerName
       ? [options.playerName]
       : Array.from(roomState.playerCasualModes.entries())
           .filter(([, v]) => v)
           .map(([k]) => k)

     for (const name of targetNames) {
       if (roomState.playerCasualModes.get(name) !== true) continue
       const ws = roomState.guests.get(name)
       if (!ws || ws.readyState !== WebSocket.OPEN) continue

       const card = round.cards.get(name)
       if (!card) continue

       let alreadySwept = round.autoMarkedTileIndices.get(name)
       if (!alreadySwept) {
         alreadySwept = new Set<number>()
         round.autoMarkedTileIndices.set(name, alreadySwept)
       }

       const newIndices: number[] = []
       for (let i = 0; i < card.length; i++) {
         if (i === 12) continue                     // FREE space
         if (alreadySwept.has(i)) continue
         if (playedIds.has(card[i].trackId)) {
           alreadySwept.add(i)
           newIndices.push(i)
         }
       }

       if (newIndices.length === 0) continue
       try {
         ws.send(JSON.stringify({
           type: 'square:auto-marked',
           tileIndices: newIndices,
           catchUp: options.isCatchUp === true,
         }))
       } catch { /* ignore broken socket */ }
     }
   }
   ```
   - Import `WebSocket` from `'ws'` at top of `rooms.ts` if not already imported.
   - Skip FREE space (index 12) explicitly even though its trackId is `''` and will never match — defensive.
   - Emit nothing if `newIndices.length === 0`: this covers "no tiles match" and "already swept everything" (prevents spurious empty events on repeat sweeps).

3. **Hook sweep into `startSong` on real track changes.** In [rooms.ts:104-177](src/server/rooms.ts#L104-L177):
   - Inside the `if (round.currentSongIndex !== songIndex)` branch at [rooms.ts:115-124](src/server/rooms.ts#L115-L124), this is the authoritative "new song" signal. BUT: `round.currentSongIndex` gets reassigned on line 125 to the new index, so the sweep must use the already-updated value to correctly compute "current song".
   - Place the sweep call **after** `persistRoomState(code)` at line 142 and **before** the Spotify fire-and-forget at line 145, but guarded by a local `isTrackChange` boolean captured at the top of the `if` branch:
     ```ts
     let isTrackChange = false
     if (round.currentSongIndex !== songIndex) {
       isTrackChange = true
       const entry: SongHistoryEntry = { ... }
       round.songHistory.push(entry)
     }
     round.currentSongIndex = songIndex
     // ... existing broadcast + persist ...
     if (isTrackChange) runCasualModeSweep(roomCode, roomState)
     ```
   - Do NOT sweep on resume from pause — that's the `currentSongIndex === songIndex` path and no history change has occurred.
   - On the very first song (previous index `-1`, new index `0`): `isTrackChange = true`, but `playedIds` excludes the new current song, so the sweep finds zero matches and emits nothing. Correct.

4. **Per-player sweep on `player:casual-mode-changed` enable.** In [src/server/ws.ts:408-414](src/server/ws.ts#L408-L414), after the broadcast:
   - Import `runCasualModeSweep` from `./rooms.ts`.
   - If `msg.enabled === true`, call `runCasualModeSweep(code, r, { playerName: name, isCatchUp: true })` **after** the broadcast.
   - If `msg.enabled === false`, also clear the player's auto-marked tracking so a later re-enable re-sweeps everything: `if (r.currentRound) r.currentRound.autoMarkedTileIndices.delete(name)`.

5. **Catch-up sweep on reconnect.** In [src/server/ws.ts:383-395](src/server/ws.ts#L383-L395) (guest WS attach path), after sending `round:start` on reconnect into an active round:
   - If `roomState.playerCasualModes.get(name) === true`, call `runCasualModeSweep(code, roomState, { playerName: name, isCatchUp: true })`.
   - Must be called AFTER the `ws.send(round:start)` so the client has the card before the auto-mark event arrives.

6. **Clear per-player auto-marks on guest disconnect.** In [src/server/ws.ts:418-425](src/server/ws.ts#L418-L425) (guest `ws.on('close')` handler):
   - Before/after `r.guests.delete(name)`, also clear `r.currentRound?.autoMarkedTileIndices.delete(name)`.
   - This guarantees the next reconnect's catch-up sweep will re-emit every eligible tile, so a fresh-device reconnect is never left without its auto-marks.
   - Do NOT clear `r.playerCasualModes.get(name)` — the casual-on state persists across reconnects as a guest-visible setting (the ☕ indicator stays visible to other players while they're disconnected). This matches 8-4's existing semantics.

7. **Reset `autoMarkedTileIndices` on new round.** `startRound` in [rooms.ts:279-355](src/server/rooms.ts#L279-L355) already resets `playerCasualModes` at line 309. Initialize `autoMarkedTileIndices: new Map()` as part of the `currentRound` object construction (AC #1). Nothing extra needed here beyond AC #1.

8. **Client — `square:auto-marked` handling in [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts).**
   - Add a new branch in `processWsMessage` after the `player:casual-mode-changed` branch:
     ```ts
     } else if (data.type === 'square:auto-marked') {
       const indices = (data.tileIndices as number[]) ?? []
       if (indices.length === 0) return
       tiles = applyAutoMarks(tiles, indices)
       onTileMark?.(tiles)
       if (data.catchUp === true) {
         catchUpToastCount = indices.length
         catchUpToastId = (catchUpToastId ?? 0) + 1   // forces $effect re-run
       }
     }
     ```
   - Add local state: `let catchUpToastCount = $state<number | null>(null)`, `let catchUpToastId = $state<number | null>(null)`.
   - Expose as getters: `get catchUpToastCount() { return catchUpToastCount }`, `get catchUpToastId() { return catchUpToastId }`, and `clearCatchUpToast() { catchUpToastCount = null }`.
   - **Reset on `round:start`:** add `catchUpToastCount = null; catchUpToastId = null` inside the existing `round:start` branch.

9. **Client — `applyAutoMarks` helper in [src/client/lib/bingo.ts](src/client/lib/bingo.ts).** New exported function, near `toggleMark`:
   ```ts
   export function applyAutoMarks(tiles: ClientTile[], indices: number[]): ClientTile[] {
     if (indices.length === 0) return tiles
     const idx = new Set(indices)
     return tiles.map((tile, i) => {
       if (!idx.has(i)) return tile
       if (tile.free) return tile
       if (tile.state === 'marked') return tile     // idempotent — no duplicate re-animation
       return { ...tile, state: 'marked' as const, autoMarked: true }
     })
   }
   ```
   - Add `autoMarked: boolean` to the `ClientTile` interface (defaults to `false`).
   - Update `initTiles` to set `autoMarked: false` on every tile.
   - `toggleMark` does not modify `autoMarked` (manual toggle stays manual; auto-marks stay auto-marked). When unmarking a manually-marked tile that was not auto-marked, no change. Hand-marks unrelated.

10. **Client — `BingoCard.svelte` soft animation for auto-marks.** In [src/client/components/BingoCard.svelte](src/client/components/BingoCard.svelte):
    - On the `<button class="tile">` element, add `class:auto-marked={tile.autoMarked}` alongside `class:marked={tile.state === 'marked'}`.
    - Add CSS for the softer animation (respect `prefers-reduced-motion`):
      ```css
      @keyframes auto-mark-sweep {
        0%   { transform: scale(1);   opacity: 1; }
        30%  { transform: scale(0.94); opacity: 0.7; }
        100% { transform: scale(1);   opacity: 1; }
      }
      .tile.auto-marked {
        animation: auto-mark-sweep 520ms ease-out 120ms both;
      }
      @media (prefers-reduced-motion: reduce) {
        .tile.auto-marked { animation: none; }
      }
      ```
    - The delay (`120ms`) and duration (`520ms`) produce a visually distinct, softer/slower mark vs. a manual tap (which has no animation today). No new color — the existing `.tile.marked` green carries the final state.

11. **Client — catch-up toast in [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte).**
    - Add local state: `let toastMessage = $state<string | null>(null); let toastTimer: ReturnType<typeof setTimeout> | undefined`.
    - Add `$effect(() => { const id = game.catchUpToastId; if (id === null || id === undefined) return; const count = game.catchUpToastCount ?? 0; if (count <= 0) return; toastMessage = \`Caught up on ${count} song${count === 1 ? '' : 's'}\`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastMessage = null; game.clearCatchUpToast() }, 3000) })`.
    - Render in the template above or below `.status-line`:
      ```html
      {#if toastMessage}
        <div class="casual-toast" role="status" aria-live="polite">{toastMessage}</div>
      {/if}
      ```
    - CSS:
      ```css
      .casual-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #2a2a2a;
        border: 2px solid #1db954;
        color: #1db954;
        padding: 10px 18px;
        border-radius: 999px;
        font-size: 14px;
        z-index: 50;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      }
      ```
    - Cleanup in `onDestroy`: `clearTimeout(toastTimer)`.

12. **Client — auto-claim on Casual Mode bingo.** In [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte):
    - Add `let autoClaimFired = $state(false)`.
    - Reset to `false` in the `round:start` branch of `handleWsData` (alongside existing `casualModeOn = false`).
    - Add `$effect(() => { if (!casualModeOn) return; if (!game.hasBingo) return; if (autoClaimFired) return; if (game.isClaiming) return; autoClaimFired = true; setTimeout(() => { if (!game.isClaiming && game.winData === null) game.handleBingoClick() }, 600) })`.
    - The 600 ms delay lets the auto-mark animation finish before the win overlay takes over. If the user manages a faster manual tap, `isClaiming` will already be true and the auto-claim is a no-op.
    - `autoClaimFired` prevents re-fire within a round. Reset on `round:start`.
    - **HostRoomPage does NOT need auto-claim** — hosts don't have Casual Mode.

13. **Server tests** in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) (new `describe` block `'Casual Mode — Auto-Mark Engine'`):
    - **`sweep emits square:auto-marked on track change for enabled player`** — seed a round with a 3-track playlist, deal a card where a guest's card contains the first track. Enable casual mode via `roomState.playerCasualModes.set('Alice', true)`. Call `startSong` twice (index 0, then index 1). Assert guest WS receives `{ type: 'square:auto-marked', tileIndices: [N], catchUp: false }` where N is the index of the first track on Alice's card. Assert `round.autoMarkedTileIndices.get('Alice')` contains N.
    - **`sweep excludes current song`** — after startSong(0), assert no auto-mark event is sent (currentTrackId == track0, all other history is empty).
    - **`sweep does not emit for players with casual mode off`** — same setup, but Alice's casualMode is false. Assert no square:auto-marked sent to Alice.
    - **`sweep is idempotent — second sweep emits nothing`** — call `runCasualModeSweep` twice with no song change. Assert only one event emitted.
    - **`sweep on new round resets autoMarkedTileIndices`** — sweep tile N, POST /round for a new round, sweep again — Alice gets a fresh set (but Alice's casualMode was reset to false in 8-4, so re-enable before second sweep to cover both resets).
    - **`host skip triggers identical sweep`** — POST `/rooms/:code/round/advance` (skip) and assert the sweep emits.
    - **`newly marked indices exclude previously-swept indices`** — start song 0, start song 1 (sweeps index of song 0), start song 2 (sweeps index of song 1 only, NOT song 0 again).
    - **`FREE space (index 12) is never in tileIndices`** — not realistic in practice since trackId is empty, but assert defensive behavior.

14. **Server integration tests** in [src/server/__tests__/ws.test.ts](src/server/__tests__/ws.test.ts) (add to the existing `player:casual-mode-changed` describe or create a new `square:auto-marked` describe):
    - **`enabling Casual Mode mid-round triggers catch-up sweep`** — start a round, advance a song, guest sends `player:casual-mode-changed {enabled: true}`, assert guest receives `square:auto-marked {catchUp: true, tileIndices: [...]}`.
    - **`catch-up event carries catchUp: true`** — validate flag presence.
    - **`reconnecting with Casual Mode on triggers catch-up sweep`** — connect guest, enable casual, advance songs, disconnect guest WS, reconnect with same name, assert the new socket receives `square:auto-marked {catchUp: true}` after `round:start`.
    - **`disconnect clears autoMarkedTileIndices entry for that player`** — enable casual, advance songs so indices are swept, disconnect, assert `round.autoMarkedTileIndices.has('Alice') === false`.
    - **`disabling Casual Mode clears autoMarkedTileIndices entry`** — enable → sweep → disable → assert entry cleared; re-enable → full catch-up sweep fires.
    - **`square:auto-marked is NOT sent to other players`** — set up host + two guests, only Alice has Casual Mode on, advance songs. Assert Bob and the host receive no `square:auto-marked` message.

15. **Client tests.** No new client unit tests (manual verification covers Svelte). Update existing tests only if they break due to new fields (e.g. if any test asserts the full shape of `ClientTile` and now breaks on `autoMarked: false`).

16. **Manual verification checklist** (Philip):
    - Start a round with Allow Casual Mode = on. Guest A enables Casual Mode. Host advances through 3 songs. Assert Guest A's tiles corresponding to songs 1 and 2 flip to marked with the softer animation (song 3 stays unmarked because it's current). Guest B (no Casual Mode) sees no auto-marks on their own card.
    - Guest A enables Casual Mode mid-round (after song 3 has played) — assert a catch-up sweep runs, toast appears "Caught up on X songs", tiles animate softer than manual.
    - Toggle Casual Mode off on Guest A, advance another song, toggle Casual Mode on — toast fires again with full count (including previously-swept tiles).
    - Casual Mode + auto-mark produces a winning line — client auto-claims after ~600 ms, win overlay fires, winner is the Casual Mode player.
    - Reconnect Guest A (refresh page) with Casual Mode still on — catch-up sweep re-runs, tiles marked on the fresh localStorage reload (marks also persisted via `onTileMark`).
    - Host skip during a round — Guest A's auto-mark fires identically to natural progression.
    - Continuous Mode auto-starts a new round — `playerCasualModes` and `autoMarkedTileIndices` both reset; Guest A has to re-toggle Casual Mode for the next round.
    - `prefers-reduced-motion` browser setting — auto-mark animation is disabled, tile flips straight to marked state.
    - Host's card is never auto-marked (confirm host Players List still shows ☕ for casual guests but host's own card is not affected).
    - `npm run lint` clean; `npm test` green.

## Tasks / Subtasks

- [x] **Server: extend `RoundState` type** (AC: #1)
  - [x] Add `autoMarkedTileIndices: Map<string, Set<number>>` to `RoundState` in [ws.ts](src/server/ws.ts)
  - [x] Initialize `new Map()` in `startRound` in [rooms.ts](src/server/rooms.ts)
  - [x] Initialize `new Map()` in `rehydrateRooms` currentRound branch in [ws.ts](src/server/ws.ts)
  - [x] Update any test fixtures that construct `RoundState` directly
- [x] **Server: `runCasualModeSweep` helper** (AC: #2)
  - [x] Implement in [rooms.ts](src/server/rooms.ts) next to `startSong`
  - [x] Export so `ws.ts` can import for reconnect + toggle-enable paths
  - [x] Skip FREE space, skip already-swept indices, skip currentTrackId, skip closed sockets, skip no-op emits
- [x] **Server: hook sweep into `startSong`** (AC: #3)
  - [x] Capture `isTrackChange` boolean at the top of the `if (currentSongIndex !== songIndex)` branch
  - [x] Call `runCasualModeSweep(roomCode, roomState)` after broadcast + persist when `isTrackChange === true`
  - [x] Verify no sweep on resume-from-pause
- [x] **Server: sweep on `player:casual-mode-changed` enable, clear on disable** (AC: #4)
  - [x] Import `runCasualModeSweep` into [ws.ts](src/server/ws.ts)
  - [x] On enable: run sweep with `{ playerName: name, isCatchUp: true }` after broadcast
  - [x] On disable: clear `currentRound.autoMarkedTileIndices.delete(name)`
- [x] **Server: catch-up sweep on guest reconnect** (AC: #5)
  - [x] After `ws.send(round:start)` in guest reconnect branch in [ws.ts](src/server/ws.ts), if `playerCasualModes.get(name) === true`, call sweep with `{ playerName: name, isCatchUp: true }`
- [x] **Server: clear per-player auto-marks on disconnect** (AC: #6)
  - [x] In guest `ws.on('close')` handler in [ws.ts](src/server/ws.ts), delete the entry from `currentRound.autoMarkedTileIndices`
- [x] **Client: extend `ClientTile` + `applyAutoMarks` helper** (AC: #9)
  - [x] Add `autoMarked: boolean` to `ClientTile` interface in [bingo.ts](src/client/lib/bingo.ts)
  - [x] Default `autoMarked: false` in `initTiles`
  - [x] Implement `applyAutoMarks(tiles, indices)` — idempotent, skips FREE + already-marked
- [x] **Client: `gameState` handling** (AC: #8)
  - [x] Add `catchUpToastCount`, `catchUpToastId` state and getters + `clearCatchUpToast()` in [gameState.svelte.ts](src/client/lib/gameState.svelte.ts)
  - [x] Add `square:auto-marked` branch in `processWsMessage` — `applyAutoMarks`, persist via `onTileMark`, increment toast id
  - [x] Reset toast state in `round:start` branch
- [x] **Client: `BingoCard` soft animation** (AC: #10)
  - [x] Add `class:auto-marked={tile.autoMarked}` to the button
  - [x] Add `@keyframes auto-mark-sweep` and `.tile.auto-marked` CSS with `prefers-reduced-motion` guard
- [x] **Client: catch-up toast in `RoomPage`** (AC: #11)
  - [x] Add `toastMessage` state + `$effect` watching `game.catchUpToastId`
  - [x] Render `.casual-toast` block above/below `.status-line`
  - [x] Clean up timer in `onDestroy`
- [x] **Client: auto-claim on Casual Mode bingo** (AC: #12)
  - [x] Add `autoClaimFired` state in [RoomPage.svelte](src/client/pages/RoomPage.svelte)
  - [x] Reset in `round:start` branch of `handleWsData`
  - [x] Add `$effect` that fires `game.handleBingoClick()` on 600 ms delay when conditions met
- [x] **Server tests** (AC: #13, #14)
  - [x] Unit: sweep emits on track change, excludes current, off-state no-op, idempotent, host skip, monotonic-delta, new round reset
  - [x] WS integration: mid-round enable catch-up, reconnect catch-up, disconnect clears entry, disable clears entry, direct-send (no leak to other players)
  - [x] `npm run lint` clean, `npm test` green
- [x] **Manual smoke test** (AC: #16)
  - [x] Run through the full checklist above, two-device Tailscale setup

### Review Findings

- [x] [Review][Defer] Auto-claim latches permanently on failed claim — `autoClaimFired` only resets on `round:start`, so a failed claim (network blip, 5xx) locks out auto-claim for the rest of the round. Deferred: Epic 9 is about to minimize/remove the claim concept, so hardening this path would be wasted work. [src/client/pages/RoomPage.svelte:103-112](src/client/pages/RoomPage.svelte#L103-L112)
- [x] [Review][Dismiss] Auto-claim fires when Casual Mode is toggled on over a pre-existing bingo — confirmed as intended behavior; enabling Casual Mode over an existing bingo logically implies "claim it for me". Spec-faithful and acceptable.
- [x] [Review][Patch] Reconnect clobbers `casualModeOn` — fixed by gating the `round:start` reset on a `hasSeenRoundStart` flag so the first (reconnect) round:start preserves the seeded casual-mode state. [src/client/pages/RoomPage.svelte:117](src/client/pages/RoomPage.svelte#L117)
- [x] [Review][Patch] Catch-up toast lingers into the next round — fixed by clearing `toastTimer` and `toastMessage` in the `round:start` branch of `handleWsData`. [src/client/pages/RoomPage.svelte:114-135](src/client/pages/RoomPage.svelte#L114-L135)
- [x] [Review][Patch] Final song is never auto-marked on playlist exhaustion — fixed by running a terminal sweep with a new `includeCurrent: true` option in `runCasualModeSweep`, invoked from `advanceToNext` immediately before broadcasting `songs:exhausted`. [src/server/rooms.ts:253-263](src/server/rooms.ts#L253-L263)
- [x] [Review][Patch] Missing AC #13 unit test `sweep on new round resets autoMarkedTileIndices` — added the test (plus a new exhaustion-sweep test covering the P3 fix). [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts)
- [x] [Review][Patch] Misleading comment about rehydrate sweep — updated `ws.ts` comment to explicitly state that `playerCasualModes` is also non-persisted and players must re-toggle after a restart. [src/server/ws.ts:53-56](src/server/ws.ts#L53-L56)
- [x] [Review][Defer] `playerCasualModes` not persisted across server restart — pre-existing from Story 8-4. After a restart, all casual opt-ins silently reset for every player. Real UX regression but not introduced by this story; requires an SQLite snapshot change.
- [x] [Review][Defer] Sweep may fire during in-flight claim race — tiny window where `round.ended = true` but `round.active = true`; trivial `!round.ended` guard would close it, but no failing test demonstrates the race today.
- [x] [Review][Defer] Enable Casual Mode during paused pre-reveal marks tile without clearing reveal state — the tile flips to marked but may still render with `masked`/`revealing` flags because `applyAutoMarks` doesn't touch mask state. Interacts with Story 5-6 reveal flow; out of scope for this story.
- [x] [Review][Defer] Catch-up toast count reflects server-sent indices, not tiles actually applied — cosmetic: post-reconnect the toast can say "Caught up on N songs" even when all N were already marked client-side. Low impact.

## Dev Notes

### Key Anti-Patterns to Avoid

- **Don't broadcast `square:auto-marked`.** It's addressed to a single player. Use direct `ws.send` via the `roomState.guests.get(name)` lookup. Broadcasting would leak other players' card indices and spam sockets for no reason.
- **Don't compute current song from songHistory.length.** Always use `round.currentSongIndex` + `round.playlist[currentSongIndex].id`. `songHistory` may be empty or out of order if a future refactor changes append semantics.
- **Don't sweep on every `song:reveal`, `song:pause`, or resume.** The spec is explicit: track change only. `startSong` with `currentSongIndex !== songIndex` is the single trigger.
- **Don't persist `autoMarkedTileIndices` to SQLite.** It's session-scoped. Server restart mid-round loses it — fresh `new Map()` after rehydrate. A reconnecting player will trigger a fresh catch-up sweep anyway (AC #5), so this is correct.
- **Don't store card-match results client-side.** Re-send the full sweep via the server on reconnect. Client-side persistence is localStorage-only and tied to the card fingerprint (which survives reconnects).
- **Don't mutate the sweep inside the `playerCasualModes` iterator.** Snapshot the target list first (`Array.from(...)`) — defensive against any future mutation during the loop.
- **Don't touch the manual click flow.** `handleTileClick` already rejects un-played tiles. Auto-mark only applies to played tiles (which are always clickable manually too) — no interaction between the two code paths.
- **Don't emit a `player:casual-mode-changed` broadcast for the server's internal re-sweep.** The reconnect catch-up path calls `runCasualModeSweep` directly without touching the `playerCasualModes` map, so no new broadcast fires. Correct.

### File Locations (exact paths)

- Server round + sweep: [src/server/rooms.ts](src/server/rooms.ts) — `startSong`, `runCasualModeSweep`, `startRound`
- Server WS types + handlers: [src/server/ws.ts](src/server/ws.ts) — `RoundState`, `rehydrateRooms`, guest WS attach + `player:casual-mode-changed` handler + close handler
- Client bingo helpers: [src/client/lib/bingo.ts](src/client/lib/bingo.ts) — `ClientTile`, `initTiles`, `applyAutoMarks`
- Client game state: [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts) — `processWsMessage`, toast state
- Client guest page: [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte) — toast rendering, auto-claim effect
- Client card: [src/client/components/BingoCard.svelte](src/client/components/BingoCard.svelte) — `.tile.auto-marked` animation
- Server tests: [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts), [src/server/__tests__/ws.test.ts](src/server/__tests__/ws.test.ts)

### Story 8-4 Foundations Already in Place

From the previous story (do NOT re-do):
- `RoundConfig.allowCasualMode` flag is already in `round:start` payload.
- `RoomState.playerCasualModes: Map<string, boolean>` already tracks opt-in state and is reset on every `startRound` call.
- `player:casual-mode-changed` WS message is already handled (validated, mapped, broadcast) — this story adds a sweep call after the existing broadcast.
- `session:connect` already seeds `casualModeNames` for late joiners.
- `☕` indicator in Players List already renders from `game.casualModePlayers`.
- Guest Casual Mode toggle (`handleCasualToggle`) already sends the WS message and persists optimistic local state.

### Client Auto-Claim Timing Rationale

600 ms is chosen so the auto-mark animation (520 ms + 120 ms delay = 640 ms total) finishes before the claim fires. The server validates the claim within a few ms (synchronous `/round/claim` handler), and `round:win` broadcasts back — total perceived latency ~700-900 ms from track-change to win overlay. Users see the softer mark land first, then the win celebration.

### Per-Player vs. All-Player Sweep Control Flow

The `runCasualModeSweep` helper supports two modes via `options.playerName`:
- **Omitted** → iterate all names in `playerCasualModes` where value is `true`. Used by the track-change trigger in `startSong`.
- **Provided** → sweep only that player. Used by the `player:casual-mode-changed` enable path and the reconnect path. Both set `isCatchUp: true`.

The inner loop body is identical in both modes — so the helper has a single code path for computing "new indices since last sweep".

### Idempotency Story: Why the Client Handler Is Safe to Run Twice

1. Server tracks `autoMarkedTileIndices` per player — won't re-emit the same index twice under normal flow.
2. Reconnect path deliberately clears the per-player set (AC #6), so a reconnected client gets every eligible tile again — this is intentional re-send, not a bug.
3. Client's `applyAutoMarks` is idempotent: already-marked tiles are a no-op (`if (tile.state === 'marked') return tile`). A second pass over the same indices produces no extra animation because the state didn't change (Svelte doesn't re-run the CSS animation unless the element is re-added or the class is toggled off/on).
4. `onTileMark` persists to localStorage; re-saving the same list is harmless.

### Testing Guidance

- Use the existing `rooms.test.ts` helpers (`seedActiveRound` etc.) as templates for sweep tests.
- For WS integration tests, follow the `player:casual-mode-changed` describe block in `ws.test.ts` — it has the connect-multiple-clients + `next(type)` pattern already worked out.
- **Card layout is randomized.** Sweep tests must find the tile index dynamically: `const idx = round.cards.get('Alice')!.findIndex(t => t.trackId === 'track0')`. Do not hard-code.
- Use the existing test WebSocket mock shape to assert `ws.send` receives a JSON string containing the expected payload.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- Initial `ws` integration test for mid-round Casual enable failed because the playlist is shuffled inside `startRound` — fixed by capturing actual `song:start` trackIds from the WS stream instead of assuming `t0`/`t1` are the first two played.
- "square:auto-marked is NOT sent to other players" test uses raw WS listeners attached before the sweep fires so leaked messages on Bob/host are detected in a short window without waiting 2s for the `next()` helper timeout.

### Completion Notes List

- Server: Added `autoMarkedTileIndices: Map<string, Set<number>>` to `RoundState`, initialised in `startRound`, `rehydrateRooms`, and test fixtures. Not persisted; fresh `new Map()` after restart — reconnect catch-up sweep re-emits.
- Server: Implemented `runCasualModeSweep(roomCode, roomState, { playerName?, isCatchUp? })` in [rooms.ts](src/server/rooms.ts). Single code path for track-change (all casual players) and catch-up (one player). Skips FREE, skips already-swept indices, skips closed sockets, no-op emits when `newIndices.length === 0`.
- Server: Hooked sweep into `startSong` after `persistRoomState` via an `isTrackChange` boolean captured at the top of the history-push branch, so resume-from-pause never sweeps. First song sweeps but finds zero matches (current song excluded).
- Server: Wired `player:casual-mode-changed` handler to run a per-player catch-up sweep on enable and to clear the player's `autoMarkedTileIndices` entry on disable so re-enable re-sweeps. Guest reconnect path runs a per-player catch-up sweep after `round:start` when `playerCasualModes.get(name) === true`. Guest disconnect (`ws.on('close')`) also clears the per-player entry so the next reconnect is fresh-device safe; `playerCasualModes` is preserved so the ☕ indicator stays visible.
- Client: `ClientTile.autoMarked: boolean` added; `initTiles` defaults to `false`. New `applyAutoMarks(tiles, indices)` is idempotent — already-marked tiles are a no-op (no duplicate animation).
- Client: `gameState` processes `square:auto-marked` by calling `applyAutoMarks`, persisting via `onTileMark`, and incrementing `catchUpToastId` only when `catchUp === true`. Toast state resets on `round:start`.
- Client: `BingoCard.svelte` renders `class:auto-marked={tile.autoMarked}` with a `520ms` `auto-mark-sweep` keyframe animation (120ms delay). `@media (prefers-reduced-motion: reduce)` disables the animation.
- Client: `RoomPage.svelte` renders a centered `.casual-toast` pill driven by a `$effect` watching `game.catchUpToastId`. Auto-claim `$effect` fires `game.handleBingoClick()` after 600 ms when `casualModeOn && game.hasBingo && !isClaiming && !autoClaimFired`. `autoClaimFired` resets on `round:start`. Host page is unaffected (hosts don't have Casual Mode).
- Tests: Added `Casual Mode — Auto-Mark Engine` describe block to [rooms.test.ts](src/server/__tests__/rooms.test.ts) — 7 unit tests covering emit-on-track-change, current-song exclusion, off-state no-op, idempotency, host skip, monotonic delta, FREE-space defensiveness, and catch-up flag. Added `square:auto-marked` describe block to [ws.test.ts](src/server/__tests__/ws.test.ts) — 4 integration tests covering mid-round enable catch-up, reconnect catch-up, disable clearing the entry, and no leak to other players.
- `npm test` → 371/371 passing (17 files). `npm run lint` clean. `npm run build:client` clean.
- Note: `runCasualModeSweep` is imported from `./rooms.ts` into `ws.ts`. `rooms.ts` already imports values from `ws.ts`, so this adds a circular runtime dependency; it's safe because both sides only reference each other at call-time (not during module init), matching the existing pattern for `roomSockets`/`broadcast`/etc.

### File List

- src/server/ws.ts — added `autoMarkedTileIndices` to `RoundState`, init in `rehydrateRooms`, imported `runCasualModeSweep`, called it on guest reconnect, `player:casual-mode-changed` enable, clear on disable/disconnect
- src/server/rooms.ts — exported new `runCasualModeSweep` helper, captured `isTrackChange` in `startSong` and invoked sweep after `persistRoomState`, initialised `autoMarkedTileIndices: new Map()` in `startRound`
- src/server/__tests__/rooms.test.ts — imported `runCasualModeSweep`, added `autoMarkedTileIndices: new Map()` to `seedActiveRound` fixture, added `Casual Mode — Auto-Mark Engine` describe block (7 tests)
- src/server/__tests__/ws.test.ts — added `square:auto-marked` describe block (4 integration tests)
- src/client/lib/bingo.ts — added `autoMarked: boolean` to `ClientTile`, default in `initTiles`, new `applyAutoMarks` helper
- src/client/lib/gameState.svelte.ts — imported `applyAutoMarks`, added `catchUpToastCount`/`catchUpToastId` state, handled `square:auto-marked` in `processWsMessage`, reset toast state on `round:start`, exposed getters + `clearCatchUpToast`
- src/client/components/BingoCard.svelte — added `class:auto-marked` and `.tile.auto-marked` animation with reduced-motion guard
- src/client/pages/RoomPage.svelte — added `toastMessage`, `toastTimer`, `autoClaimFired` state, catch-up toast `$effect`, auto-claim `$effect`, reset on `round:start`, cleanup in `onDestroy`, rendered `.casual-toast`, added toast CSS

## Change Log

| Date       | Change                                                                                 |
| ---------- | -------------------------------------------------------------------------------------- |
| 2026-04-15 | Story 8-5 implementation — Casual Mode auto-mark engine, client auto-claim, tests.    |
