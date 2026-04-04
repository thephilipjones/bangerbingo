# Story 4.2: Round Configuration Screen

Status: done

## Story

As a host,
I want to configure the music source, clip duration, and title reveal setting before starting a round,
So that I control the game experience for each round.

## Acceptance Criteria

1. From the lobby, tapping "Configure Round" navigates the host to a Round Config screen with two tabs: "Genre" and "Search".
2. On the Genre tab, genre presets from `GET /api/music/presets` are displayed as visual cards (name + one-line descriptor); tapping a card selects it with a brand-fill highlight; only one preset can be selected at a time.
3. On the Search tab, the host can type a freeform query; submitting calls `GET /api/music/search?q=<query>`; results display playlist name, owner, and track count; selecting a result designates it as the round's source.
4. Clip duration pill toggles (20s, 30s, 45s, 60s, Full Song) are always visible; exactly one is selected at a time; default is 30s.
5. Title reveal radio group (Immediately, After 5s, After 10s, After 15s, Never) is always visible; exactly one is selected; default is After 5s.
6. Tapping "Start Round →" while a music source is selected submits `{ playlistId, clipDuration, titleRevealDelay }` to the server (POST `/api/rooms/:code/round`); the button shows a loading state during the request.
7. Tapping "Start Round →" without a music source selected shows an inline error: "Select a genre or playlist first".
8. On a successful server response, the host is navigated away from Round Config (to the in-round game view — which will be built in Epic 5; for now, navigate back to lobby as placeholder).
9. All interactive elements meet the 44×44px minimum touch target (UX-DR21).

## Tasks / Subtasks

- [x] `POST /api/rooms/:code/round` server endpoint — add to `src/server/rooms.ts` (AC: 6, 8)
  - [x] Add route `roomsRouter.post('/rooms/:code/round', requireAuth, ...)` in rooms.ts
  - [x] Verify room exists (`getRoomByCode(code)`) and belongs to authenticated host; return 404 if not found, 403 if not owner
  - [x] Validate `playlistId` (non-empty string), `clipDuration` (one of: 20, 30, 45, 60, 'full'), `titleRevealDelay` (one of: 0, 5, 10, 15, null); return 400 on invalid input
  - [x] Store round config in `roomSockets` (import from `./ws.ts`) by extending the RoomState entry: `roomSockets.get(code).pendingRound = { playlistId, clipDuration, titleRevealDelay, roundNumber }`
  - [x] Return `{ roundNumber, playlistId, clipDuration, titleRevealDelay }` on success

- [x] Extend `RoomState` in `src/server/ws.ts` to include `pendingRound` field (AC: 6)
  - [x] Add `pendingRound?: RoundConfig` to `RoomState` interface
  - [x] Export `RoundConfig` type from ws.ts for use in rooms.ts

- [x] Add `startRound()` to `src/client/lib/api.ts` (AC: 6)
  - [x] Function signature: `startRound(code: string, payload: StartRoundPayload): Promise<StartRoundResponse>`
  - [x] POST to `/api/rooms/${code}/round`; throw on non-ok response with error message from body

- [x] Implement `RoundConfigPage.svelte` — replace stub content (AC: 1–9)
  - [x] Add `onRoundStarted: () => void` prop alongside existing `code: string` prop
  - [x] Tab bar: Genre / Search (Svelte 5 `$state`)
  - [x] Genre tab: fetch presets on mount; render as tappable cards; track selected preset in `$state`
  - [x] Search tab: controlled input; fetch on submit; render results; track selected playlist in `$state`
  - [x] Clip duration pills: render 5 options; manage single selection; default 30s
  - [x] Title reveal radios: render 5 options; manage single selection; default After 5s
  - [x] "Start Round →" button: disabled + loading state while submitting; inline error if no source selected
  - [x] On success: call `onRoundStarted()` to navigate back to lobby (placeholder until Epic 5)

- [x] Wire `onRoundStarted` callback in `App.svelte` (AC: 8)
  - [x] Add `handleRoundStarted()` function: sets `page = 'lobby'`
  - [x] Update `<RoundConfigPage>` usage: `<RoundConfigPage code={currentRoomCode} onRoundStarted={handleRoundStarted} />`

