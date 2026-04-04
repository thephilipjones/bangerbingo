# Story 5.5: Win Detection & Win Overlay

Status: done

## Story

As a player,
I want to claim bingo and have it verified instantly,
So that the winner is confirmed fairly and everyone sees the result.

## Acceptance Criteria

**Given** a player marks tiles on their card
**When** any marked tile completes a winning line (row, column, or either diagonal — counting the FREE centre tile)
**Then** a "Bingo!" button becomes visible and tappable on the player's card view
**And** the button is not shown before a winning line is detected client-side

**Given** the "Bingo!" button is tapped
**When** the player submits the claim
**Then** the client calls `POST /api/rooms/:code/round/claim` with the array of `trackId` values the player has marked (plus `"FREE"` for the centre tile)
**And** the button enters a disabled/loading state immediately to prevent duplicate claims

**Given** the server receives a bingo claim
**When** it validates the claim
**Then** it checks: (a) the claimed tile IDs are all present on the player's server-stored card (`currentRound.cards[playerName]`), and (b) the claimed tile IDs that are non-FREE all appear in `currentRound.songHistory` (i.e. have been played)
**And** it checks that at least one complete winning line (5 in a row/column/diagonal) exists within the claimed set

**Given** the claim is valid
**When** validation passes
**Then** the server broadcasts `round:win` to all clients with: `winnerName`, `winningTileIds` (the validated line), and `songHistory` snapshot
**And** all pending auto-advance and reveal timers are cancelled
**And** `currentRound.ended = true` and `currentRound.active = false` are set so no further `song:start` events are emitted

**Given** the claim is invalid (tiles not played, not on card, or no complete line)
**When** validation fails
**Then** the server returns HTTP 422 to the claiming client with a brief error reason
**And** no `round:win` is broadcast; other players are unaffected
**And** the claiming player's "Bingo!" button re-enables so they can retry

**Given** all clients receive `round:win`
**When** the event is processed
**Then** a full-screen Win Overlay renders above all other content (highest z-index)
**And** it displays: a CSS confetti animation (~2 seconds), the winner's name at 24px, and a list of the winning songs (title + artist)

**Given** the Win Overlay is shown on a guest's screen
**When** 5 seconds elapse
**Then** the overlay auto-dismisses and the player returns to their card view in a post-round state

**Given** the Win Overlay is shown on the host's screen
**When** 1.5 seconds elapse
**Then** a "Start Next Round" CTA appears on the overlay
**And** a secondary "Dismiss" button is also visible
**And** tapping "Start Next Round" calls `onRoundEnded()` to navigate to the lobby; tapping "Dismiss" closes the overlay and returns to the card in post-round state

**Given** two players submit claims simultaneously
**When** both `POST /round/claim` requests reach the server
**Then** the first request to arrive is validated and wins; the second receives HTTP 409 indicating the round has already ended

## Tasks / Subtasks

- [x] Add `ended?: boolean` to `RoundState` interface in `src/server/ws.ts`

- [x] Add `POST /rooms/:code/round/claim` to `roomsRouter` in `src/server/rooms.ts`
  - [x] No `requireAuth` — guest endpoint; body: `{ playerName: string, claimedTileIds: string[] }`
  - [x] 404 if room not found
  - [x] 404 if no `roomState` or `currentRound`
  - [x] 409 if `!round.active || round.ended` (round already won or ended)
  - [x] 422 if `claimedTileIds` contains IDs not in player's card (`currentRound.cards.get(playerName)`)
  - [x] 422 if non-FREE claimed IDs not all in `round.songHistory` (by trackId)
  - [x] 422 if no complete WIN_LINE found in claimed set
  - [x] On valid: `clearRoundTimers(round)`, `round.active = false`, `round.ended = true`
  - [x] Broadcast `{ type: 'round:win', winnerName: playerName, winningTileIds: <winning line ids>, songHistory: round.songHistory }`
  - [x] Return HTTP 200 `{}`

