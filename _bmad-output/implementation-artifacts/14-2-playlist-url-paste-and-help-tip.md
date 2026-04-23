# Story 14-2: Smart Playlist URL Paste + "How to Share a Playlist" Tip

## Status: ready-for-dev

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
