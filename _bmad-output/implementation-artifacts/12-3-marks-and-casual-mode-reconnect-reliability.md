# Story 12.3: Marks & Casual-Mode Reconnect Reliability (Hosts and Guests)

Status: ready-for-dev

## Story

As a host or guest whose session was interrupted — refresh, screen lock, WS reconnect —
I want my marks to survive AND casual-mode auto-marks to replay automatically when I return,
so that I never have to re-mark tiles or toggle casual mode off-and-on just to catch up.

## Acceptance Criteria

1. New server helper `replayAutoMarksToSocket(roomState, socket, userKey)` in [src/server/rooms.ts](src/server/rooms.ts) iterates `roomState.autoMarkedTileIndices.get(userKey) ?? new Set()` and emits a `square:auto-marked` event **to the given socket only** (not a room broadcast) for each tile index, with `catchUp: true` flag.
2. In [src/server/ws.ts](src/server/ws.ts) **host reconnect branch** at [ws.ts:306-326](src/server/ws.ts#L306-L326): after sending `round:start` to the reconnecting host, call `replayAutoMarksToSocket(roomState, socket, hostUserKey)` when that host had casual mode on. Then continue to run the existing `runCasualModeSweep(..., { isCatchUp: true })` to cover songs played during the disconnect window.
3. In [src/server/ws.ts](src/server/ws.ts) **guest reconnect branch** at [ws.ts:389-412](src/server/ws.ts#L389-L412): same pattern — after `round:start`, call `replayAutoMarksToSocket(roomState, socket, guestUserKey)` when that guest had casual mode on, then `runCasualModeSweep(..., { isCatchUp: true })`.
4. The existing client handler at [gameState.svelte.ts:200](src/client/lib/gameState.svelte.ts#L200) which handles `square:auto-marked` with `catchUp: true` (including the catch-up toast) continues to work unchanged — this story only changes when/how often those events fire to reconnecting sockets.
5. [HostRoomPage.svelte:60-63](src/client/pages/HostRoomPage.svelte#L60-L63) is updated to pass a real `getMarksForCard` callback (matching the guest implementation in [RoomPage.svelte:38-70](src/client/pages/RoomPage.svelte#L38-L70)) so host manual marks persist to localStorage under the key `bangerbingo:marks:{code}:{cardFingerprint}`.
6. Host marks restoration on refresh uses the same `cardFingerprint` from [bingo.ts:86-96](src/client/lib/bingo.ts#L86-L96) and `restoreMarks` validation from [bingo.ts:98-109](src/client/lib/bingo.ts#L98-L109) that guests use. No new helpers.
7. Host marks persistence survives: full page refresh, WS reconnect (Story 12-1), and the visibility-nudge reconnect (Story 12-1). This is verified via manual testing — no new test harness for this is required beyond a straightforward unit test on the `getMarksForCard`/`onTileMark` wiring.
8. Casual-mode catch-up replay on reconnect does NOT require the user to toggle casual mode off and back on. Toggling off/on still works as before (existing code path at [rooms.ts:917-937](src/server/rooms.ts#L917-L937) unchanged); it's just no longer the *only* way to catch up.
9. Idempotency: if a reconnect happens and the client already has the auto-marks in localStorage (extremely unlikely since casual-mode auto-marks are server-driven and not persisted client-side), the replay still correctly results in the tiles being marked exactly once. The existing `square:auto-marked` client handler treats already-marked tiles as a no-op.
10. `replayAutoMarksToSocket` does NOT mutate `autoMarkedTileIndices` — it's a pure read/emit. The source of truth remains the set that `runCasualModeSweep` maintains.
11. `npm run lint` passes. `npm run test` passes. New tests:
    - Given a `userKey` with 3 entries in `autoMarkedTileIndices`, `replayAutoMarksToSocket` emits 3 `square:auto-marked` events on only the given socket with `catchUp: true`.
    - Given an empty set, `replayAutoMarksToSocket` is a no-op (no emits).
    - Host `getMarksForCard` returns the same Set guests get under the same key.
12. No regressions in: casual-mode toggle flow, casual-mode reactivation after disconnect, guest marks persistence, host card generation, `runCasualModeSweep` idempotency for normal (non-reconnect) song-advance sweeps.

## Tasks / Subtasks

- [ ] Task 1 — `replayAutoMarksToSocket` helper (AC: 1, 10)
  - [ ] Add helper in [src/server/rooms.ts](src/server/rooms.ts) near `runCasualModeSweep` (at [rooms.ts:108-176](src/server/rooms.ts#L108-L176)):
    ```ts
    function replayAutoMarksToSocket(
      roomState: RoomState,
      socket: WebSocket,
      userKey: string
    ) {
      const indices = roomState.autoMarkedTileIndices.get(userKey)
      if (!indices || indices.size === 0) return
      for (const idx of indices) {
        socket.send(JSON.stringify({
          type: 'square:auto-marked',
          tileIndex: idx,
          catchUp: true,
        }))
      }
    }
    ```
  - [ ] Verify the `square:auto-marked` payload shape matches what `runCasualModeSweep` broadcasts today (same fields, same order). If `runCasualModeSweep` includes extra fields (e.g., `trackId`), include them here too.

- [ ] Task 2 — Wire replay into host reconnect branch (AC: 2)
  - [ ] In [ws.ts:306-326](src/server/ws.ts#L306-L326), after the existing `round:start` resend for the reconnecting host:
    - Determine the host's `userKey` (same key used in `autoMarkedTileIndices` map, e.g., host userId).
    - Check whether host casual mode is on via `playerCasualModes.get(hostUserKey)`.
    - If on: call `replayAutoMarksToSocket(roomState, socket, hostUserKey)`.
    - Then continue to the existing `runCasualModeSweep(..., { isCatchUp: true })` call (at [rooms.ts:419](src/server/rooms.ts#L419) trigger site).
  - [ ] Order matters: replay FIRST (surfaces historic auto-marks), then sweep (adds any new auto-marks for songs played during disconnect). The sweep's own idempotency guard will correctly avoid duplicate emits.

- [ ] Task 3 — Wire replay into guest reconnect branch (AC: 3)
  - [ ] Same pattern as Task 2, but in [ws.ts:389-412](src/server/ws.ts#L389-L412).
  - [ ] `userKey` for guests is the guest `name` (per [ws.ts:39](src/server/ws.ts#L39) and surrounding code — verify at implementation time).
  - [ ] Check `playerCasualModes.get(guestUserKey)` before replaying.

- [ ] Task 4 — Host marks persistence (AC: 5, 6, 7)
  - [ ] In [HostRoomPage.svelte:60-63](src/client/pages/HostRoomPage.svelte#L60-L63), extend the `createGameState` call with:
    ```ts
    let marksKey = ''
    function loadMarks(): Set<string> {
      if (!marksKey) return new Set()
      try {
        return new Set(JSON.parse(localStorage.getItem(marksKey) ?? '[]'))
      } catch {
        return new Set()
      }
    }
    const game = createGameState({
      code: untrack(() => code),
      getPlayerName: () => hostName,
      getMarksForCard: (card: Tile[]) => {
        marksKey = `bangerbingo:marks:${code}:${cardFingerprint(card)}`
        return loadMarks()
      },
      onTileMark: (tiles) => {
        if (!marksKey) return
        const ids = tiles.filter(t => t.state === 'marked').map(t => t.trackId)
        localStorage.setItem(marksKey, JSON.stringify(ids))
      },
    })
    ```
  - [ ] This mirrors [RoomPage.svelte:38-70](src/client/pages/RoomPage.svelte#L38-L70) verbatim. Import `cardFingerprint` and `Tile` from [src/client/lib/bingo.ts](src/client/lib/bingo.ts).
  - [ ] No changes to `bingo.ts` — `cardFingerprint` and `restoreMarks` are already the right shape.
  - [ ] Verify that the host card structure (stored server-side in `RoundState.cards` per [ws.ts:39](src/server/ws.ts#L39)) is compatible with guest card structure for fingerprinting. If the host uses the same `Tile[]` shape, no adjustment needed.

- [ ] Task 5 — Tests (AC: 11)
  - [ ] `src/server/rooms.test.ts` (or existing equivalent): test `replayAutoMarksToSocket` with (a) a populated Set of 3 indices, (b) empty Set, (c) undefined userKey. Use a mock socket that captures `send` calls.
  - [ ] `src/client/pages/HostRoomPage.test.ts` (or closest existing test surface): verify `getMarksForCard` returns a Set from localStorage under the expected key shape; verify `onTileMark` writes correctly.
  - [ ] Integration check: existing casual-mode sweep tests continue to pass unchanged.

- [ ] Task 6 — Regression + manual verification (AC: 12)
  - [ ] `npm run lint` clean.
  - [ ] `npm run test` — full suite passes.
  - [ ] Manual Journey 1 (guest): start round with casual mode on, play several songs matching the guest's card so casual-mode auto-marks fire. Lock phone 30+ seconds → unlock → reconnect triggers (via Story 12-1). Expected: all prior auto-marks re-emit as catch-up events; catch-up toast appears; no toggle-off-toggle-on needed.
  - [ ] Manual Journey 2 (host): same but as host with casual mode on; expect same behavior.
  - [ ] Manual Journey 3 (host refresh): mark several tiles as host during a round → hard-refresh the page → tiles restored from localStorage.
  - [ ] Manual Journey 4 (baseline casual toggle still works): host toggles casual mode off then on mid-round — the existing force-replay path still fires correctly.
  - [ ] Manual Journey 5 (no regression on normal song-advance sweeps): new song plays → existing `runCasualModeSweep` still fires a single `square:auto-marked` broadcast for matching tiles (no duplicates from the new replay helper).

## Dev Notes

### Why the idempotency guard in `runCasualModeSweep` is correct — but incomplete

The existing `autoMarkedTileIndices` Set prevents the sweep from re-broadcasting an auto-mark for a tile it already marked. That's correct for the normal case (song N plays → sweep matches 2 tiles → 2 broadcasts → server remembers it told everyone; song N+1 plays, same 2 tiles, no re-broadcasts). But on reconnect, the server still has those 2 tiles in the Set while the client has lost them from in-memory state. The server sees "already told you" and stays silent; the client sees unmarked tiles. That's the bug we're fixing.

The fix is NOT to remove the idempotency guard (that would cause duplicate toasts on every song). It's to add a *separate* replay path that fires once on reconnect, targeting the returning socket only.

### Why `catchUp: true`

The existing client handler at [gameState.svelte.ts:200](src/client/lib/gameState.svelte.ts#L200) already handles this flag — it shows a "Caught up on N songs" toast (see `catchUpToastCount` handling at [RoomPage.svelte:73-88](src/client/pages/RoomPage.svelte#L73-L88)). Using the existing flag means no new client-side work beyond persisting host marks.

### Why host marks weren't persisted before

At the time [HostRoomPage.svelte:60-63](src/client/pages/HostRoomPage.svelte#L60-L63) was written, the assumption was the host is "just running the game" and doesn't mark their own card. That's not how hosts use it — many play along. This is a trivial parity fix, not a new feature. The full persistence mechanism already exists and is proven for guests.

### Scope boundary with Story 12-2

Story 12-2 handles *playback* reconciliation (Spotify drift, device changes, SDK reinit). This story handles *game-state* reconciliation (marks, auto-marks). They both run on reconnect but are independent. Don't merge logic — keep the `/host/resume` endpoint focused on Spotify, and keep the `replayAutoMarksToSocket` call inside the existing ws reconnect branches.

### Ordering with Story 12-1 (`wsClient`)

This story's server-side logic doesn't depend on Story 12-1 — the reconnect branches are existing code. Host marks persistence also doesn't depend on 12-1. But the whole story is much more *visible* once 12-1 lands, because reconnects become frequent and silent instead of ending in a "please refresh" banner. Land 12-1 first if possible.

### File structure

- Modified: `src/server/rooms.ts` (add helper)
- Modified: `src/server/ws.ts` (call helper in two reconnect branches)
- Modified: `src/client/pages/HostRoomPage.svelte` (wire marks callback)
- Possibly modified: `src/server/rooms.test.ts` (new test) and a HostRoomPage test file if one exists
- No new files, no new dependencies

### Existing patterns to reuse

- Guest marks mechanism: [RoomPage.svelte:38-70](src/client/pages/RoomPage.svelte#L38-L70) — copy the pattern verbatim into HostRoomPage. Do not extract to a shared util yet — two usages, inline is clearer.
- `cardFingerprint` from [bingo.ts:86-96](src/client/lib/bingo.ts#L86-L96) and `restoreMarks` from [bingo.ts:98-109](src/client/lib/bingo.ts#L98-L109) — already validate marks against `playedIds` to prevent stale marks from surviving card reshuffles. Works identically for host.
- `createGameState` factory in [gameState.svelte.ts](src/client/lib/gameState.svelte.ts) already accepts `getMarksForCard` and `onTileMark` callbacks — host just wires them.
- Casual-mode infrastructure: `autoMarkedTileIndices`, `playerCasualModes`, `runCasualModeSweep` all at [rooms.ts:108-176](src/server/rooms.ts#L108-L176). Use `.get(userKey)` reads; don't touch the write paths.

### What NOT to touch

- `runCasualModeSweep` internals — the idempotency guard is correct.
- `autoMarkedTileIndices` write paths — the new helper only reads.
- The toggle-off-on reset path at [rooms.ts:917-937](src/server/rooms.ts#L917-L937) — still the correct way to force a total re-sweep.
- Guest marks persistence in RoomPage — already working.

### References

- Parent plan: [i-don-t-think-switching-giggly-hammock.md](~/.claude/plans/i-don-t-think-switching-giggly-hammock.md) — Track B (B1–B2).
- Parent epic: [_bmad-output/epics.md](_bmad-output/epics.md) — Epic 12.
- Related: Story 8-5 (Casual Mode Auto-Mark Engine) — that's where `runCasualModeSweep` and `autoMarkedTileIndices` were introduced.
- Related: Story 9-2 (Live Round Settings) — casual-mode permission toggle path.
- Not blocking but synergistic: Story 12-1 (WS heartbeat + visibility) makes reconnects silent and frequent, making this story's impact visible.

## Dev Agent Record

### Agent Model Used

_TBD_

### Debug Log References

_TBD_

### Completion Notes List

_TBD_

### File List

_TBD_

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created. Status: ready-for-dev. |