- [x] Tests (AC: 1–9)
  - [x] Server: add to `src/server/__tests__/rooms.test.ts`
    - [x] `POST /api/rooms/:code/round` — valid payload → 200 with round config
    - [x] `POST /api/rooms/:code/round` — missing/invalid playlistId → 400
    - [x] `POST /api/rooms/:code/round` — invalid clipDuration → 400
    - [x] `POST /api/rooms/:code/round` — invalid titleRevealDelay → 400
    - [x] `POST /api/rooms/:code/round` — unauthenticated → 401
    - [x] `POST /api/rooms/:code/round` — room not found → 404
    - [x] `POST /api/rooms/:code/round` — room belongs to different host → 403
  - [x] Client: add to `src/client/__tests__/round-config.test.ts`
    - [x] `startRound()` — calls POST with correct body; returns parsed response
    - [x] `startRound()` — throws with message on non-ok response

## Dev Notes

### LOBBY → ROUND CONFIG NAVIGATION IS ALREADY DONE

`App.svelte` already handles this:
```svelte
function handleConfigureRound() { page = 'roundconfig' }
// ...
<LobbyPage code={currentRoomCode} onConfigureRound={handleConfigureRound} />
// ...
<RoundConfigPage code={currentRoomCode} />
```
`LobbyPage.svelte` already has `<button class="configure-btn" onclick={onConfigureRound}>Configure Round →</button>`.

**Do NOT re-implement this.** Mark the navigation task complete immediately. Only work needed: add `onRoundStarted` prop and wire the success callback.

### RoundConfigPage.svelte already exists as a stub

`src/client/pages/RoundConfigPage.svelte` already exists with:
- `code: string` prop
- Header with room code copy button (preserve this)
- Placeholder `<h1>Round config (Epic 4)</h1>` — replace this with the full implementation
- Existing CSS for the header/room-code display — keep and extend

Add the `onRoundStarted: () => void` prop alongside the existing `code` prop:
```svelte
let { code, onRoundStarted }: { code: string; onRoundStarted: () => void } = $props()
```

### Server route goes in rooms.ts (NOT a new file)

Add directly to `src/server/rooms.ts`. The file already imports `requireAuth`, `type AuthEnv`, `getRoomByCode` (available from db.ts). Just add:
```ts
import { roomSockets } from './ws.ts'
// ...
roomsRouter.post('/rooms/:code/round', requireAuth, async (ctx) => { ... })
```

No circular dependency: ws.ts imports from db.ts and refresh.ts but NOT from rooms.ts.

### Extending RoomState in ws.ts

Add to `src/server/ws.ts`:
```ts
export type ClipDuration = 20 | 30 | 45 | 60 | 'full'
export type TitleRevealDelay = 0 | 5 | 10 | 15 | null  // null = never

export interface RoundConfig {
  playlistId: string
  clipDuration: ClipDuration
  titleRevealDelay: TitleRevealDelay
  roundNumber: number
}

interface RoomState {
  host: WebSocket | null
  hostUserId: string
  hostHasEverConnected: boolean
  guests: Map<string, WebSocket>
  pendingRound?: RoundConfig  // ← add this
}
```

Export the types so rooms.ts can import them. `roomSockets` is already exported.

### Storing round config (server endpoint pattern)

```ts
import { roomSockets, type RoundConfig, type ClipDuration, type TitleRevealDelay } from './ws.ts'
import { getRoomByCode } from './db.ts'

const VALID_CLIP_DURATIONS: ClipDuration[] = [20, 30, 45, 60, 'full']
const VALID_TITLE_REVEAL_DELAYS: TitleRevealDelay[] = [0, 5, 10, 15, null]

roomsRouter.post('/rooms/:code/round', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')
  
  // Room ownership check
  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)
  
  const body = await ctx.req.json().catch(() => null)
  if (!body) return ctx.json({ message: 'Invalid request body' }, 400)
  
  const { playlistId, clipDuration, titleRevealDelay } = body
  
  if (!playlistId || typeof playlistId !== 'string')
    return ctx.json({ message: 'playlistId is required' }, 400)
  if (!VALID_CLIP_DURATIONS.includes(clipDuration))
    return ctx.json({ message: 'Invalid clipDuration' }, 400)
  if (!VALID_TITLE_REVEAL_DELAYS.includes(titleRevealDelay))
    return ctx.json({ message: 'Invalid titleRevealDelay' }, 400)
  
  // Get or init room socket entry, increment roundNumber
  const roomState = roomSockets.get(code)
  const roundNumber = roomState?.pendingRound ? roomState.pendingRound.roundNumber + 1 : 1
  
  const roundConfig: RoundConfig = { playlistId, clipDuration, titleRevealDelay, roundNumber }
  
  if (roomState) {
    roomState.pendingRound = roundConfig
  }
  // Note: if roomSockets has no entry (host not yet WS-connected), we can't store it.
  // This is acceptable for now — Story 4-3 will read this when starting the round.
  
  return ctx.json(roundConfig)
})
```