- [x] Create `src/client/components/WinOverlay.svelte`
  - [x] Props: `winnerName: string`, `winningSongs: Array<{title: string, artist: string}>`, `isHost: boolean`, `onStartNextRound: () => void`, `onDismiss: () => void`
  - [x] `position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.92)`
  - [x] CSS confetti animation (keyframes, ~2s)
  - [x] Winner name display at `font-size: 24px`
  - [x] List of winning songs (title + artist)
  - [x] Guest: auto-dismiss after 5 seconds via `onMount` setTimeout → `onDismiss()`
  - [x] Host: CTAs appear after 1.5s (`showCtas = $state(false)`, `setTimeout(() => showCtas = true, 1500)`)
  - [x] Host CTAs: "Start Next Round" button → `onStartNextRound()`, "Dismiss" button → `onDismiss()`
  - [x] `onDestroy`: clear the timers

- [x] Update `src/client/pages/RoomPage.svelte` — add `code: string` prop and win flow
  - [x] Add `code: string` to props destructuring (currently `{ name, ws }`)
  - [x] Add state: `isClaiming = $state(false)`, `winData = $state<{winnerName: string, winningTileIds: string[], songHistory: SongHistoryEntry[]} | null>(null)`, `roundEnded = $state(false)`
  - [x] Add `hasBingo = $derived(...)` — checks if any WIN_LINE has all 5 positions marked/free in `tiles`
  - [x] Handle `round:win` WS event: `tiles = applyWinPath(tiles, data.winningTileIds)`, set `winData`, `roundEnded = true`
  - [x] Show "Bingo!" button in template when `hasBingo && !roundEnded && !isClaiming`
  - [x] On "Bingo!" click: `isClaiming = true`, POST `/api/rooms/${code}/round/claim`, handle 422 (re-enable), handle 409 (silent, round done)
  - [x] Render `<WinOverlay>` when `winData !== null`
  - [x] WinOverlay `onDismiss`: `winData = null` (returns to card view)
  - [x] WinOverlay `onStartNextRound`: not needed for guests (isHost=false), no-op

- [x] Update `src/client/App.svelte` — pass `code` prop to RoomPage
  - [x] Change `<RoomPage name={guestName} ws={guestWs!} />` to `<RoomPage name={guestName} code={guestRoomCode} ws={guestWs!} />`

- [x] Update `src/client/pages/HostRoomPage.svelte` — add Win Overlay on `round:win`
  - [x] Add `winData = $state<{...} | null>(null)` state
  - [x] In `round:win` WS handler: set `winData`, `tiles = applyWinPath(tiles, data.winningTileIds)` (already done), also set `isPlaying = false`
  - [x] Import and render `<WinOverlay>` when `winData !== null`
  - [x] WinOverlay `onStartNextRound`: calls `onRoundEnded()`
  - [x] WinOverlay `onDismiss`: `winData = null`

- [x] Add server tests in `src/server/__tests__/rooms.test.ts`
  - [x] `POST /api/rooms/:code/round/claim` describe block with `beforeEach: initDb(':memory:'), roomSockets.clear()`
  - [x] 200 — valid claim broadcasts `round:win`, sets `active=false`, `ended=true`
  - [x] 422 — claimed tile not on player's card
  - [x] 422 — claimed tile not in songHistory (not yet played)
  - [x] 422 — no complete winning line in claimed set
  - [x] 409 — second claim after round already won

## Dev Notes

### WIN_LINES Constant (Server & Client)

Define `WIN_LINES` as a constant in `rooms.ts` (server):
```ts
const WIN_LINES: number[][] = [
  [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24], // rows
  [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24], // cols
  [0,6,12,18,24], [4,8,12,16,20], // diagonals
]
```

Same structure needed client-side in `RoomPage.svelte` for `hasBingo` derived check.

