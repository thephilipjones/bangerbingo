# Story 9-1: Game Over Page State & Auto-Bingo

Status: done

## Story

As a player,
I want my bingo to be auto-claimed the moment I mark my winning tile and the whole room to drop into a Game Over page where everyone sees the winner's card alongside their own,
so that the end of a round is a shared scoreboard moment instead of a dismissable notification, and so no one loses because their reflexes on the Bingo button were half a second slow.

## Background

Today's end-of-round flow has two ceremonies we want to delete. First, [RoomPage.svelte:207-210](src/client/pages/RoomPage.svelte#L207-L210) and [HostRoomPage.svelte:344-348](src/client/pages/HostRoomPage.svelte#L344-L348) both gate the win behind a manual "Bingo!" button — a paper-bingo artifact with no purpose once the server already sees every card ([rooms.ts:776-785](src/server/rooms.ts#L776-L785) validates the claim server-side regardless of who pushed the button). Second, the win itself renders as a fixed-position modal via [WinOverlay.svelte](src/client/components/WinOverlay.svelte), which hides the cards behind a backdrop and offers a "Dismiss" affordance that nobody needs — the only thing worth looking at *is* the cards.

**What this story does:**
- **Auto-bingo.** The client auto-POSTs `/api/rooms/:code/round/claim` the instant `game.hasBingo` flips true (both manual-mark and Casual-Mode auto-mark paths), with a per-round single-fire guard. Removes the `Bingo!` / `Claiming…` buttons entirely from both room pages.
- **Game Over page mode.** Replaces the `WinOverlay` modal with a new `<GameOverView>` svelte component rendered as an alternate top-level branch of `RoomPage`/`HostRoomPage` (gated on `game.winData !== null`). Not a modal — the branch fully replaces the active-round card area.
- **Winner & loser variants.** Winner sees their own card celebrated (headline styled by `audioPreset`, winning line highlighted, non-winning tiles dimmed). Loser sees a small "X got BINGO" line and a **Their card / Your card** segmented toggle; "Your card" shows an *honest-card* faded state on tiles whose song played but were never marked.
- **Start Next Round CTA.** Host + Continuous ON → "Start Next Round" button (auto-starts same config via `startContinuousRound`). Host + Continuous OFF → "Change Settings & Start" button that routes the host back to the round-config screen so they can pick a different playlist (turning Continuous OFF *is* the "I want to reconfigure between rounds" signal — everything else becomes live-editable in 9-2). Winner + Continuous ON → same auto-start CTA. Winner + Continuous OFF and all other guests → "Waiting for the host to start the next round." status line.
- **Server `round:win` broadcast extended with `winnerCard: Tile[]`** so every client can render the winner's card in the loser variant's "Their card" view without a follow-up request.
- **BingoCard accepts a `mode` prop** that selects the visual treatment (active vs. game-over variants) — no second component.

**Why this is replacing `WinOverlay`, not extending it:** the overlay's fundamental premise is "the cards are a distraction, hide them behind a backdrop so the celebration takes over." Epic 9 flips that: the cards *are* the celebration (winner basks, loser compares, host scoreboard). A backdrop + modal can't express that layout.

