# Story 4.3: Card Generation & Round Start Broadcast

Status: ready-for-dev

## Story

As a player,
I want to receive a unique bingo card when the host starts a round,
So that I can play immediately without duplicate or repeated tiles.

## Acceptance Criteria

1. When the host's `POST /api/rooms/:code/round` is processed, the server fetches the full track list for the selected playlist; if fewer than 25 tracks are returned the request fails with a 422.
2. The server generates a unique 5×5 card for every connected player (including the host): 25 tiles sampled without replacement from the pool, shuffled independently per player; no two players receive identical cards.
3. The centre tile (position index 12 in a 0-indexed 25-element array) is always FREE for every card.
4. Songs played in earlier rounds of the same session are down-ranked (moved to the back of the candidate pool before sampling), not excluded.
5. Songs played in previous sessions for the same room are looked up from SQLite and also down-ranked before sampling.
6. A `round:start` WebSocket event is broadcast to every connected client with their own card, `clipDuration`, `titleRevealDelay`, `roundNumber`, and the full ordered `playlist`.
7. A guest who connects after `round:start` receives a fresh blank card and the current round payload in their `session:connect` response.
8. The `played_songs` SQLite table is updated with the track IDs dealt this round, keyed by `roomId`.

## Tasks / Subtasks

- [ ] Add `played_songs` table + helpers to `src/server/db.ts` (AC: 5, 8)
  - [ ] Add migration to `initDb()` `db.exec()` block: `CREATE TABLE IF NOT EXISTS played_songs (room_id TEXT NOT NULL, track_id TEXT NOT NULL, played_at INTEGER NOT NULL, PRIMARY KEY (room_id, track_id))`
  - [ ] Add `getPlayedSongs(roomId: string): string[]`
  - [ ] Add `recordPlayedSongs(roomId: string, trackIds: string[]): void`

- [ ] Create `src/server/game/cards.ts` — pure card generation logic (AC: 2, 3, 4, 5)
  - [ ] Export `buildPool(tracks: Track[], sessionPlayedIds: string[], historicPlayedIds: string[]): Track[]`
  - [ ] Export `generateCard(pool: Track[]): Tile[]`
  - [ ] Export `generateCards(pool: Track[], playerIds: string[]): Map<string, Tile[]>`

- [ ] Extend `RoomState` in `src/server/ws.ts` and add `RoundState` (AC: 6, 7)
  - [ ] Add `RoundState` interface and `currentRound?: RoundState` to `RoomState`
  - [ ] Export `RoundState` for use in rooms.ts

- [ ] Wire card generation into `POST /api/rooms/:code/round` in `src/server/rooms.ts` (AC: 1–8)
  - [ ] After validation: fetch tracks via `getPlaylistTracks`, build pool, generate cards, broadcast `round:start`, update SQLite
  - [ ] Inline token refresh before Spotify call (same pattern as `src/server/music/router.ts`)

- [ ] Late-join handling in `src/server/ws.ts` (AC: 7)
  - [ ] In guest `session:connect` path: if `roomState.currentRound` exists, generate a blank card and include round payload in response

- [ ] Tests in `src/server/__tests__/cards.test.ts` and add to `rooms.test.ts` (AC: 1–8)
  - [ ] Pure unit tests for `buildPool`, `generateCard`, `generateCards` in `cards.test.ts`
  - [ ] Integration tests for the full `POST /api/rooms/:code/round` flow in `rooms.test.ts`
  - [ ] Late-join test in `ws.test.ts`

## Dev Notes

### CRITICAL: `POST /api/rooms/:code/round` already exists in rooms.ts — extend it, don't replace it

Story 4-2 added this endpoint. It currently validates input and stores `pendingRound` on `roomSockets`. **This story extends that handler** to do the actual work after validation. The structure will be:

```ts
roomsRouter.post('/rooms/:code/round', requireAuth, async (ctx) => {
  // ... existing validation from 4-2 (room check, input validation) ...
  
  // NEW: inline token refresh
  // NEW: fetch tracks via getPlaylistTracks
  // NEW: build pool and generate cards
  // NEW: store currentRound on roomSockets entry
  // NEW: broadcast round:start
  // NEW: record played_songs in SQLite
  
  return ctx.json(roundConfig)
})
```

The `pendingRound` field added in 4-2 can be removed once `currentRound` replaces it, or kept for backward compatibility — your call.

### Inline token refresh — exact pattern from music/router.ts

