# Story 14-2: Smart Playlist URL Paste + "How to Share a Playlist" Tip

## Status: done (pass 2)

## Context

Hosts who've built a custom Spotify playlist for a specific game night (wedding, birthday, theme night) have no direct way to use it — they have to hope it shows up in keyword search. Spotify playlist URLs and URIs contain the exact `playlistId` the server already accepts. Detecting a pasted URL client-side and either (a) extracting the ID and loading it directly, or (b) running a search that surfaces it, turns the existing search box into a paste-friendly entry point with zero new API surface.

The server endpoint already accepts Base62 playlist IDs: [src/server/music/router.ts:49-59](src/server/music/router.ts#L49-L59). We can reuse `/api/music/tracks/:playlistId` directly — paste a URL, we pull the ID out, we call that endpoint, we select the resulting playlist if tracks come back successfully.

A frequent operator frustration with Spotify's playlist sharing is that **private playlists silently fail** — `/v1/playlists/{id}/tracks` returns 404 if the app can't read it. Today the user just sees "Failed to load tracks" with no guidance. An inline info tip next to the search input pointing to the public-playlist requirement would save a lot of confusion.

## Story

As a **host with a specific playlist in mind**,
I want **to paste a Spotify playlist URL directly into the search box and have it Just Work**,
so that **I don't have to hope my carefully-curated playlist shows up in keyword results — and when it fails because it's private, I know exactly what to fix**.

## Acceptance Criteria

**AC-1 — Detect Spotify playlist URL/URI on paste or input.**
When the search input value matches any of these patterns (with or without query string / fragment):
- `https://open.spotify.com/playlist/<id>` (with optional locale prefix like `/intl-de/`)
- `https://open.spotify.com/embed/playlist/<id>`
- `spotify:playlist:<id>`
- Bare `<id>` of 22 Base62 chars

…the client extracts the `<id>` (22 Base62 chars per Spotify convention) and skips the keyword-search code path. No visible mode switch; the same input handles both.

**AC-2 — Direct playlist fetch on URL paste.**
When a playlist URL is detected, client calls `GET /api/music/tracks/:playlistId` directly. On 200: render a single synthetic `PlaylistResult` in the results list — name from first track's playlist metadata (or "Pasted playlist" fallback if server doesn't return name), owner empty, `trackCount` = returned count — pre-selected so Start Round is primed. On 404 / non-200: render a helpful error (see AC-4) inline where results would appear, **not** a generic "Search failed."

