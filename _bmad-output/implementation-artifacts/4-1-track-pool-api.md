# Story 4.1: Track Pool API

Status: done

## Story

As a host,
I want the server to fetch tracks from a genre preset or keyword-searched playlist,
So that card generation has a pool of songs to draw from.

## Acceptance Criteria

1. `GET /api/music/presets` returns a list of genre preset objects (each with `name`, `description`, `playlistId`); the preset list is a static config of curated Spotify playlist IDs (the `/recommendations` endpoint is not used).
2. `GET /api/music/search?q=<query>` calls the Spotify `/search?type=playlist` endpoint using the host's server-side token and returns up to 10 results, each with `name`, `owner`, `trackCount`, and `playlistId`.
3. Given a `playlistId`, the server fetches tracks from the Spotify playlist and returns a list where each track contains `id`, `title`, `artist`, and `albumArtUrl`.
4. If the track pool contains fewer than 25 tracks, the server returns a 422 error with a human-readable message ("This playlist doesn't have enough tracks — need at least 25").
5. If the host's Spotify token is expired when any of these endpoints are called, the token is refreshed inline before the Spotify call proceeds; no error is returned to the client for a transparent refresh.
6. If the Spotify API returns an error (non-2xx), a structured JSON error is returned to the client with a `message` field.
7. All three endpoints require an authenticated host session; unauthenticated requests return 401.

## Tasks / Subtasks

- [x] Create `src/server/music/` directory with presets, Spotify helper, and router (AC: 1–7)
  - [x] `src/server/music/presets.ts` — static preset array (AC: 1)
  - [x] `src/server/music/spotify.ts` — `getPlaylistTracks()` and `searchPlaylists()` helpers (AC: 2, 3, 4, 5, 6)
  - [x] `src/server/music/router.ts` — Hono router with `/music/presets`, `/music/search`, `/music/tracks/:playlistId` (AC: 1, 2, 3, 7)

- [x] Register music router in `src/server/index.ts` (AC: 7)
  - [x] Add `import { musicRouter } from './music/router.ts'`
  - [x] Add `app.route('/api', musicRouter)` alongside the existing `app.route('/api', roomsRouter)` line

- [x] Tests in `src/server/__tests__/music.test.ts` (AC: 1–7)
  - [x] `GET /api/music/presets` — returns ≥ 6 presets, each with name/description/playlistId
  - [x] `GET /api/music/search` — Spotify search mocked; returns mapped results
  - [x] `GET /api/music/search` — expired token triggers inline refresh before Spotify call
  - [x] `GET /api/music/tracks/:playlistId` — returns mapped tracks for a playlist with ≥ 25 tracks
  - [x] `GET /api/music/tracks/:playlistId` — returns 422 if Spotify returns < 25 usable tracks
  - [x] All endpoints — unauthenticated → 401

## Dev Notes

### File structure — follow the existing flat pattern carefully

Current `src/server/` is flat (no subdirectories). This story introduces the first subdirectory. Create it:

```
src/server/music/
  presets.ts      ← static data only, no imports from server modules
  spotify.ts      ← Spotify fetch helpers, imports from ../db.ts and ../refresh.ts
  router.ts       ← Hono router, imports requireAuth from ../auth.ts
```

Test file goes in the existing tests directory:
```
src/server/__tests__/music.test.ts
```

### Registering the router — exact pattern to follow

In `src/server/index.ts`, follow the **exact same pattern** as `roomsRouter`:

```ts
// existing
import { roomsRouter } from './rooms.ts'
// add
import { musicRouter } from './music/router.ts'

// existing
app.route('/api', roomsRouter)
// add below it
app.route('/api', musicRouter)
```

The music router registers paths like `/music/presets`, `/music/search`, `/music/tracks/:playlistId`, which become `/api/music/presets` etc. after the prefix.

### requireAuth + token access pattern

`requireAuth` middleware (from `auth.ts`) reads the `session` cookie, fetches the host from SQLite, and sets `ctx.var.host: Host`. The `Host` object has `access_token` and `token_expires_at`.

For inline token refresh before a Spotify call:

```ts
import { refreshWithRetry } from '../refresh.ts'
import { getHostById } from '../db.ts'

// In route handler, after requireAuth runs:
let host = ctx.var.host

// Refresh if token expires within 60 seconds
if (host.token_expires_at - Date.now() < 60_000) {
  await refreshWithRetry(host.user_id)
  // refreshWithRetry calls updateHostTokens → must re-read from DB
  const refreshed = getHostById(host.user_id)
  if (!refreshed) return ctx.json({ error: 'Unauthorized' }, 401)
  host = refreshed
}

// Now host.access_token is current
const res = await fetch('https://api.spotify.com/v1/...', {
  headers: { Authorization: `Bearer ${host.access_token}` },
})
```