```ts
import { refreshWithRetry, isHostDegraded } from './refresh.ts'
import { getHostById, getPlayedSongs, recordPlayedSongs } from './db.ts'

// After validation, before Spotify call:
let host = ctx.var.host
if (host.token_expires_at - Date.now() < 60_000) {
  await refreshWithRetry(host.user_id)
  if (isHostDegraded(host.user_id)) {
    return ctx.json({ message: 'Spotify authentication degraded — please re-authenticate' }, 503)
  }
  const refreshed = getHostById(host.user_id)
  if (!refreshed) return ctx.json({ message: 'Unauthorized' }, 401)
  host = refreshed
}
```

### File: `src/server/game/cards.ts`

This is the second subdirectory introduced (after `src/server/music/`). Follow the same pattern.

```ts
import type { Track } from '../music/spotify.ts'  // reuse the Track type from 4-1

export interface Tile {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  free?: true  // only set on centre tile (index 12)
}
```

**`buildPool` logic:**
```ts
export function buildPool(
  tracks: Track[],
  sessionPlayedIds: string[],
  historicPlayedIds: string[]
): Track[] {
  // Deduplicate: a track in both lists is only down-ranked once
  const allDownranked = new Set([...sessionPlayedIds, ...historicPlayedIds])
  const fresh = tracks.filter(t => !allDownranked.has(t.id))
  const downranked = tracks.filter(t => allDownranked.has(t.id))
  return [...shuffle(fresh), ...shuffle(downranked)]
}
```

**`generateCard` logic:**
```ts
export function generateCard(pool: Track[]): Tile[] {
  // Take first 25 from pool (caller guarantees pool.length >= 25)
  const sample = pool.slice(0, 25)
  const tiles: Tile[] = shuffle(sample).map(t => ({
    trackId: t.id,
    title: t.title,
    artist: t.artist,
    albumArtUrl: t.albumArtUrl,
  }))
  // Force centre tile (index 12) to FREE — overwrite whatever is there
  tiles[12] = { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
  return tiles
}
```

**`generateCards` logic:**
```ts
export function generateCards(pool: Track[], playerIds: string[]): Map<string, Tile[]> {
  const cards = new Map<string, Tile[]>()
  const generated: string[] = []  // JSON snapshots for collision detection

  for (const id of playerIds) {
    let card: Tile[]
    let attempts = 0
    do {
      card = generateCard(pool)
      attempts++
    } while (attempts < 4 && generated.includes(cardKey(card)))
    cards.set(id, card)
    generated.push(cardKey(card))
  }
  return cards
}

// Collision key: only non-FREE tile IDs in order
function cardKey(card: Tile[]): string {
  return card.filter(t => !t.free).map(t => t.trackId).join(',')
}
```

**Fisher-Yates shuffle (private helper):**
```ts
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
```

### Extending RoomState in ws.ts

Add `RoundState` and `currentRound` field. Export `RoundState` so `rooms.ts` can import it:

```ts
import type { Track } from './music/spotify.ts'
import type { Tile } from './game/cards.ts'

export interface RoundState {
  roundNumber: number
  config: RoundConfig
  playlist: Track[]
  cards: Map<string, Tile[]>   // playerKey → card (host: userId, guests: name)
  roundStartPayload: object     // cached for late joiners
  sessionPlayedIds: string[]    // tracks played this session (grows across rounds)
  active: boolean
}

interface RoomState {
  host: WebSocket | null
  hostUserId: string
  hostHasEverConnected: boolean
  guests: Map<string, WebSocket>
  pendingRound?: RoundConfig     // set by 4-2, consumed here
  currentRound?: RoundState      // set by this story
}
```

### round:start broadcast — per-client payload

Each connected client gets their own card. The host key is `hostUserId`; guest keys are their names (matching `roomState.guests` Map keys):

```ts
// Broadcast to host
if (roomState.host?.readyState === WebSocket.OPEN) {
  const hostCard = cards.get(roomState.hostUserId) ?? []
  roomState.host.send(JSON.stringify({
    type: 'round:start',
    roundNumber,
    card: hostCard,
    playlist,
    clipDuration,
    titleRevealDelay,
  }))
}

// Broadcast to each guest
for (const [guestName, ws] of roomState.guests) {
  if (ws.readyState === WebSocket.OPEN) {
    const guestCard = cards.get(guestName) ?? []
    ws.send(JSON.stringify({
      type: 'round:start',
      roundNumber,
      card: guestCard,
      playlist,
      clipDuration,
      titleRevealDelay,
    }))
  }
}
```

Do NOT use the existing `broadcast()` helper here — it sends the same payload to everyone. Each player needs their own card.

### Late-join handling in ws.ts guest path