**AC-3 — Inline info icon next to search input.**
Add a small (i) info icon affordance adjacent to the search input label ("Search" tab or whatever the current label is in [RoundConfigOverlay.svelte:85+](src/client/components/RoundConfigOverlay.svelte#L85)). Tap / hover shows a tooltip or popover with copy approximately:

> **Tip — use your own playlist**
> Paste a Spotify playlist link here (e.g. `open.spotify.com/playlist/...`) and we'll load it directly.
> Note: the playlist must be set to **Public** in Spotify. Private playlists aren't readable by the app.

Final copy by Sally; don't ship the placeholder verbatim. Use the existing Phosphor `Info` icon.

**AC-4 — Private-playlist / not-found error is specific.**
If the direct-fetch response is 404 or a Spotify-origin 401, the error shown inline is:

> Couldn't load this playlist. Is it set to **Public** in Spotify? (Private playlists can't be read.)

For other error classes (5xx, network), fall back to the existing "Failed to load. Try again." copy. Distinguish by response status only — no request-body sniffing.

**AC-5 — No regressions on keyword search path.**
Typing non-URL keywords still runs the existing debounced search with pagination. The URL-detection branch is a pure additive check at the top of the `$effect` or input handler.

**AC-6 — Paste of a playlist URL while a keyword search is in-flight cancels the keyword search.**
The existing `searchSeq` cancellation mechanism should cover this; verify no stale results land after URL switch.

## Implementation Sketch

**Client ([RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte)):**
- New pure helper: `extractPlaylistId(input: string): string | null` — regex-match the four accepted shapes, return Base62 id or null.
- In the search `$effect`, before the debounced `fetch('/api/music/search')` call: `const id = extractPlaylistId(q); if (id) { ...direct-fetch branch... return }`
- Direct-fetch branch sets `searchResults = [{ playlistId: id, name: ..., owner: '', trackCount }]`, `searchLoading = false`, `searchHasMore = false`, pre-selects via existing `selectedPlaylist = { id, name }`.
- Info icon: add after the search input label — `<button type="button" class="info-tip" aria-label="Playlist tip" ...>` opening a popover (reuse any existing popover pattern; otherwise a simple `title=` with a richer custom tooltip is acceptable for MVP).
- Error copy: extend the existing `searchError` state to support the 404 case with distinct messaging.

**Server:** No changes required. [router.ts:51](src/server/music/router.ts#L51) already validates `playlistId` shape and returns proper 404 on not-found.

**Tests:**
- Unit test `extractPlaylistId` for the four URL shapes + invalid input (keyword query, empty, malformed URL, wrong locale prefix).
- Manual playtest: paste a URL for a known public playlist → loads. Paste a URL for a known private playlist → specific error.

**Out of scope:**
- Spotify track URLs (single-song), album URLs, artist URLs — only playlist IDs/URLs handled.
- Recently-pasted history (remembering past pastes).
- QR-code scanning of playlists.
- Validating the playlist has ≥25 tracks before Start Round (server already errors via `InsufficientTracksError`; client already surfaces it).

## References

- [src/client/components/RoundConfigOverlay.svelte:85-200](src/client/components/RoundConfigOverlay.svelte#L85) — search UI + state
- [src/server/music/router.ts:48-79](src/server/music/router.ts#L48-L79) — `/tracks/:playlistId` endpoint (reused verbatim)
- [src/server/music/spotify.ts](src/server/music/spotify.ts) — `InsufficientTracksError` (unchanged)
- Phosphor `Info` icon — already available per Epic 11

## Tasks/Subtasks

- [x] Task 1: Create `extractPlaylistId` helper
  - [x] Write `src/client/lib/playlistUrl.ts` — pure function detecting URL/URI/bare-ID patterns, returning 22-char Base62 ID or null
- [x] Task 2: Update server router for 404/401 passthrough
  - [x] Modify `src/server/music/router.ts` `/tracks/:playlistId` handler to return 404 when Spotify returns 404, 401 when Spotify returns 401 (enables AC-4 status-only discrimination)
- [x] Task 3: Update RoundConfigOverlay.svelte
  - [x] Import `Info` from phosphor-svelte and `extractPlaylistId` from playlistUrl.ts
  - [x] Add `showPlaylistTip` state; add info icon button + tip panel in template (AC-3)
  - [x] Extend `$effect` search handler: detect URL paste → direct fetch `/api/music/tracks/:id` → synthetic PlaylistResult → pre-select (AC-1, AC-2, AC-6)
  - [x] Show specific 404/401 error copy per AC-4; generic 5xx/network fallback
- [x] Task 4: Write tests
  - [x] Unit tests for `extractPlaylistId`: all four URL shapes, locale prefix, invalid inputs
  - [x] Integration tests for URL paste in RoundConfigOverlay: 200 auto-selects, 404 shows specific error, keyword search still works

## File List

- `src/client/lib/playlistUrl.ts` — new pure helper: `extractPlaylistId`
- `src/client/__tests__/playlistUrl.test.ts` — new unit tests (14 tests)
- `src/client/components/RoundConfigOverlay.svelte` — URL detection, info tip UI
- `src/server/music/router.ts` — 404/401 passthrough on `/tracks/:playlistId`
- `src/server/__tests__/music.test.ts` — updated 502 test → 404 test + new 5xx test

## Dev Agent Record

### Completion Notes

Implemented smart playlist URL paste with info tip across client and server:

1. **`extractPlaylistId`** (`src/client/lib/playlistUrl.ts`) — pure regex helper covering all four shapes from AC-1: `open.spotify.com/playlist/<id>`, `open.spotify.com/<locale>/playlist/<id>`, `open.spotify.com/embed/playlist/<id>`, `spotify:playlist:<id>`, and bare 22-char Base62 IDs.

2. **Server 404/401 passthrough** — `/tracks/:playlistId` now returns HTTP 404 when Spotify returns 404 (private or missing playlist) and 401 when Spotify returns 401. This enables the client to distinguish "is it public?" cases from genuine server errors without request-body sniffing. The spec comment "no server changes required" assumed the endpoint already did this; it did not.

3. **RoundConfigOverlay** — `$effect` now checks `extractPlaylistId(q)` before the debounced keyword branch. On match: direct fetch to `/api/music/tracks/:id`, synthetic `PlaylistResult` with `name: 'Pasted playlist'` and `trackCount` from track array length, auto-selects the playlist. 404/401 → specific "Is it Public?" error copy (AC-4). Other non-2xx / network → generic "Failed to load. Try again."

4. **Info tip** — `(i)` Phosphor `Info` icon button in the search bar opens an inline tip panel explaining URL paste and the public-playlist requirement. Toggle state `showPlaylistTip`; button has `aria-expanded`.

5. **`searchSeq` cancellation** covers AC-6: bumping seq at top of `$effect` invalidates any in-flight keyword search when a URL is pasted.

Pre-existing `hostPrefs.test.ts` failure unrelated to this story (present on main).

### Review Findings

- [x] [Review][Patch] URL hostname regex allows `open.spotify.com.evil.com` bypass — `[^?#]*` in the URL pattern consumes `.evil.com` before matching `/playlist/`; fix: add `/` after `open\.spotify\.com` in the regex [src/client/lib/playlistUrl.ts:10-12]
- [x] [Review][Defer] `err.message` raw-interpolated into 502 response body [src/server/music/router.ts:67] — deferred, pre-existing
- [x] [Review][Defer] `showPlaylistTip` has no Escape/outside-click dismissal [src/client/components/RoundConfigOverlay.svelte:438-444] — deferred, pre-existing UX pattern; lower-priority than game-flow overlays
- [x] [Review][Defer] HTTP 403 from Spotify collapses to generic 502 without "is it public?" guidance [src/server/music/router.ts:63-69] — deferred; Spotify 403 on playlist tracks typically signals token-scope issue, not playlist privacy — misleading to show same copy as 404
- [x] [Review][Defer] Bare 22-char alphanumeric string false-positives as playlist ID [src/client/lib/playlistUrl.ts:17] — deferred, spec-defined AC-1 behavior; extremely unlikely in practice
- [x] [Review][Defer] HTTP 429 rate-limit from Spotify not handled (falls through to generic 502) — deferred, broader infrastructure concern pre-existing across all Spotify API calls
- [x] [Review][Defer] Playlist track fetch limited to first 100 tracks (no pagination) — deferred, pre-existing API limitation on `/tracks/:playlistId`
- [x] [Review][Defer] 401 passthrough reveals playlist-existence information to callers — deferred, spec-intended per AC-4; acceptable tradeoff for personal app

### Review Findings (Pass 2 — playlist meta additions, 2026-04-24)

- [x] [Review][Decision] `trackCount` source: `tracks.total` (raw Spotify total, e.g. 487) vs `tracks.length` (validated usable count, capped at 100) — resolved: keep `tracks.total`; shows host how big their playlist actually is
- [x] [Review][Patch] `trackCount: 0` in `getPlaylistMeta` catch fallback is wrong when tracks succeed — change `const [, meta]` to `const [tracks, meta]` in `router.ts` and use `tracks.length` as the fallback `trackCount` instead of `0` [src/server/music/router.ts]
- [x] [Review][Patch] 422 and null-track tests use single `mockResolvedValue` for all `fetch` calls — meta endpoint now also fires, receives the tracks shape, and `.catch()` silently absorbs the parse error; update both tests to use `mockImplementation` with URL discrimination (same pattern as the updated happy-path test) [src/server/__tests__/music.test.ts]
- [x] [Review][Defer] Orphaned `getPlaylistMeta` fetch when `getPlaylistTracks` throws `InsufficientTracksError` — no `AbortController` to cancel the in-flight meta request; deferred, pre-existing no-cancellation pattern across all Spotify calls
- [x] [Review][Defer] `getPlaylistTracks` track mapping correctness no longer covered by any integration test — assertions removed when test was renamed; deferred, `getPlaylistTracks` logic unchanged in this diff; address in next test quality pass
- [x] [Review][Defer] `SpotifyPlaylistMetaResponse.owner.display_name` typed as `?: string` but Spotify may return `null` — `??` handles it correctly at runtime; deferred, type inaccuracy only

## Change Log

- 2026-04-23: Implemented story 14-2 — smart playlist URL paste + info tip. Created `playlistUrl.ts` with 14 unit tests, updated `RoundConfigOverlay.svelte` for URL detection and info tip, updated server router for 404/401 passthrough, updated server test. Status → review.
- 2026-04-23: Code review complete — 1 patch, 7 deferred, 9 dismissed. Status → in-progress pending patch P1.
- 2026-04-24: Pass 2 review (playlist meta additions) — 1 decision-needed (resolved), 2 patches applied, 3 deferred, 6 dismissed. Status → done.
