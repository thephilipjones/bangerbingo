# Story 5.1: Song Scheduling & Host Playback Controls

Status: done

## Story

As a host,
I want to start playback and have songs advance automatically,
so that the game loop runs without me manually triggering every song.

## Acceptance Criteria

1. `POST /api/rooms/:code/round/play` — when `currentSongIndex === -1` (not yet started), server broadcasts `song:start` for the first track (index 0) to all connected clients and schedules auto-advance and reveal timers as appropriate.
2. `POST /api/rooms/:code/round/play` — when `paused === true` (mid-song pause), server re-broadcasts `song:start` for the current `currentSongIndex` (no index increment) and reschedules timers.
3. `POST /api/rooms/:code/round/next` — server cancels pending timers, increments `currentSongIndex`, and broadcasts `song:start` for the new track; if already on the last track, broadcasts `songs:exhausted` instead.
4. `POST /api/rooms/:code/round/pause` — server cancels all pending timers, sets `paused = true`, and broadcasts `song:pause` with `{ songIndex }` to all clients.
5. `song:start` payload includes: `trackId`, `title`, `artist`, `albumArtUrl`, `seekPositionMs` (fixed `60_000` ms for MVP), `clipDuration`, `titleRevealDelay`, `songIndex`, `roundNumber`.
6. When `titleRevealDelay` is `> 0` (seconds), server schedules a `setTimeout` for `titleRevealDelay * 1000` ms that broadcasts `song:reveal` with `{ trackId, songIndex }`; this timer is cancelled on advance, pause, or round end.
7. When `clipDuration` is a number (clip mode — 20/30/45/60), server schedules a `setTimeout` for `clipDuration * 1000` ms that auto-advances to the next song (identical to calling `POST /round/next` internally); this timer is cancelled on manual advance, pause, or round end.
8. When `clipDuration === 'full'`, no auto-advance timer is scheduled; host must manually call `POST /round/next`.
9. Each played track is appended to `currentRound.songHistory` before broadcast, enabling win validation (Story 5-5) and history drawer delivery (Story 5-6).
10. All three endpoints return HTTP 403 if the authenticated host does not own the room; return HTTP 404 if no active round exists.
11. All three endpoints respond within 500 ms under normal conditions (NFR1).
12. `song:start` broadcasts reach all connected clients within 200 ms on a typical home network (NFR2).
13. `POST /api/rooms/:code/round` (existing endpoint from Story 4-3) is updated to initialise the new `RoundState` fields (`currentSongIndex: -1`, `songHistory: []`, `paused: false`, `timers: {}`).

## Tasks / Subtasks

- [x] Extend `RoundState` interface and add `SongHistoryEntry` interface in `src/server/ws.ts` (AC: 1–13)
  - [x] Add `SongHistoryEntry` interface (exported): `{ trackId, title, artist, albumArtUrl, songIndex }`
  - [x] Add to `RoundState`: `currentSongIndex: number`, `songHistory: SongHistoryEntry[]`, `paused: boolean`, `timers: { autoAdvance?: ReturnType<typeof setTimeout>; reveal?: ReturnType<typeof setTimeout> }`
  - [x] Export `SongHistoryEntry` so `rooms.ts` can import it

- [x] Update `POST /api/rooms/:code/round` in `src/server/rooms.ts` to initialise new fields (AC: 13)
  - [x] In the `roomState.currentRound = { ... }` assignment, add: `currentSongIndex: -1, songHistory: [], paused: false, timers: {}`

