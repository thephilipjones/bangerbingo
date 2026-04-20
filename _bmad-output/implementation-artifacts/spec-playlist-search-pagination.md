---
title: 'Playlist Search Pagination — Infinite Scroll'
type: 'feature'
created: '2026-04-20'
status: 'done'
context: []
baseline_commit: '68bf4f2514982c38f1814bfe536a9ba47ad538d6'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Playlist search only shows up to 10 results (often ~9 after null filtering) and offers no way to reach additional matches. Users searching for common terms hit a hard wall.

**Approach:** Paginate the Spotify search endpoint and append pages to the client list as the user scrolls the playlist region. Keep the first page small (10) since Spotify caps `limit` at 10, and fetch the next page when the user scrolls near the bottom.

## Boundaries & Constraints

**Always:**
- Server: `/api/music/search` accepts an optional `offset` query param (non-negative integer, default 0). Limit stays at 10 (Spotify cap). Return shape becomes `{ results: PlaylistResult[], hasMore: boolean }` where `hasMore` is derived from Spotify's response (`playlists.next != null`).
- Client: on new/changed query, reset list + offset and fetch page 1. On scroll within 80px of the bottom of `.playlist-region`, fetch next page (offset += 10) and append results. Never fire overlapping paginates for the same query.
- Reuse the existing `searchSeq` race guard for ALL fetches (page 1 and subsequent pages) so stale responses are discarded.
- Only show "No playlists found" on page 1 empty. On later pages, stop paginating silently (set `hasMore=false`).
- A small "Loading more…" indicator at the bottom of the region while a subsequent page is in flight; the existing "Searching…" message is only for page 1.
- Preserve selection across pagination (already keyed on `playlistId`).

**Ask First:**
- Server-response shape changes that would also affect other callers (there are none today — verify before deviating).
- Any change to the Spotify `limit` value (Spotify's cap is 10).

**Never:**
- Do not attempt parallel multi-offset initial fetches — one call per page.
- Do not paginate the presets list; this is search-only.
- Do not debounce the scroll-triggered fetch beyond a trailing in-flight guard — scroll should feel immediate.
- Do not add a "Load more" button — infinite scroll only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New query | user types "rock", debounce fires | GET `/api/music/search?q=rock&offset=0` → 10 results render; offset state=10; hasMore reflects response | Page-1 error → show error-msg in region |
| Scroll to near bottom with hasMore | user scrolls `.playlist-region` to within 80px of bottom, no in-flight paginate, hasMore=true | GET `/api/music/search?q=rock&offset=10` → append 10 more; offset=20 | Page-N error → stop paginating, leave existing results, silent (no error banner) |
| Scroll with hasMore=false | user scrolls to bottom, hasMore=false | No fetch fires | N/A |
| Scroll while paginate in flight | scroll event fires during pending next-page fetch | Ignored (guarded by in-flight flag) | N/A |
| Query change mid-paginate | in-flight paginate for "rock" then user types "rockab" | Old paginate discarded via searchSeq; fresh page-1 fetch runs for new query | N/A |
| Empty page-1 | Spotify returns zero items at offset 0 | Show "No playlists found for …"; hasMore=false | N/A |
| Empty later page | Spotify returns zero items at offset>0 | Silently set hasMore=false; keep existing results | N/A |
| Invalid offset | `offset` param is non-numeric or negative | Server returns 400 with message | N/A |
| Missing offset | `offset` omitted | Server treats as 0 (back-compat) | N/A |

</frozen-after-approval>

## Code Map

- [src/server/music/spotify.ts](src/server/music/spotify.ts) — `searchPlaylists()`: add `offset` param, include in Spotify URL, expose `next` flag; widen return type to `{ results, hasMore }`.
- [src/server/music/router.ts](src/server/music/router.ts) — `/music/search` route: parse+validate `offset`, pass through, return new `{ results, hasMore }` shape.
- [src/server/__tests__/music.test.ts](src/server/__tests__/music.test.ts) — update existing mocks (now return `{ results, hasMore }`), add cases for offset pass-through, hasMore=true/false, invalid offset 400.
- [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) — add pagination state (`searchOffset`, `searchHasMore`, `paginating`), scroll handler on `.playlist-region`, updated `$effect` for page 1, new `loadMoreResults()` reusing searchSeq, "Loading more…" row.

## Tasks & Acceptance

**Execution:**
- [x] [src/server/music/spotify.ts](src/server/music/spotify.ts) — change `searchPlaylists(query, accessToken, offset = 0)`; set `limit=10` + `offset=<offset>` on URL; return `{ results: PlaylistResult[], hasMore: boolean }` where `hasMore = data.playlists?.next != null`. Update `SpotifySearchResponse` to include `next: string | null`.
- [x] [src/server/music/router.ts](src/server/music/router.ts) — parse `offset` from query: missing → 0; present → must match `/^\d+$/` and be ≤ 1000 (Spotify hard cap on offset+limit) else 400. Call `searchPlaylists(query, token, offset)` and return the `{ results, hasMore }` object as-is.
- [x] [src/server/__tests__/music.test.ts](src/server/__tests__/music.test.ts) — update "returns mapped playlist results" test to assert new envelope shape. Add tests: (a) offset param forwarded to Spotify URL, (b) hasMore=true when `next` present, (c) hasMore=false when `next` null, (d) 400 on non-numeric `offset`. Keep token-refresh test intact.
- [x] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) — add state `searchOffset=0`, `searchHasMore=false`, `paginating=false`. Page-1 `$effect`: on query change, reset offset/hasMore/paginating, fetch `offset=0`, hydrate `searchResults` from `data.results` and `searchHasMore` from `data.hasMore`. Add `async function loadMoreResults()` that returns early if `paginating || !searchHasMore || !isSearching`, captures `searchSeq`, sets `paginating=true`, fetches with current offset, appends results and updates state only if seq still matches. Wire `onscroll={handleScroll}` on `.playlist-region` where `handleScroll` checks `scrollHeight - scrollTop - clientHeight < 80` and calls `loadMoreResults()`. Render a single `<p class="status-msg">Loading more…</p>` below the grid while `paginating`. Use a subtle footer sentinel if cleaner than inline paragraph; either works.