**Epic 8 retro action items baked into this story (see [epic-8-retro-2026-04-15.md:173-180](_bmad-output/implementation-artifacts/epic-8-retro-2026-04-15.md#L173-L180)):**
- **Action #2 (auto-claim latch):** Story 8-5 shipped with `autoClaimFired` permanently latched on failure — deferred on the bet that Epic 9 would minimize/remove the claim concept. This story replaces that flag with a per-round single-fire guard that resets to `false` on *failure* (so a transient network blip doesn't brick the round), leaving the success case one-shot.
- **Action #3 (Casual Mode ↔ auto-bingo convergence):** Both `game.handleTileClick` (manual mark) and `square:auto-marked` (Casual Mode sweep) mutate `tiles`, which flips the existing `game.hasBingo` `$derived`. A single `$effect` watching `hasBingo` fires the claim POST once per round regardless of which path flipped it — no path-specific logic.
- **Action #1 (identity-by-display-name):** Still deferred. Loser-variant self-detection uses `selfName === winData.winnerName` (same string comparison `WinOverlay` already uses at [WinOverlay.svelte:35](src/client/components/WinOverlay.svelte#L35)), and so has the same "two Alices in one room both look like the winner" bug. Out of scope — the project-wide fix is its own story slot.

**Epic 9 fit:** This story is independent of 9-2 (Live Round Settings & Pre-Round Simplification) and can ship either order.

## Acceptance Criteria

### Auto-Bingo (replace the claim button)

1. **Client auto-claim on `hasBingo` flip.** In both [RoomPage.svelte](src/client/pages/RoomPage.svelte) and [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte), replace the existing per-page auto-claim logic with a single `$effect` that fires `game.handleBingoClick()` *the first time* `game.hasBingo` becomes `true` in a round, regardless of whether the mark came from a manual tap (`game.handleTileClick`) or a Casual Mode sweep (`square:auto-marked`). No user-visible button tap required.

2. **Single-fire guard per round.** Replace the existing `autoClaimFired` local-state pattern from [RoomPage.svelte:34,110-116](src/client/pages/RoomPage.svelte#L34) with a guard that lives inside `gameState.handleBingoClick`: set an internal `hasAutoClaimedThisRound` flag to `true` *only after* the fetch resolves with `res.status === 200`. On non-200 responses or thrown errors, leave the flag `false` so a subsequent tile-mark can re-trigger the effect. Reset the flag to `false` on every `round:start` (next to the existing `winData = null; isClaiming = false` resets at [gameState.svelte.ts:159-160](src/client/lib/gameState.svelte.ts#L159-L160)).

3. **No `Bingo!` button anywhere.** Delete the `{#if game.hasBingo && !game.isClaiming} <button class="bingo-btn" ...>` and `{:else if game.isClaiming}` blocks from both [RoomPage.svelte:207-211](src/client/pages/RoomPage.svelte#L207-L211) and [HostRoomPage.svelte:344-348](src/client/pages/HostRoomPage.svelte#L344-L348), along with their CSS. Delete the per-page `autoClaimFired` state + effect (the guard now lives in `gameState`). Remove the `handleBingoClick` public method from `createGameState`'s return value only if no longer referenced after cleanup — else keep it private.

4. **Race: two near-simultaneous claims.** Two clients whose tile-marks flip `hasBingo` in the same Spotify tick will both POST to `/round/claim`. Server-side [rooms.ts:746-749](src/server/rooms.ts#L746-L749) already closes the race via the `round.ended = true` flag set before any await. The *second* POST returns 409 (or 404 after `deleteActiveRoom` at line 807); the second client's internal `hasAutoClaimedThisRound` flag stays `false` from that failure. The `round:win` broadcast — triggered by the first POST — is what transitions both clients into Game Over; the second client does NOT re-attempt a claim on broadcast receipt because `round:win` sets `winData !== null`, which gates the `hasBingo` derivation to `false` ([gameState.svelte.ts:80-82](src/client/lib/gameState.svelte.ts#L80-L82), already correct today).

5. **Late unmark after server accepts.** If a player unmarks a tile on their winning line after the claim POST returns 200 but before (or after) `round:win` arrives, the Game Over page mode still persists: `winData` is set by the `round:win` broadcast handler and is only cleared on `round:start` or explicit `round:dismissed` (still the case in [gameState.svelte.ts:189-190](src/client/lib/gameState.svelte.ts#L189-L190)). The late unmark has no retroactive effect.

6. **Server `round:win` broadcast extended with `winnerCard`.** In [rooms.ts:793-798](src/server/rooms.ts#L793-L798), extend the broadcast payload with `winnerCard: card` (the same `card` variable retrieved at line 761 via `round.cards.get(cardKey)`). This gives every client the 25-tile array (including the winning tiles *and* the non-winning ones) so the loser variant's "Their card" view can render it without a follow-up fetch. Also extend the persisted `roundStartPayload` / reconnect flows only if `winData` needs to survive server restart — see AC #22 below (it does not).

### Game Over Page Mode (not an overlay)

7. **`GameOverView.svelte` component (new shared component).** Create `src/client/components/GameOverView.svelte`. Contract:
   ```ts
   {
     role: 'host' | 'guest',     // caller's role; 'host' always shows host CTA
     selfName: string | null,    // caller's display name for winner-self comparison (null for host)
     winData: WinData,           // { winnerName, winningTileIds, songHistory, winnerCard }
     audioPreset: AudioPreset,
     continuousMode: boolean,    // needed for CTA eligibility
     ownTiles: ClientTile[],     // caller's own card — used for loser "Your card" view
     playedTrackIds: Set<string>, // derived from game.songHistory — honest-card shading
     onStartNextRound: () => void, // parent wires to POST /round/next-round (AC #14)
   }
   ```
   Extend the client `WinData` type at [gameState.svelte.ts:31-35](src/client/lib/gameState.svelte.ts#L31-L35) to include `winnerCard: Tile[]`. Capture `winnerCard` from the `round:win` payload at [gameState.svelte.ts:218-226](src/client/lib/gameState.svelte.ts#L218-L226).

8. **Render as a top-level page branch.** In both [RoomPage.svelte:174-185](src/client/pages/RoomPage.svelte#L174-L185) (guest) and [HostRoomPage.svelte:310-322](src/client/pages/HostRoomPage.svelte#L310-L322) (host), replace the `<WinOverlay ... />` block with a branch in the main render tree (not fixed-position). Use the existing `{#if game.winData !== null}` gate, but render `<GameOverView ... />` *inside* the `<main class="room-page">` / `<div class="host-game">` flow instead of floating it over `position: fixed`.

9. **Active-round card branch is hidden during Game Over.** The existing `{#if game.tiles.length > 0}` active-round branch (renders `GameHeader` + `BingoCard` + status line + casual-toggle) must only render when `game.winData === null`. The Game Over branch renders its own `GameHeader` (so header affordances keep working, per AC #11) plus the Game Over content. Concretely: change the top-level structure to `{#if game.winData !== null} <GameOverView .../> {:else if game.tiles.length > 0} <active-round content> {:else} <GuestWaitingRoom .../> {/if}` on RoomPage; equivalent on HostRoomPage with its host-specific structure.

10. **No `Dismiss` affordance.** Remove the `onDismiss` prop path from the call site (no button, no shortcut). The page mode persists until one of: `round:start` (next round) clears `winData` at [gameState.svelte.ts:159](src/client/lib/gameState.svelte.ts#L159), or `session:end` / `round:dismissed` / `round:end` clear it via existing handlers. Host's existing `handleDismissWin` function in [HostRoomPage.svelte:86-90](src/client/pages/HostRoomPage.svelte#L86-L90) becomes unreferenced — delete it along with the import of `WinOverlay`.

11. **Header + drawers + players overlay still reachable.** The `GameHeader`, `SongHistoryDrawer`, and `PlayersOverlay` components continue to render (with their buttons/affordances functional) during Game Over. Implementation: `GameOverView` includes its own `<GameHeader>` at the top using the same props it receives today (`playerCount`, `code`, `songIndex`, `historyOpen`, `playersOpen`, `onPlayersClick`, `onHistoryClick`). The existing `{#if game.showHistory}` / `{#if game.showPlayers}` blocks in `RoomPage`/`HostRoomPage` remain above the main branch and continue to overlay correctly.

### Winner variant

12. **Winner detection.** Within `GameOverView`: `const isWinner = $derived(role === 'guest' && selfName !== null && selfName === winData.winnerName)`. The host is never the winner *in the winner-variant sense* even when the host played and won (host is always `role: 'host'`); the host sees the **host variant**, which is the loser-variant layout plus a host-specific "Start Next Round" CTA. See AC #17.

13. **Winner headline.** When `isWinner === true`:
    - `audioPreset === 'hype'` → big `BINGO!` display headline (reuse existing `.bingo-label` styling from [WinOverlay.svelte:151-159](src/client/components/WinOverlay.svelte#L151-L159)) with the winner's name beneath (their own name, which is `selfName` / `winnerName`).
    - `audioPreset === 'deadpan'` → `...bingo.` with `...wins.` subtitle (reuse `.bingo-label--deadpan` + `.winner-name`).
    - `audioPreset === 'minimal'` → just the winner name + "Won this round" subtitle (reuse `.winner-name--minimal` + `.minimal-subtitle`).
    - Unknown preset values fall back to `'minimal'` (mirror the [WinOverlay.svelte:32-34](src/client/components/WinOverlay.svelte#L32-L34) `effectivePreset` guard).

14. **Winner card view.** Render the winner's own card via `<BingoCard tiles={ownTiles} mode="gameover-winner" .../>`. In the new `mode="gameover-winner"` visual:
    - Winning-line tiles keep the existing `applyWinPath` treatment (already rotated + accent outline + BB stamp at [BingoCard.svelte:113-136](src/client/components/BingoCard.svelte#L113-L136)).
    - Non-winning tiles dim to ~40% opacity (new CSS rule `.tile.gameover-dim { opacity: 0.4 }` or similar; applied via a `class:gameover-dim={tile.state !== 'free' && !tile.winPath && mode === 'gameover-winner'}` branch in BingoCard).
    - No toggle, no "their card vs your card" controls.
    - Tiles are non-interactive: `onTileClick` is ignored in `gameover-*` modes (see AC #19).

15. **Winning songs list.** Below the card area, render an ordered list of the 5 songs that formed the winning line. Source: filter `winData.songHistory` by `winData.winningTileIds` (exclude the `FREE` sentinel) preserving the order the tiles appear on the winning line — i.e. `winningTileIds.map(id => songHistory.find(e => e.trackId === id)).filter(Boolean)`. Reuse the existing `.winning-songs` CSS block from [WinOverlay.svelte:188-198](src/client/components/WinOverlay.svelte#L188-L198) (move it into `GameOverView.svelte`).

### Loser variant (and host variant)

16. **Loser headline.** When `isWinner === false` AND `role === 'guest'`, render a smaller "{winnerName} got BINGO" single-line headline — no confetti, no hype-preset styling, no deadpan variants. Plain body-font, `var(--fg)` colour, medium weight.

17. **Host variant headline.** When `role === 'host'`, render "{winnerName} got BINGO" same as the loser headline. The host-who-is-also-the-winner case (same human, because the host is always also a player per the Epic 9 intro) is currently undetectable on the host page — `selfName` is `null` there and the host cannot be `isWinner === true`. That's fine: the host sees loser-layout content (Their/Your toggle on the card) + the Host CTA (AC #20). Do NOT attempt to detect "is this host's own name equal to winnerName" in 9-1 — identity-by-display-name is still project-wide deferred debt.

18. **Their / Your card toggle.** In loser and host variants, render a segmented toggle above the card area:
    - Two buttons, same `.pill-group`/`.pill` pattern the project already uses for round settings (today inline in [RoundConfigOverlay.svelte:344-406](src/client/components/RoundConfigOverlay.svelte#L344-L406); reuse tokens).
    - Default selected: **Their card**.
    - Labels exactly: `Their card` / `Your card`.
    - The selected card renders in the card slot below via a `<BingoCard>` instance with a mode prop (see AC #19).

19. **`BingoCard` `mode` prop — three game-over variants + existing active.** Extend [BingoCard.svelte](src/client/components/BingoCard.svelte) with a new optional prop:
    ```ts
    mode?: 'active' | 'gameover-winner' | 'gameover-loser-their' | 'gameover-loser-your'  // default 'active'
    ```
    Behaviour by mode:
    - `'active'` (default) — today's behavior, unchanged.
    - `'gameover-winner'` — non-winning tiles dimmed; winning-line treatment unchanged.
    - `'gameover-loser-their'` — winning-line treatment applied; *only the winning tiles visually pop*, non-winning tiles dim to ~60% opacity (slightly more legible than the winner view's 40%, so losers can still read the winner's non-winning tiles for context).
    - `'gameover-loser-your'` — no winning-line treatment; honest-card shading: tiles whose `trackId` is in the passed-in `playedTrackIds` set AND whose `state === 'unmarked'` render with a distinct dimmed/greyed "missed" style (`.tile.missed` class: background `var(--bg-2)`, colour `var(--fg-muted)`, thin dashed border; no animation). Marked tiles render as today (filled `var(--fg)` block). Unplayed + unmarked tiles render at normal opacity. The FREE tile renders as today. Rationale: lets the loser review "how close was I to winning" — marked tiles light up, missed tiles ghost out, unplayed-unmarked tiles stay neutral.
    - **Non-interactive rendering for all game-over modes.** Render tiles as `<div role="img" aria-label={...}>` instead of `<button>` in every `'gameover-*'` mode. No click handler attached; no focus target; keyboard tab order naturally skips them. This is the simplest option and the Game Over page is a terminal screen with no per-tile interaction anyway.
    - The `nopeIndex` prop is only meaningful in `'active'` mode — guard inside the `$derived` / class-list logic.

20. **Start Next Round CTA — eligibility.** Below the card area (and below the winning-songs list), the CTA area renders based on role + continuous mode. Continuous Mode OFF *is* the host's "I want to reconfigure between rounds" signal — so host + Continuous OFF gets a distinct CTA that routes to the round-config screen instead of auto-starting.
    - `role === 'host'` AND `continuousMode === true` → render `<button class="btn-primary">Start Next Round</button>`. Action: AC #21a (auto-start via `POST /round/next-round`).
    - `role === 'host'` AND `continuousMode === false` → render `<button class="btn-primary">Change Settings & Start</button>`. Action: AC #21b (route to round-config screen, NO server call from Game Over).
    - `role === 'guest'` AND `isWinner === true` AND `continuousMode === true` → render `<button class="btn-primary">Start Next Round</button>`. Action: AC #21a.
    - `role === 'guest'` AND `isWinner === true` AND `continuousMode === false` → status line: `Waiting for the host to start the next round.`
    - `role === 'guest'` AND `isWinner === false` → status line: `Waiting for the host to start the next round.`
    - Host-is-winner collapse happens naturally: `role === 'host'` always wins over winner-eligibility — no double-render.

21. **Start Next Round CTA — action.**
    - **21a (auto-start path).** Tapping "Start Next Round" calls `POST /api/rooms/:code/round/next-round` (new endpoint, AC #23). Parent (`RoomPage` or `HostRoomPage`) owns the fetch. On success (HTTP 200): do nothing client-side — the ensuing `round:start` broadcast flips `winData = null` (via existing `round:start` handler) and transitions the page mode back to active-round. On failure (non-2xx or network error): render a short transient error line near the CTA for ~3s (`Couldn't start next round — try again.`); leave the button enabled so the user can retry.
    - **21b (reconfigure path, host + Continuous OFF only).** Tapping "Change Settings & Start" triggers the host's existing round-config flow — the same path the host takes from the lobby today. In `HostRoomPage`, this means opening `RoundConfigOverlay` (see [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) for the existing open trigger — reuse the same state/handler, e.g. `configOverlayOpen = true`). No server call from the Game Over page itself; the config overlay's existing "Start Round" button continues to drive `POST /round/start` as today. `winData` remains set until the new `round:start` broadcast clears it (same as 21a).

### Mobile-first responsive layout

22. **Layout.** `GameOverView` fits a standard mobile viewport (≥ 360px wide) without horizontal scroll. Order: header → headline → toggle (loser/host variants) → card (`BingoCard` max-width from existing `.bingo-grid` rules applies) → winning-songs list → CTA / status line. On viewports ≥ 768px, the layout centers within the existing `.host-game` max-width (720px) for host and within `RoomPage`'s current responsive padding for guests — do NOT introduce a TV/big-screen two-up layout (explicitly out of scope per Epic 9 intro).

### Server — new endpoint

23. **`POST /api/rooms/:code/round/next-round`.** Add to [src/server/rooms.ts](src/server/rooms.ts) near `/round/claim` (line 736). Behaviour:
    - **Guards.**
      - 404 `{ message: 'Room not found' }` if `!room`.
      - 503 `{ message: 'Room session not active' }` if `!roomState`.
      - 409 `{ message: 'No completed round' }` if `!roomState.currentRound || roomState.currentRound.ended !== true` (i.e. a valid win has not happened yet).
      - 409 `{ message: 'No pending round config' }` if `!roomState.pendingRound`.
    - **Authorization.** This endpoint is *not* behind `requireAuth` (guest-callable in continuous mode when the guest is the winner):
      - Parse a JSON body `{ playerName?: string }`. If the caller has a valid `session` cookie and is the room's host, allow. Otherwise `playerName` must be a string, it must equal `roomState.currentRound.config.winnerName` *(see Dev Note — use the `round:win` broadcast's `winnerName`; capture it on the round object at claim time)*, AND `roomState.continuousMode === true`. If none of those conditions match → 403 `{ message: 'Not allowed to start next round' }`.
    - **Action.** Call `startContinuousRound(code, roomState)` (existing helper at [rooms.ts:442-480](src/server/rooms.ts#L442-L480)). This builds the next round's config from `roomState.pendingRound`, runs `startRound` (which broadcasts `round:start`), and on failure broadcasts `continuous:countdown-cancel`. Return HTTP 200 `{}` on success. On the helper failing internally, it already broadcasts; still return 200 — the client reads the broadcast.
    - **Side-effects.** None beyond what `startContinuousRound` does. No countdown is scheduled by this endpoint (the countdown flow is only for auto-start-after-dismiss in today's `POST /round/dismiss-win`, which Game Over page mode no longer uses).
    - **Capture winner on round.** To authorize the winner, the claim handler in [rooms.ts:789-798](src/server/rooms.ts#L789-L798) must record the winner's name on the round before broadcasting. Add `round.winnerName = playerName` (type addition: add optional `winnerName?: string` to `RoundState` at [src/server/ws.ts:35-58](src/server/ws.ts#L35-L58)). Persist it — include in `persistRoomState` snapshot at [ws.ts:103-116](src/server/ws.ts#L103-L116) and restore in `rehydrateRooms` at [ws.ts:150-164](src/server/ws.ts#L150-L164) — so a server restart between `round:win` and the CTA tap still authorizes the winner correctly.

24. **Deprecation of `POST /round/dismiss-win` — NOT in this story.** The Game Over page mode has no Dismiss button, so the host-authoritative dismiss is no longer wired from the client. The endpoint itself and the `round:dismissed` WS event remain in place (so existing tests keep passing) but are effectively dead code from the Game Over path. Full removal is out of scope — leave to a cleanup story.

25. **Continuous countdown on Game Over — NOT in this story.** The existing continuous-mode countdown (10 s auto-start after dismiss) is no longer triggered because nothing dismisses. For 9-1, continuous mode means "the winner also gets a CTA" and nothing else — no automatic advancement. The countdown auto-advance is explicitly deferred per Epic 9 intro ("Countdown timer on Game Over screen: Deferred pending live-play feedback"). Do NOT add new auto-start plumbing.

### Tests

26. **Server — `round:win` payload.** Extend the existing valid-claim tests at [rooms.test.ts:1826-1890](src/server/__tests__/rooms.test.ts#L1826-L1890): assert the broadcast payload includes `winnerCard` and that `winnerCard` deep-equals the `round.cards.get(cardKey)` entry (including FREE tile). Also assert `round.winnerName === 'Alice'` after a successful claim.

27. **Server — `POST /round/next-round`.** New `describe('POST /api/rooms/:code/round/next-round', ...)` block covering:
    - 404 on unknown room.
    - 503 when no live `roomState`.
    - 409 when there is no ended round (`currentRound?.ended !== true`).
    - 409 when `pendingRound` is missing.
    - 403 when the caller is an anonymous guest (no session cookie) and the body is missing `playerName`.
    - 403 when the caller is a guest whose `playerName` does not match `round.winnerName`.
    - 403 when the caller is the winner but `continuousMode === false`.
    - 200 when the caller is the host (with session cookie) — asserts `startContinuousRound` path is taken via a `round:start` broadcast in the test WS mock.
    - 200 when the caller is the winner AND `continuousMode === true` — same assertion.

28. **Client — auto-claim guard.** Unit test in a new `src/client/__tests__/gameState.test.ts` (or extend existing test file) that asserts: a failed fetch (mock `res.status = 409`) leaves the internal `hasAutoClaimedThisRound` flag `false`, so a second `handleBingoClick()` call fires a second POST. A `res.status === 200` path latches it to `true` until the next `round:start` resets it.

29. **Client — Game Over render.** Add lightweight render tests for `GameOverView` covering:
    - Winner variant: winning-line highlight renders, winning-songs list has 5 entries, no toggle.
    - Loser variant, Their card selected: winner's card renders via `winnerCard` prop; winning-line highlight applied.
    - Loser variant, Your card selected: honest-card `.missed` class applied to un-marked-but-played tiles; no winning-line highlight.
    - CTA eligibility matrix (host / winner-guest / other-guest × continuousMode on/off) renders the correct button vs. status line.

30. **Client — `BingoCard` mode.** Extend [src/client/__tests__/bingo.test.ts](src/client/__tests__/bingo.test.ts) (or add a BingoCard render test file) to assert:
    - Default `mode='active'` behavior unchanged (regression).
    - `mode='gameover-loser-your'` applies `.missed` to unmarked tiles whose `trackId ∈ playedTrackIds`.
    - In every game-over mode, clicking a tile is a no-op (ensures `onTileClick` is not called).

31. **Regression.** `bun run lint` (tsc --noEmit) clean. `bun test` green. Existing `WinOverlay`-related tests (e.g. in [RoundConfigOverlay.test.ts](src/client/__tests__/RoundConfigOverlay.test.ts) if any reference it) may need updating if they import `WinOverlay` directly.

## Tasks / Subtasks

- [x] **Server: `RoundState.winnerName` + persistence** (AC #23 — capture)
  - [x] Add `winnerName?: string` to `RoundState` in [src/server/ws.ts](src/server/ws.ts).
  - [x] Include in `persistRoomState` snapshot and `rehydrateRooms` reconstruction.
  - [x] Set `round.winnerName = playerName` in [rooms.ts:789-798](src/server/rooms.ts#L789-L798) before the `round:win` broadcast.
- [x] **Server: `round:win` broadcast `winnerCard`** (AC #6)
  - [x] Extend broadcast payload in [rooms.ts:793-798](src/server/rooms.ts#L793-L798) with `winnerCard: card`.
- [x] **Server: `POST /rooms/:code/round/next-round` endpoint** (AC #23)
  - [x] Add handler near `/round/claim` in [rooms.ts](src/server/rooms.ts).
  - [x] Implement guards (404 / 503 / 409) and host-or-winner authorization.
  - [x] Call `startContinuousRound` on success.
- [x] **Client: extend `WinData` + `round:win` handler** (ACs #6, #7)
  - [x] Add `winnerCard: Tile[]` to `WinData` in [gameState.svelte.ts](src/client/lib/gameState.svelte.ts).
  - [x] Capture from broadcast payload at [gameState.svelte.ts:218-226](src/client/lib/gameState.svelte.ts#L218-L226).
- [x] **Client: `handleBingoClick` single-fire guard** (AC #2, #4)
  - [x] Move guard into `createGameState` — `hasAutoClaimedThisRound` flag, set to `true` on 200, reset on non-200 / error and on `round:start`.
  - [x] Remove per-page `autoClaimFired` state + effect from [RoomPage.svelte](src/client/pages/RoomPage.svelte).
- [x] **Client: auto-claim `$effect` on `hasBingo`** (AC #1)
  - [x] Add `$effect` in both `RoomPage` and `HostRoomPage` watching `game.hasBingo` — fires `game.handleBingoClick()` once per round.
  - [x] Delete the existing casual-mode-gated auto-claim `$effect` at [RoomPage.svelte:107-116](src/client/pages/RoomPage.svelte#L107-L116) — the new unconditional version supersedes it.
- [x] **Client: delete Bingo! button** (AC #3)
  - [x] Remove button + CSS from [RoomPage.svelte:207-211, 282-305](src/client/pages/RoomPage.svelte).
  - [x] Remove button + CSS from [HostRoomPage.svelte:344-348, 410-430](src/client/pages/HostRoomPage.svelte).
- [x] **Client: `GameOverView.svelte` (new component)** (ACs #7, #11-#22)
  - [x] Component shell with prop contract.
  - [x] Render own `<GameHeader>` at top.
  - [x] Winner variant: headline (by `audioPreset`), `<BingoCard mode="gameover-winner">`, winning-songs list.
  - [x] Loser variant: small headline, Their/Your toggle, `<BingoCard mode="gameover-loser-their|your">`, winning-songs list.
  - [x] Host variant: same layout as loser + host CTA.
  - [x] Start Next Round CTA eligibility matrix (AC #20) — two button labels: "Start Next Round" (auto-start) vs "Change Settings & Start" (host + Continuous OFF → reconfigure).
  - [x] `onStartNextRound` callback (auto-start path) fires parent's POST.
  - [x] `onReconfigure` callback (host + Continuous OFF path) routes the host back to the lobby (where `RoundConfigOverlay` lives).
  - [x] Transient error line on POST failure.
  - [x] Responsive styling (mobile-first, ≥768px center-in-container).
- [x] **Client: `BingoCard.svelte` — `mode` prop** (AC #19)
  - [x] Add `mode` prop with default `'active'`.
  - [x] Disable interactivity in `gameover-*` modes (rendered as `<div role="img">`).
  - [x] Dim non-winning tiles in `gameover-winner` (40%) and `gameover-loser-their` (60%).
  - [x] `.missed` style in `gameover-loser-your` for `tile.state === 'unmarked' && playedTrackIds.has(tile.trackId)`.
  - [x] Ensure `.win-path` treatment still applies in winner + their variants.
  - [x] `prefers-reduced-motion` guards carry over.
- [x] **Client: wire `GameOverView` into both pages** (ACs #7-#10)
  - [x] [RoomPage.svelte](src/client/pages/RoomPage.svelte): top-level `{#if game.winData !== null} <GameOverView .../> {:else if game.tiles.length > 0} <active> {:else} <GuestWaitingRoom/> {/if}`.
  - [x] [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte): equivalent structure inside `.card-area`.
  - [x] Delete `WinOverlay` import + usage from both pages.
  - [x] Delete `handleDismissWin` from [HostRoomPage.svelte:86-90](src/client/pages/HostRoomPage.svelte#L86-L90).
  - [x] Parent owns the `POST /round/next-round` fetch; wire to `onStartNextRound`.
- [x] **Client: `api.ts` helper** — added `postStartNextRound(code, playerName?)` returning `Promise<Response>`.
- [x] **(Cleanup)** — `WinOverlay.svelte` left in place per story scope; no client call sites remain.
- [x] **Tests** (ACs #26–#31)
  - [x] Server: extend claim tests with `winnerCard` + `winnerName` assertions.
  - [x] Server: new `describe` for `POST /round/next-round` (9 cases).
  - [x] Client: auto-claim guard unit test.
  - [x] Client: `GameOverView` render tests (winner / loser / toggle / CTA matrix).
  - [x] Client: `BingoCard` mode tests.
  - [x] `npm test` green (401/401); `npm run lint` clean.
- [ ] **Manual verification** (Philip — see checklist in Dev Notes).

### Review Findings

_Code review 2026-04-19 — three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 6 patches, 4 deferred, ~25 dismissed as noise/intentional._

- [x] [Review][Patch] Expose `playedTrackIds` via `gameState` getter — both `RoomPage.svelte:204` and `HostRoomPage.svelte:345` build a fresh `new Set(game.songHistory.map(...))` on every reactive pass, duplicating the already-existing `$derived` Set at [gameState.svelte.ts:80](src/client/lib/gameState.svelte.ts#L80). Add a getter (`get playedTrackIds() { return playedTrackIds }`) and consume it from the pages.
- [x] [Review][Patch] BingoCard: `role="img"` tiles inside `role="grid"` [src/client/components/BingoCard.svelte:58,80](src/client/components/BingoCard.svelte#L58) — ARIA grid children should be `role="gridcell"`. Either change the gameover-mode div to `role="gridcell"` with aria-label, or drop `role="grid"` on the parent when `mode !== 'active'`.
- [x] [Review][Patch] HostRoomPage `round:start` handler doesn't clear `nextRoundError` [src/client/pages/HostRoomPage.svelte:228-239](src/client/pages/HostRoomPage.svelte#L228) — [RoomPage.svelte:138-139](src/client/pages/RoomPage.svelte#L138) clears it. Inconsistent. A stale error can linger past the start of the next round until the 3s timer fires.
- [x] [Review][Patch] Test gap: `round:start` reset path not directly tested [src/client/__tests__/gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts) — AC #28 explicitly calls for "`res.status === 200` path latches it to `true` until the next `round:start` resets it". Add a case: 200 → invoke `processWsMessage({type:'round:start', ...})` → second `handleBingoClick()` fires a second POST.
- [x] [Review][Patch] Test gap: `rooms.test.ts` "winner + continuous OFF → 403" case only asserts the 403, not that no `round:start` was broadcast [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) — a regression where the server both 403s the caller *and* still starts a round would pass today. Add `expect(hostWs.sent.some(m => m.type === 'round:start')).toBe(false)`.
- [x] [Review][Patch] Test data fragility: `GameOverView.test.ts` and `BingoCard.test.ts` construct tiles without the `state` field [src/client/__tests__/GameOverView.test.ts](src/client/__tests__/GameOverView.test.ts), [src/client/__tests__/BingoCard.test.ts:63-68](src/client/__tests__/BingoCard.test.ts#L63) — the `.missed` count test passes because `isMissed` also checks `tile.state === 'unmarked'` but the mock tiles don't set `state` explicitly. Running through `initTiles()` first would make the test exercise the real state-gated logic instead of passing incidentally.

- [x] [Review][Defer] Reconnect after a win loses Game Over view — [src/server/ws.ts session:connect flow](src/server/ws.ts) does not replay `round:win` when `round.ended === true`; a reconnecting winner can't access the Start Next Round CTA. Already acknowledged as a "pre-existing limitation of the current reconnect contract" in Dev Notes. Deferred, pre-existing.
- [x] [Review][Defer] No CSRF / origin check / rate-limit on `POST /round/next-round` [src/server/rooms.ts:817](src/server/rooms.ts#L817) — the endpoint is intentionally unauthenticated (guest-callable) and gated only by `playerName === round.winnerName`. Dev Notes explicitly accept the spoofing risk as "consistent with the project's friends-only model". Deferred, architectural.
- [x] [Review][Defer] 403 / 409 error messaging is generic — handleStartNextRound shows "Couldn't start next round — try again." for permanent failures (403 wrong-name, 409 no-pending) where retry will never succeed. UX polish, not a correctness issue. Deferred.
- [x] [Review][Defer] No server-side debounce when host + winning guest tap CTA at the same instant — both authorized callers pass their auth branch and both run `startContinuousRound`, which could double-broadcast `round:start` or double-bump `roundNumber`. `startContinuousRound`'s own idempotency would need verification. Deferred pending observation in real play.

## Dev Notes

- **Why not put the CTA HTTP call inside `GameOverView` itself?** Because the parent owns the transient error state and can surface it in its existing error-banner location ([HostRoomPage.svelte:290-296](src/client/pages/HostRoomPage.svelte#L290-L296)). `GameOverView` stays prop-driven and easy to render-test.
- **Why `startContinuousRound` for both host and winner CTAs?** It already correctly derives the next config from `pendingRound`, increments `roundNumber`, re-runs `startRound` (which resets per-round state — `playerCasualModes`, `autoMarkedTileIndices`, etc.), and broadcasts `round:start`. Writing a parallel "start-same-config" path would duplicate ~40 lines and diverge in subtle ways. Continuous Mode is already the "reuse-config" path — the CTA just triggers it synchronously instead of via the 10 s countdown.
- **Why keep `/round/dismiss-win` and `round:dismissed`?** Deleting the endpoint requires backporting tests and removing `round:dismissed` from the WS type catalogue. The cleanup is ~30 lines and unrelated to this story's goal. Leaving it as dead code is fine — no client path hits it once `WinOverlay` is unreferenced.
- **Auto-claim convergence with Casual Mode.** The existing Casual Mode auto-claim effect at [RoomPage.svelte:107-116](src/client/pages/RoomPage.svelte#L107-L116) is *gated on `casualModeOn`* — it only fires for casual players. This story replaces it with an *unconditional* `$effect` watching `game.hasBingo`. The result: a non-casual player whose manual tap flips `hasBingo` also auto-claims. This is the desired 9-1 behavior. Casual Mode's auto-mark sweep still fires as before — it mutates `tiles`, which flips `hasBingo`, which fires the single unconditional effect. One code path, both flows converge cleanly.
- **Why move the single-fire guard from page state into `gameState`?** Because `handleBingoClick` is the single choke-point and already holds the success/failure knowledge (it awaits the fetch). Page-level state required duplicating the reset in multiple handlers (`round:start`, Casual Mode toggle). In `gameState`, the guard resets automatically wherever `winData` and `isClaiming` reset, which already happens in `round:start`.
- **The loser "Your card" honest-card shading is for self-reflection, not judgment.** The purpose is "how close was I to winning?" — marked tiles stay solid so the loser can see the lines they *did* build; missed tiles (song played, they didn't mark) ghost out so they can spot the misses without feeling scolded. Use dimmed/greyed styling, not red / danger / strikethrough. `var(--bg-2)` background, `var(--fg-muted)` colour, dashed thin border at `var(--rule)` opacity. No animation on `.missed`.
- **`BingoCard` will be used in up to FOUR visual modes.** In all three game-over modes, render tiles as `<div role="img">` (no click handler, no focus target) — simplest way to keep active-mode's `<button>` semantics clean while making the end-screen variants truly terminal.
- **Race condition recovery.** The client second-claim race (AC #4) already resolves correctly given existing server + `gameState` logic. The `hasAutoClaimedThisRound` guard in `gameState` is a *belt-and-suspenders* protection against pathological cases (e.g. React-like double-mount or a hot-reload mid-round); it is not load-bearing for the two-player race.
- **Identity-by-display-name is still deferred.** If two players share a display name and one of them wins, the non-winning duplicate will render the *winner* variant because `selfName === winnerName` is `true` for both. Same bug `WinOverlay` has today. Acknowledged; fix belongs to a dedicated project-wide identity story. Flag it again in the retrospective if it bites in manual play.
- **`POST /round/next-round` authorization design decision.** Two options for winner auth:
  1. Body field `{ playerName }` that the server cross-checks against `round.winnerName` (chosen here — no new session concept for guests).
  2. A short-lived token embedded in the `round:win` broadcast that the winner echoes back.
  Chose option 1 because it reuses the existing "guests identify by display name" pattern (same pattern the claim endpoint uses — see [rooms.ts:760-762](src/server/rooms.ts#L760-L762)). Yes, the name-spoofing risk is present, but it's consistent with the project's friends-only model.
- **`winData` survives reconnect.** Server-side `round.ended === true` is persisted; a reconnecting guest replays the `roundStartPayload` but the `round:win` broadcast is *not* re-sent on reconnect today. If a player reconnects *after* a win, they rejoin a round that's still technically `currentRound` but `active: false` — which renders their client as the active-round branch (they won't see Game Over). **This is a pre-existing limitation of the current reconnect contract, not something 9-1 needs to solve.** Document as a known gap. A future story could extend `session:connect` with a `winData` payload when `roomState.currentRound?.ended`.

### Key Anti-Patterns to Avoid

- **Don't render `GameOverView` as fixed-position or with `z-index` > 0 unless it's a drawer/overlay that already uses that.** It's a page branch, not an overlay.
- **Don't add a "Dismiss" affordance for testing ergonomics.** If you need to exit Game Over during dev, tap Start Next Round (or End Session for the host).
- **Don't reuse the `WinOverlay` component as a container.** Extract the CSS tokens you need (headline variants, winning-songs list styling) into `GameOverView.svelte` directly; leave `WinOverlay.svelte` untouched so we don't risk accidental re-use of its modal CSS.
- **Don't try to detect "host is also the winner" on the host page.** `selfName` is `null` for hosts; identity comparison fails by design. Host always sees host-variant layout with the host CTA; if the host is also the human who won, they still see the loser-shaped layout. That's fine — the host knows they won.
- **Don't fire auto-claim on `round:start` → `hasBingo === false` transitions.** The guard is "first time `hasBingo` becomes `true`"; Svelte `$effect` runs on dependency change, so the effect fires only when `hasBingo` flips `false → true`, which is the right edge. Double-check by reading `$effect` behaviour — do not manually track "previous value" unless Svelte's default re-run behaviour surprises you.
- **Don't pass `winData` directly into `<BingoCard>` as a pretended `tiles` array.** The winner's card comes from `winData.winnerCard: Tile[]` — it must be run through `initTiles` + `applyWinPath(tiles, winData.winningTileIds)` before rendering, just like the active card goes through `initTiles` on `round:start`. Compute this derived `ClientTile[]` inside `GameOverView` (not on the server, not in `gameState`).
- **Don't auto-start the next round on `round:win` receipt in Continuous Mode.** The countdown auto-advance is out of scope for 9-1. Continuous Mode in 9-1 only changes who sees the CTA (winner also), not whether the CTA is implicit.

### Manual Verification Checklist (Philip)

- Host + two guests (Alice, Bob). Alice manually marks her 5th winning tile — Alice auto-claims, all three clients transition to Game Over. Alice sees winner variant (headline by `audioPreset`, own card, winning-line highlight, dimmed non-winning). Bob sees loser variant with Their/Your toggle (defaults Their). Host sees loser-shaped layout + "Start Next Round" CTA.
- Two guests nearly simultaneously cross the winning-line threshold on the same song. Only one ends up as the winner on everyone's screen; the loser's client does not re-claim on `round:win` receipt. Check server logs for exactly one `round:win` broadcast.
- Alice (Casual Mode ON) enables Casual Mode mid-round; sweep auto-marks enough tiles to complete a line. Alice auto-claims without a manual tap. Game Over transitions correctly.
- Alice's transient claim POST fails (simulate by killing the network briefly right after `hasBingo` flips): page stays on active-round view, `hasBingo` re-flips next tile mark, second POST succeeds. The old 8-5 latch bug does NOT reappear.
- Continuous Mode OFF: only host sees Start Next Round CTA in Game Over. Alice (winner) + Bob see the status line.
- Continuous Mode ON: host + Alice (winner) both see the CTA. Bob sees the status line. Alice taps her CTA; next round starts identically to host tapping.
- Continuous Mode ON + host is also the winner-human: only one CTA visible (role is still `'host'`, so no duplicate rendering). Taps start the next round.
- Loser "Your card" view: tiles whose song played but Bob never marked render with the faded missed style. Marked tiles render solid. FREE tile renders normally.
- Header affordances (Players overlay, Song History drawer) are reachable during Game Over and show the correct data (history includes the winning songs).
- Mobile viewport (Safari iOS emulated at 375px width): Game Over page fits without horizontal scroll. Tap targets on the Their/Your toggle meet 44×44.
- `prefers-reduced-motion`: no new animations introduced — the `.win-path` rotation/outline are the only motion and they already respect the media query.
- `bun test` green, `bun run lint` clean, `bun run build:client` clean.
- Two-device Tailscale manual run reproduces the full end-to-end flow once, including Continuous-Mode-ON winner-CTA path.

### Project Structure Notes

Files touched:

**Server:**
- src/server/rooms.ts — `round:win` broadcast adds `winnerCard`; sets `round.winnerName`; new `POST /round/next-round` handler.
- src/server/ws.ts — `RoundState.winnerName` type; persist/rehydrate.
- src/server/__tests__/rooms.test.ts — extend claim tests, new `next-round` describe.

**Client:**
- src/client/lib/api.ts — `postStartNextRound(code, playerName?)` helper.
- src/client/lib/gameState.svelte.ts — `WinData.winnerCard`; capture in `round:win`; `hasAutoClaimedThisRound` guard inside `handleBingoClick`; reset on `round:start`.
- src/client/components/GameOverView.svelte — new file.
- src/client/components/BingoCard.svelte — `mode` prop + game-over visual variants.
- src/client/pages/RoomPage.svelte — top-level branch; delete Bingo! button; delete `autoClaimFired`; delete `WinOverlay` import; wire `onStartNextRound` fetch.
- src/client/pages/HostRoomPage.svelte — same; delete `handleDismissWin`.
- src/client/__tests__/gameState.test.ts — new file (or extend a sibling).
- src/client/__tests__/GameOverView.test.ts — new file.
- src/client/__tests__/bingo.test.ts — extend with `BingoCard` mode coverage (or new `BingoCard.test.ts`).

### References

- Epic 9 intro + 9-1 ACs: [_bmad-output/planning-artifacts/epics.md:1467-1602](_bmad-output/planning-artifacts/epics.md#L1467-L1602)
- Epic 8 retro — Epic 9 prep action items: [_bmad-output/implementation-artifacts/epic-8-retro-2026-04-15.md:146-180](_bmad-output/implementation-artifacts/epic-8-retro-2026-04-15.md#L146-L180)
- Story 8-5 (auto-claim origin, latch debt): [_bmad-output/implementation-artifacts/8-5-casual-mode-auto-mark-engine.md](_bmad-output/implementation-artifacts/8-5-casual-mode-auto-mark-engine.md)
- Story 8-3 (continuous mode, `startContinuousRound`, `pendingRound`): [_bmad-output/implementation-artifacts/8-3-continuous-mode.md](_bmad-output/implementation-artifacts/8-3-continuous-mode.md)
- Story 8-1 (`WinOverlay` audio preset variants, `AudioPreset` type): [_bmad-output/implementation-artifacts/8-1-win-moment-hold-and-audio-presets.md](_bmad-output/implementation-artifacts/8-1-win-moment-hold-and-audio-presets.md)
- Existing `round:win` broadcast: [src/server/rooms.ts:793-798](src/server/rooms.ts#L793-L798)
- Existing `WinOverlay` (reference for styling tokens only): [src/client/components/WinOverlay.svelte](src/client/components/WinOverlay.svelte)
- Existing `hasBingo` + `handleBingoClick`: [src/client/lib/gameState.svelte.ts:79-140](src/client/lib/gameState.svelte.ts#L79-L140)
- Existing Casual-Mode auto-claim effect (being replaced): [src/client/pages/RoomPage.svelte:107-116](src/client/pages/RoomPage.svelte#L107-L116)

## Open Questions (for Philip)

_All resolved — design decisions baked into ACs #19, #20, #21. No open items at this time._

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (claude-opus-4-7)

### Completion Notes List

- **Server — `RoundState.winnerName`.** Added optional `winnerName?: string` to `RoundState` in [src/server/ws.ts](src/server/ws.ts); set on successful claim in [rooms.ts](src/server/rooms.ts) before the `round:win` broadcast. Persisted via the existing `...snap.currentRound` spread in `persistRoomState` + `rehydrateRooms`, so no new explicit snapshot field is required.
- **Server — `round:win` broadcast extended with `winnerCard`.** Broadcast payload now includes `winnerCard: card` (the same 25-tile array fetched via `round.cards.get(cardKey)` for claim validation). Every client gets the winner's full card without a follow-up fetch.
- **Server — `POST /api/rooms/:code/round/next-round`.** New endpoint; not behind `requireAuth` so a winning guest can call it when continuous mode is on. Guards: 404 (no room), 503 (no live WS session), 409 (no ended round / no pending config), 403 (unauthorized). Authorization: valid host session cookie OR `playerName === round.winnerName` with `continuousMode === true`. Delegates to the existing `startContinuousRound` helper.
- **Client — `WinData.winnerCard` + capture.** Extended `WinData` in [gameState.svelte.ts](src/client/lib/gameState.svelte.ts) and captured `winnerCard` from the `round:win` payload (defaults to `[]` if missing — defensive against an older server).
- **Client — auto-claim guard rework.** Replaced Story 8-5's permanently-latching `autoClaimFired` page state with an internal `hasAutoClaimedThisRound` flag inside `handleBingoClick`. Set `true` *before* the fetch (prevents concurrent double-fire); reset to `false` on any non-200 response or thrown error so a transient failure can retry on next tile-mark. Reset on `round:start` (same place `winData` / `isClaiming` reset). The Story 8-5 retro action item is closed.
- **Client — auto-claim convergence with Casual Mode.** Both pages now share a single unconditional `$effect(() => { if (game.hasBingo) game.handleBingoClick() })`. Manual marks and Casual Mode auto-mark sweeps both mutate `tiles`, flipping `hasBingo` through the same derivation — one code path serves both flows. Epic 8 retro action #3 closed.
- **Client — `GameOverView.svelte`.** New shared component rendered as a top-level page branch (NOT a modal). Winner variant uses audio-preset-aware headlines (hype / deadpan / minimal) mirroring the `WinOverlay` styling tokens. Loser/host variants render a `Their card` / `Your card` segmented toggle (pill-group pattern) above the card. Winner's card reconstructed client-side via `applyWinPath(initTiles(winnerCard), winningTileIds)`.
- **Client — `BingoCard` `mode` prop.** Added `mode?: 'active' | 'gameover-winner' | 'gameover-loser-their' | 'gameover-loser-your'`, defaulting to `'active'`. Game-over modes render tiles as `<div role="img">` (non-interactive — no `onclick`, no focus target, keyboard skips them). `gameover-winner` dims non-winning tiles to 40%; `gameover-loser-their` dims to 60%; `gameover-loser-your` applies the "missed" style (dashed border, muted colors) to unmarked tiles whose song already played.
- **Client — CTA wiring.** Host + continuous ON → "Start Next Round" button → `POST /round/next-round`. Host + continuous OFF → "Change Settings & Start" → calls parent's `onReconfigure` which routes back to the lobby where `RoundConfigOverlay` lives (no in-place overlay needed on `HostRoomPage`). Guest winner + continuous ON → "Start Next Round" (same endpoint, with `playerName` body). All other guests and guest-winner + continuous OFF see a waiting status line. Transient error line for ~3s on a failed POST with the retry-friendly message "Couldn't start next round — try again."
- **Both room pages — top-level structure.** Swapped `WinOverlay` for `GameOverView` rendered inside the main page branch: `{#if game.winData !== null} <GameOverView/> {:else if game.tiles.length > 0} <active-round> {:else} <GuestWaitingRoom/> {/if}`. Deleted the `Bingo!` button, its disabled variant, `autoClaimFired` state, `handleDismissWin`, and associated CSS.
- **Tests.** Added/extended:
  - Extended claim tests with `winnerCard` + `winnerName` assertions (`src/server/__tests__/rooms.test.ts`).
  - 9 new cases under `describe('POST /api/rooms/:code/round/next-round')` covering all guard and auth branches.
  - `src/client/__tests__/gameState.svelte.test.ts` — 4 cases for the auto-claim single-fire guard (named `.svelte.test.ts` so Svelte rune processing applies).
  - `src/client/__tests__/GameOverView.test.ts` — 10 cases covering winner/loser variants, audio presets, Their/Your toggle state, CTA eligibility matrix (host / winner-guest / other-guest × continuous on/off), and error line.
  - `src/client/__tests__/BingoCard.test.ts` — 5 cases covering default-mode interactivity regression, gameover-mode non-interactivity, `gameover-loser-their` dim class, `missed` class in `gameover-loser-your`, and absence of win-path styling in the "your card" view.
- **Final validation.** `npm run lint` clean (tsc --noEmit). `npm test` → 401/401 passing across 20 test files.

### File List

**Server:**
- `src/server/ws.ts` — added `winnerName?: string` to `RoundState`.
- `src/server/rooms.ts` — set `round.winnerName` on claim; extended `round:win` broadcast with `winnerCard`; new `POST /rooms/:code/round/next-round` endpoint; added `getCookie` + `verifySession` imports for guest-winner authorization.
- `src/server/__tests__/rooms.test.ts` — extended valid-claim test with `winnerCard` + `winnerName` assertions; new `POST /api/rooms/:code/round/next-round` describe block (9 cases).

**Client:**
- `src/client/lib/api.ts` — added `postStartNextRound(code, playerName?)`.
- `src/client/lib/gameState.svelte.ts` — `WinData.winnerCard: Tile[]`; capture from `round:win`; `hasAutoClaimedThisRound` guard reworked; reset on `round:start`, 200, non-200, error.
- `src/client/components/GameOverView.svelte` — **new file**, page-branch component.
- `src/client/components/BingoCard.svelte` — `mode` prop + three game-over visual variants; non-interactive div rendering for game-over modes; `.gameover-dim`, `.gameover-dim-their`, `.missed` styles.
- `src/client/pages/RoomPage.svelte` — swapped `WinOverlay` for `GameOverView` page branch; deleted Bingo! button + CSS; deleted `autoClaimFired`; unconditional auto-claim `$effect`; `handleStartNextRound` owning transient error state.
- `src/client/pages/HostRoomPage.svelte` — same restructure; deleted `handleDismissWin`; `onReconfigure={onRoundEnded}` routes host back to the lobby.
- `src/client/__tests__/gameState.svelte.test.ts` — **new file**, 4 auto-claim guard tests.
- `src/client/__tests__/GameOverView.test.ts` — **new file**, 10 render tests.
- `src/client/__tests__/BingoCard.test.ts` — **new file**, 5 mode-prop tests.

## Change Log

| Date       | Change                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| 2026-04-19 | Story 9-1 implementation — auto-bingo, Game Over page mode, `/round/next-round`, tests. |
| 2026-04-19 | Code review — 6 patches applied (playedTrackIds getter, gridcell a11y, HostRoomPage nextRoundError clear, round:start reset test, no-broadcast assertion on 403 winner+cont-off, test data via initTiles). 4 deferred items logged. 402/402 tests pass, lint clean. |