### Server Claim Validation — Tile ID Mapping

The player's card is `Tile[]` (25 elements). Index 12 is the free tile (`tile.free === true`, `tile.trackId === ''`). Effective ID per tile:
```ts
const effectiveId = (tile: Tile) => tile.free ? 'FREE' : tile.trackId
```

Steps:
1. Get card: `const card = round.cards.get(playerName)` — 404/422 if missing
2. All claimed IDs present on card: `claimedTileIds.every(id => card.some(t => effectiveId(t) === id))`
3. Non-FREE played: `claimedTileIds.filter(id => id !== 'FREE').every(id => round.songHistory.some(e => e.trackId === id))`
4. Win line: build `claimedSet = new Set(claimedTileIds)`, then for each WIN_LINE check if all 5 positions' effective IDs are in `claimedSet`. Find first matching line = `winningTileIds`.

### Client-Side Win Detection (`hasBingo` derived)

```ts
const WIN_LINES = [ /* same 12 lines */ ]

const hasBingo = $derived(() => {
  if (tiles.length === 0 || roundEnded) return false
  return WIN_LINES.some(line =>
    line.every(i => tiles[i]?.state === 'marked' || tiles[i]?.state === 'free')
  )
})
```

**Note:** `$derived` syntax in Svelte 5 — use `$derived(expression)` not `$derived(() => expression)`. See existing examples in HostRoomPage (which doesn't use derived) but follow Svelte 5 syntax from project context.

Actually for this project's Svelte 5 usage: use `$derived(expression)` directly:
```ts
const hasBingo = $derived(
  tiles.length > 0 &&
  !roundEnded &&
  WIN_LINES.some(line => line.every(i => tiles[i]?.state === 'marked' || tiles[i]?.state === 'free'))
)
```

### Claim Request Body & Player Identity

No session cookie for guests — identity is asserted via `playerName` in body. Sufficient for personal MVP (same trust model as existing WS name-based auth). Request:
```ts
{
  playerName: name,          // the guest's display name (prop of RoomPage)
  claimedTileIds: string[],  // trackIds of marked tiles + 'FREE' for centre
}
```

Gather claimed IDs from current tiles:
```ts
const claimedTileIds = tiles
  .filter(t => t.state === 'marked' || t.state === 'free')
  .map(t => t.free ? 'FREE' : t.trackId)
```

### round:win Payload

Server broadcasts:
```ts
{
  type: 'round:win',
  winnerName: string,         // player who won
  winningTileIds: string[],   // 5 effective IDs from the winning line (e.g. ['t0','t5','FREE','t15','t20'])
  songHistory: SongHistoryEntry[], // full history snapshot for overlay display
}
```

Client derives winning songs for overlay:
```ts
const winningSongs = data.songHistory.filter(e => data.winningTileIds.includes(e.trackId))
// Note: 'FREE' won't match any SongHistoryEntry.trackId — that's fine, show 4 songs if FREE is in the line
```

### `ended` vs `active` on RoundState

After a win: `round.active = false` AND `round.ended = true`. The `active=false` guard already prevents `advanceToNext` from firing. The `/round/play`, `/round/next`, `/round/pause` endpoints all check `round?.active` — they'll return 404 "No active round" after a win. This is acceptable; the host uses the Win Overlay CTA to start the next round.

`/round/end` also checks `round?.active` — same result. The host doesn't need to call `/round/end` after a win; navigating to lobby and starting a new round via `POST /round` overwrites `roomState.currentRound`.

### WinOverlay z-index

- `wsError` banner: `z-index: 200` (HostRoomPage.svelte line ~139)
- `SdkFailureBanner`: `z-index: 190`
- `WinOverlay`: `z-index: 300` (must be highest)

### WinOverlay CSS Confetti (Pure CSS)

Simple approach — pseudo-element confetti squares that animate in a burst:
```css
@keyframes confetti-fall {
  0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(60px) rotate(180deg); opacity: 0; }
}
```
Use 8–12 `<span>` elements with staggered `animation-delay` values. Keep it lightweight — this is MVP. Total animation: 2 seconds, then confetti elements hidden via `opacity: 0`.

### App.svelte Change (IMPORTANT — don't miss this)

`RoomPage` currently receives `name` and `ws` props but NOT `code`. The room code is available in App.svelte as `guestRoomCode`. Add `code={guestRoomCode}` to the RoomPage instantiation:

```svelte
<!-- src/client/App.svelte line 69 — BEFORE -->
<RoomPage name={guestName} ws={guestWs!} />

<!-- AFTER -->
<RoomPage name={guestName} code={guestRoomCode} ws={guestWs!} />
```

Also update `RoomPage.svelte` props destructuring:
```ts
// Before:
let { name, ws }: { name: string; ws: WebSocket } = $props()
// After:
let { name, code, ws }: { name: string; code: string; ws: WebSocket } = $props()
```

### Existing `round:win` Handler in RoomPage & HostRoomPage

Both pages already have a `round:win` WS handler that calls `applyWinPath(tiles, data.winningTileIds)`. DO NOT remove this — extend it:

**RoomPage.svelte** (current line 51-52):
```ts
} else if (data.type === 'round:win') {
  tiles = applyWinPath(tiles, data.winningTileIds)
  // ADD:
  roundEnded = true
  winData = { winnerName: data.winnerName, winningTileIds: data.winningTileIds, songHistory: data.songHistory }
}
```

**HostRoomPage.svelte** (current line 123-124):
```ts
} else if (data.type === 'round:win') {
  tiles = applyWinPath(tiles, data.winningTileIds)
  // ADD:
  isPlaying = false
  winData = { winnerName: data.winnerName, winningTileIds: data.winningTileIds, songHistory: data.songHistory }
}
```

### `SongHistoryEntry` Import on Client

`SongHistoryEntry` is currently defined in `src/server/ws.ts` (server-side). Do NOT import server types client-side. Just use an inline type for the client:
```ts
type WinData = {
  winnerName: string
  winningTileIds: string[]
  songHistory: Array<{ trackId: string; title: string; artist: string; songIndex: number }>
}
```

### Test Pattern for `/round/claim`

Follow the pause/sdk/device test patterns. For a valid claim test, you need:
1. Set up card in `currentRound.cards` (the `seedActiveRound` helper doesn't populate cards — add them manually)
2. Set up `songHistory` entries matching the claim
3. Verify `round:win` broadcast and `round.active === false`, `round.ended === true`

```ts
describe('POST /api/rooms/:code/round/claim', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
  })

  it('200 — valid claim broadcasts round:win and ends round', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()

    // Build a card and song history for a row win (positions 0-4)
    const winTracks = makeTracksLocal(5) // or define inline
    const card: Tile[] = [
      ...winTracks.map(t => ({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '' })),
      ...Array.from({ length: 20 }, (_, i) => ({ trackId: `other${i}`, title: `O${i}`, artist: 'A', albumArtUrl: '' }))
    ]
    card[12] = { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
    round.cards.set('Alice', card)
    // Add winTracks[0-4] to songHistory
    winTracks.forEach((t, i) => round.songHistory.push({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '', songIndex: i }))

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const claimedTileIds = winTracks.map(t => t.id)
    const res = await app.request('/api/rooms/ABCD/round/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice', claimedTileIds }),
    })
    expect(res.status).toBe(200)
    expect(round.active).toBe(false)
    expect(round.ended).toBe(true)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('round:win')
    expect(msg.winnerName).toBe('Alice')
  })
})
```

Note: `makeTracksLocal` is defined at the top of rooms.test.ts (line ~547). Check its definition — it creates tracks with predictable IDs. You can also inline track arrays for clarity.

### `Tile` Type for Tests

`Tile` is exported from `src/server/game/cards.ts` — import it in tests if needed:
```ts
import type { Tile } from '../game/cards.ts'
```

### Post-Round State for Guests

After WinOverlay dismisses (5s or manual), guests see their card with winning tiles highlighted (`winPath: true` styling applied by `applyWinPath`). No active Bingo button (`roundEnded = true`). The round is over — guests wait for the host to start a new round (which sends `round:start`). On `round:start`, `tiles` are re-initialized and `roundEnded = false`, `winData = null`.

### File List of Changes

- `src/server/ws.ts` — add `ended?: boolean` to `RoundState` interface
- `src/server/rooms.ts` — add `WIN_LINES` constant + `POST /rooms/:code/round/claim` endpoint
- `src/client/components/WinOverlay.svelte` (new) — full-screen overlay, confetti, winner display, host CTAs
- `src/client/pages/RoomPage.svelte` — add `code` prop, `hasBingo` derived, Bingo button, claim POST, WinOverlay
- `src/client/pages/HostRoomPage.svelte` — add `winData` state, WinOverlay on `round:win`
- `src/client/App.svelte` — pass `code={guestRoomCode}` to RoomPage
- `src/server/__tests__/rooms.test.ts` — `POST /api/rooms/:code/round/claim` describe block (5 tests)

### References

- `RoundState` interface: `src/server/ws.ts` lines 29–45
- `clearRoundTimers()`: `src/server/rooms.ts` lines 15–20
- `broadcast()`: `src/server/ws.ts` lines 63–75
- `advanceToNext()` active guard (pattern to follow): `src/server/rooms.ts` lines 100–111
- Existing `round:win` handler in RoomPage: `src/client/pages/RoomPage.svelte` lines 51–52
- Existing `round:win` handler in HostRoomPage: `src/client/pages/HostRoomPage.svelte` lines 123–124
- `applyWinPath` function (existing, handles 'FREE' correctly): `src/client/lib/bingo.ts` lines 73–80
- `wsError` banner z-index: `src/client/pages/HostRoomPage.svelte` line ~150 (z-index: 200)
- `SdkFailureBanner` z-index: `src/client/components/SdkFailureBanner.svelte` (z-index: 190)
- `seedActiveRound` test helper: `src/server/__tests__/rooms.test.ts` lines 554–571
- `makeApp()` test helper: `src/server/__tests__/rooms.test.ts` lines 32–36
- `seedHost()` / `seedRoom()` test helpers: `src/server/__tests__/rooms.test.ts` lines 21–43
- `guestRoomCode` state in App.svelte: `src/client/App.svelte` line 16
- `handleJoined` captures `code` already: `src/client/App.svelte` lines 31–36
- Tile free index: `src/server/game/cards.ts` line 43 (`tiles[12] = { ..., free: true }`)
- Brand colours: `#1db954` (Spotify green), `#1a1a1a` (card bg), `#121212` (page bg)
- Touch target minimum: 44×44px (WCAG AA) — apply to Bingo button

### Known Post-Win Limitations (Don't Fix in This Story)

- Host's Play/Next/Pause buttons will fail with 404 after win (round.active=false) — acceptable; Win Overlay CTAs handle the flow
- `round/end` POST returns 404 after a win — same reason; not needed since overlay CTA navigates directly
- No server-side "already won" signal for guests who join after `round:win` — out of scope for 5-5; addressed in 5-6 late-join sync

## Dev Agent Record

### Completion Notes

- Added `ended?: boolean` to `RoundState` interface to track win state separately from `active`
- Implemented `POST /rooms/:code/round/claim` endpoint with full validation chain: card membership, song history presence, win line detection via `WIN_LINES` constant (12 lines: 5 rows, 5 cols, 2 diagonals)
- Claim endpoint is guest-accessible (no `requireAuth`); identity asserted via `playerName` in body — same trust model as existing WS auth
- Created `WinOverlay.svelte` with CSS keyframe confetti, winner name at 24px, winning song list, 5s guest auto-dismiss, 1.5s host CTA reveal
- Extended `RoomPage.svelte` with `code` prop, `hasBingo` derived (WIN_LINES client-side), Bingo button with disabled/loading state, claim POST handler, WinOverlay integration
- Extended `HostRoomPage.svelte` with `winData` state, WinOverlay with Start Next Round / Dismiss CTAs
- Updated `App.svelte` to pass `code={guestRoomCode}` to RoomPage
- All 224 tests pass (5 new claim endpoint tests added)

## File List

- `src/server/ws.ts` — added `ended?: boolean` to `RoundState`
- `src/server/rooms.ts` — added `WIN_LINES` constant + `POST /rooms/:code/round/claim` endpoint
- `src/client/components/WinOverlay.svelte` (new) — full-screen overlay, confetti, winner display, host CTAs
- `src/client/pages/RoomPage.svelte` — added `code` prop, `hasBingo` derived, Bingo button, claim POST, WinOverlay
- `src/client/pages/HostRoomPage.svelte` — added `winData` state, WinOverlay on `round:win`
- `src/client/App.svelte` — passes `code={guestRoomCode}` to RoomPage
- `src/server/__tests__/rooms.test.ts` — added `POST /api/rooms/:code/round/claim` describe block (5 tests)

### Review Findings

- [x] [Review][Decision] Confetti visual quality — patched: pieces now spread across full viewport width with varied top positions, fall full viewport height [src/client/components/WinOverlay.svelte]

- [x] [Review][Patch] Race condition in /round/claim — fixed: `round.ended = true` set optimistically before `await ctx.req.json()`; restored to `false` on any validation failure [src/server/rooms.ts]
- [x] [Review][Patch] `isClaiming` permanently stuck on unexpected HTTP status (404, 500, etc.) — fixed: any non-200 response resets `isClaiming = false` [src/client/pages/RoomPage.svelte]
- [x] [Review][Patch] `isClaiming` not cleared when `round:win` WS event arrives while claim is in-flight — fixed: `isClaiming = false` added to `round:win` handler [src/client/pages/RoomPage.svelte]
- [x] [Review][Patch] `claimedTileIds` array elements not validated as strings — fixed: element-level `typeof id === 'string'` check added to body validation [src/server/rooms.ts]
- [x] [Review][Patch] Host `round:start` handler does not reset `winData` — fixed: `winData = null` added to `round:start` handler [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] Non-null assertion `winData!` inside `{#if winData !== null}` template block — fixed: removed unnecessary `!` assertion [src/client/pages/HostRoomPage.svelte]

- [x] [Review][Defer] `claimedTileIds` array length unbounded — O(n²) card scan; acceptable for personal MVP [src/server/rooms.ts] — deferred, pre-existing
- [x] [Review][Defer] Late-joining guest card absent from `round.cards` → always 422 on claim — explicitly deferred to story 5-6 (late-join sync) — deferred, pre-existing
- [x] [Review][Defer] `WinData` type and `WIN_LINES` constant duplicated across client/server — code quality issue, no runtime bug — deferred, pre-existing
- [x] [Review][Defer] `applyWinPath` may silently produce no highlight if song was never revealed on client — pre-existing pattern — deferred, pre-existing

## Change Log

- 2026-04-04: Story created by bmad-create-story workflow — previous story intelligence from 5-4 (fire-and-forget patterns, WS event handling, Svelte 5 reactivity patterns, component structure), analysis of existing RoomPage/HostRoomPage round:win stubs, App.svelte code prop gap identified
- 2026-04-04: Implemented by dev agent — all tasks complete, 224 tests pass
- 2026-04-04: Code review — 1 decision-needed, 6 patch, 4 deferred, 8 dismissed
