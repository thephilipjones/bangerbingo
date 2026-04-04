# Story 5.2: Bingo Card UI & Tile Marking

Status: done

## Story

As a player,
I want to see my bingo card and mark tiles as songs play,
so that I can track my progress and claim bingo when I complete a line.

## Acceptance Criteria

1. On `round:start`, `RoomPage` renders a 5×5 grid of tiles, each showing `title` (2-line max, ellipsis) and `artist` (10px muted). Centre tile (index 12) is always `free` state: lighter brand fill + "FREE" label, auto-marked, never tappable.
2. Tapping an `unmarked` tile → transitions to `marked` (brand fill + white text). Tapping a `marked` tile → toggles back to `unmarked`. Free tile is not tappable and ignores taps.
3. When `song:start` arrives with `titleRevealDelay > 0`: tile matching `trackId` enters `masked` state — CSS `blur(4px)` on title/artist text, overlaid with "Song N" label (N = `songIndex + 1`). Status line below card updates to "Song N of this round".
4. When `song:start` arrives with `titleRevealDelay === 0`: matching tile does NOT enter masked state; title stays visible. Status line still updates to "Song N of this round".
5. When `song:start` arrives with `titleRevealDelay === null` (never reveal): tile enters masked state and stays masked permanently (server never sends `song:reveal`).
6. When `song:reveal` arrives: CSS blur animates off over 300ms and "Song N" overlay fades out, revealing the tile title.
7. Between songs (no active song, or after `song:pause` / `songs:exhausted`): status line reads "Waiting for next song…".
8. When `round:win` arrives: all tiles in `winningTileIds` gain `win-path` state — gold/amber 2px outline applied on top of current state.
9. All interactive tiles are at least 44×44px (WCAG AA touch target). Tiles are approximately 60×60px at 375px viewport with minimal gaps.
10. Long-pressing a tile on touch (or hovering on desktop) reveals the full title via a tooltip if the text is truncated.
11. All text meets WCAG AA ≥ 4.5:1 contrast ratio against tile backgrounds.
12. Card is fully interactive within 2 seconds of `session:connect` completing (NFR3).

## Tasks / Subtasks

- [x] Create `src/client/lib/bingo.ts` with pure tile state logic (AC: 1–8)
  - [x] Define and export `ClientTile` interface
  - [x] `initTiles(card: Tile[]): ClientTile[]` — maps Tile[] to ClientTile[], sets state='free' on index 12 (free=true), 'unmarked' for all others
  - [x] `applyMask(tiles: ClientTile[], trackId: string, titleRevealDelay: TitleRevealDelay): ClientTile[]` — sets `masked=true` on matching tile when `titleRevealDelay !== 0`; noop when `titleRevealDelay === 0`; returns new array
  - [x] `startReveal(tiles: ClientTile[], trackId: string): ClientTile[]` — sets `masked=false, revealing=true` on matching tile; returns new array
  - [x] `finishReveal(tiles: ClientTile[], trackId: string): ClientTile[]` — sets `revealing=false` on matching tile; returns new array
  - [x] `toggleMark(tiles: ClientTile[], index: number): ClientTile[]` — toggles `unmarked↔marked`; noop for free tile; returns new array
  - [x] `applyWinPath(tiles: ClientTile[], winningTileIds: string[]): ClientTile[]` — sets `winPath=true` where `tile.trackId` is in `winningTileIds` or tile is `free` and "FREE" is in `winningTileIds`; returns new array

- [x] Create `src/client/components/BingoCard.svelte` (AC: 1–2, 9–11)
  - [x] Props: `tiles: ClientTile[]`, `onTileClick: (index: number) => void`
  - [x] Render 5×5 CSS grid; tiles ~60×60px at 375px viewport (use `aspect-ratio: 1` or fixed height)
  - [x] Per-tile: show `title` with 2-line max (CSS `-webkit-line-clamp: 2`), `artist` at 10px; apply state classes (`unmarked`, `marked`, `free`, `masked`, `revealing`, `win-path`)
  - [x] Masked state: apply `filter: blur(4px)` to title/artist text via CSS; overlay "Song N" label using slot (passed from parent as part of tile data)
  - [x] Reveal animation: `.revealing .tile-text { filter: blur(0); transition: filter 300ms; }` — blur animates off; "Song N" overlay fades with `opacity: 0; transition: opacity 300ms`
  - [x] Win-path: `outline: 2px solid #f5a623` or `box-shadow: inset 0 0 0 2px #f5a623` composable over any base state
  - [x] Free tile: render as non-interactive with `aria-disabled="true"` and `pointer-events: none`
  - [x] Touch target: ensure all interactive tiles have `min-width: 44px; min-height: 44px`
  - [x] Long-press/hover: `title` attribute on tile button for browser native tooltip; add `title={tile.title}` on the tile element