- [x] Add shared song-advance helper and `SEEK_POSITION_MS` constant to `src/server/rooms.ts` (AC: 1–9)
  - [x] Add `const SEEK_POSITION_MS = 60_000` at module top
  - [x] Add private helper `clearRoundTimers(round: RoundState): void` — calls `clearTimeout` on both timer slots, sets them to `undefined`
  - [x] Add private helper `startSong(roomCode: string, roomState: RoomState, songIndex: number): void`:
    - Clears existing timers
    - Appends `SongHistoryEntry` to `round.songHistory`
    - Sets `round.currentSongIndex = songIndex` and `round.paused = false`
    - Calls `broadcast(roomCode, song:start payload)`
    - Schedules reveal timer if `titleRevealDelay > 0`
    - Schedules auto-advance timer if `clipDuration !== 'full'`
  - [x] Add private helper `advanceToNext(roomCode: string, roomState: RoomState): void`:
    - Clears timers
    - Computes `nextIndex = round.currentSongIndex + 1`
    - If `nextIndex >= round.playlist.length` → broadcast `{ type: 'songs:exhausted' }`, return
    - Else → calls `startSong(roomCode, roomState, nextIndex)`

- [x] Add `POST /api/rooms/:code/round/play` to `src/server/rooms.ts` (AC: 1, 2, 5–9, 10, 11)
  - [x] Auth check: `requireAuth` middleware already applied at router level; add explicit owner check
  - [x] Return 404 if `!roomState?.currentRound?.active`
  - [x] If `currentSongIndex === -1` → call `startSong(code, roomState, 0)`
  - [x] Else if `paused === true` → call `startSong(code, roomState, currentSongIndex)` (re-broadcast same index)
  - [x] Else → return 400 `{ message: 'Round is already playing' }`
  - [x] Return 200 `{ songIndex: currentRound.currentSongIndex }`

- [x] Add `POST /api/rooms/:code/round/next` to `src/server/rooms.ts` (AC: 3, 10, 11)
  - [x] Owner check, 404 if no active round
  - [x] Call `advanceToNext(code, roomState)`
  - [x] Return 200 `{ songIndex: currentRound.currentSongIndex }`

- [x] Add `POST /api/rooms/:code/round/pause` to `src/server/rooms.ts` (AC: 4, 10, 11)
  - [x] Owner check, 404 if no active round
  - [x] Call `clearRoundTimers(round)`, set `round.paused = true`
  - [x] Call `broadcast(code, { type: 'song:pause', songIndex: round.currentSongIndex })`
  - [x] Return 200

- [x] Add tests to `src/server/__tests__/rooms.test.ts` (AC: 1–13)
  - [x] `POST /round/play` — broadcasts `song:start` with correct payload (first song, seekPositionMs=60000)
  - [x] `POST /round/play` on paused round — re-broadcasts same song index
  - [x] `POST /round/play` returns 400 when already playing
  - [x] `POST /round/next` — advances song index, cancels previous auto-advance timer
  - [x] `POST /round/pause` — broadcasts `song:pause`, cancels timers
  - [x] Auto-advance timer: `vi.useFakeTimers()`, call `/round/play` with clip mode, advance time by `clipDuration * 1000`, assert second `song:start` received
  - [x] `song:reveal` timer: fake timers, advance by `titleRevealDelay * 1000`, assert `song:reveal` received
  - [x] `POST /round/next` on last song → broadcasts `songs:exhausted`
  - [x] All three endpoints return 403 for non-owner host
  - [x] All three endpoints return 404 when no active round
  - [x] `songHistory` entries are appended correctly (one per `startSong` call)

## Dev Notes

### CRITICAL: This story is server-side only — no client changes

`RoomPage.svelte` currently shows only the host-disconnect banner and "Waiting for the host…" placeholder. Do NOT modify it in this story. The client-side card UI, tile marking, and host controls panel are built in Stories 5-2, 5-3, and 5-4.

### Extending `RoundState` in ws.ts — exact additions

