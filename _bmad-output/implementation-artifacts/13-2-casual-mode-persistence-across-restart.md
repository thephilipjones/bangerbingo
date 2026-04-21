# Story 13-2: Casual Mode Persistence Across Server Restart

## Status: Ready for Development

## Context

`playerCasualModes` and `allowCasualMode` live entirely in-memory in `roomSockets`. A server restart (deploy, crash, manual restart) silently resets all players' Casual Mode opt-ins to off. The catch-up sweep can't re-emit because its target set is empty. Players are confused why tiles stopped auto-marking.

The SQLite room snapshot already exists from Story 6-4 (`persistRoomState` in `ws.ts`). We just need to include casual state in the snapshot and restore it on `rehydrateRoom`.

Deferred item resolved: `deferred-work.md` → "`playerCasualModes` not persisted across server restart" (Deferred from code review of 8-5)

## Acceptance Criteria

**AC-1 (Persist):** `persistRoomState` includes `allowCasualMode` (boolean) and `playerCasualModes` (serialized as `Record<string, true>` — just the names of players with casual on) in the JSON blob written to SQLite.

**AC-2 (Restore — allowCasualMode):** On `rehydrateRoom`, if `state_json.allowCasualMode` is a boolean, set `roomState.currentRound.config.allowCasualMode` accordingly. If no active round, no-op.

**AC-3 (Restore — playerCasualModes):** On `rehydrateRoom`, if `state_json.playerCasualModes` is a non-null object, reconstruct `roomState.playerCasualModes` as a `Map<string, true>` from the object's keys.

**AC-4 (Survive restart):** Host starts session with Casual Mode allowed + two guests opted in. Server restarts. Guests rejoin. Their Casual Mode indicators still show ☕. The next song auto-marks their tiles.

**AC-5 (No regression):** A room with no casual state in `state_json` (old snapshot format) still rehydrates cleanly without errors.

**AC-6 (Test):** New test in `ws.test.ts` or `rooms.test.ts`: populate `playerCasualModes` and `allowCasualMode`, call `persistRoomState`, read back from DB, call `rehydrateRoom`, assert both fields are correctly restored.

## Implementation Notes

**`src/server/ws.ts`:**

In `persistRoomState(code)`:
```ts
const state = roomSockets.get(code)
if (!state) return
const json = {
  activeDeviceId: state.activeDeviceId,
  // add:
  allowCasualMode: state.currentRound?.config.allowCasualMode ?? false,
  playerCasualModes: Object.fromEntries(state.playerCasualModes ?? new Map()),
}
saveRoomState(code, JSON.stringify(json))
```

In `rehydrateRoom(code, stateJson)` (or wherever snapshots are loaded):
```ts
if (typeof parsed.allowCasualMode === 'boolean' && roomState.currentRound) {
  roomState.currentRound.config.allowCasualMode = parsed.allowCasualMode
}
if (parsed.playerCasualModes && typeof parsed.playerCasualModes === 'object') {
  roomState.playerCasualModes = new Map(
    Object.keys(parsed.playerCasualModes).map(k => [k, true as const])
  )
}
```

`playerCasualModes` on `RoomState` is typed `Map<string, true>` — confirm the type in `ws.ts` before writing.

## Files

- `src/server/ws.ts` — `persistRoomState` + `rehydrateRoom` (or the snapshot restore path)
- `src/server/__tests__/ws.test.ts` or `rooms.test.ts` — persistence round-trip test

## Deferred Work Updates

Upon completion, remove from `deferred-work.md`:
- "`playerCasualModes` not persisted across server restart" (under "Deferred from: code review of 8-5")
