# Story 13-1: Reconnect-After-Win State Replay

## Status: Done

## Context

When a player (host or guest) reconnects after a bingo win has occurred and the round has ended, they land on an empty active-round shell with no Game Over view and no Start Next Round CTA. This is because `session:connect` replay in `ws.ts` does not re-send `round:win` when `round.ended === true`. Already flagged as a known gap in story 9-1 Dev Notes.

Deferred item resolved: `deferred-work.md` → "Reconnect after a win loses Game Over view" (Deferred from code review of 9-1)

## Acceptance Criteria

**AC-1 (Server — host reconnect):** When the host reconnects (`session:connect` from the host WS path) and `roomState.currentRound?.ended === true` and `roomState.currentRound?.winData` exists, the server unicasts a `round:win` message immediately after the `round:start` replay, containing `winData` with the same shape as the original broadcast.

**AC-2 (Server — guest reconnect):** When a guest reconnects (guest `session:connect` path) and `roomState.currentRound?.ended === true` and `roomState.currentRound?.winData` exists, the server unicasts the same `round:win` to that guest socket.

**AC-3 (Client — HostRoomPage):** On receiving a replayed `round:win` when `game.winData` is already set (i.e. we reconnected into an already-won state), the handler sets `winData` from the payload but **does not re-trigger audio** (only trigger audio on the first `round:win` receipt, when `winData` was previously null).

**AC-4 (Client — RoomPage):** Same guard as AC-3: replayed `round:win` populates `winData` without re-triggering SFX.

**AC-5 (Manual verification):** Host is on Game Over screen. Force-kill and restore network. Within ~2 seconds of reconnect, Game Over view is back with winner + winning songs + Start Next Round / Dismiss CTAs.

**AC-6 (Test — server):** `ws.test.ts` — new test: host reconnects mid-ended-round; asserts unicast includes `{ type: 'round:win', ...winData fields }` after the `round:start` unicast. Same for guest reconnect.

## Implementation Notes

**Server (`src/server/ws.ts`):**

Host reconnect unicast block (around line 341) currently sends:
```ts
ws.send(JSON.stringify({ ...activeRound.roundStartPayload, card: hostCard, songHistory: activeRound.songHistory, currentSongIndex: ..., paused: ... }))
```

Add immediately after that send:
```ts
if (activeRound.ended && activeRound.winData) {
  ws.send(JSON.stringify({ type: 'round:win', ...activeRound.winData }))
}
```

Do the same in the guest reconnect unicast block (separate branch in ws.ts).

`winData` must already be stored on `RoundState`. If it's not, add `winData?: WinData` to the `RoundState` type in `ws.ts` and populate it when `round:win` is broadcast in `rooms.ts`.

**Client (`src/client/pages/HostRoomPage.svelte` and `RoomPage.svelte`):**

In the `round:win` handler, add a guard:
```ts
const isReplay = game.winData !== null
game.winData = { ... }  // always update
if (!isReplay) { /* play audio / SFX */ }
```

Currently there's no audio to play (Story 13-6 adds it), so the guard is a placeholder — the important thing is that `winData` is set on replay.

## Files

- `src/server/ws.ts` — host + guest reconnect unicast blocks
- `src/server/rooms.ts` — store winData on RoundState when broadcasting round:win
- `src/client/pages/HostRoomPage.svelte` — round:win handler replay guard
- `src/client/pages/RoomPage.svelte` — round:win handler replay guard
- `src/server/__tests__/ws.test.ts` — new reconnect-after-win tests

## Dev Agent Record

### Completion Notes

Implemented 2026-04-21. All 509 tests pass (2 new tests added).

**Server (`src/server/ws.ts`):**
- Added `WinData` interface (exported) with `winnerName`, `winningTileIds`, `songHistory`, `winnerCard` fields.
- Added `winData?: WinData` to `RoundState`.
- Host reconnect block: changed condition from `activeRound?.active` to `activeRound?.active || activeRound?.ended`; unicasts `round:win` after `round:start` when `ended && winData` (AC-1).
- Guest reconnect block: same condition change and round:win unicast (AC-2).