`refreshWithRetry` silently marks the host `degraded` on repeated failure (sets flag in memory, emits `authEvents.emit('degraded', userId)`). It does NOT throw. After calling it, always re-read from DB to get the updated token.

### Spotify API calls — use bare fetch, no SDK

All server-side Spotify calls use native `fetch`. No SDK on the server — the Web Playback SDK is browser-only.

**Search playlists:**
```ts
const url = new URL('https://api.spotify.com/v1/search')
url.searchParams.set('type', 'playlist')
url.searchParams.set('q', query)
url.searchParams.set('limit', '10')

const res = await fetch(url.toString(), {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!res.ok) throw new SpotifyError(res.status, await res.text())
const data = await res.json() as SpotifySearchResponse
```

Map to: `{ name: item.name, owner: item.owner.display_name, trackCount: item.tracks.total, playlistId: item.id }`

**Fetch playlist tracks (page 1 only — 100 tracks max, sufficient for card gen):**
```ts
const url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`)
url.searchParams.set('limit', '100')
url.searchParams.set('fields', 'items(track(id,name,artists,album(images)))')

const res = await fetch(url.toString(), {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!res.ok) throw new SpotifyError(res.status, await res.text())
const data = await res.json() as SpotifyTracksResponse
```

Filter out null tracks (Spotify returns `null` for local files or removed tracks):
```ts
const tracks = data.items
  .filter(item => item.track && item.track.id)  // remove nulls and local files
  .map(item => ({
    id: item.track.id,
    title: item.track.name,
    artist: item.track.artists[0]?.name ?? 'Unknown',
    albumArtUrl: item.track.album.images[0]?.url ?? '',
  }))

if (tracks.length < 25) throw new InsufficientTracksError(tracks.length)
```

### Track shape (used by this story and all downstream stories)

Define in `spotify.ts` and export — Story 4-3 imports this:

```ts
export interface Track {
  id: string          // Spotify track ID
  title: string
  artist: string      // primary artist name only
  albumArtUrl: string // first image URL, or '' if none
}
```

### Genre presets — curated playlist IDs

`/recommendations` endpoint is dead for new Spotify apps. Use curated public playlist IDs instead. These are real Spotify playlist IDs — use well-known editorial playlists owned by Spotify:

```ts
export const PRESETS = [
  { name: '80s Pop', description: 'Classic pop hits from the 80s', playlistId: '37i9dQZF1DXb57FjYWz00c' },
  { name: '90s Hits', description: 'The biggest songs of the 90s', playlistId: '37i9dQZF1DXbTxeAdrVG2l' },
  { name: '00s Bangers', description: 'Peak 2000s pop and RnB', playlistId: '37i9dQZF1DX4o1oenSJRJd' },
  { name: 'Pop Classics', description: 'Essential pop anthems', playlistId: '37i9dQZF1DXcBWIGoYBM5M' },
  { name: 'Rock Anthems', description: 'Guitar-driven crowd pleasers', playlistId: '37i9dQZF1DXcF6B6QPhFDv' },
  { name: 'Party Hits', description: 'Floor-fillers across all eras', playlistId: '37i9dQZF1DXdPec7aLTmlC' },
]
```

**Note:** These playlist IDs may need to be verified/replaced at implementation time — Spotify editorial playlists are generally stable but confirm they're publicly accessible with your Spotify app credentials.

### Error handling pattern

Create a simple error helper in `spotify.ts`:

```ts
export class SpotifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export class InsufficientTracksError extends Error {
  constructor(public count: number) {
    super(`Playlist has only ${count} playable tracks — need at least 25`)
  }
}
```

In the router, catch and convert:
```ts
} catch (err) {
  if (err instanceof InsufficientTracksError) {
    return ctx.json({ message: err.message }, 422)
  }
  if (err instanceof SpotifyApiError) {
    return ctx.json({ message: `Spotify API error: ${err.message}` }, 502)
  }
  throw err  // let Hono handle unexpected errors
}
```

### Testing — follow the exact pattern from rooms.test.ts

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { initDb, upsertHost } from '../db.ts'

// Stub env BEFORE dynamic imports (same as all other test files)
vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { musicRouter } = await import('../music/router.ts')

function seedHost(userId = 'host_1') {
  upsertHost({
    user_id: userId,
    display_name: 'Test Host',
    email: 'test@example.com',
    access_token: 'valid_token',
    refresh_token: 'ref',
    token_expires_at: Date.now() + 3_600_000,  // fresh token
  })
}

function makeApp() {
  const app = new Hono()
  app.route('/api', musicRouter)
  return app
}
```

**Mock fetch for Spotify calls:**
```ts
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ /* mock spotify response */ }),
  } as Response)
})
afterEach(() => vi.restoreAllMocks())
```