```ts
// Add to ws.ts exports:
export interface SongHistoryEntry {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  songIndex: number
}

export interface RoundState {
  roundNumber: number
  config: RoundConfig
  playlist: Track[]
  cards: Map<string, Tile[]>
  roundStartPayload: object
  sessionPlayedIds: string[]
  active: boolean
  // ── NEW in Story 5-1 ──────────────────────────────────────────
  currentSongIndex: number        // -1 = round not yet started
  songHistory: SongHistoryEntry[] // append-only; used by 5-5 win validation + 5-6 drawer
  paused: boolean                 // true after /pause; cleared on /play
  timers: {
    autoAdvance?: ReturnType<typeof setTimeout>
    reveal?: ReturnType<typeof setTimeout>
  }
}
```

Also import `SongHistoryEntry` in `rooms.ts`:
```ts
import { roomSockets, broadcast, type RoundConfig, type ClipDuration, type TitleRevealDelay, type RoundState, type SongHistoryEntry } from './ws.ts'
```

### Update existing `POST /api/rooms/:code/round` initialiser in rooms.ts

Find the `roomState.currentRound = { ... }` block (added in Story 4-3) and add the new fields:

```ts
roomState.currentRound = {
  roundNumber,
  config: roundConfig,
  playlist,
  cards,
  roundStartPayload,
  sessionPlayedIds: newSessionPlayed,
  active: true,
  // NEW:
  currentSongIndex: -1,
  songHistory: [],
  paused: false,
  timers: {},
}
```

### Private helpers in rooms.ts (do not export)

```ts
const SEEK_POSITION_MS = 60_000  // Fixed chorus-position offset for MVP (validated in Epic 2 spike)

function clearRoundTimers(round: RoundState): void {
  clearTimeout(round.timers.autoAdvance)
  clearTimeout(round.timers.reveal)
  round.timers.autoAdvance = undefined
  round.timers.reveal = undefined
}

function startSong(roomCode: string, roomState: RoomState, songIndex: number): void {
  const round = roomState.currentRound!
  const track = round.playlist[songIndex]

  clearRoundTimers(round)

  const entry: SongHistoryEntry = {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    albumArtUrl: track.albumArtUrl,
    songIndex,
  }
  round.songHistory.push(entry)
  round.currentSongIndex = songIndex
  round.paused = false

  broadcast(roomCode, {
    type: 'song:start',
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    albumArtUrl: track.albumArtUrl,
    seekPositionMs: SEEK_POSITION_MS,
    clipDuration: round.config.clipDuration,
    titleRevealDelay: round.config.titleRevealDelay,
    songIndex,
    roundNumber: round.roundNumber,
  })

  // song:reveal timer (titleRevealDelay is in seconds; 0 and null = no timer)
  if (round.config.titleRevealDelay && round.config.titleRevealDelay > 0) {
    round.timers.reveal = setTimeout(() => {
      broadcast(roomCode, { type: 'song:reveal', trackId: track.id, songIndex })
    }, round.config.titleRevealDelay * 1000)
  }

  // auto-advance timer (clip mode only)
  if (round.config.clipDuration !== 'full') {
    round.timers.autoAdvance = setTimeout(() => {
      advanceToNext(roomCode, roomState)
    }, (round.config.clipDuration as number) * 1000)
  }
}

function advanceToNext(roomCode: string, roomState: RoomState): void {
  const round = roomState.currentRound
  if (!round?.active) return
  clearRoundTimers(round)
  const nextIndex = round.currentSongIndex + 1
  if (nextIndex >= round.playlist.length) {
    broadcast(roomCode, { type: 'songs:exhausted' })
    return
  }
  startSong(roomCode, roomState, nextIndex)
}
```

**Note:** `roomState` is of type `RoomState` from ws.ts. Locally re-declare it where needed or add the type alias:
```ts
type RoomState = ReturnType<typeof roomSockets.get> extends infer T | undefined ? NonNullable<T> : never
```
Or just use the inline shape — ws.ts doesn't export `RoomState` directly, only the contents. Check what ws.ts exports and import accordingly.

Actually — ws.ts exports `roomSockets` but not the `RoomState` interface because it's declared `interface` (not `export interface`). You'll need to either:
- Export `RoomState` from ws.ts (add `export` keyword)
- Or inline the type check (`roomSockets.get(code)!`)

