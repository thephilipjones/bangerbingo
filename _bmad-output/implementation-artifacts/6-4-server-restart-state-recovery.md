# Story 6.4: Server Restart State Recovery

Status: done

## Story

As a player,
I want a single server restart mid-round to not kill our game,
So that we can resume after a deploy or crash without losing the current round (NFR13).

## Acceptance Criteria

1. **DB schema** — `initDb()` in `src/server/db.ts` creates `active_rooms(room_code TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)` idempotently (IF NOT EXISTS).

2. **`persistRoomState(code)`** — defined and exported from `src/server/ws.ts`. Reads the `RoomState` from `roomSockets`, serializes a plain-data snapshot (see Dev Notes for exact shape — omits `host`, `guests`, `timers`), and upserts into `active_rooms`.

3. **Persist triggers** — `persistRoomState(code)` is called exactly once after each of:
   - (a) the per-player `round:start` broadcasts in `rooms.ts` (after cards and initial `songHistory` are built)
   - (b) each `song:start` broadcast inside `startSong()` in `rooms.ts`
   - (c) the `round:win` broadcast after valid claim validation in `rooms.ts`
   - (d) the `round:end` broadcast in `rooms.ts` — but at round:end, `currentRound` is `undefined`, so persisting is moot; instead, the `active_rooms` row is **deleted** here (see AC 6)
   - No per-tap (tile marks) or per-guest-join snapshots — only the four events above.

4. **`rehydrateRooms()`** — defined and exported from `src/server/ws.ts`. Reads every row from `active_rooms`, deserializes `state_json`, and repopulates `roomSockets` with a reconstructed `RoomState` per row: `host: null`, `guests: new Map()`, `hostHasEverConnected: true`, `currentRound.timers: {}`, `currentRound.paused: true` (force-paused regardless of prior state).

5. **Startup wiring** — `rehydrateRooms()` is called from `src/server/index.ts` **after** `initDb()` and **before** `setupWebSocketServer()`. Only runs in non-test env (inside the `if (config.nodeEnv !== 'test')` block, immediately before `setupWebSocketServer(httpServer)`).

6. **Row cleanup** — after a round transitions out of active state, the `active_rooms` row is deleted:
   - After `round:win` broadcast: call `persistRoomState(code)` (captures final win state) then immediately delete the `active_rooms` row.
   - After `round:end` broadcast: only delete the row (currentRound is already undefined at that point).
   - `destroyRoom(code)` in `ws.ts`: delete from `active_rooms` as part of teardown.

7. **Host reconnect post-restart** — existing Story 5-6 logic in `handleConnection` (ws.ts lines 203–207) already re-sends `round:start` + `songHistory` when `activeRound?.active`. After rehydration this just works — no new code needed in the WS connection handler.

8. **Guest reconnect post-restart** — existing logic (ws.ts lines 252–264) finds the guest's card in `currentRound.cards.get(name)` and re-sends it. After rehydration, `cards` is a proper `Map<string, Tile[]>` (deserialized), so this just works.

9. **Play after restart** — `POST /round/play` re-broadcasts `song:start` for current `currentSongIndex` without incrementing (the `round.paused` branch of the play handler calls `startSong(code, roomState!, round.currentSongIndex)`; `startSong` only appends to `songHistory` when `round.currentSongIndex !== songIndex`, so no duplicate history entry).

10. **Restart-recovery smoke test** — developer verifies: start round → play 3 songs → kill server → restart → guest reconnects → History drawer shows same 3 songs in same order, guest card tile state matches pre-kill state.

## Tasks / Subtasks