### startRound() in client lib/api.ts

Add to `src/client/lib/api.ts` following the existing pattern:
```ts
export interface StartRoundPayload {
  playlistId: string
  clipDuration: number | 'full'
  titleRevealDelay: number | null
}

export interface StartRoundResponse {
  roundNumber: number
  playlistId: string
  clipDuration: number | 'full'
  titleRevealDelay: number | null
}

export async function startRound(code: string, payload: StartRoundPayload): Promise<StartRoundResponse> {
  const res = await fetch(`/api/rooms/${code}/round`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(err.message ?? 'Request failed')
  }
  return res.json()
}
```

### Genre tab card design (UX-DR12)

```svelte
<button class="preset-card" class:selected={selectedPresetId === preset.playlistId}
  onclick={() => selectedPresetId = preset.playlistId}>
  <span class="preset-name">{preset.name}</span>
  <span class="preset-desc">{preset.description}</span>
</button>
```
Selected state: `background: var(--brand-color, #1db954); color: white`.
Touch target: min 44×44px (AC9).

### Clip duration pills and title reveal radios

```svelte
const CLIP_OPTIONS = [
  { value: 20, label: '20s' },
  { value: 30, label: '30s' },
  { value: 45, label: '45s' },
  { value: 60, label: '60s' },
  { value: 'full', label: 'Full Song' },
]

const REVEAL_OPTIONS = [
  { value: 0, label: 'Immediately' },
  { value: 5, label: 'After 5s' },
  { value: 10, label: 'After 10s' },
  { value: 15, label: 'After 15s' },
  { value: null, label: 'Never' },
]

let clipDuration = $state<number | 'full'>(30)      // default: 30s
let titleRevealDelay = $state<number | null>(5)      // default: After 5s
```

### Client testing approach — NO component testing infra

Vitest is configured with `environment: 'node'` (see `vitest.config.ts`). There is **no jsdom, no @testing-library/svelte**. Client tests are **pure function tests only** — see `src/client/__tests__/join.test.ts` and `src/client/__tests__/dashboard.test.ts` for examples.

**Do NOT attempt to test Svelte component rendering.** Test the `startRound()` function in lib/api.ts instead:

```ts
// src/client/__tests__/round-config.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { startRound } from '../lib/api.ts'

afterEach(() => vi.restoreAllMocks())

describe('startRound', () => {
  it('calls POST /api/rooms/:code/round with correct body', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ roundNumber: 1, playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }),
    } as Response)
    
    await startRound('ABCD', { playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 })
    
    expect(mockFetch).toHaveBeenCalledWith('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }),
    })
  })
  
  it('throws with server error message on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid clipDuration' }),
    } as Response)
    
    await expect(startRound('ABCD', { playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }))
      .rejects.toThrow('Invalid clipDuration')
  })
})
```

### Server test additions to rooms.test.ts

Add new describe blocks to `src/server/__tests__/rooms.test.ts`. The test already imports `roomsRouter` and has `makeApp()` and `seedHost()` helpers. Also need to seed a room and set up `roomSockets`:

```ts
import { roomSockets } from '../ws.ts'

// In beforeEach: also set up roomSockets entry for the room
// The POST round endpoint needs a room in DB + roomSockets entry
function seedRoom(hostUserId = 'host_1', code = 'ABCD') {
  const db = (await import('../db.ts')).getDb()
  db.prepare('INSERT OR IGNORE INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run(code, hostUserId, Date.now())
  roomSockets.set(code, { host: null, hostUserId, hostHasEverConnected: false, guests: new Map() })
}
```

Note: rooms.test.ts is a top-level module with `vi.stubEnv` before dynamic imports — follow the same pattern.

### App.svelte changes

Only two changes needed in `src/client/App.svelte`:
1. Add: `function handleRoundStarted() { page = 'lobby' }`
2. Change: `<RoundConfigPage code={currentRoomCode} />` → `<RoundConfigPage code={currentRoomCode} onRoundStarted={handleRoundStarted} />`

### Do NOT touch

- `src/server/music/router.ts`, `spotify.ts`, `presets.ts` — music module is complete
- `src/server/ws.ts` — only add types/interface fields, no logic changes
- `src/server/db.ts` — no schema changes needed (played_songs table is Story 4-3)
- `src/client/pages/LobbyPage.svelte` — navigation already wired
- Any other client pages

## References