In the existing guest `session:connect` handler, after `roomState.guests.set(name, ws)`:

```ts
// If a round is in progress, send round:start with a blank card
const round = roomState.currentRound
if (round?.active) {
  const blankCard: Tile[] = Array.from({ length: 25 }, (_, i) =>
    i === 12
      ? { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
      : { trackId: '', title: '', artist: '', albumArtUrl: '' }
  )
  ws.send(JSON.stringify({
    ...round.roundStartPayload,
    card: blankCard,
    lateJoin: true,
  }))
}
```

### played_songs helpers in db.ts

Add directly to the existing `db.ts` file (not a new file):

```ts
export function getPlayedSongs(roomId: string): string[] {
  return (db.prepare('SELECT track_id FROM played_songs WHERE room_id = ?').all(roomId) as Array<{ track_id: string }>)
    .map(r => r.track_id)
}

export function recordPlayedSongs(roomId: string, trackIds: string[]): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO played_songs (room_id, track_id, played_at) VALUES (?, ?, ?)'
  )
  const now = Date.now()
  for (const trackId of trackIds) {
    stmt.run(roomId, trackId, now)
  }
}
```

`INSERT OR IGNORE` handles the case where the same track was dealt in a previous session of the same room.

### Session-played tracking — where it lives

`sessionPlayedIds` accumulates across rounds within a single server session (in-memory only, not persisted). Store on `RoundState` as a growing list:

```ts
// When starting a new round:
const previousSessionPlayed = roomState.currentRound?.sessionPlayedIds ?? []
const newSessionPlayed = [...previousSessionPlayed, ...dealtTrackIds]

roomState.currentRound = {
  // ...
  sessionPlayedIds: newSessionPlayed,
}
```

### Testing patterns

**Unit tests for cards.ts — no DB, no Hono:**
```ts
// src/server/__tests__/cards.test.ts
import { describe, it, expect } from 'vitest'
import { buildPool, generateCard, generateCards } from '../game/cards.ts'
import type { Track } from '../music/spotify.ts'

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `track_${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    albumArtUrl: '',
  }))
}
```

**Integration tests for POST round — mock fetch + WS:**
Add to `src/server/__tests__/rooms.test.ts`. Mock `getPlaylistTracks` from `../music/spotify.ts` to return 30 tracks. Seed a room in `roomSockets` with a host WebSocket mock and 1-2 guest WebSocket mocks. Assert:
- `round:start` sent to each WS with the correct structure
- Each client gets a different card (different `card[0].trackId`)
- `played_songs` table has entries after the call

**WS late-join test:** Add to `src/server/__tests__/ws.test.ts`. Connect host, start round (call POST endpoint), then connect guest. Assert guest `session:connect` response includes `type: 'round:start'` and `lateJoin: true`.

### What to mock in integration tests

`getPlaylistTracks` is the only external call triggered by this endpoint (after inline refresh). Mock it at the module level:
```ts
const spotifyModule = await import('../music/spotify.ts')
vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))
```

### Do NOT touch

- `src/server/music/` — no changes needed
- `src/client/` — this story is entirely server-side; the client already handles `round:start` in Epic 5
- `src/server/auth.ts`, `src/server/refresh.ts` — no changes needed
- Existing tests — must not regress; currently 134 passing

## References
- `Track` interface: `src/server/music/spotify.ts` (export from 4-1)
- `RoundConfig`, `ClipDuration`, `TitleRevealDelay`, `roomSockets`, `broadcast`: `src/server/ws.ts`
- `getPlaylistTracks`: `src/server/music/spotify.ts`
- `refreshWithRetry`, `isHostDegraded`: `src/server/refresh.ts`
- `getHostById`, `getRoomByCode`, `getPlayedSongs`, `recordPlayedSongs`: `src/server/db.ts`
- `POST /api/rooms/:code/round` existing handler: `src/server/rooms.ts`
- Test patterns: `vi.stubEnv` + dynamic import, `initDb(':memory:')`, `vi.spyOn(global, 'fetch')` [Source: `src/server/__tests__/music.test.ts`]
- `roomSockets.set` seeding pattern for tests [Source: `src/server/__tests__/rooms.test.ts` — `seedRoom()`]
- FR25, FR26, FR31, FR32 [Source: epics.md]
- Down-rank not exclude; `round:start` WS event contract [Source: epics.md Additional Requirements]

## Change Log
- 2026-04-04: Story created by create-epics-and-stories workflow
- 2026-04-04: Enriched with full implementation context (4-1 and 4-2 complete, full codebase analysed)