**Recommended:** Export `RoomState` from ws.ts alongside `RoundState`. Add `export` to the `interface RoomState { ... }` declaration.

### New route handlers — pattern to follow

Add after the existing `roomsRouter.post('/rooms/:code/round', ...)` handler. Use the exact same pattern for auth + owner check:

```ts
roomsRouter.post('/rooms/:code/round/play', requireAuth, (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  const round = roomState?.currentRound
  if (!round?.active) return ctx.json({ message: 'No active round' }, 404)

  if (round.currentSongIndex === -1) {
    startSong(code, roomState!, 0)
  } else if (round.paused) {
    startSong(code, roomState!, round.currentSongIndex)
  } else {
    return ctx.json({ message: 'Round is already playing' }, 400)
  }

  return ctx.json({ songIndex: round.currentSongIndex })
})
```

### Timer management edge cases

- **Pause then play resumes same song**: `startSong(code, roomState, currentSongIndex)` re-broadcasts `song:start` for the same track at `seekPositionMs`. This re-sends to the SDK to seek back to 60s and re-start the clip. This is intentional — pause/play is a host control, not mid-clip interruption.
- **Double play guard**: if `!paused && currentSongIndex >= 0`, return 400. Prevents duplicate timers if host double-taps.
- **Timer in auto-advance fires after round ends**: guard in `advanceToNext` with `if (!round?.active) return` catches this.

### `RoomState` reference note

`rooms.ts` currently accesses roomSockets entries as `roomSockets.get(code)`. The type is currently the inline object shape. To avoid type-casting, export `RoomState` from ws.ts:

```ts
// ws.ts — change interface to export interface:
export interface RoomState { ... }
```

This is a non-breaking addition. `rooms.ts` can then `import type { ..., RoomState } from './ws.ts'`.

### Testing with fake timers

```ts
describe('song scheduling', () => {
  beforeEach(() => {
    initDb(':memory:')
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-advance fires after clipDuration', async () => {
    seedHost()
    const code = 'ABCD'
    await seedRoom(hostUserId, code)

    // Seed active round with clip mode
    const roomState = roomSockets.get(code)!
    roomState.currentRound = {
      roundNumber: 1,
      config: { playlistId: 'x', clipDuration: 20, titleRevealDelay: 0, roundNumber: 1 },
      playlist: makeTracks(5),
      cards: new Map(),
      roundStartPayload: {},
      sessionPlayedIds: [],
      active: true,
      currentSongIndex: -1,
      songHistory: [],
      paused: false,
      timers: {},
    }

    // Mock the host WS to capture broadcasts
    const sentMessages: string[] = []
    const mockWs = { readyState: 1, send: (msg: string) => sentMessages.push(msg) } as unknown as WebSocket
    roomState.host = mockWs

    // POST /round/play
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: `session=${hostUserId}` },
    })
    expect(res.status).toBe(200)

    // First song:start immediately
    expect(sentMessages).toHaveLength(1)
    const firstStart = JSON.parse(sentMessages[0])
    expect(firstStart.type).toBe('song:start')
    expect(firstStart.songIndex).toBe(0)
    expect(firstStart.seekPositionMs).toBe(60_000)

    // Advance fake time by clip duration
    vi.advanceTimersByTime(20_000)
    expect(sentMessages).toHaveLength(2)
    const secondStart = JSON.parse(sentMessages[1])
    expect(secondStart.type).toBe('song:start')
    expect(secondStart.songIndex).toBe(1)
  })
})
```

**Timer import note:** `vi.useFakeTimers()` in vitest replaces global `setTimeout`/`clearTimeout`, which affects the Node.js runtime used by rooms.ts. This works correctly in vitest's test environment.

### WS event contract (must match exactly — from epics.md Additional Requirements)

These contracts are consumed by the client in Stories 5-2, 5-3, 5-4:

