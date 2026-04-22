# Story 13-8: Per-Player Independent Cards, Strict Played-Song Exclusion, Auto-Reset

## Status: ready-for-dev

## Context

A staging session (host DBX, session JKAG) produced a bingo card with the same song on two tiles, both inside a winning line. Casual mode auto-marked one copy, and clicking the second closed out the win. Root cause: Spotify playlists can contain duplicate tracks (users add manually; Spotify does not enforce uniqueness), and our ingest pipeline never dedupes. Win detection is position-based, so two tiles with the same `trackId` count as two distinct tiles.

Investigating the bug surfaced two adjacent design issues worth fixing in the same story rather than deferring:

1. **All players share the same 25 songs per round.** `generateCard` does `pool.slice(0, 25)` against an already-shuffled pool, then reshuffles *tile positions*. Cards differ in layout, not in song content — everyone is playing "the same card" visually rearranged. This causes frequent tie-bingos and is not how bingo traditionally works.
2. **Previously-played songs are *downranked*, not excluded.** `buildPool` pushes played-before tracks to the tail of the pool rather than removing them. Songs can re-appear on cards (and re-play) across rounds. The `sessionPlayedIds` / `historicPlayedIds` split makes the model harder to reason about, and the downrank bias is only effective today because all cards share one slice — once per-player independent draws land, the soft bias is almost useless.

This story fixes all three in a single coherent change:

- Dedupe at Spotify ingest (safety net, fixes the primary bug).
- Replace downrank-played with hard exclusion (simpler, stronger guarantee).
- Each player's card drawn independently from the full filtered pool (true bingo behaviour).
- When the filtered pool drops below the 25-track minimum at round start, auto-reset the room's played-song history and show the host a transient toast so the behaviour isn't silent.

No new dependencies, no DB schema changes. Net code decreases (a plumbing field and a concatenation path both go away).

---

## Changes

### A — Dedupe at Spotify ingest

**File:** `src/server/music/spotify.ts` — `getPlaylistTracks` (around lines 107–116)

Add a `Set`-based dedup pass between the null-filter and the `map`, before the `< 25` threshold check. The existing `InsufficientTracksError` then correctly fires on unique count.

```ts
const seen = new Set<string>()
const tracks = data.items
  .filter(item => item.track && item.track.id)
  .filter(item => {
    if (seen.has(item.track!.id)) return false
    seen.add(item.track!.id)
    return true
  })
  .map(item => ({
    id: item.track!.id,
    title: item.track!.name,
    artist: item.track!.artists?.[0]?.name ?? 'Unknown',
    albumArtUrl: item.track!.album.images[0]?.url ?? '',
  }))
```

This is the safety net: even if downstream exclusion logic ever regresses, a single round can never contain duplicate tiles.

**Behaviour note for commit message:** a playlist with 30 total items but only 20 unique tracks will now throw `InsufficientTracksError` instead of silently generating a broken round. This is correct — bingo requires 25 distinct songs.

---

### B — Replace downrank-played with exclude-played; simplify `buildPool`

**File:** `src/server/game/cards.ts` — `buildPool` (lines 24–33)

**Current:**
```ts
export function buildPool(
  tracks: Track[],
  sessionPlayedIds: string[],
  historicPlayedIds: string[]
): Track[] {
  const allDownranked = new Set([...sessionPlayedIds, ...historicPlayedIds])
  const fresh = tracks.filter(t => !allDownranked.has(t.id))
  const downranked = tracks.filter(t => allDownranked.has(t.id))
  return [...shuffle(fresh), ...shuffle(downranked)]
}
```

**New:**
```ts
export function buildPool(tracks: Track[], excludedIds: Set<string>): Track[] {
  return shuffle(tracks.filter(t => !excludedIds.has(t.id)))
}
```

No more "downranked tail" concept. Pool contains only fresh tracks, shuffled.

---

### C — Per-player independent card draws

**File:** `src/server/game/cards.ts` — `generateCard` (lines 35–45)

**Current:**
```ts
export function generateCard(pool: Track[]): Tile[] {
  const sample = pool.slice(0, 25)
  const tiles: Tile[] = shuffle(sample).map(t => ({ ... }))
  ...
}
```

**New:**
```ts
export function generateCard(pool: Track[]): Tile[] {
  const sample = shuffle(pool).slice(0, 25)
  const tiles: Tile[] = sample.map(t => ({ ... }))
  ...
}
```