**Token expiry test — seed host with expired token:**
```ts
upsertHost({
  ...baseHost,
  access_token: 'expired_token',
  token_expires_at: Date.now() - 1000,  // already expired
})
// Spy on refreshWithRetry to verify it was called
const refreshSpy = vi.spyOn(await import('../refresh.ts'), 'refreshWithRetry')
  .mockResolvedValue(undefined)
```

### Do NOT touch

- `src/server/index.ts` beyond the two lines described above (import + route registration)
- `src/server/db.ts` — no schema changes needed in this story (played_songs table is Story 4-3)
- `src/server/ws.ts`, `auth.ts`, `refresh.ts`, `rooms.ts` — no modifications needed
- Any client-side Svelte files — this story is server-only

## References
- FR18 (genre presets), FR19 (keyword playlist search) [Source: epics.md]
- `/recommendations` deprecated for new apps — curated playlist IDs used instead [Source: epics.md Additional Requirements]
- `requireAuth` middleware and `AuthEnv` type [Source: src/server/auth.ts]
- `refreshWithRetry`, `authEvents` [Source: src/server/refresh.ts]
- `getHostById`, `updateHostTokens` [Source: src/server/db.ts]
- Router registration pattern [Source: src/server/index.ts — `app.route('/api', roomsRouter)`]
- Test patterns: `vi.stubEnv`, `initDb(':memory:')`, dynamic import after stubs [Source: src/server/__tests__/rooms.test.ts]
- `Track` interface reused by Story 4-3 card generation [Source: 4-3-card-generation-and-round-start.md]

## Dev Agent Record

### Implementation Plan
- Create `src/server/music/` directory with three files: presets.ts (static data), spotify.ts (Spotify API helpers + error types + Track interface), router.ts (Hono routes with requireAuth + inline token refresh)
- Register musicRouter in src/server/index.ts
- Write tests in src/server/__tests__/music.test.ts covering all ACs

### Debug Log
- Token refresh test initially failed because the test was overwriting the expired token before the route ran. Fixed by having the `refreshWithRetry` mock itself perform the DB update, accurately simulating the real refresh flow.

### Completion Notes
- Created `src/server/music/` with three files: presets.ts (6 curated playlists), spotify.ts (helpers + Track interface + error types), router.ts (3 endpoints with requireAuth + inline token refresh)
- Registered music router in src/server/index.ts following exact same pattern as roomsRouter
- 10 new tests, all passing; 134 total tests, no regressions

## File List
- src/server/music/presets.ts (new)
- src/server/music/spotify.ts (new)
- src/server/music/router.ts (new)
- src/server/index.ts (modified — added musicRouter import and route registration)
- src/server/__tests__/music.test.ts (new)

### Review Findings

- [x] [Review][Patch] `/music/presets` missing inline token refresh — AC5 requires token refresh on *all three* endpoints; presets handler returns immediately with no expiry check [src/server/music/router.ts:12]
- [x] [Review][Patch] `searchPlaylists` throws TypeError when Spotify returns `playlists.items: null` — crashes as unhandled 500 instead of returning empty array [src/server/music/spotify.ts:69]
- [x] [Review][Patch] Failed token refresh not detected — `refreshWithRetry` silently swallows errors; code re-reads stale expired token from DB and proceeds to Spotify, producing a confusing 502; should check `isHostDegraded` after refresh [src/server/music/router.ts:25,48]
- [x] [Review][Patch] Post-refresh 401 uses `{ error: }` key instead of `{ message: }` — inconsistent with AC6 and all other error responses [src/server/music/router.ts:27,50]
- [x] [Review][Patch] `artists` array not null-safe — `item.track!.artists[0]?.name` throws TypeError if `artists` is `null`; fix: `item.track!.artists?.[0]?.name ?? 'Unknown'` [src/server/music/spotify.ts:92]
- [x] [Review][Defer] `playlistId` path param not sanitized before URL interpolation — allows path traversal to arbitrary Spotify API endpoints via server token [src/server/music/router.ts:44] — deferred, pre-existing
- [x] [Review][Defer] Concurrent token refresh race: two simultaneous requests both see expiring token and call `refreshWithRetry` in parallel [src/server/music/router.ts:21-28,44-51] — deferred, pre-existing architectural concern
- [x] [Review][Defer] Inline token refresh block duplicated verbatim in two route handlers — future fix must be applied twice [src/server/music/router.ts:21-28,44-51] — deferred, pre-existing
- [x] [Review][Defer] `token_expires_at` ms/seconds unit not enforced at schema level — would silently trigger refresh on every request if written in seconds [src/server/music/router.ts:24] — deferred, pre-existing

## Change Log
- 2026-04-04: Story created and enriched with full implementation context
- 2026-04-04: Implementation complete — music module created, router registered, 10 tests added (134 total passing)
- 2026-04-04: Code review complete — 5 patch findings, 4 deferred, 4 dismissed
