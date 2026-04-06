# Story 7.5: Game Page Header + Players Overlay

Status: done

## Story

As a player (host or guest) on the game page,
I want a persistent header showing the player count, room code, and current song position, plus a tappable Players overlay listing everyone in the room,
So that I always know who's here, can share the code with latecomers, and can see where we are in the round — without navigating away from my card.

## Acceptance Criteria

1. **New header replaces existing `card-header` on both game pages.** The current right-aligned `≡ History` button ([HostRoomPage.svelte:229-231](src/client/pages/HostRoomPage.svelte#L229-L231), [RoomPage.svelte:165-167](src/client/pages/RoomPage.svelte#L165-L167)) is replaced with a three-column header:
   - **Left:** `[N Players]` button — live count including host (same `computePlayerCount` logic from [waitingRoom.ts](src/client/lib/waitingRoom.ts)). Tapping opens the Players Overlay.
   - **Center:** Room code in monospace, muted/lower-contrast (`#888`), tappable to copy (use existing `copyRoomCode` from [ws.ts:27-29](src/client/lib/ws.ts#L27-L29)). Show a brief "Copied!" flash (1.5s) replacing the code text.
   - **Right:** `[Nth Song]` button — ordinal of current song in round (e.g., "4th Song"). Tapping opens the existing SongHistoryDrawer. Pre-round fallback text: `History`.
     The header renders **only when `tiles.length > 0`** (same condition as the current `card-header`). The GuestWaitingRoom component (pre-round) keeps its own header unchanged.

2. **Same header component for host and guest.** Create `src/client/components/GameHeader.svelte` with props:

   ```ts
   {
     playerCount: number
     code: string
     songIndex: number | null  // null = pre-round / no songs yet
     onPlayersClick: () => void
     onHistoryClick: () => void
   }
   ```

   Both HostRoomPage and RoomPage import and render this component, passing their own state. The component is purely presentational — no WS logic, no state management.

3. **Song ordinal logic.** Create a pure helper `formatSongOrdinal(songIndex: number): string` in `src/client/lib/gameHeader.ts`. Maps 0-based `songIndex` to display string: `0 → "1st Song"`, `1 → "2nd Song"`, `2 → "3rd Song"`, `3 → "4th Song"`, etc. Use standard English ordinal suffix rules (`st`, `nd`, `rd`, `th`). When `songIndex` is null, the button text is `"History"`.

4. **HostRoomPage tracks `songIndex` and `hostName`.** Add `songIndex = $state<number | null>(null)` to [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte). Update the `song:start` handler (line 148-156) to set `songIndex = data.songIndex`. On `round:start`, reset `songIndex = null`. The host already has `players` state (line 41). The host currently receives `hostName` via `session:connect` (per 7-4 AC #1) but does not store it — add `hostName = $state<string | null>(null)` and capture `data.hostName ?? null` in the `session:connect` handler (line 139-140). Compute `playerCount` as a `$derived`: `computePlayerCount(players, hostName)`.

5. **RoomPage threads `songIndex`.** RoomPage already has `players` and `hostName`. Add `songIndex = $state<number | null>(null)`. Update the `song:start` handler (line 103-108) to set `songIndex = data.songIndex`. On `round:start` (line 96-102), reset `songIndex = null`.

6. **New `PlayersOverlay.svelte` component.** Create `src/client/components/PlayersOverlay.svelte`. Same bottom-sheet pattern as [SongHistoryDrawer.svelte](src/client/components/SongHistoryDrawer.svelte) (overlay backdrop + sheet + header + close button). Props:

   ```ts
   {
     players: string[]
     hostName: string | null
     selfName: string | null   // null for host (host knows who they are)
     onClose: () => void
   }
   ```

   Layout:
   - Sheet header: `Players (N)` title (using `computePlayerCount`) + `×` close button.
   - Player list: host row first (with `[host]` pill, same styling as [GuestWaitingRoom.svelte:137-148](src/client/components/GuestWaitingRoom.svelte#L137-L148)), then guest rows in `players` order. Current user's row gets `(you)` suffix (using `isSelfRow`). When `hostName === null`, show `Host` placeholder with pill (same fallback as GuestWaitingRoom).
   - Same z-index layering as SongHistoryDrawer: overlay `z-index: 149`, sheet `z-index: 150`.
   - Height: `70vh` (same as history drawer).
   - Empty state when `players.length === 0 && hostName === null`: `No players yet.` centered text.

7. **HostRoomPage integrates header + overlay.** In [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte):
   - Add `showPlayers = $state(false)`.
   - Replace the `<div class="card-header">` block (line 229-231) with `<GameHeader playerCount={playerCount} {code} {songIndex} onPlayersClick={() => { showPlayers = true }} onHistoryClick={() => { showHistory = true }} />`.
   - Add PlayersOverlay rendering (same pattern as SongHistoryDrawer at line 212-214): `{#if showPlayers} <PlayersOverlay {players} {hostName} selfName={null} onClose={() => { showPlayers = false }} /> {/if}`.
   - Remove the `.card-header` and `.history-btn` CSS rules (dead code after header replacement).

8. **RoomPage integrates header + overlay.** In [RoomPage.svelte](src/client/pages/RoomPage.svelte):
   - Add `showPlayers = $state(false)`.
   - Replace the `<div class="card-header">` block (line 165-167) with `<GameHeader playerCount={playerCount} {code} {songIndex} onPlayersClick={() => { showPlayers = true }} onHistoryClick={() => { showHistory = true }} />`.
   - Add PlayersOverlay: `{#if showPlayers} <PlayersOverlay {players} {hostName} selfName={name} onClose={() => { showPlayers = false }} /> {/if}`.
   - Compute `playerCount` as `$derived`: `computePlayerCount(players, hostName)`.
   - Remove `.card-header` and `.history-btn` CSS rules.

9. **Copy-to-clipboard UX.** In `GameHeader.svelte`, the center room-code element calls `copyRoomCode(code)` on click. On success, set a local `$state` `copied = true` and show "Copied!" text for 1.5s (via `setTimeout`), then revert to the code. On failure (clipboard API rejected), silently do nothing — the code is still visible for manual copy. No toast, no external state.

10. **HostRoomPage: host sees own name in Players overlay.** Per 7-4 AC #1, `session:connect` carries `hostName` to the host. The host's overlay renders the host row from `hostName` with `selfName={null}` — meaning the host does NOT get a `(you)` suffix. This is intentional: the host knows who they are, and adding `(you)` next to `[host]` pill is redundant. If `hostName` matches a future `selfName` prop, `isSelfRow` handles it — but for 7-5 the host passes `selfName={null}`.

11. **App.svelte: no changes.** HostRoomPage already receives `code`; it now stores `hostName` internally from WS. RoomPage already receives `hostName` and `initialPlayers` as props. No new props or routing changes needed.

12. **Players list removes player-list from HostControlsPanel.** The player list in [HostControlsPanel.svelte:88-95](src/client/components/HostControlsPanel.svelte#L88-L95) is now redundant — the header `[N Players]` button + PlayersOverlay replaces it. Remove the `.player-list` section and the `players` prop from HostControlsPanel. Update the HostControlsPanel prop type to remove `players: string[]`. Update both call sites in [HostRoomPage.svelte:244-250](src/client/pages/HostRoomPage.svelte#L244-L250) and [HostRoomPage.svelte:262-269](src/client/pages/HostRoomPage.svelte#L262-L269) to stop passing `players`.

13. **Helper tests.** Create `src/client/__tests__/gameHeader.test.ts` — unit test `formatSongOrdinal`:
    - `formatSongOrdinal(0)` → `"1st Song"`
    - `formatSongOrdinal(1)` → `"2nd Song"`
    - `formatSongOrdinal(2)` → `"3rd Song"`
    - `formatSongOrdinal(3)` → `"4th Song"`
    - `formatSongOrdinal(10)` → `"11th Song"` (edge: 11th/12th/13th use `th`)
    - `formatSongOrdinal(20)` → `"21st Song"`
    - `formatSongOrdinal(100)` → `"101st Song"`
      No new DOM-render tests (per project convention — logic-only helpers + manual verification).

14. **Regression.**
    - `npm run lint` (tsc --noEmit) clean.
    - `npm test` green (all existing tests plus new `gameHeader.test.ts` tests).
    - Host flow: LobbyPage → HostRoomPage → new header visible with `[N Players]` / room code / `[Nth Song]`.
    - Guest flow: JoinPage → RoomPage → waiting room (pre-round, unchanged) → round starts → new header visible.
    - SongHistoryDrawer still accessible via right button in header.
    - PlayersOverlay shows correct list with host pill and `(you)` suffix.
    - WinOverlay still renders above everything (z-index 300 > 150).
    - Mobile controls panel handle + sheet still functional on host page (now without inline players list).
    - Desktop split-view layout unchanged (card left, controls right).

15. **Scope boundaries — what is explicitly OUT of this story.**
    - **No** Host Mini-Player (7-6 scope). The existing mobile controls panel + desktop panel remain as-is (minus the player-list removal in AC #12).
    - **No** Host Controls Overlay / gear icon (7-6 scope).
    - **No** End Session / End Round restructure (7-6 scope).
    - **No** Between-Rounds component (7-6 scope). When `round:end` fires, existing behavior continues (host returns to lobby; guest `tiles = []` shows waiting room).
    - **No** `session:end` banner/redirect UX. The comments in [ws.ts:55-59](src/client/lib/ws.ts#L55-L59) and [ws.ts:127-130](src/client/lib/ws.ts#L127-L130) remain as-is — `session:end` client handling is deferred to 7-6 or later.
    - **No** focus trap / keyboard a11y on PlayersOverlay (matches project-wide precedent from 7-3, 7-4 — deferred).
    - **No** Escape key handler on PlayersOverlay (same deferral).
    - **No** drag handle on PlayersOverlay (spec mentions it; defer to polish — `×` close button is sufficient for MVP).

## Tasks / Subtasks

- [x] **Create `gameHeader.ts` helper + tests** (AC #3, #13)
  - [x] Create [src/client/lib/gameHeader.ts](src/client/lib/gameHeader.ts) with `formatSongOrdinal(songIndex: number): string`.
  - [x] Create [src/client/**tests**/gameHeader.test.ts](src/client/__tests__/gameHeader.test.ts) — cover ordinal logic (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 101st, etc.).

- [x] **Create `GameHeader.svelte` component** (AC #1, #2, #9)
  - [x] Create [src/client/components/GameHeader.svelte](src/client/components/GameHeader.svelte) with props `{ playerCount, code, songIndex, onPlayersClick, onHistoryClick }`.
  - [x] Three-column layout: left `[N Players]` button, center monospace room code (muted, tappable-to-copy with "Copied!" flash), right `[Nth Song]` / `History` button.
  - [x] Import `formatSongOrdinal` from `../lib/gameHeader.ts` and `copyRoomCode` from `../lib/ws.ts`.
  - [x] Local `copied = $state(false)` for the copy flash, 1.5s timeout to reset.
  - [x] Dark theme consistent with existing headers: `#1a1a1a` background, `#333` border-bottom, buttons match `.history-btn` style vocabulary.

- [x] **Create `PlayersOverlay.svelte` component** (AC #6)
  - [x] Create [src/client/components/PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte) with props `{ players, hostName, selfName, onClose }`.
  - [x] Bottom-sheet pattern: overlay backdrop (`z-index: 149`) + sheet (`z-index: 150`, `70vh` height, `border-radius: 12px 12px 0 0`), matching [SongHistoryDrawer.svelte](src/client/components/SongHistoryDrawer.svelte) exactly.
  - [x] Sheet header: `Players (N)` title + `×` close button.
  - [x] Player list: host row first with `[host]` pill (reuse CSS from GuestWaitingRoom), guest rows, `(you)` suffix via `isSelfRow`.
  - [x] Import `computePlayerCount` and `isSelfRow` from `../lib/waitingRoom.ts`.

- [x] **Remove player list from HostControlsPanel** (AC #12)
  - [x] In [src/client/components/HostControlsPanel.svelte](src/client/components/HostControlsPanel.svelte): remove the `.player-list` section (lines 88-95), remove `players` from props type, remove `.player-list` / `.player-count` CSS rules.
  - [x] Update both `<HostControlsPanel>` call sites in [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) to stop passing `players`.

- [x] **Integrate into HostRoomPage** (AC #4, #7, #10)
  - [x] Add `hostName`, `songIndex`, `showPlayers` state vars.
  - [x] Capture `data.hostName ?? null` in `session:connect` handler, `songIndex = data.songIndex` in `song:start`, reset `songIndex = null` on `round:start`.
  - [x] Add `playerCount = $derived(computePlayerCount(players, hostName))`.
  - [x] Replace `<div class="card-header">` with `<GameHeader>`.
  - [x] Add `<PlayersOverlay>` block with `selfName={null}`.
  - [x] Remove dead `.card-header` and `.history-btn` CSS.

- [x] **Integrate into RoomPage** (AC #5, #8)
  - [x] Add `songIndex`, `showPlayers` state vars.
  - [x] Set `songIndex = data.songIndex` in `song:start`, reset on `round:start`.
  - [x] Add `playerCount = $derived(computePlayerCount(players, hostName))`.
  - [x] Replace `<div class="card-header">` with `<GameHeader>`.
  - [x] Add `<PlayersOverlay>` block with `selfName={name}`.
  - [x] Remove dead `.card-header` and `.history-btn` CSS.

- [ ] **Manual verification** (for Philip to run)
  - [x] Host starts session, starts round — header shows `[1 Players]` (just host), room code (muted, monospace), `History` (no song yet).
  - [x] First song plays — right button updates to `1st Song`; second song → `2nd Song`.
  - [x] Guest joins — host header updates to `[2 Players]`; guest header also shows `[2 Players]`.
  - [x] Tap `[2 Players]` on host page — PlayersOverlay opens showing `Sarah [host]` + `Alice`. No `(you)` on host.
  - [x] Tap `[2 Players]` on guest page — overlay shows `Sarah [host]` + `Alice (you)`.
  - [x] Tap room code in header — "Copied!" flash, code in clipboard.
  - [x] Tap `2nd Song` — SongHistoryDrawer opens (same as before).
  - [ ] Mobile host: controls panel handle still works (slide up/down), no player list inside panel.
  - [ ] Desktop host: split-view layout still correct (card left, controls right, no player list in controls).
  - [ ] WinOverlay fires — renders above header and any open overlay.
  - [ ] Guest pre-round: GuestWaitingRoom renders (no GameHeader — header only appears when tiles are populated).
  - [ ] Guest late-join: brief waiting room → card appears → header shows correct song ordinal.

## Dev Notes

### Why a shared `GameHeader` component (not inline in each page)

The sprint-change-proposal specifies: "Same header applies to Guest Card View (same buttons, same room code, same labels)" [§4.2 Change U5]. A shared component avoids duplicating the three-column layout, copy-to-clipboard logic, and ordinal formatting across two pages. The component is presentational only — each page computes its own `playerCount` and passes callbacks.

### Player count semantics

`computePlayerCount(players, hostName)` from [waitingRoom.ts](src/client/lib/waitingRoom.ts) already handles the "guests + host" math correctly. `players` is always guest-only (server `getPlayerList` returns `Array.from(room.guests.keys())`). The header button text uses this count: `"N Players"` or `"1 Player"` (singular). The PlayersOverlay title uses the same count in `"Players (N)"`.

### `songIndex` tracking

Both game pages already process `song:start` events with `data.songIndex` (0-based). Adding `songIndex` state is trivial — just capture the value alongside the existing `currentTrack` / `statusLine` updates. Reset to `null` on `round:start` so the button falls back to `"History"` at the start of each new round.

### HostRoomPage now stores `hostName`

The host WS already receives `hostName` in `session:connect` (per 7-4 AC #1). HostRoomPage currently ignores it. This story captures it so the PlayersOverlay can render the host row. The host does NOT receive `hostName` updates mid-session (it's immutable per session per 7-4 AC #11), so a simple `$state` assignment on connect is sufficient.

### Removing players from HostControlsPanel

The sprint-change-proposal [§4.2 Change U6] says: "Players list removed from this component — now in header Players overlay." The current HostControlsPanel [lines 88-95](src/client/components/HostControlsPanel.svelte#L88-L95) has a basic player list. Story 7-5 replaces it with the richer PlayersOverlay (includes host row, host pill, `(you)` suffix). Remove the `players` prop from HostControlsPanel entirely — it becomes a playback + End Round component only.

### PlayersOverlay styling — reuse, don't reinvent

The overlay/sheet structure copies [SongHistoryDrawer.svelte](src/client/components/SongHistoryDrawer.svelte) verbatim for the container (`.overlay`, `.sheet`, `.sheet-header`, `.close-btn`). The player list styling reuses the `.host-pill`, `.you-suffix`, `.player-row` vocabulary from [GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte). Copy the CSS values directly — do NOT extract a shared stylesheet or CSS module. The duplication is intentional per project convention (each component is self-contained with scoped `<style>`).

### `copyRoomCode` already exists

[ws.ts:27-29](src/client/lib/ws.ts#L27-L29) exports `copyRoomCode(code: string): Promise<void>` using `navigator.clipboard.writeText`. Reuse it in `GameHeader.svelte`. The clipboard API may fail (e.g., insecure context, permissions denied) — wrap in try/catch and silently ignore failure.

### Ordinal suffix rules

English ordinals: numbers ending in 1 → "st" (except 11), 2 → "nd" (except 12), 3 → "rd" (except 13), everything else → "th". The helper works on 1-based display number (songIndex + 1).

### Svelte 5 patterns (same as all previous stories)

- `let { ... }: { ... } = $props()` for prop destructuring.
- `$state<Type>(initial)` for local reactive state.
- `$derived(expression)` for computed values.
- `onclick={handler}` attribute syntax (Svelte 5).
- No `export let`, no `on:click`, no Svelte 4 patterns.

### Testing patterns (matches 7-3/7-4 precedent)

- Logic-only helpers in `src/client/lib/gameHeader.ts` → tests in `src/client/__tests__/gameHeader.test.ts`.
- No `@testing-library/svelte` DOM render tests.
- vitest `node` env.
- Manual verification for visual/interactive behaviour.

### Project Structure Notes

- New files follow established patterns:
  - `src/client/components/GameHeader.svelte` — alongside existing components (BingoCard, SongHistoryDrawer, GuestWaitingRoom, etc.)
  - `src/client/components/PlayersOverlay.svelte` — same directory
  - `src/client/lib/gameHeader.ts` — alongside existing lib helpers (bingo.ts, ws.ts, waitingRoom.ts)
  - `src/client/__tests__/gameHeader.test.ts` — alongside existing test files
- No new dependencies.
- No routing changes.
- No server changes.

### References

- Sprint Change Proposal [§4.2 Change U5 — Header restructure](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md) — three-column header spec with status-indicator buttons
- Sprint Change Proposal [§4.2 Change U6 — Mini-Player removes players list](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md) — players list extracted to overlay
- Sprint Change Proposal [§4.2 Change U7 — Players Overlay](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md) — bottom sheet spec, host pill, `(you)` suffix
- Previous story: [7-4-guest-waiting-room-and-host-as-player.md](7-4-guest-waiting-room-and-host-as-player.md) — `hostName` on `session:connect`, player list helpers, GuestWaitingRoom component
- Previous story: [7-3-round-config-overlay-and-host-name.md](7-3-round-config-overlay-and-host-name.md) — `rooms.host_name` persistence, overlay component patterns
- SongHistoryDrawer: [src/client/components/SongHistoryDrawer.svelte](src/client/components/SongHistoryDrawer.svelte) — bottom-sheet pattern to replicate
- GuestWaitingRoom: [src/client/components/GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte) — player list rendering + styling to reuse
- waitingRoom helpers: [src/client/lib/waitingRoom.ts](src/client/lib/waitingRoom.ts) — `computePlayerCount`, `isSelfRow`
- `copyRoomCode`: [src/client/lib/ws.ts:27-29](src/client/lib/ws.ts#L27-L29) — clipboard helper
- `applyPlayerEvent`: [src/client/lib/ws.ts:16-24](src/client/lib/ws.ts#L16-L24) — player list event helper
- HostRoomPage: [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — host game page to modify
- RoomPage: [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte) — guest game page to modify
- HostControlsPanel: [src/client/components/HostControlsPanel.svelte](src/client/components/HostControlsPanel.svelte) — remove player list from here
- App.svelte: [src/client/App.svelte](src/client/App.svelte) — no changes needed (verified)

### Review Findings

- [x] [Review][Patch] `copyTimer` not cleared on GameHeader component teardown [src/client/components/GameHeader.svelte]
- [x] [Review][Patch] Duplicate `padding` declaration in `.players-list` CSS [src/client/components/PlayersOverlay.svelte]
- [x] [Review][Defer] PlayersOverlay: no focus trap / keyboard dismissal — deferred, explicitly out of scope per spec AC scope boundaries (matches 7-3/7-4 precedent)
- [x] [Review][Defer] PlayersOverlay: `playerCount` title vs rendered row count mismatch when `hostName === null` + guests present — deferred, theoretical edge (hostName always set before GameHeader visible in normal flow)
- [x] [Review][Defer] PlayersOverlay: backdrop click fragility (sheet sibling, no stopPropagation) — deferred, pre-existing systemic pattern from SongHistoryDrawer
- [x] [Review][Defer] PlayersOverlay: duplicate player name key collision — deferred, server-controlled uniqueness
- [x] [Review][Defer] GameHeader: history button has no `aria-label` update when showing song ordinal — deferred, a11y out of scope per spec

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, no blockers encountered.

### Completion Notes List

- Created `formatSongOrdinal` helper with correct English ordinal suffix logic (handles teens: 11th, 12th, 13th).
- Created `GameHeader.svelte` — presentational three-column header with Players button (left), room code with copy-to-clipboard + "Copied!" flash (center), Song ordinal / History button (right).
- Created `PlayersOverlay.svelte` — bottom-sheet matching SongHistoryDrawer pattern. Shows host row with `[host]` pill, guest rows with `(you)` suffix, empty state.
- Removed `players` prop and `.player-list` section from `HostControlsPanel.svelte`.
- HostRoomPage: added `hostName`, `songIndex`, `showPlayers` state; captures `hostName` from `session:connect`; derives `playerCount`; replaced old card-header with GameHeader + PlayersOverlay.
- RoomPage: added `songIndex`, `showPlayers` state; derives `playerCount`; replaced old card-header with GameHeader + PlayersOverlay.
- All 296 tests pass (10 new gameHeader tests). `tsc --noEmit` clean. No dead CSS warnings.

### Change Log

- 2026-04-05: Story 7-5 implementation complete — game header + players overlay

### File List

- src/client/lib/gameHeader.ts (new)
- src/client/**tests**/gameHeader.test.ts (new)
- src/client/components/GameHeader.svelte (new)
- src/client/components/PlayersOverlay.svelte (new)
- src/client/components/HostControlsPanel.svelte (modified — removed players prop + player-list section + CSS)
- src/client/pages/HostRoomPage.svelte (modified — GameHeader + PlayersOverlay integration, hostName/songIndex state)
- src/client/pages/RoomPage.svelte (modified — GameHeader + PlayersOverlay integration, songIndex state)