Now each call samples a fresh random 25 from the full pool. `generateCards` loop (lines 47–62) stays as-is — its uniqueness-retry loop (`cardKey` dedup across players) becomes meaningfully useful now that natural card-content uniqueness is high.

This also correctly fixes the late-joiner path at `src/server/ws.ts:461`, which calls `generateCard(round.playlist)` for guests who join mid-round.

---

### D — Round creation uses the filtered pool for both cards and playback

**File:** `src/server/rooms.ts` — round creation (around lines 438–495)

Currently shuffles the raw Spotify response into `playlist` (line 449), then calls `buildPool` separately with that playlist (line 462). Replace with a single filtered+shuffled pool used for both `round.playlist` (playback sequence) and card generation.

Conceptual shape:

```ts
const tracks = await getPlaylistTracks(config.playlistId, host.access_token)
const historicPlayedIds = new Set(getPlayedSongs(code))
let fresh = buildPool(tracks, historicPlayedIds)

// Auto-reset on exhaustion (Change E below handles the host message)
let didReset = false
if (fresh.length < 25) {
  clearPlayedSongs(code)
  fresh = buildPool(tracks, new Set())
  didReset = true
}
if (fresh.length < 25) throw new InsufficientTracksError(fresh.length)

const playlist = fresh  // same shuffled filtered pool for both
const cards = generateCards(playlist, playerIds)

// Write roomState, then notify host after socket is live:
if (didReset) sendHostInfo(roomState, 'Played history reset — playlist fully cycled.')
```

Notes:
- `InsufficientTracksError` already exists and is rendered by the host UI.
- After reset, the full deduped playlist is reused, so a playlist with ≥25 unique tracks always succeeds.
- If a playlist has <25 unique tracks at all, the error fires the same as today — correct for bingo.

---

### E — Remove `sessionPlayedIds` plumbing

With `played_songs` DB-persisted per room, in-memory session tracking of dealt-but-not-played track IDs becomes dead code. `getPlayedSongs(code)` is the single source of truth for exclusion.

**Files:**
- `src/server/ws.ts:49` — remove field from the round-state type (`sessionPlayedIds: string[]`).
- `src/server/ws.ts:122` — remove from the WS payload sent to clients.
- `src/server/rooms.ts:460, 484, 492` — remove reads/writes of `sessionPlayedIds`.
- `src/server/__tests__/rooms.test.ts:706` — remove `sessionPlayedIds: []` from fixture.
- `src/server/__tests__/ws.test.ts:832` — remove `sessionPlayedIds: ['t0']` from fixture.

Grep the codebase after the change to confirm zero remaining references.

---

### F — Host-facing transient toast

**New WS message:** `{ type: 'host:info', message: string, autoDismissMs?: number }` sent server → host socket only.

**Server:** add a small helper in `src/server/rooms.ts`:

```ts
function sendHostInfo(roomState: RoomState, message: string, autoDismissMs = 6000): void {
  const host = roomState.host
  if (!host || host.readyState !== WebSocket.OPEN) return
  try {
    host.send(JSON.stringify({ type: 'host:info', message, autoDismissMs }))
  } catch { /* ignore broken socket */ }
}
```

Mirror the send patterns used by `runCasualModeSweep` (guard socket readiness, swallow send errors).

**Client:** in `src/client/pages/HostRoomPage.svelte`:

1. Add state near the other banner states (around line 30):
```ts
let hostMessage = $state<string | null>(null)
let hostMessageTimer: ReturnType<typeof setTimeout> | null = null
```

2. In the WS message handler (around lines 486–573), add case:
```ts
if (data.type === 'host:info' && typeof data.message === 'string') {
  if (hostMessageTimer) clearTimeout(hostMessageTimer)
  hostMessage = data.message
  const dismissMs = typeof data.autoDismissMs === 'number' ? data.autoDismissMs : 6000
  hostMessageTimer = setTimeout(() => { hostMessage = null; hostMessageTimer = null }, dismissMs)
}
```

3. Clear the timer on component cleanup / navigation-away to avoid leaks.

4. Render inline near the other banners (around lines 619–637):
```svelte
{#if hostMessage}
  <div class="info-toast" role="status" aria-live="polite">{hostMessage}</div>
{/if}
```