- [x] Add `active_rooms` table and DB helpers in `src/server/db.ts` (AC: #1)
  - [x] Add `CREATE TABLE IF NOT EXISTS active_rooms (room_code TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)` to `db.exec(...)` in `initDb()`
  - [x] Add `upsertActiveRoom(code: string, stateJson: string): void`
  - [x] Add `deleteActiveRoom(code: string): void`
  - [x] Add `getAllActiveRooms(): Array<{ room_code: string; state_json: string }>`

- [x] Add `persistRoomState(code)` and `rehydrateRooms()` to `src/server/ws.ts` (AC: #2, #4, #6)
  - [x] Export `persistRoomState(code: string): void` — serializes snapshot (see Dev Notes) and calls `upsertActiveRoom`
  - [x] Export `rehydrateRooms(): void` — reads all active_rooms, reconstructs RoomState per row, sets into `roomSockets`
  - [x] Add `deleteActiveRoom` call inside `destroyRoom(code)` (after socket cleanup, before `roomSockets.delete`)

- [x] Wire persist triggers in `src/server/rooms.ts` (AC: #3)
  - [x] Import `persistRoomState` from `./ws.ts` (already imported from there)
  - [x] Call `persistRoomState(code)` after the per-player `round:start` broadcast block (after the `for` loop, before `recordPlayedSongs`)
  - [x] Call `persistRoomState(roomCode)` at end of `startSong()`, after the `broadcast(roomCode, { type: 'song:start', ... })` call
  - [x] For `round:win`: call `persistRoomState(code)` then `deleteActiveRoom(code)` after `round.active = false` and `broadcast`
  - [x] For `round:end`: call `deleteActiveRoom(code)` after `roomState.currentRound = undefined` and `broadcast`

- [x] Wire `rehydrateRooms()` in `src/server/index.ts` (AC: #5)
  - [x] Import `rehydrateRooms` from `./ws.ts`
  - [x] Call `rehydrateRooms()` inside the `if (config.nodeEnv !== 'test')` block, immediately before `setupWebSocketServer(httpServer)`

- [x] Tests (AC: #1, #2, #4)
  - [x] `db.test.ts`: test `active_rooms` table created by `initDb(':memory:')`, test `upsertActiveRoom` / `deleteActiveRoom` / `getAllActiveRooms`
  - [x] `ws.test.ts` or new test: test `rehydrateRooms()` — seed `active_rooms` via `upsertActiveRoom`, call `rehydrateRooms()`, assert `roomSockets` has correct entry with `host: null`, `guests.size === 0`, `hostHasEverConnected: true`, `currentRound.paused: true`, `currentRound.timers` is `{}`, and `currentRound.cards` is a `Map` with correct tiles

### Review Findings

- [x] [Review][Patch] `rehydrateRooms()` crashes server on corrupt JSON — wrap `JSON.parse` in try/catch, log warning, skip and delete corrupt row [src/server/ws.ts:97]
- [x] [Review][Patch] Orphaned `active_rooms` row rehydrates ghost room — check `getRoomByCode` during rehydration, skip and delete orphaned rows [src/server/ws.ts:94-113]

## Dev Notes

### Snapshot shape (what `persistRoomState` serializes)

`cards` is `Map<string, Tile[]>` — serialize with `Object.fromEntries(round.cards)`, deserialize with `new Map(Object.entries(parsed.cards))`.

Fields to include in snapshot (omit `host`, `guests`, `timers`):

```ts
{
  hostUserId: room.hostUserId,
  hostHasEverConnected: room.hostHasEverConnected,
  pendingRound: room.pendingRound,           // RoundConfig | undefined
  sdkDeviceId: room.sdkDeviceId,             // string | undefined
  currentRound: room.currentRound ? {
    roundNumber: round.roundNumber,
    config: round.config,
    playlist: round.playlist,
    cards: Object.fromEntries(round.cards),  // Map → plain object
    roundStartPayload: round.roundStartPayload,
    sessionPlayedIds: round.sessionPlayedIds,
    active: round.active,
    currentSongIndex: round.currentSongIndex,
    currentSongRevealed: round.currentSongRevealed,
    songHistory: round.songHistory,
    paused: round.paused,
    ended: round.ended,
    // timers: omitted
  } : undefined
}
```

### Deserialization in `rehydrateRooms()`

After `JSON.parse(row.state_json)`, reconstruct `RoomState` as:

```ts
const snap = JSON.parse(row.state_json)
const roomState: RoomState = {
  host: null,
  hostUserId: snap.hostUserId,
  hostHasEverConnected: true,               // always true on rehydration
  guests: new Map(),
  pendingRound: snap.pendingRound,
  sdkDeviceId: snap.sdkDeviceId,
  currentRound: snap.currentRound ? {
    ...snap.currentRound,
    cards: new Map(Object.entries(snap.currentRound.cards)),  // plain object → Map
    paused: true,                            // force-paused on restart
    timers: {},                              // cleared — no timers survive restart
  } : undefined,
}
roomSockets.set(row.room_code, roomState)
```

### Where each trigger lives in rooms.ts

- **round:start** trigger: after the `for (const [guestName, ws] of roomState.guests)` loop (line ~315), before `recordPlayedSongs(code, dealtTrackIds)`. Only call if `roomState` is defined.
- **song:start** trigger: in `startSong()`, after the `broadcast(roomCode, { type: 'song:start', ... })` call (~line 65). Always call (startSong is only called when there's an active round).
- **round:win** trigger: after `broadcast(code, { type: 'round:win', ... })` and after `round.active = false`. Call `persistRoomState(code)` then call `deleteActiveRoom(code)` from db.ts.
- **round:end** trigger: after `broadcast(code, { type: 'round:end' })` (currentRound is already `undefined` at this point). Call `deleteActiveRoom(code)`.

### Import additions needed in rooms.ts

`persistRoomState` must be added to the import from `./ws.ts`. `deleteActiveRoom` must be imported from `./db.ts`.

Current import from ws.ts (line 6):
```ts
import { roomSockets, broadcast, destroyRoom, type RoundConfig, ... } from './ws.ts'
```
Add `persistRoomState` to this import.

Current import from db.ts (line 4):
```ts
import { createRoom, getRoomsByHost, ... deleteRoom, setRoomHostName, type Room } from './db.ts'
```
Add `deleteActiveRoom` to this import.

### destroyRoom patch (ws.ts)

Inside `destroyRoom(code: string)`, after `roomSockets.delete(roomCode)` (line ~123), add:
```ts
deleteActiveRoom(roomCode)   // clear any persisted state for this room
```
This requires importing `deleteActiveRoom` from `./db.ts` in `ws.ts`. `ws.ts` already imports from `./db.ts` — add to that import.

### Startup wiring (index.ts)

Current structure (lines 46–54):
```ts
if (config.nodeEnv !== 'test') {
  startRefreshScheduler()
  const httpServer = serve(...)
  setupWebSocketServer(httpServer)
}
```

After change:
```ts
if (config.nodeEnv !== 'test') {
  startRefreshScheduler()
  const httpServer = serve(...)
  rehydrateRooms()             // ← add here, before WS server
  setupWebSocketServer(httpServer)
}
```

### Host reconnect is free (no changes to handleConnection)

After rehydration, `roomSockets` has the room entry with `host: null`, `hostHasEverConnected: true`. When the host reconnects:
- `wasInMap = true` (set by rehydrate)
- `roomState.host === null` and `roomState.hostHasEverConnected === true`
- So `isReconnect = true` — triggers `host:reconnected` broadcast ✅
- `activeRound?.active` is `true` — triggers round:start + songHistory re-send ✅

### Guest reconnect is free (no changes to handleConnection)

After rehydration, `currentRound.cards` is a proper `Map<string, Tile[]>`. Guest `?name=` param matches a key, `existingCard` is found, card is re-sent with `lateJoin: false`. ✅

### Play after restart behavior

`POST /round/play` → `round.paused === true` (set by rehydrate) → calls `startSong(code, roomState!, round.currentSongIndex)` → `startSong` guard: `round.currentSongIndex !== songIndex` is `false` (same index) → no new history entry appended → re-broadcasts `song:start` for the current song from the top (mid-song position recovery is explicitly NOT required per AC). ✅

### What `active_rooms` contains at any time

- Inserted: after round:start (first persist) and updated on each song:start and round:win
- Deleted: on round:win (after final persist), round:end, destroyRoom
- Rows in this table at server restart = rooms with an active or just-won round

### Testing guidance

Use `initDb(':memory:')` for all DB tests. Test `rehydrateRooms()` by:
1. `initDb(':memory:')`
2. `upsertActiveRoom('ABCD', JSON.stringify(snapshotWithActiveRound))`
3. Call `rehydrateRooms()`
4. Assert `roomSockets.get('ABCD')` has correct reconstructed state

For persist trigger tests, the simplest approach is a direct unit test: call the relevant rooms.ts handler in test (using the existing supertest pattern from `rooms.test.ts`), then query `getDb().prepare('SELECT * FROM active_rooms WHERE room_code = ?').get('ABCD')` to verify the row exists/doesn't exist.

### No TypeScript changes to RoundState/RoomState interfaces

The snapshot is a plain-data type for serialization only — no new TypeScript interface is strictly required. If you add one, call it `RoomSnapshot` and keep it local to `ws.ts`.

### Project Structure Notes

- `src/server/db.ts` — add table + 3 helper functions
- `src/server/ws.ts` — add `persistRoomState`, `rehydrateRooms`, patch `destroyRoom`, add `deleteActiveRoom` to db import
- `src/server/rooms.ts` — add 4 trigger call sites, add `persistRoomState` to ws import, add `deleteActiveRoom` to db import
- `src/server/index.ts` — add `rehydrateRooms` import + call
- `src/server/__tests__/db.test.ts` — add `active_rooms` tests
- `src/server/__tests__/ws.test.ts` — add `rehydrateRooms` test

### References

- [Epic 6-4 acceptance criteria](_bmad-output/planning-artifacts/epics.md#L1053)
- [src/server/db.ts](src/server/db.ts) — add `active_rooms` table + helpers
- [src/server/ws.ts](src/server/ws.ts) — `RoomState` interface, `roomSockets`, `destroyRoom`, `handleConnection`
- [src/server/rooms.ts](src/server/rooms.ts) — `startSong()` (line ~30), round:start broadcast (~line 306), round:win (~line 495), round:end (~line 437)
- [src/server/index.ts](src/server/index.ts) — startup wiring (line ~46)
- [src/server/__tests__/db.test.ts](src/server/__tests__/db.test.ts) — use `initDb(':memory:')` pattern
- [_bmad-output/implementation-artifacts/deferred-work.md](_bmad-output/implementation-artifacts/deferred-work.md) — NFR13 noted as unmet (line ~212)
- Story 5-6 established reconnect re-send logic (still in ws.ts) — do NOT re-implement

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

None — clean implementation, no issues encountered.

### Completion Notes List

- Added `active_rooms` table to SQLite schema (idempotent CREATE TABLE IF NOT EXISTS)
- Added 3 DB helpers: `upsertActiveRoom`, `deleteActiveRoom`, `getAllActiveRooms`
- Implemented `persistRoomState(code)` in ws.ts — serializes RoomState snapshot (omits host/guests/timers) to JSON and upserts into active_rooms
- Implemented `rehydrateRooms()` in ws.ts — reads all active_rooms rows, reconstructs RoomState with host=null, guests=empty Map, paused=true, timers={}, cards as proper Map
- Wired 4 persist triggers in rooms.ts: after round:start broadcast, after song:start broadcast, after round:win (persist then delete), after round:end (delete only)
- Patched `destroyRoom()` to delete active_rooms row on teardown
- Wired `rehydrateRooms()` call in index.ts startup, after initDb and before setupWebSocketServer
- Added 6 DB unit tests and 4 WS integration tests (rehydrate with/without currentRound, round:start persist, round:end delete)
- All 313 tests pass with zero regressions

### Change Log

- 2026-04-06: Implemented server restart state recovery (Story 6-4) — all ACs satisfied

### File List

- src/server/db.ts (modified) — active_rooms table + 3 helper functions
- src/server/ws.ts (modified) — persistRoomState, rehydrateRooms, destroyRoom patch, db imports
- src/server/rooms.ts (modified) — 4 persist trigger call sites, added persistRoomState + deleteActiveRoom imports
- src/server/index.ts (modified) — rehydrateRooms import + startup call
- src/server/__tests__/db.test.ts (modified) — active_rooms test suite (6 tests)
- src/server/__tests__/ws.test.ts (modified) — rehydrateRooms + persist trigger tests (4 tests)