```ts
// song:start
{ type: 'song:start', trackId: string, title: string, artist: string,
  albumArtUrl: string, seekPositionMs: number, clipDuration: ClipDuration,
  titleRevealDelay: TitleRevealDelay, songIndex: number, roundNumber: number }

// song:reveal  
{ type: 'song:reveal', trackId: string, songIndex: number }

// song:pause
{ type: 'song:pause', songIndex: number }

// songs:exhausted
{ type: 'songs:exhausted' }
```

### Do NOT touch

- `src/server/music/` — no Spotify API calls in this story
- `src/server/auth.ts`, `src/server/refresh.ts` — no token changes
- `src/server/game/cards.ts` — no card logic changes
- `src/client/` — this story is entirely server-side
- `src/server/__tests__/ws.test.ts` — don't add timer tests here; the ws test file uses a real HTTP server which makes fake timers unreliable; use `rooms.test.ts` instead
- Existing 168 passing tests must not regress

### Test seed helper — add to rooms.test.ts

The existing `seedRoom()` helper creates a room in DB and roomSockets. For 5-1 tests, also need to seed an active round:

```ts
import type { RoundState } from '../ws.ts'
import type { Track } from '../music/spotify.ts'

function makeTracksLocal(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `track_${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    albumArtUrl: '',
  }))
}