- [x] Update `src/client/pages/RoomPage.svelte` (AC: 1–8, 12)
  - [x] Import `BingoCard` from `../components/BingoCard.svelte`
  - [x] Import `initTiles`, `applyMask`, `startReveal`, `finishReveal`, `toggleMark`, `applyWinPath` from `../lib/bingo.ts`
  - [x] Import `Tile` type from server-side `../../server/game/cards.ts` — **WRONG**: do not import from server. Instead copy or re-declare `Tile` in `bingo.ts` for client use (or import from a shared location)
    - **Correct approach**: declare `Tile` interface directly in `bingo.ts` — same shape as server (`trackId`, `title`, `artist`, `albumArtUrl`, `free?: true`)
  - [x] State: `let tiles = $state<ClientTile[]>([])`, `let statusLine = $state('Waiting for the host to start a round...')`, `let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)`
  - [x] Handle `round:start` in `ws.onmessage`: extract `card` and `titleRevealDelay` from payload, call `tiles = initTiles(card)`, `roundConfig = { titleRevealDelay }`, `statusLine = 'Waiting for next song…'`
  - [x] Handle `song:start`: call `tiles = applyMask(tiles, data.trackId, roundConfig.titleRevealDelay)`, `statusLine = \`Song ${data.songIndex + 1} of this round\``; store `currentSongIndex = data.songIndex`
  - [x] Handle `song:reveal`: call `tiles = startReveal(tiles, data.trackId)`; schedule `setTimeout(() => { tiles = finishReveal(tiles, data.trackId) }, 300)`
  - [x] Handle `song:pause` and `songs:exhausted`: `statusLine = 'Waiting for next song…'`
  - [x] Handle `round:win`: call `tiles = applyWinPath(tiles, data.winningTileIds)`
  - [x] `handleTileClick(index: number)`: call `tiles = toggleMark(tiles, index)`
  - [x] Render: show `BingoCard` only when `tiles.length > 0`; show status line below card; keep existing `host-disconnected-banner`

- [x] Add `src/client/__tests__/bingo.test.ts` (AC: 1–8)
  - [x] `initTiles` — 25 tiles, index 12 is `free=true, state='free'`, all others `unmarked, masked=false, winPath=false`
  - [x] `applyMask` with `titleRevealDelay > 0` — masks matching tile, leaves others unchanged
  - [x] `applyMask` with `titleRevealDelay === 0` — no tile is masked
  - [x] `applyMask` with `titleRevealDelay === null` — matching tile IS masked (never-reveal = stay masked)
  - [x] `startReveal` — matching tile: `masked=false, revealing=true`
  - [x] `finishReveal` — matching tile: `revealing=false`
  - [x] `toggleMark` on `unmarked` tile → `marked`; `marked` tile → `unmarked`
  - [x] `toggleMark` on free tile (index 12) → noop, state unchanged
  - [x] `applyWinPath` — tiles with trackIds in `winningTileIds` get `winPath=true`; "FREE" in winningTileIds sets `winPath=true` on the free tile
  - [x] All functions return new array references (immutable — originals unchanged)

## Dev Notes

### CRITICAL: This story is client-side only — no server changes

Do NOT modify anything in `src/server/`. The server already broadcasts `round:start`, `song:start`, `song:reveal`, `song:pause`, `round:win`, `songs:exhausted` (all implemented in Story 5-1 + 4-3).

### Do NOT break RoomPage's existing host:disconnected / host:reconnected handling