**Server (`src/server/rooms.ts`):**
- In `/round/claim`: stores `round.winData` immediately after `round.active = false`, before the broadcast, so reconnecting clients can receive the replay (AC-1/AC-2).

**Client (`src/client/pages/HostRoomPage.svelte`, `RoomPage.svelte`):**
- Added `isWinReplay` capture before `processWsMessage` in both pages' WS message handlers. Placeholder `if (!isWinReplay)` block marks where Story 13-6 audio guard lives (AC-3/AC-4).

**Tests (`src/server/__tests__/ws.test.ts`):**
- Added "host reconnects into ended round → receives round:start then round:win" (AC-6).
- Added "guest reconnects into ended round → receives round:start then round:win" (AC-6).

**Deferred work:** Removed "Reconnect after a win loses Game Over view" entry from `deferred-work.md`.

### File List

- `src/server/ws.ts`
- `src/server/rooms.ts`
- `src/client/pages/HostRoomPage.svelte`
- `src/client/pages/RoomPage.svelte`
- `src/server/__tests__/ws.test.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/13-1-reconnect-after-win-state-replay.md`

### Change Log

- 2026-04-21: Implemented Story 13-1 — reconnect-after-win state replay for host and guest; added WinData type, winData field on RoundState, claim handler stores winData, reconnect blocks unicast round:win, client isWinReplay guard placeholder, 2 new server tests.
- 2026-04-21: Code review applied — persist winData across server restart; snapshot songHistory/winnerCard in /round/claim (no live refs); guard guest reconnect replay to returning guests only (existingCard gate). All 509 tests pass.

## Deferred Work Updates

Upon completion, remove from `deferred-work.md`:
- "Reconnect after a win loses Game Over view" (under "Deferred from: code review of 9-1")

## Review Findings

_Adversarial code review 2026-04-21. 3 decision-needed, 3 patch, 3 deferred, 5 dismissed as noise._

- [x] [Review][Decision→Patch] Ended-round replay to late-joining guest mis-highlights a freshly-generated card — **Resolved:** guest reconnect guard changed from `round?.active || round?.ended` to `round?.active || (round?.ended && round.cards.has(name))`. Returning guests still get the replay; new joiners on an ended round now get only `session:connect`. ([src/server/ws.ts](src/server/ws.ts) guest reconnect block)
- [x] [Review][Decision→Dismissed] Dismissed Game Over overlay reappears on every reconnect — **Resolved:** accepted as intentional. Round is still ended server-side; Game Over is the current screen until next round starts.
- [x] [Review][Decision→Dismissed] Host reconnect replay never fires `onRoundEnded()` lifecycle — **Resolved:** misread. `onRoundEnded()` navigates host to lobby; firing on replay would wrongly kick host off the Game Over screen. Current behavior is correct.
- [x] [Review][Patch] `winData` not included in `persistRoomState` snapshot — **Fixed:** added `winData: round.winData` to the snapshot; `rehydrateRooms` spread picks it up automatically. ([src/server/ws.ts:129](src/server/ws.ts))
- [x] [Review][Patch] `WinData.songHistory` stored as live reference — **Fixed:** snapshot via `round.songHistory.slice()` in `/round/claim`. ([src/server/rooms.ts:1082](src/server/rooms.ts))
- [x] [Review][Patch] `WinData.winnerCard` stored as live reference — **Fixed:** snapshot via `card.map(t => ({ ...t }))`. ([src/server/rooms.ts:1083](src/server/rooms.ts))
- [x] [Review][Defer] Reconnect-after-win tests mutate `round.winData` directly rather than exercising `/round/claim` [src/server/__tests__/ws.test.ts:979-985, 1033-1039](src/server/__tests__/ws.test.ts) — deferred to 13-4 test-quality pass.
- [x] [Review][Defer] `round:end` not replayed on reconnect — client stuck in mid-game UI if it missed the broadcast [src/server/ws.ts:340-386](src/server/ws.ts) — deferred, pre-existing.
- [x] [Review][Defer] Reconnect-replay widens the existing guest-name-collision / host-name-spoof surface to ended rounds [src/server/ws.ts:447-465](src/server/ws.ts) — deferred, pre-existing (tracked under Story 12-3 deferred work).