function seedActiveRound(code = 'ABCD', clipDuration: ClipDuration = 30, titleRevealDelay: TitleRevealDelay = 5): RoundState {
  const roomState = roomSockets.get(code)!
  const round: RoundState = {
    roundNumber: 1,
    config: { playlistId: 'test_playlist', clipDuration, titleRevealDelay, roundNumber: 1 },
    playlist: makeTracksLocal(10),
    cards: new Map(),
    roundStartPayload: {},
    sessionPlayedIds: [],
    active: true,
    currentSongIndex: -1,
    songHistory: [],
    paused: false,
    timers: {},
  }
  roomState.currentRound = round
  return round
}
```

### References

- `RoundState`, `RoundConfig`, `ClipDuration`, `TitleRevealDelay`, `roomSockets`, `broadcast`: `src/server/ws.ts`
- `Tile` interface: `src/server/game/cards.ts`
- `Track` interface: `src/server/music/spotify.ts`
- `requireAuth`, `AuthEnv`: `src/server/auth.ts`
- `getRoomByCode`, `getHostById`: `src/server/db.ts`
- Existing route pattern: `src/server/rooms.ts` — `POST /rooms/:code/round`
- WS event contracts: epics.md Additional Requirements section
- Auto-advance / song:reveal behaviour: epics.md UX-DR9, FR21, FR28
- Fixed 60s seek position: Epic 2 spike findings (spike-sdk.html `position_ms: 60000`)
- `vi.useFakeTimers()` pattern: vitest docs; used in same process as Hono test client (`app.fetch`)
- Test `seedRoom()` helper: `src/server/__tests__/rooms.test.ts`
- Test mock WS pattern (readyState + send): `src/server/__tests__/rooms.test.ts` round:start broadcast tests (Story 4-3)
- Story 5-5 will read `currentRound.songHistory` for win validation (claim endpoint checks `songHistory` contains claimed tiles)
- Story 5-6 will read `currentRound.songHistory` for history drawer delivery on late-join

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Exported `RoomState` interface from `ws.ts` (was previously private); added `SongHistoryEntry` export; extended `RoundState` with `currentSongIndex`, `songHistory`, `paused`, `timers`.
- Updated `POST /rooms/:code/round` initialiser to set the four new fields.
- Added `SEEK_POSITION_MS = 60_000`, `clearRoundTimers`, `startSong`, `advanceToNext` helpers in `rooms.ts`.
- Added `POST /rooms/:code/round/play`, `/next`, `/pause` route handlers.
- Added 18 new tests (43 total in rooms.test.ts, up from 25); full suite passes at 186 tests with no regressions.

### File List

- `src/server/ws.ts` — export `RoomState`; add `SongHistoryEntry` interface; extend `RoundState` with `currentSongIndex`, `songHistory`, `paused`, `timers`
- `src/server/rooms.ts` — update `POST /rooms/:code/round` initialiser; add `SEEK_POSITION_MS` constant; add `clearRoundTimers`, `startSong`, `advanceToNext` helpers; add `POST /rooms/:code/round/play`, `/next`, `/pause` routes
- `src/server/__tests__/rooms.test.ts` — add `seedActiveRound` helper; add tests for play/next/pause/timers/exhausted/403/404

## Change Log

- 2026-04-04: Story created by bmad-create-story workflow — comprehensive context from full codebase analysis (Epics 1–4 complete, 168 tests passing, exact RoundState/rooms.ts/ws.ts shapes confirmed)
- 2026-04-04: Story implemented by claude-sonnet-4-6 — all tasks complete, 18 tests added, 186 tests passing, status → review
- 2026-04-04: Code review completed — 2 decision-needed, 5 patch, 3 deferred, 2 dismissed

## Review Findings

### decision-needed

- [x] [Review][Decision] Pre-game `/pause` broadcasts `song:pause` with `songIndex: -1` → **resolved: block it** — add 400 guard when `currentSongIndex === -1`; converted to patch below
- [x] [Review][Decision] `titleRevealDelay === 0` semantics → **resolved: `0` = no reveal** — server is already correct per spec ("when `titleRevealDelay > 0`"); dismissed. Add negative-assertion test (no `song:reveal` fires when `titleRevealDelay === 0`) converted to patch below

### patch

- [x] [Review][Patch] `songHistory` duplicate entry on pause-resume — `startSong` unconditionally appends to `songHistory`; calling `/round/play` on a paused round pushes a second entry for the same `songIndex`, corrupting win validation (Story 5-5) and history drawer (Story 5-6) [src/server/rooms.ts]
- [x] [Review][Patch] `/round/next` HTTP response returns stale `currentSongIndex` on exhaustion — `advanceToNext` returns early on `songs:exhausted` without updating `currentSongIndex`; the 200 response gives the old index with no signal that exhaustion occurred [src/server/rooms.ts]
- [x] [Review][Patch] `startSong` crashes on empty/out-of-bounds playlist — `round.playlist[songIndex]` is not bounds-checked; accessing `.id` on `undefined` throws TypeError if playlist is empty or index is invalid [src/server/rooms.ts]
- [x] [Review][Patch] Stale auto-advance timer fires on new round — `advanceToNext` closure captures `roomState` by reference; if `/round` creates a new round before the clip timer expires, the old timer advances the new round unintentionally [src/server/rooms.ts]
- [x] [Review][Patch] Missing `albumArtUrl` assertion in `song:start` test — AC5 requires `albumArtUrl` in payload but the broadcast test never asserts it [src/server/__tests__/rooms.test.ts]
- [x] [Review][Patch] `/pause` returns 400 when `currentSongIndex === -1` (pre-game pause guard) [src/server/rooms.ts]
- [x] [Review][Patch] Add negative test: no `song:reveal` fires when `titleRevealDelay === 0` [src/server/__tests__/rooms.test.ts]

### defer

- [x] [Review][Defer] `/next` silently unpauses a paused round [src/server/rooms.ts] — deferred; spec (AC3) has no guard against calling `/next` while paused; current behavior advances and clears paused state
- [x] [Review][Defer] Round stays `active: true` after `songs:exhausted` [src/server/rooms.ts] — deferred; spec does not require deactivation on exhaustion; post-exhaustion `/play` returning 400 is acceptable for MVP
- [x] [Review][Defer] Stale fired timer IDs retained in `round.timers` after expiry [src/server/rooms.ts] — deferred; `clearTimeout` on a fired timer is a no-op, functionally harmless for MVP