`RoomPage.svelte` currently handles `host:disconnected` and `host:reconnected` in its `ws.onmessage`. When extending the handler, keep those cases intact. Pattern:

```svelte
ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data)
    if (data.type === 'host:disconnected') {
      hostDisconnected = true
    } else if (data.type === 'host:reconnected') {
      hostDisconnected = false
    } else if (data.type === 'round:start') {
      // ...
    } else if (data.type === 'song:start') {
      // ...
    }
    // etc.
  } catch {
    // ignore unparseable
  }
}
```

### BingoCard.svelte goes in a new `components/` folder

`src/client/components/` does not exist yet — create it. Story 5-3 will import `BingoCard.svelte` from the same location (`../components/BingoCard.svelte`), so name and path must be exact.

### ClientTile interface (define in bingo.ts, not imported from server)

```ts
// src/client/lib/bingo.ts
export interface Tile {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  free?: true
}

export interface ClientTile {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  free: boolean
  state: 'unmarked' | 'marked' | 'free'
  masked: boolean      // true = blur applied (title/artist hidden)
  revealing: boolean   // true = 300ms animation-out in progress
  winPath: boolean     // true = gold outline composited over current state
  songLabel: string    // "Song N" overlay label (e.g. "Song 3"), set on mask
}
```

Do NOT import `Tile` from the server path (`../../server/game/cards.ts`) — client code must not reach into `src/server/`.

### round:start payload shape (from Story 4-3 rooms.ts)

```ts
// Payload sent per-client via WebSocket
{
  type: 'round:start',
  roundNumber: number,
  playlist: Track[],        // full playlist array (not needed for card UI)
  clipDuration: ClipDuration,
  titleRevealDelay: TitleRevealDelay,  // 0 | 5 | 10 | 15 | null
  card: Tile[],             // 25 tiles; index 12 is { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
}
```

### song:start payload shape (from Story 5-1 rooms.ts)

```ts
{
  type: 'song:start',
  trackId: string,
  title: string,
  artist: string,
  albumArtUrl: string,
  seekPositionMs: number,    // always 60_000
  clipDuration: ClipDuration,
  titleRevealDelay: TitleRevealDelay,
  songIndex: number,         // 0-based; display as (songIndex + 1)
  roundNumber: number,
}
```

### Masked state semantics

| titleRevealDelay | song:start → mask? | song:reveal sent? |
|---|---|---|
| 0 (immediately) | NO — title visible instantly | No |
| 5 / 10 / 15 (seconds) | YES | Yes, after delay |
| null (never) | YES | Never |

In `applyMask`: mask when `titleRevealDelay !== 0`. This covers both `> 0` and `null`.

### CSS approach for masked/revealing states

Keep blur on the text content, not the whole tile, so the tile remains tappable and its background is visible:

```css
/* In BingoCard.svelte */
.tile.masked .tile-content {
  filter: blur(4px);
  user-select: none;
}

.tile.revealing .tile-content {
  filter: blur(0);
  transition: filter 300ms ease-out;
}

.tile.masked .song-label {
  opacity: 1;
}

.tile.revealing .song-label {
  opacity: 0;
  transition: opacity 300ms ease-out;
}

.tile.win-path {
  box-shadow: inset 0 0 0 2px #f5a623;
}
```

### Grid sizing at 375px viewport

5 columns × ~60px tiles with ~2px gaps = ~304px. Actual layout target:

```css
.bingo-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  width: 100%;
  max-width: 360px;
}

.tile {
  aspect-ratio: 1;
  min-width: 44px;
  min-height: 44px;
}
```

### Tile colours (match existing brand palette)

| State | Background | Text |
|---|---|---|
| `unmarked` | `#1a1a1a` (dark) | `#fff` |
| `marked` | `#1db954` (Spotify green) | `#000` |
| `free` | `#178a3e` (darker brand green) | `#fff` |
| `masked` | `#1a1a1a` | blurred — doesn't matter |

Win-path: `box-shadow: inset 0 0 0 2px #f5a623` composited over any base colour.

WCAG AA check: `#fff` on `#1a1a1a` = ~16:1 ✓; `#000` on `#1db954` = ~4.7:1 ✓; `#fff` on `#178a3e` = ~5.2:1 ✓.