**Acceptance Criteria:**
- Given a query that matches >10 playlists, when the user scrolls to near the bottom of the playlist region, then an additional page of up to 10 results appends without the modal resizing or the scroll jumping.
- Given the user paginates to the end of available results, when they keep scrolling, then no further fetches fire.
- Given the user changes the query while a paginate is in flight, when the old response returns, then it is discarded and only the new query's page 1 is visible.
- Given a page-2 fetch fails, when the failure resolves, then existing results remain visible and no further pagination is attempted for that query.
- Given a new query, when typing pauses past debounce, then exactly one page-1 fetch fires regardless of prior pagination state.

## Verification

**Commands:**
- `bun run typecheck` — expected: no TS errors.
- `bun test src/server/__tests__/music.test.ts` — expected: all pass.

**Manual checks:**
- `bun run dev`, open round config, search a broad term ("love", "rock"), scroll the region — list should extend smoothly; watch Network tab for `offset=10`, `offset=20`, …; stop when `hasMore=false`.
- Rapid query changes should not leak stale results (check searchSeq guard).

## Suggested Review Order

**Pagination core (client)**

- Page-1 fetch now sets offset by fixed page size (10), not filtered length, to match Spotify's indexing.
  [`RoundConfigOverlay.svelte:132`](../../src/client/components/RoundConfigOverlay.svelte#L132)

- `loadMoreResults` reuses searchSeq guard, appends via spread, and triggers a fill-check on completion.
  [`RoundConfigOverlay.svelte:147`](../../src/client/components/RoundConfigOverlay.svelte#L147)

- Unconditional `++searchSeq` on every query change (including clear) invalidates in-flight paginates.
  [`RoundConfigOverlay.svelte:108`](../../src/client/components/RoundConfigOverlay.svelte#L108)

- `fillIfNotScrollable` auto-paginates when the region can't scroll — handles short first pages.
  [`RoundConfigOverlay.svelte:178`](../../src/client/components/RoundConfigOverlay.svelte#L178)

- Scroll handler trips within 80px of the bottom; `void` prefix makes the floating promise explicit.
  [`RoundConfigOverlay.svelte:190`](../../src/client/components/RoundConfigOverlay.svelte#L190)

**Template + styles**

- `onscroll` wiring on the fixed-height playlist region.
  [`RoundConfigOverlay.svelte:358`](../../src/client/components/RoundConfigOverlay.svelte#L358)

- "Loading more…" footer inside the results branch only.
  [`RoundConfigOverlay.svelte:382`](../../src/client/components/RoundConfigOverlay.svelte#L382)

**Server contract**

- `searchPlaylists()` gains optional `offset`; response widened to `{ results, hasMore }`.
  [`spotify.ts:61`](../../src/server/music/spotify.ts#L61)

- `/music/search` validates offset (non-negative int, ≤ 990 to respect Spotify's offset+limit≤1000 cap).
  [`router.ts:20`](../../src/server/music/router.ts#L20)

**Tests**

- New envelope shape, offset pass-through, hasMore flag, boundary 400s, and 990 acceptance.
  [`music.test.ts:72`](../../src/server/__tests__/music.test.ts#L72)
