---
title: 'Unified Playlist Picker — Search-first Layout'
type: 'feature'
created: '2026-04-13'
status: 'in-review'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The round-config playlist picker splits Genre/Search into tabs, forcing users to pick a tab before typing and requiring an explicit Search button click. This mismatches the Spotify-style mental model where a single search field dominates and curated tiles fill the space until typing starts.

**Approach:** Collapse the two tabs into one search-first layout: a pinned search input on top and a single fixed-height scrollable grid region below that shows preset tiles by default and live (debounced) search-result tiles while typing. Same card style for both; modal height never jumps.

## Boundaries & Constraints

**Always:**
- Only change [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte). No server-side changes; reuse `/api/music/presets` and `/api/music/search?q=...` as-is.
- Grid region has a fixed `max-height` (~280px) and `overflow-y: auto`; presets AND search results render inside the same container with the same `.preset-card` styling so the modal does not resize when the user types.
- Debounce search fetches by 250ms of quiet typing. Guard against race conditions with an incrementing `searchSeq` — only apply results whose captured seq still matches.
- Selection persists across preset↔search views via a single `selectedPlaylist: { id, name } | null`. Show a "Selected: {name} ✕" chip under the search input when a selection exists but isn't visible in the current list.
- Keep clip duration, title reveal, host name, and Start Round sections untouched.
- Accessibility: search input = `role="searchbox"` + `aria-label`; region has `aria-live="polite"`; clear button has `aria-label="Clear search"` and 44×44 min hit target.

**Ask First:**
- Any divergence from a single-file change.
- Adding dependencies (lodash, debounce utils, etc.) — keep debounce inline via `setTimeout`/`clearTimeout` in an `$effect`.

**Never:**
- No tab bar, no Search submit button, no separate search-results list layout.
- On search error: do NOT fall back to presets while a query is active.
- Do not extract helpers or add unit tests for this UI-only change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty query | `searchQuery === ''` | Preset grid renders inside region | presetsError shown centered in region |
| User types "rock" | non-empty query after 250ms quiet | Fetch runs; tiles swap to results; modal height unchanged | On fetch fail → error-msg in region, presets NOT shown |
| Fast typing "r"→"ro"→"rock" | multiple changes <250ms apart | Only one fetch fires, for final query | N/A |
| Stale race | slow "a" response returns after "abba" results applied | Stale response discarded via searchSeq guard | N/A |
| Whitespace-only query | `searchQuery.trim() === ''` | Treat as empty → show presets | N/A |
| Clear via ✕ button | click clear-btn | searchQuery = ''; presets return | N/A |
| Select search result, then clear query | selection set, current view = presets, id not in presets | "Selected: {name} ✕" chip appears under search input; Start Round stays enabled | Chip ✕ clears selection |
| Offline | fetch throws | error-msg centered in region | No preset fallback |

</frozen-after-approval>

## Code Map

- [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- only file to change: script state, template, CSS.
- [src/server/music/router.ts](src/server/music/router.ts) -- unchanged; provides `/api/music/presets` and `/api/music/search`.
- [src/server/music/spotify.ts](src/server/music/spotify.ts) -- unchanged; `searchPlaylists()` returns `{name, owner, trackCount, playlistId}[]`.

## Tasks & Acceptance

**Execution:**
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- remove `Tab` type, `activeTab`, tab bar markup, `handleSearch`, `selectedPresetId`/`selectedPlaylistId` split, `selectedSource` derived.
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- add unified `selectedPlaylist: { id, name } | null`; update preset + result `onclick` handlers and Start Round enablement check.
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- pin search input at top of playlist region; add `inputmode="search"`, `enterkeyhint="search"`, `autocomplete="off"`, `role="searchbox"`; add inline clear (✕) button shown when `searchQuery` non-empty.
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- replace `handleSearch` with `$effect` on `searchQuery`: `clearTimeout` → `setTimeout(250)` → fetch with captured `searchSeq`. Apply results only if seq still matches.
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- wrap preset/result cards in `.playlist-region` with `max-height: ~280px`, `overflow-y: auto`, `aria-live="polite"`. Reset `scrollTop = 0` when toggling views or applying new results.
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- render preset cards when `searchQuery.trim() === ''`, otherwise loading / error / empty / result cards. Result cards reuse `.preset-card` + `.preset-name` (name) + `.preset-desc` (`{owner} · {trackCount} tracks`).
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- render "Selected: {name} ✕" chip under search input when selection exists and not visible in the current list.
- [ ] [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) -- delete now-unused CSS (`.tab-bar`, `.tab-btn`, `.tab-panel`, `.search-form`, `.search-btn`, `.search-results`, `.result-card`, `.result-name`, `.result-meta`); add `.playlist-region`, `.clear-btn`, `.selected-chip`; tweak `.search-input` to full-width; add `-webkit-line-clamp: 2` + ellipsis to `.preset-name`.

**Acceptance Criteria:**
- Given the modal is open with an empty query, when it renders, then there are no tabs and preset tiles appear inside a single scrollable region below the search input.
- Given the user clicks a preset tile, when the click resolves, then it highlights and Start Round becomes enabled.
- Given the user types "rock", when 250ms pass without further typing, then exactly one fetch fires and the same grid region swaps to result tiles while the modal height stays constant.
- Given a slow response for an earlier query returns after a faster response for a newer query, when both resolve, then only the newest query's results remain visible.
- Given the user selects a search result and clears the query, when presets re-render, then a "Selected: {name} ✕" chip appears under the search input and Start Round stays enabled.
- Given the user clicks the chip's ✕, when clicked, then selection clears and Start Round disables.
- Given network is offline and the user types a query, when the fetch fails, then an error message appears in the region and preset tiles are NOT shown while the query remains.

## Verification

**Commands:**
- `bun run typecheck` -- expected: no TS errors.

**Manual checks:**
- `bun run dev`, create a room, open round configuration, walk the full acceptance list in a browser (Chrome and iOS Safari via local IP).
