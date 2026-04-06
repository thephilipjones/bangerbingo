# Story 7.6: Host Mini-Player and Controls Overlay

Status: done

## Story

As the host on the game page,
I want a fixed mini-player bar at the bottom showing now-playing info with play/pause, next, and a gear icon,
so that playback controls are always one tap away without a dismissable sheet cluttering the screen, and round/session management is cleanly separated behind the gear.

## Acceptance Criteria

1. **`HostMiniPlayer.svelte` replaces the mobile panel handle+sheet.** Create `src/client/components/HostMiniPlayer.svelte`. Props:
   ```ts
   {
     currentTrack: { title: string; artist: string } | null
     isPlaying: boolean
     sdkReady: boolean
     sdkFailed: boolean
     currentTrackId: string | null
     onPlayPause: () => void
     onNext: () => void
     onGearClick: () => void
   }
   ```
   Layout (single row, fixed bottom):
   ```
   │  [track title — artist]    [▶/‖]  [⏭ Next]  [⚙] │
   ```
   - Track info: `"${title} — ${artist}"` in a single truncated line. When `currentTrack === null`: show `"Waiting for round to start…"` in muted color.
   - **Play/Pause button** (icon text: `"▶"` / `"‖"`): disabled when `!sdkReady`. When `sdkFailed`, replace with `<a href="spotify:track:{currentTrackId}">Open Spotify</a>` (fallback: `https://open.spotify.com` when `currentTrackId === null`). The Spotify link opens in app — no explicit `target` attribute needed.
   - **Next button**: always enabled regardless of sdkReady.
   - **Gear button** (`"⚙"`): tapping opens HostControlsOverlay. Not related to `sdkReady`.
   - Fixed to bottom of viewport, z-index 20. Height: ~64px (enough for 44px touch targets + track text above).
   - Background `#1a1a1a`, top border `1px solid #333`.
   - Visible on ALL viewport sizes (both mobile and desktop).
   - No slide-up behavior — always visible.

