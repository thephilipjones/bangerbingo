# Story 9-3: Collapse Continuous Mode into a Game Over Choice

Status: done

## Story

As a host,
I want the Game Over screen to offer me two big buttons — **Let It Ride** to run the same config again and **Change It Up** to reconfigure before the next round — instead of hiding next-round behavior behind a persistent Continuous Mode toggle,
so that the choice to continue or reconfigure is made at the moment it's relevant, without carrying a stateful setting between rounds.

## Background

Story 9-1 shipped the Game Over page with a CTA matrix that branches on `RoomState.continuousMode`:

- Host + Continuous ON → **Start Next Round** (auto-start same config via `POST /round/next-round`).
- Host + Continuous OFF → **Change Settings & Start** (routes host back to lobby/config overlay).
- Guest winner + Continuous ON → same **Start Next Round** CTA (guest-callable, authorized by `playerName === round.winnerName`).
- Everyone else → "Waiting for the host to start the next round."

Story 9-2 (ready-for-dev, not yet implemented) was going to move the Continuous Mode flag out of `HostMiniPlayer` and into a live-editable `AdvancedSettings` panel as an "Autoplay Next Round" toggle inside `HostControlsOverlay`.

This story **deletes Continuous Mode entirely** and turns the next-round decision into a per-BINGO host choice rendered on the Game Over page. The toggle was a piece of persistent state whose only effect was branching the CTA; collapsing it into two explicit buttons removes the state, the CTA matrix, the guest-winner auth shim, the 10s countdown plumbing, the `round:dismissed` event, and the `/round/dismiss-win` endpoint — all of which are dead or about-to-be-dead code once the toggle is gone. Story 9-2 shrinks accordingly (Autoplay row dropped; four live-editable fields remain).

**What this story does:**

