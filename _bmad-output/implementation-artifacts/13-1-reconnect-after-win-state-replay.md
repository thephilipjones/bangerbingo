# Story 13-1: Reconnect-After-Win State Replay

## Status: Ready for Development

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

## Deferred Work Updates

Upon completion, remove from `deferred-work.md`:
- "Reconnect after a win loses Game Over view" (under "Deferred from: code review of 9-1")