5. Style: neutral tone (not danger). Fixed-top, z-index below `authDegraded`. Match the understated feel of `reconnecting-chip`. Simple fade-in/fade-out transition.

No new toast component file, no store, no library. Match the inline-banner pattern already established for `authDegraded`, `wsState`, `playbackError`, `sdkFailed`.

---

## Acceptance Criteria

**AC 1 — Spotify ingest dedupes by track id**
Given a Spotify playlist response containing the same `track.id` twice, `getPlaylistTracks` returns each `id` at most once.

**AC 2 — Dedup threshold check applies to unique count**
Given a Spotify response of 30 items with only 20 unique ids, `getPlaylistTracks` throws `InsufficientTracksError(20)`.

**AC 3 — No tile duplicates within a card**
Given any playlist (including one with duplicates), every generated card has 24 tiles with distinct `trackId`s (the 25th is the FREE centre tile). This holds whether or not the playlist had duplicates at the Spotify layer.

**AC 4 — Played-before tracks excluded from card pool and playback**
Given `played_songs` for the room contains track ids `[X, Y, Z]`, a subsequent round's `round.playlist` contains none of `X, Y, Z`, and no player's card contains any of `X, Y, Z`.

**AC 5 — Per-player independent cards**
Given a playlist with ≥50 unique tracks and two players, the two players' cards differ by content (not just tile order). Over repeated runs, the song-overlap between any two cards is bounded by random draw, not fixed.

**AC 6 — Auto-reset on exhaustion**
Given the filtered fresh pool is <25 at round start, the server: (a) calls `clearPlayedSongs(code)`, (b) re-computes the pool from the full deduped playlist, (c) starts the round successfully if ≥25 unique tracks exist, (d) sends a `host:info` WS message to the host socket with a reset notice.

**AC 7 — Host toast appears and auto-dismisses**
On receipt of `host:info`, the Host Room page shows a neutral inline toast containing the message text. The toast auto-dismisses after `autoDismissMs` (default 6000ms). A new `host:info` while one is visible replaces the text and resets the timer.

**AC 8 — Playlist with <25 unique tracks still errors after reset**
Given a playlist has fewer than 25 unique tracks total, round creation still throws `InsufficientTracksError` (auto-reset cannot manufacture tracks).

**AC 9 — `sessionPlayedIds` fully removed**
Grep for `sessionPlayedIds` in `src/` returns no matches after the change (excluding historical git log).

**AC 10 — Late-joining guest gets an independent card**
Given a guest joins mid-round, `generateCard(round.playlist)` at `ws.ts:461` produces a card whose 25 songs are an independent random sample of the round's playlist — not identical to an existing player's card.

---

## Files Modified

- `src/server/music/spotify.ts` — dedupe in `getPlaylistTracks` (Change A)
- `src/server/game/cards.ts` — `buildPool` signature + behaviour; `generateCard` independent sampling (Changes B, C)
- `src/server/rooms.ts` — round-creation uses filtered pool for both playlist + cards; auto-reset logic; `sendHostInfo` helper; remove `sessionPlayedIds` reads/writes (Changes D, E, F)
- `src/server/ws.ts` — drop `sessionPlayedIds` from round-state type and WS payload (Change E)
- `src/client/pages/HostRoomPage.svelte` — `host:info` handler + inline toast + styles (Change F)

---

## Tests

### Update existing tests

**`src/server/__tests__/cards.test.ts`**

- Replace the existing `'down-ranks tracks from historicPlayedIds'` test (around line 44) with `'excludes tracks from historicPlayedIds'` — pool must not contain excluded IDs at all; length must equal `tracks.length - excluded.length`.
- Update all `buildPool(...)` calls in the file to the new two-arg signature `buildPool(tracks, excludedIds: Set<string>)`.
- Add `'generateCard on a pool of size > 25 produces varying subsets across calls'` — call generateCard 20 times against a 100-track pool; assert at least two distinct subsets appear (loose statistical check — effectively impossible to fail by chance).
- Add `'generateCards produces different card contents (not just layouts) when pool > 25 and playerIds.length > 1'` — 100-track pool, 3 players; assert that the set of trackIds in card A differs from card B.
- Keep the existing `'generateCard does not duplicate track ids within a card'` test. Add a comment noting that post-13-8 this invariant also relies on `getPlaylistTracks` deduping its input.