- **Game Over host CTA — two stacked buttons.** Host sees **Let It Ride** (primary/fill) + **Change It Up** (secondary/outline), stacked vertically at the top of the CTA area. Guest view (winner + loser) renders only the "Waiting for the host…" status line.
- **Let It Ride.** Fires `POST /api/rooms/:code/round/next-round` — same endpoint as today, but now host-only (behind `requireAuth`), same-config auto-start via `startContinuousRound(…)` which reads `roomState.pendingRound`.
- **Change It Up.** Opens `RoundConfigOverlay` *in place on top of the Game Over page* (not a route back to the lobby). Music keeps playing, Game Over card stays mounted underneath. Host can dismiss the overlay to return to Game Over and tap "Let It Ride" instead. When the overlay's Start flow succeeds, the resulting `round:start` broadcast clears `winData` and naturally unmounts the Game Over branch.
- **Server — Continuous Mode excise.** Delete `POST /rooms/:code/continuous-mode`; delete `RoomState.continuousMode` + `RoomState.continuousCountdown`; delete `POST /rooms/:code/round/dismiss-win`; delete WS events `continuous-mode:changed`, `continuous:countdown-start`, `continuous:countdown-cancel`, `round:dismissed`; delete `CONTINUOUS_COUNTDOWN_MS` constant + the 10s countdown timer. `startContinuousRound` survives as the "build next round from pendingRound + delegate to startRound" helper, but its countdown/cancel broadcast paths disappear.
- **Server — `/round/next-round` simplification.** Move behind `requireAuth`. Drop `playerName` body parsing. Drop `round.winnerName` capture + persistence (was only used for guest-winner auth). Guards collapse to: 404 (no room), 503 (no live session), 409 (no ended round), 409 (no pending config).
- **Client — `GameOverView` contract simplifies.** Drop `continuousMode` prop. Drop `isWinner`-drives-CTA branching (winner-variant headline + winner's card view stay; only the CTA logic collapses). Add `onLetItRide` + `onChangeItUp` callbacks (replacing `onStartNextRound` + `onReconfigure` names to match the new button labels).
- **Client — gameState cleanup.** Delete `continuousMode` getter/setter, `countdownEndsAt` state, `continuous-mode:changed` / `continuous:countdown-start` / `continuous:countdown-cancel` / `round:dismissed` handlers. Delete `initialContinuousMode` + `initialCountdownRemainingMs` constructor params. `WinData.winnerCard` stays (loser variant needs it); `WinData.winnerName` stays (headline).
- **Client — `HostMiniPlayer` Loop button removed.** `∞ Loop` button block + `continuousMode` / `onContinuousToggle` / `countdownSeconds` props + associated CSS all go. (This was planned for 9-2; migrates here.)
- **Client — `GuestWaitingRoom` countdown removed.** `countdownSeconds` prop + "Next game starts in Xs" UI go. The prop is no longer threaded from any caller.
- **Client — `RoomPage`, `JoinPage`, `App`, `ws.ts` cleanup.** Drop all `continuousMode` / `countdownRemainingMs` plumbing from the guest-side connect flow (`session:connect` payload → `onConnect` handler → `App` state → `RoomPage` props). Delete `postContinuousMode`, `postDismissWin` client helpers. `postStartNextRound(code, playerName?)` drops the `playerName` arg.
- **Story 9-2 amendment (separate story file edit).** Drop Autoplay Next Round row from `AdvancedSettings` (AC #12 row 5, AC #16 tooltip copy, AC #17 wiring, AC #19 prop re-routing). `AdvancedSettings` renders 4 rows: Clip Duration, Title Reveal, Win Reaction, Casual Mode. Strike the `HostMiniPlayer` Loop removal from 9-2's task list (now owned by 9-3).

**Apply timing:** Musically, playback continues through the Game Over screen on the host device because the claim handler only calls `clearRoundTimers` + sets `round.active = false` — it does NOT pause Spotify. The winning song plays through on the host's device until either the track naturally ends or the next `startSong` call (from Let It Ride or a Change-It-Up-driven Start) replaces it.

**Epic 9 fit:** Supersedes the Continuous Mode-aware CTA logic shipped in 9-1 and trims the Autoplay scope out of 9-2 before 9-2 enters dev.

## Acceptance Criteria

### Server — delete `/continuous-mode`

1. **Endpoint removed.** Delete the `roomsRouter.post('/rooms/:code/continuous-mode', …)` handler at [rooms.ts:548-576](src/server/rooms.ts#L548-L576). Related tests under `describe('POST /api/rooms/:code/continuous-mode', …)` in [rooms.test.ts](src/server/__tests__/rooms.test.ts) are removed.
2. **WS event removed.** No client or server code emits or handles `continuous-mode:changed` after this story.
3. **State field removed.** Delete `continuousMode: boolean` from `RoomState` at [ws.ts:85](src/server/ws.ts#L85) and all reads/writes of it across [rooms.ts](src/server/rooms.ts), [ws.ts](src/server/ws.ts). No persistence changes required — the field was never persisted (see the "not persisted" comment at [ws.ts:83-84](src/server/ws.ts#L83-L84)).

### Server — delete `/round/dismiss-win`

4. **Endpoint removed.** Delete the `roomsRouter.post('/rooms/:code/round/dismiss-win', …)` handler at [rooms.ts:581-615](src/server/rooms.ts#L581-L615). Related tests removed.
5. **WS event removed.** No client or server code emits or handles `round:dismissed`. Any `WinOverlay`-era client code referencing it is already dead per 9-1 Dev Notes — delete the handler from [gameState.svelte.ts:196-197](src/client/lib/gameState.svelte.ts#L196-L197).

### Server — delete continuous-mode countdown plumbing

6. **Countdown timer removed.** Delete `RoomState.continuousCountdown` field at [ws.ts:86](src/server/ws.ts#L86). Delete `CONTINUOUS_COUNTDOWN_MS` constant (grep `CONTINUOUS_COUNTDOWN` in [rooms.ts](src/server/rooms.ts) to find all uses). Delete the `session:connect` reply fields `continuousMode` and `countdownRemainingMs` at [rooms.ts:323-324](src/server/rooms.ts#L323-L324) and [rooms.ts:406-407](src/server/rooms.ts#L406-L407). Delete the countdown clear-on-round-start at [rooms.ts:213](src/server/rooms.ts#L213).
7. **WS events removed.** No client or server code emits or handles `continuous:countdown-start` or `continuous:countdown-cancel`.

### Server — simplify `/round/next-round`

8. **Auth moves behind `requireAuth`.** Rewrite [rooms.ts:823-861](src/server/rooms.ts#L823-L861):
    - Add `requireAuth` middleware to the route, mirroring `/continuous-mode`'s prior shape.
    - Use `ctx.var.host` and verify `room.host_user_id === host.user_id` (403 Forbidden otherwise).
    - Drop all `getCookie` / `verifySession` / `playerName` body parsing. Delete the corresponding imports from [rooms.ts](src/server/rooms.ts) if no longer used elsewhere in the file.
    - Guards (in order): 404 (no room), 403 (wrong host), 503 (no live `roomState`), 409 `{ message: 'No completed round' }` (no ended round), 409 `{ message: 'No pending round config' }` (no `pendingRound`).
    - On success: call `await startContinuousRound(code, roomState)`; return HTTP 200 `{}`.
9. **`round.winnerName` removed.** Delete the `winnerName?: string` field from `RoundState` at [ws.ts](src/server/ws.ts) (type declaration), delete the assignment in the claim handler at [rooms.ts:790](src/server/rooms.ts#L790), and delete the `winnerName` line in the `persistRoomState` snapshot at [ws.ts:117](src/server/ws.ts#L117). No rehydrate changes required once removed. The `round:win` broadcast still sends `winnerName: playerName` for the client-side headline — that's a payload field on the broadcast, separate from `round.winnerName` the server-side capture.

### Server — simplify `startContinuousRound`

10. **Strip cancel-broadcast paths.** Rewrite `startContinuousRound` at [rooms.ts:449-487](src/server/rooms.ts#L449-L487):
    - Keep the helper's responsibility: resolve fresh host token, build next-round config from `pendingRound`, delegate to `startRound`.
    - Delete all `broadcast(code, { type: 'continuous:countdown-cancel', … })` calls.
    - On a missing host / `withFreshToken` returning null / `!pendingRound` / `startRound` failure: the helper returns normally (no broadcast); the calling endpoint's HTTP response is how failure surfaces. Since the only caller is `/round/next-round`, a failure leaves the host on the Game Over screen — the transient error line in `HostRoomPage` already handles it.
    - Remove the `roomState.continuousCountdown = undefined` at line 450 (field no longer exists).
    - Callers: the sole remaining call site is in `/round/next-round` (the dismiss-win caller goes away with AC #4).

### Client — gameState cleanup

11. **`createGameState` constructor params.** Delete `initialContinuousMode` and `initialCountdownRemainingMs` from the `createGameState` options type at [gameState.svelte.ts](src/client/lib/gameState.svelte.ts). Update the two call sites: [RoomPage.svelte:79](src/client/pages/RoomPage.svelte#L79) (guest) seeds from the now-deleted `initialCountdownRemainingMs` — replace with nothing. [HostRoomPage.svelte:47](src/client/pages/HostRoomPage.svelte#L47) does not pass either today — no change.
12. **`continuousMode` + `countdownEndsAt` state.** Delete `let continuousMode = $state(…)` at [gameState.svelte.ts:100](src/client/lib/gameState.svelte.ts#L100), `let countdownEndsAt = $state<number | null>(null)` at [gameState.svelte.ts:101](src/client/lib/gameState.svelte.ts#L101), and the corresponding getter/setter pairs at [gameState.svelte.ts:289-292](src/client/lib/gameState.svelte.ts#L289-L292). Delete the countdown clear on `round:start` at [gameState.svelte.ts:168](src/client/lib/gameState.svelte.ts#L168).
13. **WS message handlers deleted.** Delete the handlers at [gameState.svelte.ts:190-197](src/client/lib/gameState.svelte.ts#L190-L197) for `continuous-mode:changed`, `continuous:countdown-start`, `continuous:countdown-cancel`, and `round:dismissed`. The `processWsMessage` switch collapses accordingly.

### Client — `api.ts` cleanup

14. **Helpers removed.** Delete `postContinuousMode` and `postDismissWin` from [api.ts](src/client/lib/api.ts) if they exist. `postStartNextRound(code)` drops its optional `playerName` argument — signature becomes `(code: string) => Promise<Response>`; body becomes `{}` or no body. If the server implementation requires *no* body on a POST, adjust the helper accordingly — see AC #8.

### Client — `ws.ts` + guest connect flow

15. **`connectAsGuest` signature.** Delete `continuousMode` and `countdownRemainingMs` from the `onConnect` callback signature at [ws.ts:87-88](src/client/lib/ws.ts#L87-L88) and [ws.ts:144-145](src/client/lib/ws.ts#L144-L145). Update callers: [JoinPage.svelte:19-20, 78-85](src/client/pages/JoinPage.svelte#L19-L85) and [App.svelte:50-51, 65-66](src/client/App.svelte#L50-L51). Delete `guestContinuousMode` and `guestCountdownRemainingMs` state from [App.svelte](src/client/App.svelte) and the corresponding `initialContinuousMode` / `initialCountdownRemainingMs` props passed to `RoomPage` at [App.svelte:117](src/client/App.svelte#L117).

### Client — `HostMiniPlayer`

16. **`∞ Loop` button removed.** Delete the `.continuous-btn` button block at [HostMiniPlayer.svelte:48-54](src/client/components/HostMiniPlayer.svelte#L48-L54) and its associated `.continuous-btn` / `.continuous-btn.active` CSS rules. Delete the `countdownSeconds` rendering block at [HostMiniPlayer.svelte:58-60](src/client/components/HostMiniPlayer.svelte#L58-L60) and its `.countdown-text` CSS. Remove the `continuousMode`, `onContinuousToggle`, and `countdownSeconds` props from the `$props()` destructure and type annotation at [HostMiniPlayer.svelte:12-27](src/client/components/HostMiniPlayer.svelte#L12-L27).

### Client — `GuestWaitingRoom`

17. **Countdown UI removed.** Delete the `countdownSeconds` prop from `GuestWaitingRoom.svelte`'s type and destructure. Delete the `{#if countdownSeconds !== null}` block (grep `waiting.countdown` in [GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte) for the surrounding markup + CSS rule). Remove the `{countdownSeconds}` prop pass at [RoomPage.svelte:241](src/client/pages/RoomPage.svelte#L241).

### Client — `RoomPage` (guest)

18. **Guest-winner CTA removed.** Delete the `continuousMode={game.continuousMode}` prop pass to `<GameOverView>` at [RoomPage.svelte:200](src/client/pages/RoomPage.svelte#L200). `GameOverView` no longer accepts or needs it (AC #22). Delete the local `countdownSeconds` $state + its $effect at [RoomPage.svelte:79-88](src/client/pages/RoomPage.svelte#L79-L88) and the `{countdownSeconds !== null ? … : statusLine}` branch at [RoomPage.svelte:225](src/client/pages/RoomPage.svelte#L225). The status line becomes `<p class="status-line" role="status">{statusLine}</p>`.
19. **`onStartNextRound` on guest page.** Delete entirely: guests never call `/round/next-round`. The parent-owned fetch helper on `RoomPage.svelte` (analogous to `handleStartNextRound` on the host page) goes away. `<GameOverView>` on the guest side receives no next-round callback — AC #22 covers the prop contract.

### Client — `HostRoomPage`

20. **Continuous plumbing removed.** Delete `handleContinuousToggle` function at [HostRoomPage.svelte:83-99](src/client/pages/HostRoomPage.svelte#L83-L99) along with `continuousError`, `continuousErrorTimer`, `showContinuousError`, and the `countdownSeconds` $state + $effect at [HostRoomPage.svelte:130-140](src/client/pages/HostRoomPage.svelte#L130-L140). Delete the `continuous:countdown-cancel` WS handler branch at [HostRoomPage.svelte:269](src/client/pages/HostRoomPage.svelte#L269). Delete the `continuousMode` / `countdownRemainingMs` capture on `session:connect` at [HostRoomPage.svelte:263-265](src/client/pages/HostRoomPage.svelte#L263-L265). Delete the `continuousMode` prop pass to `<GameOverView>` at [HostRoomPage.svelte:363](src/client/pages/HostRoomPage.svelte#L363). Delete the `continuousMode` / `onContinuousToggle` / `countdownSeconds` props passed to `<HostMiniPlayer>` at [HostRoomPage.svelte:416-418](src/client/pages/HostRoomPage.svelte#L416-L418).
21. **Change It Up — in-place overlay.**
    - Add `let isRoundConfigOpen = $state(false)` to `HostRoomPage`.
    - Add `handleChangeItUp()` that sets `isRoundConfigOpen = true` (no fetch, no route change).
    - Pass `onChangeItUp={handleChangeItUp}` to `<GameOverView>` (replaces the prior `onReconfigure={onRoundEnded}` at [HostRoomPage.svelte:374](src/client/pages/HostRoomPage.svelte#L374)).
    - Below the existing page markup, render `{#if isRoundConfigOpen} <RoundConfigOverlay {code} initialHostName={hostName} onClose={() => (isRoundConfigOpen = false)} onStarted={…} onHostNameMaybeSaved={…} /> {/if}`.
    - `onStarted`: close the overlay (`isRoundConfigOpen = false`). Do NOT call `onRoundEnded()` — the `round:start` broadcast clears `winData` and transitions the page back to active-round naturally. The host stays on `HostRoomPage`.
    - `onHostNameMaybeSaved(name)`: write through to the existing host-name local state if present. Follow the same pattern as [LobbyPage.svelte:188-194](src/client/pages/LobbyPage.svelte#L188-L194).
    - `onClose`: dismissal returns the host to the Game Over view with music still playing; "Let It Ride" still works.
    - Import `RoundConfigOverlay` at the top of `HostRoomPage` — currently only `LobbyPage` imports it. Follow the same pattern.
22. **"Let It Ride" wiring.** Rename `handleStartNextRound` → `handleLetItRide` (behaviour unchanged — same `POST /round/next-round` fetch, same transient error line, same retry on button re-enable). Pass `onLetItRide={handleLetItRide}` to `<GameOverView>` (replaces the prior `onStartNextRound` prop).

### Client — `GameOverView`

23. **Prop contract simplified.**
    ```ts
    {
      role: 'host' | 'guest',
      selfName: string | null,
      winData: WinData,
      audioPreset: AudioPreset,
      ownTiles: ClientTile[],
      playedTrackIds: Set<string>,
      // host-only callbacks (safely no-op for guest callers):
      onLetItRide?: () => void,
      onChangeItUp?: () => void,
      // optional transient error surface (host-only):
      nextRoundError?: string | null,
    }
    ```
    Delete the `continuousMode: boolean` prop.
24. **CTA render logic.** At [GameOverView.svelte:63-65](src/client/components/GameOverView.svelte#L63-L65):
    - `role === 'host'` → render **two stacked buttons**: primary "Let It Ride" (`onclick={onLetItRide}`, existing `.btn-primary` style), below it secondary "Change It Up" (`onclick={onChangeItUp}`, outline style — use existing secondary button class from the project, e.g. `.btn-secondary` if defined, else follow the pill pattern). If `nextRoundError` is truthy, render the existing transient error line below the buttons.
    - `role === 'guest'` → render the existing waiting-status line: "Waiting for the host to start the next round."
    - Delete `showWinnerCta` / `showWaitingLine` / any `isWinner`-drives-CTA derivations.
    - The winner-variant headline + winner's card view (winner-self comparison via `selfName === winData.winnerName`) **stays unchanged** — only the CTA section simplifies.
25. **Stacking + spacing.** Buttons are full-width (same width as the card below), stacked vertically with the existing vertical spacing pattern between major sections. The primary button renders first (top).

### Tests

26. **Server tests — deletions.** In [rooms.test.ts](src/server/__tests__/rooms.test.ts):
    - Delete the entire `describe('POST /api/rooms/:code/continuous-mode', …)` block (if present).
    - Delete the entire `describe('POST /api/rooms/:code/round/dismiss-win', …)` block (if present).
    - In the existing `describe('POST /api/rooms/:code/round/next-round', …)` block: delete the guest-winner success case (200 when winner + continuousMode ON) and delete the three 403 cases that test the guest-winner auth branch. Keep/update: 404, 503, 409-no-ended-round, 409-no-pending-config, 403-not-host, 200-host-session.
    - In the claim tests (`round:win` payload assertions): delete any `round.winnerName === 'Alice'` assertion. Keep the `winnerCard` assertion.
27. **Server tests — updated claim tests.** Assert that after a valid claim, `round` does NOT have a `winnerName` field (or equivalently that the `RoundState` type no longer has it — the TypeScript `tsc --noEmit` check catches regressions).
28. **Client tests — GameOverView.** In [GameOverView.test.ts](src/client/__tests__/GameOverView.test.ts):
    - Delete all test cases that assert winner-guest-sees-CTA or Continuous Mode-dependent CTA eligibility.
    - Update the prop fixture to drop `continuousMode` (currently at [GameOverView.test.ts:34, 115, 130, 144, 155, 167, 180](src/client/__tests__/GameOverView.test.ts#L34)).
    - Add a new case: `role === 'host'` renders both "Let It Ride" and "Change It Up" buttons; clicking each invokes the corresponding callback.
    - Add a new case: `role === 'guest'` (both winner and non-winner) renders the waiting status line, no CTA buttons.
    - Add a new case: host `nextRoundError` prop truthy → transient error line renders.
29. **Client tests — gameState.** In [gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts):
    - Delete any tests exercising `continuous-mode:changed`, `continuous:countdown-start`, `continuous:countdown-cancel`, `round:dismissed`, or `continuousMode` / `countdownEndsAt` getters/setters.
    - Keep the auto-claim guard tests (regression coverage for 9-1).
30. **Client tests — RoundConfigOverlay / HostRoomPage.** If any existing tests assert that `onRoundEnded` fires when the host completes a round from Game Over, update them: the new flow keeps the host on `HostRoomPage` and opens `RoundConfigOverlay` in place; `onRoundEnded` is no longer called from the Change It Up path. Verify by grep for `onRoundEnded` in test files.
31. **Regression.** `bun run lint` (tsc --noEmit) clean. `bun test` green. Remaining test count should decrease relative to 9-1's tally due to deletions.

### Story 9-2 amendment (edit the 9-2 story file, not a code change)

32. **`AdvancedSettings` row list — Autoplay Next Round removed.** In [_bmad-output/implementation-artifacts/9-2-live-round-settings-and-pre-round-simplification.md](_bmad-output/implementation-artifacts/9-2-live-round-settings-and-pre-round-simplification.md):
    - Strike row 5 from AC #12 (Autoplay Next Round).
    - Strike the "Autoplay Next Round" tooltip copy line from AC #16.
    - Strike AC #17's forwarding of `continuousMode` + `onContinuousToggle` to `AdvancedSettings`.
    - Strike AC #18 entirely if it now has no content, OR rephrase — the `HostMiniPlayer` Loop removal migrates to 9-3's AC #16, so 9-2's AC #18 can be deleted.
    - Strike AC #19 entirely — `HostRoomPage` no longer re-routes `continuousMode` / `onContinuousToggle` props (both go away in 9-3).
    - Update the "What this story does" bullet list to reflect four live-editable fields (Clip Duration, Title Reveal, Win Reaction, Casual Mode).
    - Update `hostPrefs` schema references — no change needed (the schema was already four fields without continuousMode).
    - Add a note at the top of the story: "Scope amended by Story 9-3 (2026-04-19): Autoplay Next Round row and HostMiniPlayer Loop removal excised. See 9-3 for context."

## Tasks / Subtasks

- [x] **Server — delete `/continuous-mode` handler + `continuous-mode:changed` event** (ACs #1, #2)
  - [x] Delete endpoint from [rooms.ts](src/server/rooms.ts).
  - [x] Delete matching tests in [rooms.test.ts](src/server/__tests__/rooms.test.ts).
- [x] **Server — delete `/round/dismiss-win` handler + `round:dismissed` event** (ACs #4, #5)
  - [x] Delete endpoint from [rooms.ts](src/server/rooms.ts).
  - [x] Delete matching tests.
- [x] **Server — delete continuous countdown plumbing** (ACs #3, #6, #7, #10)
  - [x] Delete `RoomState.continuousMode` + `RoomState.continuousCountdown` from [ws.ts](src/server/ws.ts).
  - [x] Delete `CONTINUOUS_COUNTDOWN_MS` constant from [rooms.ts](src/server/rooms.ts).
  - [x] Delete countdown reads in `session:connect` replies at [rooms.ts:323-324, 406-407](src/server/rooms.ts#L323-L324).
  - [x] Delete countdown clear in `startRound` / round-advance paths (grep `continuousCountdown` in [rooms.ts](src/server/rooms.ts)).
  - [x] Strip `continuous:countdown-cancel` broadcasts from `startContinuousRound`.
- [x] **Server — simplify `/round/next-round`** (ACs #8, #9)
  - [x] Add `requireAuth` middleware.
  - [x] Collapse to host-only auth.
  - [x] Delete `round.winnerName` field + capture + persistence line.
- [x] **Client — gameState cleanup** (ACs #11, #12, #13)
  - [x] Delete `continuousMode` + `countdownEndsAt` state + getters/setters + constructor params.
  - [x] Delete 4 WS message handlers.
- [x] **Client — api.ts cleanup** (AC #14)
- [x] **Client — ws.ts + guest connect flow cleanup** (AC #15)
  - [x] Update `ws.ts` `connectAsGuest` / `onConnect` signature.
  - [x] Update `JoinPage.svelte`, `App.svelte` to drop state.
- [x] **Client — `HostMiniPlayer` Loop button + countdown text removed** (AC #16)
- [x] **Client — `GuestWaitingRoom` countdown UI removed** (AC #17)
- [x] **Client — `RoomPage` cleanup** (ACs #18, #19)
  - [x] Drop `continuousMode` prop to `GameOverView`.
  - [x] Delete `countdownSeconds` state + UI.
  - [x] Delete guest-side `postStartNextRound` usage.
- [x] **Client — `HostRoomPage` Change It Up in-place overlay** (ACs #20, #21, #22)
  - [x] Delete continuous-toggle code paths.
  - [x] Add `isRoundConfigOpen` state + `handleChangeItUp`.
  - [x] Mount `RoundConfigOverlay` conditionally at page level with `onStarted` closing the overlay (no route change).
  - [x] Rename `handleStartNextRound` → `handleLetItRide`.
- [x] **Client — `GameOverView` contract + render logic** (ACs #23, #24, #25)
  - [x] Drop `continuousMode` prop.
  - [x] Render two stacked buttons for host; waiting status for guest.
- [x] **Tests** (ACs #26–#31)
  - [x] Server deletions.
  - [x] GameOverView test updates.
  - [x] gameState test updates.
  - [x] `bun run lint` + `bun test` clean.
- [x] **Story 9-2 amendment** (AC #32)
  - [x] Edit the 9-2 story file to strike the Autoplay row, AC #17/18/19 wiring, and add scope-amendment note.
- [ ] **Manual verification** (Philip — see Dev Notes checklist).

### Review Findings

_Added 2026-04-19 via `bmad-code-review`. Three parallel reviewers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) triaged into patch / defer / dismiss._

- [x] [Review][Patch] `/round/next-round` silent-fail — `startContinuousRound` has four void early-returns (missing host / null fresh token / missing room / null `pendingRound`) and an unchecked `startRound` call; the endpoint returns HTTP 200 regardless [src/server/rooms.ts:444-468, 725-746]. Spec Dev Notes explicitly state "failures surface via the HTTP response", but nothing does. Propagate a `{ ok, message? }` result from `startContinuousRound` and return a 5xx/502 from the route on failure so `HostRoomPage`'s transient error line fires.
- [x] [Review][Patch] Missing `onHostNameMaybeSaved` on the in-place `RoundConfigOverlay` mount (AC #21 partial miss) [src/client/pages/HostRoomPage.svelte:372-378]. Spec mandates the same pattern as `LobbyPage.svelte:193` — write `hostName = name` through.
- [x] [Review][Patch] `onLetItRide` / `onChangeItUp` are typed optional in `GameOverView` but invoked unguarded in the host branch [src/client/components/GameOverView.svelte]. Guard the onclick handlers with `?.()` so a prop-omission can't throw at click time.
- [x] [Review][Patch] `handleChangeItUp` does not clear a stale `nextRoundError` banner [src/client/pages/HostRoomPage.svelte:77-79]. Reset `nextRoundError` and `nextRoundErrorTimer` when opening the overlay so an old "Couldn't start next round" doesn't linger behind the config modal.
- [x] [Review][Patch] Nothing prevents tapping Let It Ride while `RoundConfigOverlay` is open [src/client/pages/HostRoomPage.svelte:372-378 + `<GameOverView>` mount]. Keyboard focus can still land on the Let It Ride button behind the modal, racing a `POST /round` with `POST /round/next-round`. Disable the CTA or `inert` the GameOverView when `isRoundConfigOpen`.
- [x] [Review][Patch] Rehydrate spreads `...snap.currentRound` verbatim, so pre-9-3 persisted snapshots still carry the deleted `winnerName` field [src/server/ws.ts rehydrateRooms]. Orphan field — harmless today but violates the new `RoundState` contract. `delete rehydrated.winnerName` after the spread (or pick explicitly).
- [x] [Review][Patch] Tighten `GameOverView.test.ts` host-CTA tests — currently each button-click test only asserts the matching callback fired; add `expect(otherCallback).not.toHaveBeenCalled()` so a cross-wired handler can't pass CI [src/client/__tests__/GameOverView.test.ts].
- [x] [Review][Defer] `session:connect` wire-protocol change without version bump [src/server/rooms.ts:323-324, 406-407] — deferred, pre-existing deploy practice (no version field exists project-wide).
- [x] [Review][Defer] No integration test for the Change It Up → `RoundConfigOverlay` mount flow (only unit test of the button click) — deferred, manual-verification path per Dev Notes.
- [x] [Review][Defer] Let It Ride 401 has no re-auth prompt path [src/client/pages/HostRoomPage.svelte:81-95] — deferred, pre-existing UX gap across every host endpoint.
- [x] [Review][Defer] Buffered `round:end` during Game Over can yank host to lobby before CTA tap [src/client/pages/HostRoomPage.svelte:~241] — deferred, pre-existing reconnect edge case exposed more by 9-3's deletion of `round:dismissed`.
- [x] [Review][Defer] No `round:end` handler in gameState clears `winData` [src/client/lib/gameState.svelte.ts:150-170] — deferred, winData is client-only state cleared on remount; no concrete symptom identified.
- [x] [Review][Defer] No test for authenticated caller + missing room returning 404 (not 403) on `/round/next-round` [src/server/__tests__/rooms.test.ts] — deferred, ordering invariant nice-to-have.
- [x] [Review][Defer] `RoundConfigOverlay` backdrop dismisses without confirmation [src/client/components/RoundConfigOverlay.svelte] — deferred, pre-existing behavior, exposed more from Game Over.
- [x] [Review][Defer] `pendingRound.roundNumber` fallback for `nextRoundNumber` is the only driver post-9-3 [src/server/rooms.ts:457] — deferred, pre-existing computation, not regressed.

_Dismissed as noise (10): winData clears on `round:start` (handled); `winnerName` broadcast still works (spec-intentional — only server-side capture was for guest-winner auth); staged-deploy `round:dismissed` concerns (coordinated deploy); guest role-prop defensive coupling (server-authoritative); brittle `'winnerName' in round === false` (positive broadcast assertion already covers it); error-surface divergence between `playbackError` banner and `nextRoundError` inline (acceptable UX choice); positional arg-list fragility (pre-existing pattern); `seedRoom` continuousMode init absence (correct per deletion); 8 px stacking gap (reasonable for sibling buttons); `gameState.svelte.test.ts` not existing (vacuous AC #29)._

## Dev Notes

- **Why delete Continuous Mode rather than relocate?** The toggle's only consumer was the Game Over CTA eligibility matrix. Turning the choice into a per-BINGO click removes one piece of state, two broadcasts, one endpoint, one countdown timer, and a guest-callable auth shim. The semantic "I want to keep rocking this playlist" survives as a button press at the exact moment it's relevant; it doesn't need to be a persistent flag.
- **Why `requireAuth` on `/round/next-round` is safe.** Previously the endpoint accepted guest-winner callers authorized by `playerName === round.winnerName`. With the guest CTA deleted, no guest calls this endpoint — putting it behind `requireAuth` both tightens the auth surface and deletes ~15 lines of name-match plumbing. The host session cookie is already checked everywhere else on the host surface.
- **Why `startContinuousRound` survives.** It encodes the "build next-round config from `pendingRound` + increment `roundNumber` + delegate to `startRound`" sequence, and that's still what "Let It Ride" needs. Only the countdown-cancel broadcasts go.
- **Why open `RoundConfigOverlay` in place rather than route back to lobby.** The music is still playing on the host's Spotify device; routing to a different page would unmount the Game Over view (no harm) but also break visual continuity. Keeping the host on `HostRoomPage` with the overlay mounted means the host can dismiss the overlay and tap "Let It Ride" instead without losing context. When the overlay's Start fires, the resulting `round:start` broadcast clears `winData` and the Game Over branch naturally unmounts — same mechanism 9-1 already uses.
- **Music continuity is already there.** The claim handler at [rooms.ts:737-812](src/server/rooms.ts#L737-L812) calls `clearRoundTimers(round)` and `round.active = false` but does NOT issue a Spotify pause. The winning song continues playing on the host's device. This story doesn't need to add any new music-continuity logic — it just needs to avoid adding any new pause calls in the "Let It Ride" or "Change It Up" paths. `startContinuousRound → startRound → startSong(0)` replaces the currently-playing track with the next one; no explicit pause in between is needed.
- **The "host-is-also-the-winner" case collapses cleanly.** `role === 'host'` always wins over winner-eligibility in `GameOverView`. The host always sees the two-button CTA regardless of whether they happen to be the player who won. No double-render.
- **`WinData.winnerCard` and `WinData.winnerName` stay.** They're used for the loser variant's "Their card" view and the winner-variant headline, respectively. Only the server-side `round.winnerName` capture goes (it was only for guest-winner auth on `/round/next-round`).
- **Button style tokens.** The project already has `.btn-primary` (existing `Start Next Round` button uses it). For the secondary "Change It Up" button: check for an existing outline / secondary button style in the codebase (grep `btn-secondary` or similar in [src/client](src/client)); if none exists, add minimal CSS scoped to `GameOverView.svelte` — single `border: 1px solid var(--fg)`-style rule with transparent background, same padding/sizing as primary. Do not introduce a new shared Button variant in this story.
- **Story 9-2 sequencing.** If 9-3 lands first, 9-2 dev picks up an already-simplified codebase (no `continuousMode` state to work around in `HostControlsOverlay`). If 9-2 somehow lands first (it's ready-for-dev with Autoplay in scope), 9-3 has to undo it. Recommend 9-3 lands first — edit 9-2's story file now (AC #32) so the Autoplay scope is removed before 9-2 dev begins.
- **Dead code to also watch for.** After this story: `WinOverlay.svelte` is still unreferenced from any page (per 9-1 Dev Notes). Not in scope to delete the component itself, but any lingering imports anywhere should already be dead — run a grep and delete any. Similarly, the `GuestWaitingRoom` `countdownSeconds` prop removal should ripple cleanly through its callers (`RoomPage` is the only one).
- **TypeScript safety net.** After deleting `RoundState.winnerName`, `RoomState.continuousMode`, `RoomState.continuousCountdown`, and the guest-connect fields, `bun run lint` will surface every remaining reference. Use that as the cleanup checklist — if tsc is clean, no dead references remain.

### Key Anti-Patterns to Avoid

- **Don't route `onChangeItUp` back to the lobby.** The whole point is that music + Game Over stay visible underneath a modal.
- **Don't pause Spotify in `onLetItRide` or `onChangeItUp` paths.** The claim handler already stops the round timers; adding a pause call would introduce the "silent Game Over" behavior the user explicitly does not want.
- **Don't try to detect "host is the winner" and render a third CTA variant.** Host always sees the two buttons. Winner-detection drives only the winner-variant headline + own-card view on the guest side.
- **Don't add a CSRF / origin check to `/round/next-round` to compensate for the guest path going away.** The endpoint is now `requireAuth` like every other host endpoint; the project-wide auth model is consistent.
- **Don't leave `WinOverlay.svelte` imports lingering.** Any file that still imports `WinOverlay` is dead code from 9-1; grep after finishing.
- **Don't persist the new `isRoundConfigOpen` state.** It's per-session client state — a reconnect should NOT re-open the overlay. If the host reconnects mid-Change-It-Up, they arrive back on Game Over and can re-tap. (Reconnect-replays-round:win is still the pre-existing limitation per 9-1 Dev Notes.)

### Manual Verification Checklist (Philip)

- Host + two guests (Alice, Bob). Complete a round. Host taps **Let It Ride**: next round starts with the same config; music either continues (if the prior song is still playing) or picks up with the next round's first track; Game Over branch unmounts; active-round UI returns.
- Same setup. Host taps **Change It Up**: `RoundConfigOverlay` opens on top of the Game Over page; music keeps playing; winner's card + history are visible underneath.
- In the Change It Up overlay: host changes the playlist; taps Start. Next round starts with the new playlist. Host lands on active-round UI (not lobby).
- Alternative path: host taps **Change It Up**, then closes the overlay without starting. Game Over page is still there; "Let It Ride" button still works.
- Guest view (Alice is winner, Bob is loser): both Alice and Bob see only the "Waiting for the host to start the next round." status line. No "Start Next Round" button visible on either.
- The host-is-also-the-winner case: host still sees only the two buttons, no duplicate.
- `HostMiniPlayer` no longer shows the `∞ Loop` button or the "Next game starts in Xs" countdown text.
- `GuestWaitingRoom` no longer shows "Next game starts in Xs" copy.
- Mobile viewport (iPhone Safari or 375px-wide emulator): two stacked buttons fit without horizontal scroll; tap targets ≥ 44×44.
- A network failure on "Let It Ride" (kill network for 3s right after the tap): transient error line "Couldn't start next round — try again." appears; retry after network returns works.
- `bun test` green. `bun run lint` clean. `bun run build:client` clean.
- Two-device Tailscale run reproduces both the Let It Ride and Change It Up paths end-to-end at least once.

### Project Structure Notes

Files touched:

**Server:**
- `src/server/rooms.ts` — delete `/continuous-mode` + `/round/dismiss-win` endpoints; delete `CONTINUOUS_COUNTDOWN_MS`; delete `session:connect` reply continuous fields; delete countdown clear in round lifecycle; strip `startContinuousRound` broadcasts; rewrite `/round/next-round` to `requireAuth` + host-only; delete `round.winnerName` capture.
- `src/server/ws.ts` — delete `RoomState.continuousMode`, `RoomState.continuousCountdown`, `RoundState.winnerName`; delete persistence line for `winnerName`.
- `src/server/__tests__/rooms.test.ts` — delete `/continuous-mode` + `/dismiss-win` describe blocks; update `/round/next-round` cases; update claim tests to drop `winnerName` assertion.

**Client:**
- `src/client/lib/gameState.svelte.ts` — delete `continuousMode`, `countdownEndsAt` state + getters/setters + constructor params; delete 4 WS handlers.
- `src/client/lib/api.ts` — delete `postContinuousMode`, `postDismissWin`; simplify `postStartNextRound` signature.
- `src/client/lib/ws.ts` — delete `continuousMode` + `countdownRemainingMs` from `connectAsGuest` / `onConnect` signature.
- `src/client/App.svelte` — delete `guestContinuousMode`, `guestCountdownRemainingMs` state + prop passes.
- `src/client/pages/JoinPage.svelte` — update `onConnect` signature + `onJoined` pass-through.
- `src/client/pages/RoomPage.svelte` — delete `countdownSeconds` state + UI; delete `continuousMode` prop to `GameOverView`; delete guest-winner fetch helper.
- `src/client/pages/HostRoomPage.svelte` — delete continuous toggle function + error state + countdown effect + WS handlers; add `isRoundConfigOpen` state + `handleChangeItUp`; mount `RoundConfigOverlay` conditionally; rename `handleStartNextRound` → `handleLetItRide`; delete `HostMiniPlayer` continuous props; delete `GameOverView` continuous prop; import `RoundConfigOverlay`.
- `src/client/components/GameOverView.svelte` — drop `continuousMode` prop; replace CTA matrix with two-button host view + single guest status line; rename callbacks to `onLetItRide` / `onChangeItUp`.
- `src/client/components/HostMiniPlayer.svelte` — delete `∞ Loop` button block + `.continuous-btn` CSS + `countdownSeconds` UI; delete 3 props.
- `src/client/components/GuestWaitingRoom.svelte` — delete `countdownSeconds` prop + UI + CSS.
- `src/client/__tests__/GameOverView.test.ts` — rewrite CTA matrix cases → host-two-buttons + guest-waiting-line cases; drop `continuousMode` fixture.
- `src/client/__tests__/gameState.svelte.test.ts` — delete continuous-mode / countdown / dismissed handler tests.

**Story docs:**
- `_bmad-output/implementation-artifacts/9-2-live-round-settings-and-pre-round-simplification.md` — scope-amendment edit (AC #32).

### References

- Approved plan: [_Users_Philip_.claude_plans_following-on-story-linked-glacier.md](/Users/Philip/.claude/plans/following-on-story-linked-glacier.md) (party-mode discussion + clarifying-question decisions)
- Epic 9 intro: [_bmad-output/planning-artifacts/epics.md:1467-1478](_bmad-output/planning-artifacts/epics.md#L1467-L1478)
- Story 9-1 (superseded CTA matrix, auto-bingo, Game Over page mode): [_bmad-output/implementation-artifacts/9-1-game-over-page-state-and-auto-bingo.md](_bmad-output/implementation-artifacts/9-1-game-over-page-state-and-auto-bingo.md)
- Story 9-2 (scope-amended by this story — drop Autoplay row): [_bmad-output/implementation-artifacts/9-2-live-round-settings-and-pre-round-simplification.md](_bmad-output/implementation-artifacts/9-2-live-round-settings-and-pre-round-simplification.md)
- Story 8-3 (Continuous Mode origin — being deleted): [_bmad-output/implementation-artifacts/8-3-continuous-mode.md](_bmad-output/implementation-artifacts/8-3-continuous-mode.md)
- `/round/next-round` endpoint + guest-winner auth (now simplified): [rooms.ts:821-861](src/server/rooms.ts#L821-L861)
- `startContinuousRound` helper (surviving, stripped): [rooms.ts:445-487](src/server/rooms.ts#L445-L487)
- `RoundConfigOverlay` usage pattern in `LobbyPage` (mirror for HostRoomPage in-place mount): [LobbyPage.svelte:183-195](src/client/pages/LobbyPage.svelte#L183-L195)
- `GameOverView` CTA matrix (being simplified): [GameOverView.svelte:63-145](src/client/components/GameOverView.svelte#L63-L145)
- `HostMiniPlayer` Loop button (being deleted): [HostMiniPlayer.svelte:46-60](src/client/components/HostMiniPlayer.svelte#L46-L60)

## Open Questions

_All resolved via clarifying-question answers during planning (see plan file). No open items._

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `npx vitest run` — 382 tests pass (server + client).
- `npx tsc --noEmit` — clean.
- `npx svelte-check` — 8 errors remain; all pre-existing and verified baseline-equivalent via `git stash` comparison (Spotify namespace types, `VinylWithTonearm` declaration, `BingoCard.test.ts` `Set<unknown>`, `JoinPage` `MessageEvent`). No new diagnostics introduced by this story.

### Completion Notes List

- Deleted Continuous Mode in full: `/continuous-mode` + `/round/dismiss-win` endpoints, `RoomState.continuousMode`, `RoomState.continuousCountdown`, `RoundState.winnerName`, `CONTINUOUS_COUNTDOWN_MS`, the 10s countdown timer, and WS events `continuous-mode:changed` / `continuous:countdown-start` / `continuous:countdown-cancel` / `round:dismissed`.
- `/round/next-round` collapsed to `requireAuth` + host-only: guest-winner auth branch (`playerName === round.winnerName`) removed; `startContinuousRound` stripped of cancel-broadcast paths.
- `GameOverView` CTA matrix replaced with two stacked host buttons (Let It Ride / Change It Up) + single guest waiting-status line; `continuousMode` / `isWinner`-drives-CTA branching removed.
- `HostRoomPage` mounts `RoundConfigOverlay` in place on Change It Up tap (no route change); `onStarted` closes the overlay and the `round:start` broadcast naturally unmounts the Game Over branch. `handleStartNextRound` → `handleLetItRide`.
- Guest-side plumbing cleaned: `connectAsGuest` / `onConnect` signature, `App.svelte` state, `RoomPage.svelte` props, `JoinPage.svelte` pass-throughs all dropped `continuousMode` + `countdownRemainingMs`. `GuestWaitingRoom` and `HostMiniPlayer` both lost their countdown / Loop UI blocks + CSS.
- `gameState.svelte.ts` dropped `initialContinuousMode` + `initialCountdownRemainingMs` constructor params, `continuousMode` + `countdownEndsAt` state, getters/setters, and the 4 WS handlers.
- Server tests: rewrote `describe('POST /api/rooms/:code/round/next-round', …)` to cover 401-no-session / 404 / 403-not-host / 503 / 409-no-ended-round / 409-no-pending-config / 200-host-session; dropped guest-winner success + three guest-403 cases; `seedEndedRound` no longer takes `winnerName`. Claim-path test asserts `'winnerName' in round === false`.
- Client tests: `GameOverView.test.ts` rewritten for new prop contract (host sees both buttons and they invoke callbacks; guest sees waiting-line only; `nextRoundError` renders). `join.test.ts` `onConnect` call assertions updated to drop the two removed trailing args.
- 9-2 story amended per AC #32: scope-amendment note added at top; "What this story does" bullet updated to four fields; AC #11 `continuousMode?` prop, AC #12 row 5, AC #14 `/continuous-mode` fallback, AC #16 tooltip copy, AC #18, and AC #19 all struck through with inline notes pointing to 9-3.

### File List

**Server**
- `src/server/rooms.ts`
- `src/server/ws.ts`
- `src/server/__tests__/rooms.test.ts`

**Client**
- `src/client/App.svelte`
- `src/client/lib/api.ts`
- `src/client/lib/gameState.svelte.ts`
- `src/client/lib/ws.ts`
- `src/client/pages/JoinPage.svelte`
- `src/client/pages/RoomPage.svelte`
- `src/client/pages/HostRoomPage.svelte`
- `src/client/components/GameOverView.svelte`
- `src/client/components/GuestWaitingRoom.svelte`
- `src/client/components/HostMiniPlayer.svelte`
- `src/client/__tests__/GameOverView.test.ts`
- `src/client/__tests__/join.test.ts`

**Docs**
- `_bmad-output/implementation-artifacts/9-2-live-round-settings-and-pre-round-simplification.md` (scope-amendment edit)
- `_bmad-output/implementation-artifacts/9-3-collapse-continuous-mode-to-gameover-choice.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

| Date       | Change                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| 2026-04-19 | Story 9-3 drafted — collapse Continuous Mode to Game Over choice; supersedes 9-1 CTA matrix. |
| 2026-04-19 | Story 9-3 implemented — Continuous Mode deleted; Game Over host CTA rewired to Let It Ride + Change It Up; 9-2 scope amended. |