### round:start arrives on the same WS set up by connectAsGuest in JoinPage

The `ws` prop passed to `RoomPage` was created by `connectAsGuest`. That function sets `ws.onmessage` to route `session:connect`, `host:disconnected`, `host:reconnected` to handlers, and everything else to `handlers.onMessage`. `RoomPage` then **overwrites** `ws.onmessage` entirely in its `onMount`. This is the existing pattern (see current `RoomPage.svelte`) — continue it. All event types, including `round:start`, `song:start`, etc., must be handled in `RoomPage`'s `ws.onmessage`.

### No App.svelte changes needed for this story

`handleJoined` in `App.svelte` passes the WS directly to `RoomPage`. The deferred item ("discards role") is resolved in Story 5-3 when the host flow is differentiated. For 5-2 (guest-only view), the current passthrough is correct.

### TitleRevealDelay type — client-side

`TitleRevealDelay = 0 | 5 | 10 | 15 | null`. Redeclare it in `bingo.ts` for client use — do NOT import it from `../../server/ws.ts`.

```ts
// bingo.ts
export type TitleRevealDelay = 0 | 5 | 10 | 15 | null
```

### Testing pattern — pure functions only, no component rendering

Client tests use vitest with no Svelte testing library. Only test `bingo.ts` functions:

```ts
// src/client/__tests__/bingo.test.ts
import { describe, it, expect } from 'vitest'
import { initTiles, applyMask, startReveal, finishReveal, toggleMark, applyWinPath } from '../lib/bingo.ts'
import type { Tile } from '../lib/bingo.ts'

function makeTiles(n = 25): Tile[] {
  return Array.from({ length: n }, (_, i) =>
    i === 12
      ? { trackId: '', title: '', artist: '', albumArtUrl: '', free: true as const }
      : { trackId: `track_${i}`, title: `Song ${i}`, artist: `Artist ${i}`, albumArtUrl: '' }
  )
}

describe('initTiles', () => {
  it('returns 25 ClientTiles with index 12 free and auto-marked', () => {
    const tiles = initTiles(makeTiles())
    expect(tiles).toHaveLength(25)
    expect(tiles[12].free).toBe(true)
    expect(tiles[12].state).toBe('free')
    expect(tiles[0].state).toBe('unmarked')
    expect(tiles[0].masked).toBe(false)
    expect(tiles[0].winPath).toBe(false)
  })
})
```

### Deferred item from Story 4-3 that affects this story

> `handleJoined` in `App.svelte` discards `role` and `players` — intentional stub; RoomPage will need both when the game loop is built in Epic 5.

For Story 5-2, `role` is always 'guest' in `handleJoined`, so no change needed. Story 5-3 resolves the host path.

### Deferred item from Story 5-1 that affects this story

> `stale fired timer IDs retained in round.timers` — `clearTimeout` on a fired timer is a no-op; `round.timers.autoAdvance !== undefined` cannot be used as a "timer pending" predicate.

Client-side implication: the client cannot predict timer state from server messages. Always rely on server-sent events (`song:start`, `song:pause`, `songs:exhausted`) to drive state transitions — do NOT implement any client-side timer logic for song advancement.

### References

- `round:start` payload shape: `src/server/rooms.ts` lines 209–216 (Story 4-3)
- `song:start` / `song:reveal` / `song:pause` / `songs:exhausted` / `round:win` events: `src/server/rooms.ts` (Story 5-1)
- `Tile` interface: `src/server/game/cards.ts` — mirror its shape in `bingo.ts`, do not import across src/client ↔ src/server
- `RoundState.songHistory`: `src/server/ws.ts` — story 5-6 adds history drawer; `round:win` includes `songHistory` snapshot but Story 5-2 does not display it
- Existing `RoomPage.svelte` ws.onmessage pattern: `src/client/pages/RoomPage.svelte`
- Client test pattern (vitest, pure TS functions): `src/client/__tests__/join.test.ts`
- Brand colours / dark background: `src/client/App.svelte` global styles (`background: #121212`, `color: #fff`, brand green `#1db954`)
- Touch target and tile size requirements: UX-DR21 (44×44px min, ~60×60px at 375px)
- Tile states reference: UX-DR4
- Guest card view header and status line: UX-DR3
- Tile typography: UX-DR20 (title 11–12px 2-line max; artist 10px muted)
- Story 5-3 imports `BingoCard.svelte` from `src/client/components/BingoCard.svelte` — path must be exact
- Existing 186 passing tests must not regress