2. **`HostControlsOverlay.svelte` — gear bottom sheet.** Create `src/client/components/HostControlsOverlay.svelte`. Props:
   ```ts
   {
     code: string
     onClose: () => void
     onEndRound: () => void     // closes overlay + triggers undo-toast flow in HostRoomPage
     onSessionEnded: () => void // called after DELETE /api/rooms/:code succeeds
     onHostManagement: () => void // navigate to dashboard
   }
   ```
   Layout: bottom sheet, ~40% screen height, same overlay/sheet pattern as [SongHistoryDrawer.svelte](src/client/components/SongHistoryDrawer.svelte) (overlay backdrop `z-index: 149`, sheet `z-index: 150`, `border-radius: 12px 12px 0 0`). Sheet body:
   - **End Round button** (with ↻ prefix): `onclick` → `onEndRound()` then `onClose()`. No confirmation dialog in the overlay itself — the undo toast (2s undo window) lives in HostRoomPage (see AC #5).
   - **End Session button** (with ⏻ prefix): opens inline confirmation dialog within the overlay:
     - Title: `"End this session for everyone?"`
     - Subcopy: `"All players will be disconnected."`
     - Buttons: [Cancel] [End Session]
     - Cancel: dismiss dialog, overlay stays open.
     - Confirm: `await fetch(\`/api/rooms/${code}\`, { method: 'DELETE' })`. On success: `onSessionEnded()`. On fetch error: show inline error text `"Failed to end session — try again."`, keep overlay open.
   - **Divider line** between End Session and Host Management.
   - **Host Management link** (with → prefix): `onclick` → `onHostManagement()`. Styled as a muted text link, not a button.
   - Sheet header: `"Host Controls"` title + `×` close button (calls `onClose()`).
   - Overlay backdrop click closes (calls `onClose()`).

3. **HostRoomPage: remove old mobile panel, wire new components.** In [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte):
   - Add prop: `onSessionEnded: () => void`
   - Import `HostMiniPlayer` and `HostControlsOverlay`; remove `HostControlsPanel` import.
   - Remove `panelOpen = $state(false)`.
   - Add `showControls = $state(false)`.
   - Add undo toast state (moved from HostControlsPanel): `toastVisible = $state(false)`, `undoTimer: ReturnType<typeof setTimeout> | undefined`.
   - Remove `panel-mobile` div entirely (the `<button class="panel-handle">` + `<div class="panel-sheet">`).
   - Remove `panel-desktop` div entirely.
   - Add `<HostMiniPlayer>` below the `<div class="host-game">` (outside the flex/grid container, since it's fixed):
     ```svelte
     <HostMiniPlayer
       {currentTrack}
       {isPlaying}
       {sdkReady}
       {sdkFailed}
       {currentTrackId}
       onPlayPause={handlePlayPause}
       onNext={handleNext}
       onGearClick={() => { showControls = true }}
     />
     ```
   - `handlePlayPause` and `handleNext` move from HostControlsPanel into HostRoomPage (they call `fetch(\`/api/rooms/${code}/round/play\`)` etc).
   - Add undo toast render at page level (position: fixed, top: 16px, same styling as HostControlsPanel's current toast):
     ```svelte
     {#if toastVisible}
       <div class="toast" role="status">
         <span>Ending round…</span>
         <button class="undo-btn" onclick={handleUndo}>Undo</button>
       </div>
     {/if}
     ```
   - `handleEndRound()` (called from HostControlsOverlay `onEndRound`): `showControls = false`, `toastVisible = true`, start `undoTimer = setTimeout(async () => { toastVisible = false; await fetch(\`/api/rooms/${code}/round/end\`, { method: 'POST' }) }, 2000)`.
   - `handleUndo()`: `toastVisible = false; clearTimeout(undoTimer)`.
   - Add HostControlsOverlay rendering:
     ```svelte
     {#if showControls}
       <HostControlsOverlay
         {code}
         onClose={() => { showControls = false }}
         onEndRound={handleEndRound}
         {onSessionEnded}
         onHostManagement={onSessionEnded}
       />
     {/if}
     ```
     Note: `onHostManagement` uses `onSessionEnded` callback — both navigate host to dashboard (App.svelte decides the destination). This is intentional; the host navigating to management is the same page as after a session ends.
   - `onDestroy`: add `clearTimeout(undoTimer)`.
   - Handle `session:end` in WS message handler: `else if (data.type === 'session:end') { onSessionEnded() }`.

4. **HostRoomPage: layout CSS changes.** Remove all CSS for:
   - `.panel-handle`, `.panel-sheet`, `.panel-sheet.open`
   - `.panel-desktop`, `.panel-mobile`
   - The `@media (min-width: 768px)` grid layout block that sets `grid-template-columns: 3fr 2fr`.
   Replace desktop `@media` with a simpler block:
   ```css
   @media (min-width: 768px) {
     .host-game {
       max-width: 640px;
       margin: 0 auto;
       padding: 16px;
     }
     .card-area {
       padding-top: 80px;
     }
   }
   ```
   Update mobile `.card-area` bottom padding to `80px` (already correct — accommodates the fixed 64px mini-player + gap). Add `.toast` and `.undo-btn` CSS (copy from HostControlsPanel, unchanged).

5. **HostControlsPanel.svelte: delete.** After all functionality is moved (playback controls → HostMiniPlayer, End Round undo toast → HostRoomPage, End Round confirm → HostControlsOverlay), `HostControlsPanel.svelte` is dead code. Delete `src/client/components/HostControlsPanel.svelte`. The file should not exist in the final state.

6. **App.svelte: add `onSessionEnded` handler.** Add `handleSessionEnded()` function:
   ```ts
   function handleSessionEnded() {
     history.pushState(null, '', '/')
     page = 'dashboard'
   }
   ```
   Update `<HostRoomPage>` call site to pass `onSessionEnded={handleSessionEnded}`.

7. **RoomPage: handle `session:end`.** In [RoomPage.svelte](src/client/pages/RoomPage.svelte)'s `ws.onmessage` handler, add:
   ```ts
   } else if (data.type === 'session:end') {
     onLeave?.()
   }
   ```
   This reuses the existing `onLeave` callback (App.svelte's `handleGuestLeave`), which navigates to the join page. No banner in this story — deferred.

8. **SDK connecting status.** In the old HostControlsPanel, `sdkReady` false showed `"Connecting to Spotify audio…"` text in the panel. In the new design, [HostRoomPage.svelte:292-294](src/client/pages/HostRoomPage.svelte#L292-L294) already has `<p class="sdk-status">Connecting to Spotify audio…</p>` inline in the card-area (shown when `!sdkReady && !sdkFailed`). This is sufficient — no additional sdk-connecting indicator needed in HostMiniPlayer.

9. **Z-index layering preserved:**
   - HostMiniPlayer: `z-index: 20`
   - HostControlsOverlay backdrop: `z-index: 149`, sheet: `z-index: 150`
   - WinOverlay: `z-index: 300` (above everything, unchanged)
   - SdkFailureBanner: `z-index: 190` (unchanged)
   - PlayersOverlay and SongHistoryDrawer: `z-index: 149/150` (unchanged, peer to HostControlsOverlay)

10. **Regression.**
    - `npm run lint` (tsc --noEmit) clean.
    - `npm test` green (no new unit tests required — all new logic is UI callbacks with no extractable pure functions).
    - Host flow: round active → HostMiniPlayer visible at bottom (track name, play/pause, next, gear). Tapping gear opens HostControlsOverlay.
    - End Round via gear: overlay closes, undo toast appears for 2s, then round ends and page goes to lobby.
    - End Session via gear: confirmation dialog appears, confirm → DELETE /api/rooms/:code → host redirected to dashboard.
    - Host Management link in overlay → same as session ended (goes to dashboard).
    - SDK failure: Play/Pause replaced with "Open Spotify" link in mini-player; SdkFailureBanner also fires above everything (existing behavior unchanged).
    - Guest session:end: guest receives session:end WS msg → redirected to join page (no banner in this story).
    - Desktop: card fills centered column (max-width 640px); HostMiniPlayer fixed at bottom across all viewport sizes. No right panel.
    - WinOverlay still renders above HostMiniPlayer and any open overlay (z-index 300 > 150 > 20).
    - PlayersOverlay and SongHistoryDrawer still work as before.

11. **Scope boundaries — explicitly OUT of this story.**
    - **No** "Session ended by host" banner on guest join page (deferred — guest just lands on join page silently).
    - **No** drag handle on HostControlsOverlay (deferred, matches 7-3/7-4/7-5 precedent).
    - **No** Escape key / focus trap on HostControlsOverlay (same deferral).
    - **No** Between-Rounds component (between-round state still shows GuestWaitingRoom for guests; host goes to lobby — unchanged from pre-7-6).
    - **No** `computePlayerCount` change — `computePlayerCount(players)` (without `hostName`) is already correct per current HostRoomPage:71. Do not change this.
    - **No** changes to RoundConfigPage or LobbyPage routing.
    - **No** server changes — `DELETE /api/rooms/:code` already exists and broadcasts `session:end`.

## Tasks / Subtasks

- [x] **Create `HostMiniPlayer.svelte`** (AC #1)
  - [x] Create [src/client/components/HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte) with props as specified.
  - [x] Fixed bottom bar: track info (truncated single line), play/pause (disabled when !sdkReady; Spotify link when sdkFailed), next, gear.
  - [x] Dark theme: `#1a1a1a` bg, `1px solid #333` top border, `z-index: 20`, height ~64px.

- [x] **Create `HostControlsOverlay.svelte`** (AC #2)
  - [x] Create [src/client/components/HostControlsOverlay.svelte](src/client/components/HostControlsOverlay.svelte) with props as specified.
  - [x] Bottom sheet: `z-index: 149` overlay + `z-index: 150` sheet (copy SongHistoryDrawer container structure verbatim).
  - [x] End Round button → `onEndRound()` + `onClose()`.
  - [x] End Session button → inline confirmation dialog → `DELETE /api/rooms/${code}` → `onSessionEnded()` on success; inline error text on failure.
  - [x] Divider + Host Management link → `onHostManagement()`.

- [x] **Update HostRoomPage.svelte** (AC #3, #4)
  - [x] Add `onSessionEnded` prop.
  - [x] Remove `HostControlsPanel` import; import `HostMiniPlayer`, `HostControlsOverlay`.
  - [x] Move `handlePlayPause` and `handleNext` functions from HostControlsPanel into this file.
  - [x] Remove `panelOpen`; add `showControls`, `toastVisible`, `undoTimer`.
  - [x] Add `handleEndRound`, `handleUndo` functions.
  - [x] Handle `session:end` in WS onmessage.
  - [x] Remove `panel-mobile`, `panel-desktop` markup.
  - [x] Add `<HostMiniPlayer>` and `{#if showControls}<HostControlsOverlay>{/if}`.
  - [x] Add toast markup + CSS at page level.
  - [x] Update CSS: remove panel/grid CSS, simplify desktop media query.
  - [x] `onDestroy`: add `clearTimeout(undoTimer)`.

- [x] **Update App.svelte** (AC #6)
  - [x] Add `handleSessionEnded` function.
  - [x] Pass `onSessionEnded={handleSessionEnded}` to `<HostRoomPage>`.

- [x] **Update RoomPage.svelte** (AC #7)
  - [x] Add `session:end` handler in ws.onmessage → `onLeave?.()`.

- [x] **Delete HostControlsPanel.svelte** (AC #5)
  - [x] Verify no other file imports `HostControlsPanel`.
  - [x] Delete [src/client/components/HostControlsPanel.svelte](src/client/components/HostControlsPanel.svelte).

- [ ] **Manual verification** (for Philip to run)
  - [ ] Host game active: HostMiniPlayer visible at bottom, always present (not dismissable).
  - [ ] Play/Pause toggles; Next advances song.
  - [ ] Gear opens HostControlsOverlay sheet from bottom.
  - [ ] End Round → overlay closes, undo toast appears, Undo cancels it, or 2s later round ends → page goes to lobby.
  - [ ] End Session → dialog appears in overlay → Confirm → host goes to dashboard.
  - [ ] Host Management link in overlay → host goes to dashboard.
  - [ ] Desktop (≥768px): card centered at max-width, HostMiniPlayer still fixed at bottom.
  - [ ] Guest receives session:end → redirected to join page.
  - [ ] WinOverlay appears above HostMiniPlayer and open overlays.
  - [ ] SdkFailureBanner fires above everything; Play/Pause replaced with "Open Spotify" link in mini-player.

## Dev Notes

### Files to touch summary

```
NEW:   src/client/components/HostMiniPlayer.svelte
NEW:   src/client/components/HostControlsOverlay.svelte
MOD:   src/client/pages/HostRoomPage.svelte
MOD:   src/client/pages/RoomPage.svelte
MOD:   src/client/App.svelte
DEL:   src/client/components/HostControlsPanel.svelte
```

No server changes. No new dependencies. No new test files.

### Current state of HostRoomPage (as of 7-5)

[HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) is the source of truth. Key current state:
- Lines 1-11: imports (includes HostControlsPanel — remove this)
- Line 29: `let { code, onRoundEnded }` — add `onSessionEnded` here
- Lines 50-51: `let panelOpen = $state(false)` — remove
- Line 71: `const playerCount = $derived(computePlayerCount(players))` — do NOT add `hostName` here (it was already corrected in current code to omit `hostName`)
- Lines 309-324: `panel-mobile` block — remove entirely
- Lines 297-307: `panel-desktop` block — remove entirely
- Lines 299-306: HostControlsPanel call site — move `handlePlayPause`/`handleNext` logic here
- Lines 428-462: `.panel-handle`, `.panel-sheet` CSS — remove
- Lines 392-425: Desktop media query with grid — simplify

### handlePlayPause and handleNext — copy from HostControlsPanel

These functions only call fetch. They are simple — copy verbatim into HostRoomPage:
```ts
function handlePlayPause() {
  const endpoint = isPlaying ? 'pause' : 'play'
  fetch(`/api/rooms/${code}/round/${endpoint}`, { method: 'POST' })
}

function handleNext() {
  fetch(`/api/rooms/${code}/round/next`, { method: 'POST' })
}
```

### Undo toast CSS — copy from HostControlsPanel

The toast and undo-btn CSS in HostControlsPanel (lines 115-139) can be copied directly into HostRoomPage's `<style>` block. Position: fixed, top: 16px, z-index: 50, same styling. The toast is already above overlays conceptually since it's a transient 2s state.

### End Session server endpoint

`DELETE /api/rooms/:code` already exists in [src/server/rooms.ts:181-196](src/server/rooms.ts#L181-L196). It:
1. Validates host ownership
2. Calls `destroyRoom(code)` — broadcasts `session:end` to all connected WS clients + closes sockets
3. Calls `deleteRoom(code)` — removes DB record
4. Returns 204

The fetch call in HostControlsOverlay needs the host's auth cookie — since all host requests are cookie-authed and `fetch` sends cookies by default for same-origin requests, no special headers needed.

### session:end client handling — previously deferred

Comments in ws.ts at lines 62-65 (host) and 134-138 (guest) say "full UX deferred to Story 7-5". 7-5 pushed it further to "7-6 or later". This story finally implements it:
- **Host side** (HostRoomPage direct WS): `data.type === 'session:end'` → `onSessionEnded()`. The host triggered the delete themselves, so this is mostly defensive (server closes socket after broadcast).
- **Guest side** (RoomPage direct WS): `data.type === 'session:end'` → `onLeave?.()`. `onLeave` = App.svelte's `handleGuestLeave` which navigates to join page and pushes `'/'` to history.

### SdkFailureBanner vs mini-player Spotify link

`SdkFailureBanner.svelte` is a red banner that fires when `sdkFailed = true`. It shows "Open in Spotify app" with `href="spotify:track:{trackId}"`. It remains unchanged.

In HostMiniPlayer, when `sdkFailed`, the Play/Pause button is replaced with a simpler inline link — this is a secondary affordance. Both coexist: the banner provides the primary error context, the mini-player link is a convenience. Use the same `spotify:track:{currentTrackId}` href pattern (fallback `https://open.spotify.com`). Do NOT remove or modify SdkFailureBanner.

### Desktop layout after removing the right panel

Currently desktop uses a `grid-template-columns: 3fr 2fr` two-column layout (card left, HostControlsPanel right). After removing the right panel:
- The card takes full available width
- Suggest `max-width: 640px` (card is 5×5 bingo, roughly square on mobile; limiting width prevents it becoming too wide on big screens)
- Keep `margin: 0 auto; padding: 16px;` for centering
- HostMiniPlayer remains fixed at bottom (not in the grid/flex flow at all — it's `position: fixed`)

### onHostManagement = onSessionEnded (same callback)

Both "Host Management" link and a successful "End Session" call `onSessionEnded()` in App.svelte, which navigates to `'dashboard'` and pushes `'/'` to history. This is intentional: from the host's perspective, tapping "Host Management" navigates them OUT of the game to the dashboard (the session keeps running server-side until explicitly ended). The comment `// Navigate out of game; session continues running server-side` should be added inline.

### Svelte 5 patterns (same as all stories in Epic 7)

- `let { ... }: { ... } = $props()` for props
- `$state<Type>(initial)` for reactive state
- `$derived(expression)` for computed values
- `onclick={handler}` attribute syntax
- No `export let`, no `on:click`, no Svelte 4 patterns

### Bottom padding for card-area

Current `card-area` has `padding: 80px 16px 80px`. Bottom 80px was added to avoid content being obscured by the fixed panel-handle (which was also ~48px + some gap). The HostMiniPlayer is ~64px tall. 80px bottom padding remains appropriate. No change needed.

### Testing (matches Epic 7 precedent)

No new pure-function helpers requiring unit tests. All logic is UI callbacks. Manual verification (AC #10) is the quality gate. `tsc --noEmit` must pass clean.

### Project Structure Notes

- New components follow existing naming and directory: `src/client/components/`
- Each component is self-contained with scoped `<style>` — no shared CSS imports
- Overlay container CSS (`.overlay`, `.sheet`, `.sheet-header`, `.close-btn`) copied verbatim from SongHistoryDrawer — intentional duplication per project convention

### References

- Sprint Change Proposal [§4.2 Change U6 — Host Mini-Player](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md) — mini-player layout spec
- Sprint Change Proposal [§4.2 Change U11 — Host Controls Overlay](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md) — overlay contents spec
- Sprint Change Proposal [§4.2 Change U8 — End Session Flow](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md) — end session confirmation + `session:end` broadcast
- Previous story: [7-5-game-page-header-and-players-overlay.md](7-5-game-page-header-and-players-overlay.md) — GameHeader, PlayersOverlay, overlay pattern, z-index conventions
- HostRoomPage: [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — primary file to modify
- HostControlsPanel: [src/client/components/HostControlsPanel.svelte](src/client/components/HostControlsPanel.svelte) — source of handlePlayPause/handleNext/toast CSS to migrate then DELETE
- SongHistoryDrawer: [src/client/components/SongHistoryDrawer.svelte](src/client/components/SongHistoryDrawer.svelte) — overlay/sheet container pattern to replicate exactly
- SdkFailureBanner: [src/client/components/SdkFailureBanner.svelte](src/client/components/SdkFailureBanner.svelte) — Spotify deep link pattern (`spotify:track:{trackId}`)
- RoomPage: [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte) — add session:end → onLeave()
- App.svelte: [src/client/App.svelte](src/client/App.svelte) — add handleSessionEnded, pass onSessionEnded prop
- Server delete endpoint: [src/server/rooms.ts:181-196](src/server/rooms.ts#L181-L196) — `DELETE /api/rooms/:code` (already exists)
- session:end WS comments: [src/client/lib/ws.ts:62-65](src/client/lib/ws.ts#L62-L65) and [src/client/lib/ws.ts:134-138](src/client/lib/ws.ts#L134-L138) — these comments are now resolved by this story; remove the "deferred" comment text when implementing

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Created `HostMiniPlayer.svelte`: fixed bottom bar with track info (truncated), play/pause (disabled when !sdkReady, Spotify link when sdkFailed), next, and gear buttons. Dark theme, z-index 20, 64px height.
- Created `HostControlsOverlay.svelte`: bottom sheet (40vh) with End Round, End Session (inline confirmation + DELETE fetch), divider, Host Management link. Overlay/sheet pattern copied from SongHistoryDrawer (z-index 149/150).
- Rewrote `HostRoomPage.svelte`: removed HostControlsPanel import and all panel-mobile/panel-desktop markup+CSS. Added HostMiniPlayer (fixed, outside flex flow) and conditional HostControlsOverlay. Moved handlePlayPause/handleNext inline. Added undo toast (2s timer) at page level. Added session:end WS handler. Simplified desktop media query to max-width 640px centered layout. Added onSessionEnded prop + clearTimeout(undoTimer) in onDestroy.
- Updated `App.svelte`: added handleSessionEnded() (pushes '/' to history, navigates to dashboard), passed onSessionEnded to HostRoomPage.
- Updated `RoomPage.svelte`: added session:end → onLeave?.() in handleWsData.
- Deleted `HostControlsPanel.svelte` (dead code after migration).
- All 303 tests pass. Pre-existing lint error in RoundConfigOverlay.test.ts (unrelated).

### Change Log

- 2026-04-06: Implemented story 7-6 — replaced HostControlsPanel with HostMiniPlayer + HostControlsOverlay, added session:end handling on both host and guest sides, simplified desktop layout.

### File List

- src/client/components/HostMiniPlayer.svelte (new)
- src/client/components/HostControlsOverlay.svelte (new)
- src/client/pages/HostRoomPage.svelte (modified)
- src/client/App.svelte (modified)
- src/client/pages/RoomPage.svelte (modified)
- src/client/components/HostControlsPanel.svelte (deleted)

### Review Findings

- [x] [Review][Decision] **Layout order in HostMiniPlayer** — Approved current layout: controls-left / info-centre / gear-right.
- [x] [Review][Decision] **Desktop popover layout in HostControlsOverlay** — Approved; consistent with PlayersOverlay desktop pattern.
- [x] [Review][Patch] **Double onSessionEnded invocation** — Fixed: added handleSessionEnd() guard (sessionEnded flag) in HostRoomPage; all session:end paths funnel through it. undoTimer cleared on session end. [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] **handleEndRound double-invocation orphans previous undoTimer** — Fixed: clearTimeout(undoTimer) added before setting new timer in handleEndRound(). [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] **Toast hidden by overlay backdrop when gear is tapped during undo window** — Fixed: toast z-index raised to 200 (above overlay backdrop 149/sheet 150). Gear also changed to set-only (no toggle) so overlay can't reopen during toast. [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] **"Nothing playing" shown instead of "Waiting for round to start…"** — Fixed: corrected null-track text in HostMiniPlayer. [src/client/components/HostMiniPlayer.svelte]
- [x] [Review][Patch] **"Connecting to Spotify audio…" moved to HostMiniPlayer, violating AC #8** — Fixed: removed SDK connecting branch from HostMiniPlayer track-info; restored sdk-status paragraph (+ CSS) in HostRoomPage card-area. [src/client/components/HostMiniPlayer.svelte, src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] **onGearClick toggles showControls instead of setting to true** — Fixed: changed to showControls = true. [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] **End Round button clickable while End Session DELETE is in-flight** — Fixed: disabled={ending} added to both End Round and End Session action buttons. [src/client/components/HostControlsOverlay.svelte]
- [x] [Review][Defer] **fetch errors swallowed in handlePlayPause/handleNext** [src/client/pages/HostRoomPage.svelte] — deferred, pre-existing pattern; out of scope for this story
- [x] [Review][Defer] **Keyboard accessibility / focus trap on HostControlsOverlay** [src/client/components/HostControlsOverlay.svelte] — deferred, explicitly out of scope per AC #11
- [x] [Review][Defer] **sdkReinitializing re-entry race causing permanent "Connecting…" state** [src/client/pages/HostRoomPage.svelte] — deferred, pre-existing; unrelated to story changes