- UX-DR12 (Round Config screen), UX-DR13 (playlist/artist search tab) [Source: epics.md]
- UX-DR21: all interactive elements ≥ 44×44px [Source: epics.md]
- FR7, FR8, FR39 [Source: epics.md]
- Track Pool API endpoints from Story 4-1 [Source: 4-1-track-pool-api.md]
- `requireAuth`, `AuthEnv` [Source: src/server/auth.ts]
- `getRoomByCode` [Source: src/server/db.ts]
- `roomSockets`, `RoomState` [Source: src/server/ws.ts]
- Router pattern [Source: src/server/rooms.ts]
- Test patterns: `vi.stubEnv`, `initDb(':memory:')`, dynamic import after stubs [Source: src/server/__tests__/rooms.test.ts]
- Client test patterns: pure lib/ function tests, `vi.spyOn(global, 'fetch')` [Source: src/client/__tests__/join.test.ts]

## Dev Agent Record

### Implementation Plan

Implemented in task order per story spec:
1. Extended `ws.ts` with exported `ClipDuration`, `TitleRevealDelay`, `RoundConfig` types and `pendingRound?: RoundConfig` on `RoomState`
2. Added `POST /api/rooms/:code/round` to `rooms.ts` with full auth, ownership, and input validation; stores round config in `roomSockets`
3. Added `startRound()`, `StartRoundPayload`, `StartRoundResponse` to client `api.ts`
4. Replaced `RoundConfigPage.svelte` stub with full implementation: Genre/Search tabs, clip duration pills, title reveal radios, start button with loading/error states
5. Wired `handleRoundStarted()` in `App.svelte` (navigates back to lobby)
6. Added 9 server tests and 5 client tests; all 148 tests pass

### Debug Log

No significant issues encountered. The `seedRoom` helper in tests needed to be `async` due to `await import('../db.ts')` usage.

### Completion Notes

All tasks/subtasks complete. All ACs satisfied:
- AC1: Navigate to Round Config from lobby (pre-existing, preserved)
- AC2: Genre tab with preset cards, single-select, brand-fill highlight
- AC3: Search tab with freeform query, results showing name/owner/track count, single-select
- AC4: Clip duration pills (20s/30s/45s/60s/Full Song), default 30s
- AC5: Title reveal radios (Immediately/After 5s/After 10s/After 15s/Never), default After 5s
- AC6: "Start Round →" posts to `POST /api/rooms/:code/round`, loading state during request
- AC7: Inline error "Select a genre or playlist first" when no source selected
- AC8: On success, `onRoundStarted()` navigates back to lobby
- AC9: All interactive elements ≥ 44×44px touch target enforced via CSS min-height

## File List

- src/server/ws.ts
- src/server/rooms.ts
- src/client/lib/api.ts
- src/client/pages/RoundConfigPage.svelte
- src/client/App.svelte
- src/server/__tests__/rooms.test.ts
- src/client/__tests__/round-config.test.ts

### Review Findings

- [x] [Review][Patch] Test "increments roundNumber on second call" has wrong Cookie header — FALSE POSITIVE; actual file has correct headers; no fix needed [src/server/__tests__/rooms.test.ts]
- [x] [Review][Patch] `selectedPlaylistId` not cleared when a new search is submitted — fixed: `selectedPlaylistId = null` added at top of `handleSearch` [src/client/pages/RoundConfigPage.svelte]
- [x] [Review][Patch] `playlistId` whitespace-only string passes server validation — fixed: added `|| !playlistId.trim()` guard [src/server/rooms.ts]
- [x] [Review][Defer] `pendingRound` silently dropped + `roundNumber` non-durable when `roomSockets` has no entry — if the host hasn't opened a WS connection yet, the round config is returned (HTTP 200) but never stored; roundNumber also resets on server restart — deferred, pre-existing by design; story dev notes explicitly call this acceptable for now; Story 4-3 scope [src/server/rooms.ts]
- [x] [Review][Defer] `onRoundStarted()` fires before any WebSocket broadcast to guests — host navigates to lobby while guests receive no signal about the round — deferred, pre-existing by design; AC8 calls this a placeholder until Epic 5 [src/client/pages/RoundConfigPage.svelte]
- [x] [Review][Defer] API response for presets/search not shape-validated before rendering — non-array `presets` or `searchResults` response would crash `{#each}` rendering at runtime — deferred, pre-existing; low risk for server-controlled endpoint; acceptable for MVP [src/client/pages/RoundConfigPage.svelte]

## Change Log
- 2026-04-04: Story created by create-epics-and-stories workflow
- 2026-04-04: Story enriched with full codebase analysis — GameState pattern, route location, nav wiring, test approach
- 2026-04-04: Story implemented — Round Config screen complete, all 148 tests passing
- 2026-04-04: Code review complete — 3 patches, 3 deferred, 9 dismissed