### Review Findings

- [x] [Review][Decision] Masked tile text visible to screen readers — resolved: use `aria-label="{songLabel} (masked)"` during masked state. [src/client/components/BingoCard.svelte]
- [x] [Review][Patch] Blur reveal animation never fires — fixed: `startReveal` now keeps `masked: true` and only sets `revealing: true`; `finishReveal` clears both; CSS `.revealing` rule overrides `.masked` blur enabling the 300ms transition. [src/client/lib/bingo.ts]
- [x] [Review][Patch] `setTimeout` for `finishReveal` not cancelled on component destroy — fixed: stored as `revealTimer`, cancelled in `onDestroy` and before each new reveal. [src/client/pages/RoomPage.svelte]
- [x] [Review][Patch] `role="gridcell"` on `<button>`/`<div>` is invalid ARIA — fixed: removed redundant roles from both tile elements. [src/client/components/BingoCard.svelte]
- [x] [Review][Patch] `currentSongIndex` state set but never consumed — fixed: removed dead state. [src/client/pages/RoomPage.svelte]
- [x] [Review][Patch] Status line missing `role="status"` in pre-round branch — fixed: added `role="status"` to `{:else}` paragraph. [src/client/pages/RoomPage.svelte]
- [x] [Review][Defer] `song:reveal` fires unconditionally regardless of `titleRevealDelay` — server contract guarantees `song:reveal` is never sent when `titleRevealDelay === null`, so no-op in practice — deferred, pre-existing
- [x] [Review][Defer] `toggleMark` allows marking a masked tile — UX choice; spec does not prohibit early marking — deferred, pre-existing
- [x] [Review][Defer] Masked tile stays masked through `round:win` in null-delay games — game is over at that point; acceptable UX — deferred, pre-existing
- [x] [Review][Defer] Duplicate `trackId` in card causes both tiles to reveal simultaneously — server-side concern; `generateCard` prevents duplicates — deferred, pre-existing
- [x] [Review][Defer] Multiple `tile.free === true` tiles all highlight on 'FREE' win — server always sends exactly one free tile at index 12 — deferred, pre-existing

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none)

### Completion Notes List

- Created `src/client/lib/bingo.ts` with pure immutable state functions: `initTiles`, `applyMask`, `startReveal`, `finishReveal`, `toggleMark`, `applyWinPath`. Added `songIndex` parameter to `applyMask` to populate `songLabel` for the masked overlay.
- Created `src/client/components/BingoCard.svelte` with 5×5 CSS grid, `aspect-ratio: 1` tiles, full state class system (unmarked/marked/free/masked/revealing/win-path), WCAG AA colours (#fff/#1a1a1a ~16:1, #000/#1db954 ~4.7:1, #fff/#178a3e ~5.2:1), `min-width/height: 44px`, native `title` attribute for tooltip, free tile rendered as non-interactive div.
- Updated `src/client/pages/RoomPage.svelte` to handle `round:start`, `song:start`, `song:reveal`, `song:pause`, `songs:exhausted`, `round:win` events; kept existing `host:disconnected`/`host:reconnected` handling intact.
- 20 new unit tests in `bingo.test.ts`, all passing. Full suite: 208 tests, 0 regressions.

### File List

- `src/client/lib/bingo.ts` (new)
- `src/client/components/BingoCard.svelte` (new)
- `src/client/pages/RoomPage.svelte` (update)
- `src/client/__tests__/bingo.test.ts` (new)

## Change Log

- 2026-04-04: Story created by bmad-create-story workflow — full context from Epic 5 analysis, Story 5-1 dev notes, existing client architecture (RoomPage WS pattern, test style, no Svelte testing library)
- 2026-04-04: Implemented by claude-sonnet-4-6 — created bingo.ts pure logic module, BingoCard.svelte component, updated RoomPage.svelte with WS event handlers, added 20 unit tests; 208 tests total passing