**`src/server/__tests__/rooms.test.ts`**

- Remove `sessionPlayedIds: []` from the fixture at line 706.
- Add `'round-start excludes previously-played tracks from card pool and round playlist'` — seed `played_songs`, start round, assert neither `round.playlist` nor any player's card contains excluded ids.
- Add `'round-start auto-resets played_songs when fresh pool < 25 and emits host:info'` — seed `played_songs` such that fewer than 25 tracks remain; start round; assert `played_songs` is empty after, round starts successfully, and a `host:info` message was delivered to the host socket.
- Add `'round-start throws InsufficientTracksError when playlist has fewer than 25 unique tracks total'` — stub `getPlaylistTracks` to return 20 unique tracks; assert the existing error path fires.

**`src/server/__tests__/ws.test.ts`**

- Remove `sessionPlayedIds: ['t0']` from the fixture at line 832 and any other references.
- Add `'host receives host:info message with message text'` — send a `host:info` through the test WS harness and assert the client sees it.

### New tests

**`src/server/music/__tests__/spotify.test.ts`** (create if missing, or extend existing)

- `'getPlaylistTracks dedupes by track id'` — mock Spotify response with 27 items where 3 are duplicate ids; assert returned array has 24 entries and all ids are unique.
- `'getPlaylistTracks throws InsufficientTracksError when unique count < 25'` — mock 30-item response with only 20 unique ids; assert `InsufficientTracksError(20)` is thrown.

### Client-side verification

The project does not currently have Svelte component tests for `HostRoomPage`. Toast behaviour is verified via staging manual test (see Verification section in the plan file). If a Svelte test harness is later added, port AC 7 to it.

---

## Deferred Work Updates

Upon completion, check `_bmad-output/implementation-artifacts/deferred-work.md` and remove any entries related to:
- "playlist duplicate handling" / "dedup Spotify tracks"
- "repeat songs across rounds"
- "shared 25-song slice across players"

If none exist, no deferred-work.md change is needed.

---

## Dev Notes

- **The dedup at ingest is the safety net.** Even if exclusion logic regresses or a future change reintroduces shared draws, `getPlaylistTracks` deduping prevents duplicate tiles from ever reaching a card within a single round.
- **Auto-reset uses existing primitives.** `clearPlayedSongs(roomId)` already exists in `db.ts:136`. The new code only orchestrates the existing function plus a host notice.
- **`sendHostInfo` belongs with room-state helpers.** Keep it near `runCasualModeSweep` / `replayAutoMarksToSocket` in `rooms.ts` — same shape, same socket-readiness guards.
- **Toast timer discipline.** Always `clearTimeout` the prior timer before starting a new one, and clear on component cleanup. Leaking a timer after unmount would try to write `$state` on a dead component.
- **Do not add a toast abstraction.** One message, one inline `{#if}`, one timer. If more host-info messages appear later, revisit — but YAGNI for now.
- **`generateCards` uniqueness retry stays.** The `cardKey` comparison plus 10-attempt retry was near-useless with shared draws but is a real guard with independent draws. Leave it alone.
- **Session-vs-historic distinction is being retired.** Before this story, `sessionPlayedIds` tracked dealt-but-not-played track ids across rounds in-memory; `historicPlayedIds` (= `played_songs` table) tracked actually-played across server restarts. After this story, only actually-played excludes — dealt-but-not-played does not spoil and is allowed to appear again.
- **Auto-dismiss duration (6s).** Tuned to read a one-line message without lingering. If a future message needs longer, pass `autoDismissMs` explicitly in the `host:info` payload.

---

## Dev Agent Record

### Completion Notes

- [ ] Change A — Spotify ingest dedupes by `track.id` before threshold check.
- [ ] Change B — `buildPool` collapsed to `(tracks, excludedIds: Set<string>) → shuffle(filter)`.
- [ ] Change C — `generateCard` shuffles pool before slicing; per-player independent draws.
- [ ] Change D — Round creation uses one filtered pool for both `round.playlist` and card generation; auto-reset on exhaustion.
- [ ] Change E — `sessionPlayedIds` field + plumbing removed; grep confirms zero refs.
- [ ] Change F — `sendHostInfo` helper + `host:info` WS message + inline host toast with auto-dismiss.

### File List

*(populate during implementation)*

### Change Log

*(populate during implementation)*

### Review Findings

*(populate during review)*
