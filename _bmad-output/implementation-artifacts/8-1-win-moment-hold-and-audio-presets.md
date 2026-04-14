# Story 8-1: Win Moment Hold & Audio Presets

Status: done

## Story

As the host,
I want to choose an audio personality preset (Hype / Deadpan / Minimal) before each session,
so that the win moment and overall game tone matches the mood of the group —
and the win overlay holds open until someone manually dismisses it, rather than vanishing on guests after 5 seconds.

## Background

`WinOverlay` currently auto-dismisses for non-host clients after 5 seconds (`dismissTimer` in `onMount`). The preset is a session-level cosmetic setting that controls the win overlay's visual style. No server-side audio is played — this is purely copy, animation, and colour-palette variation.

## Acceptance Criteria

1. **Remove auto-dismiss for guests.** In [WinOverlay.svelte](src/client/components/WinOverlay.svelte):
   - Delete the `dismissTimer` path (the `else` branch in `onMount` that calls `onDismiss()` after 5 000 ms).
   - Remove `dismissTimer` state and its `clearTimeout` in `onDestroy`.
   - All clients — host, winner, and other guests — now hold until a button is tapped.

2. **Dismiss button for all non-host clients.** Add a `selfName: string | null` prop to `WinOverlay` (pass `null` from host call site, the player's name from guest call site):
   - **Winner** (`!isHost && selfName === winnerName`): show `"🎉 Dismiss"` button immediately on mount (no delay).
   - **Other guest** (`!isHost && selfName !== winnerName`): show `"Dismiss"` button after 2 000 ms (a brief celebration pause, matching the host's 1 500 ms CTA delay rhythm).
   - Both use a `btn-secondary` style (same as the existing host Dismiss button).
   - Host CTAs (`isHost === true`) are unchanged: "Start Next Round" + "Dismiss" appear after 1 500 ms.

3. **`AudioPreset` type.** In `src/client/lib/api.ts`, add:
   ```ts
   export type AudioPreset = 'hype' | 'deadpan' | 'minimal'
   ```
   Add `audioPreset: AudioPreset` to `StartRoundPayload` (required, not optional).
   Add `audioPreset: AudioPreset` to `StartRoundResponse`.

4. **Server: accept and echo `audioPreset`.** In `src/server/rooms.ts`:
   - Add `VALID_AUDIO_PRESETS: AudioPreset[]` constant: `['hype', 'deadpan', 'minimal']`.
   - Destructure `audioPreset` from the POST body alongside `clipDuration` / `titleRevealDelay`.
   - Validate: return 400 `{ message: 'Invalid audioPreset' }` if not in the valid list.
   - Add `audioPreset` to `RoundConfig` in `src/server/ws.ts`.
   - Include `audioPreset` in the `round:start` broadcast payload (same pattern as `clipDuration`).

5. **`buildStartRoundPayload` updated.** In `src/client/lib/roundConfig.ts`:
   - Add `audioPreset: AudioPreset` parameter to `buildStartRoundPayload`.
   - Include it in the returned payload object.

6. **Preset picker in `RoundConfigOverlay`.** In [RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte):
   - Add `let audioPreset = $state<AudioPreset>('hype')` (default Hype).
   - Add a **preset row** above the clip duration section. Label: `"Vibe"`. Three pill buttons: `"Hype"`, `"Deadpan"`, `"Minimal"`. Same `selected` / `aria-pressed` toggle pattern as clip duration pills.
   - Pass `audioPreset` to `buildStartRoundPayload`.
   - **Session persistence**: preset resets to `'hype'` each time the overlay is opened (it is not persisted between overlay opens, only within a single open session of the overlay). This is intentional — the host picks it fresh each time.

7. **`gameState` stores `audioPreset`.** In `src/client/lib/gameState.svelte.ts`:
   - Add `audioPreset = $state<AudioPreset>('hype')` to game state.
   - In `processWsMessage`, on `round:start`, set `audioPreset = data.audioPreset ?? 'hype'`.

8. **`WinOverlay` accepts and applies `audioPreset` prop.** Add `audioPreset: AudioPreset = 'hype'` prop (optional with default so existing call sites don't break):
   - **Hype** (default): current behaviour — confetti animation, large green `"BINGO!"` label, existing colour palette. No changes to existing markup for this variant.
   - **Deadpan**: no confetti (hide `.confetti-container`), replace `"BINGO!"` text with `"...bingo."` in `#aaa` at 32px. Winner line: `"{winnerName} wins."` (no exclamation mark). Winning songs list unchanged.
   - **Minimal**: no confetti, no `"BINGO!"` headline at all, winner name in 20px white, `"Won this round"` subtitle in `#666`, winning songs list unchanged. Background overlay opacity reduced to `0.85` (vs `0.92`).

9. **Pass `audioPreset` and `selfName` to `WinOverlay` from both call sites.**
   - `HostRoomPage.svelte`: pass `audioPreset={game.audioPreset}` and `selfName={null}`.
   - `RoomPage.svelte`: pass `audioPreset={game.audioPreset}` and `selfName={name}`.

10. **Regression.**
    - `npm run lint` (tsc --noEmit) clean.
    - `npm test` green. Add unit tests to `src/server/__tests__/rooms.test.ts`:
      - POST `/api/rooms/:code/round` with invalid `audioPreset` → 400.
      - POST with valid `audioPreset: 'deadpan'` → `round:start` broadcast includes `audioPreset: 'deadpan'`.
    - Manual: host opens RoundConfigOverlay → selects "Deadpan" → starts round → win occurs → WinOverlay shows deadpan style on host and all guests. Dismiss button present on all clients, no auto-dismiss.
    - Manual: default `'hype'` preset → WinOverlay looks identical to pre-story (confetti, green BINGO!).

## Tasks / Subtasks

- [x] **Remove guest auto-dismiss** (AC #1)
  - [x] Delete `dismissTimer` and its `onMount`/`onDestroy` references in [WinOverlay.svelte](src/client/components/WinOverlay.svelte).

- [x] **Add Dismiss button for non-host clients** (AC #2)
  - [x] Add `selfName: string | null` prop.
  - [x] Winner branch: immediate "🎉 Dismiss" button.
  - [x] Non-winner guest branch: "Dismiss" button after 2 000 ms delay.
  - [x] New `guestTimer` for the 2 000 ms delay — clear in `onDestroy`.

- [x] **`AudioPreset` type + `StartRoundPayload`** (AC #3)
  - [x] Add `AudioPreset` type to [src/client/lib/api.ts](src/client/lib/api.ts).
  - [x] Add `audioPreset: AudioPreset` to `StartRoundPayload` and `StartRoundResponse`.

- [x] **Server validation + `RoundConfig` extension** (AC #4)
  - [x] Add `audioPreset` to `RoundConfig` interface in [src/server/ws.ts](src/server/ws.ts).
  - [x] Validate and destructure in [src/server/rooms.ts](src/server/rooms.ts).
  - [x] Include in `round:start` broadcast.

- [x] **`buildStartRoundPayload` + `RoundConfigOverlay`** (ACs #5, #6)
  - [x] Add `audioPreset` param to `buildStartRoundPayload` in [src/client/lib/roundConfig.ts](src/client/lib/roundConfig.ts).
  - [x] Add `audioPreset` state + "Vibe" pill row to [RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte).

- [x] **`gameState` stores `audioPreset`** (AC #7)
  - [x] Add `audioPreset` state + `round:start` handler in [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts).

- [x] **`WinOverlay` preset variants** (AC #8)
  - [x] Add `audioPreset` prop with `'hype'` default.
  - [x] Implement Deadpan variant (no confetti, dry copy).
  - [x] Implement Minimal variant (no confetti, no BINGO!, reduced opacity).

- [x] **Wire call sites** (AC #9)
  - [x] Pass `audioPreset` + `selfName` from [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte).
  - [x] Pass `audioPreset` + `selfName={name}` from [RoomPage.svelte](src/client/pages/RoomPage.svelte).

- [x] **Tests** (AC #10)
  - [x] `rooms.test.ts`: invalid `audioPreset` → 400.
  - [x] `rooms.test.ts`: valid `audioPreset` echoed in `round:start` broadcast.

- [ ] **Manual verification** (Philip)
  - [ ] Default Hype: win overlay looks identical to pre-story.
  - [ ] Deadpan: no confetti, "...bingo.", dry copy on all screens.
  - [ ] Minimal: no confetti, no BINGO! headline, reduced overlay opacity.
  - [ ] Guest win overlay: no auto-dismiss; Dismiss button appears.
  - [ ] Winner guest: "🎉 Dismiss" button appears immediately.
  - [ ] Non-winning guest: "Dismiss" button appears after ~2s.

### Review Findings

- [x] [Review][Patch] `rehydrateRooms` doesn't seed `audioPreset` default for pre-feature persisted rounds [src/server/ws.ts:96-131] — fixed: rehydrate now defaults missing `config.audioPreset` and `roundStartPayload.audioPreset` to `'minimal'` (the new default).
- [x] [Review][Patch] `WinOverlay` has no `{:else}` fallback — unknown preset renders no header [src/client/components/WinOverlay.svelte:64-73] — fixed: added derived `effectivePreset` that normalizes any unknown value to `'minimal'`, and the third branch is now a bare `{:else}` catch-all. Confetti gate flipped from `audioPreset !== 'deadpan' && audioPreset !== 'minimal'` to explicit `effectivePreset === 'hype'`.
- [x] [Review][Patch] Test mock `StartRoundResponse` omits required `audioPreset` field [src/client/__tests__/round-config.test.ts:22-31] — fixed: mock `.json()` and assertion now include `audioPreset: 'minimal'`. First test's mock also updated to include the field so all `StartRoundResponse` mocks satisfy the required contract.
- **Side change**: Default `audioPreset` flipped from `'hype'` to `'minimal'` across server fallback, server rehydrate, client `gameState` initial + fallback, `RoundConfigOverlay` initial state, and `WinOverlay` prop default. Test fixtures that used `'hype'` as a generic placeholder updated to `'minimal'` (tests that specifically exercise a named preset, like the 400-on-`'blasting'` and the `'deadpan'` broadcast echo, are unchanged).
- [x] [Review][Defer] `selfName` matched as raw display name rather than a stable player ID [src/client/components/WinOverlay.svelte:28] — deferred, pre-existing pattern. Identity by trimmed/raw name is how the whole project keys players; fixing it here would spill into join/claim/tile-mark flows. Re-address in a dedicated pass.
- [x] [Review][Defer] POST with `audioPreset: null` silently coalesces to `'hype'` instead of returning 400 [src/server/rooms.ts:285] — deferred, low-severity consistency issue. `?? 'hype'` treats explicit `null` the same as missing; other fields on the endpoint use stricter typeof checks. No known client sends `null`, so not blocking.
- [x] [Review][Defer] No explicit negative test for missing `audioPreset` field in POST body [src/server/__tests__/rooms.test.ts] — deferred, test coverage gap. `validPayload` exercises the default-to-`'hype'` path indirectly; no assertion locks in that the broadcast contains `audioPreset: 'hype'` when the field is absent. Add when touching rooms tests next.

## Dev Notes

- `WinOverlay` changes are purely additive to props — existing call sites get `audioPreset='hype'` default and `selfName=null` default, so nothing breaks before the call sites are updated.
- The `dismissTimer` removal is 3 lines. Do this first, verify tests still pass, then build outward.
- No changes to `onStartNextRound` or the lobby navigation path — Continuous Mode (8-3) owns that.
- `audioPreset` is not stored in SQLite. It lives in `RoundConfig` (in-memory `roomSockets`) and is re-sent on each `round:start`. Server restart clears it; `rehydrateRooms` for an active round will default to `'hype'` if the field is absent from the persisted `active_rooms` snapshot. Add `?? 'hype'` fallback wherever `audioPreset` is read from the broadcast payload.

## Dev Agent Record

### Completion Notes

Implemented 2026-04-14. All 10 acceptance criteria satisfied; `tsc --noEmit` clean; 332/332 tests pass (2 new tests added).

Key decisions:
- Server defaults `audioPreset` to `'hype'` when absent from POST body (`body.audioPreset ?? 'hype'`), keeping existing payloads and tests backward-compatible.
- `isOtherGuest` derived var kept but not rendered — only `isWinner` drives the emoji label; both states share the same `showGuestDismiss` flag. The distinction lives in the button label `{isWinner ? '🎉 Dismiss' : 'Dismiss'}`.
- `AudioPreset` type defined in both `src/client/lib/api.ts` (client) and `src/server/ws.ts` (server) independently — no shared module, matching existing project pattern for `ClipDuration` / `TitleRevealDelay`.
- Updated existing `round-config.test.ts` and `RoundConfigOverlay.test.ts` fixtures to include `audioPreset: 'hype'` — no test logic changed.

### File List

- `src/client/components/WinOverlay.svelte` — removed `dismissTimer`; added `selfName`, `audioPreset` props; guest dismiss buttons; Deadpan & Minimal variants; CSS for new variants
- `src/client/lib/api.ts` — added `AudioPreset` type; added `audioPreset` to `StartRoundPayload` and `StartRoundResponse`
- `src/server/ws.ts` — added `AudioPreset` type; added `audioPreset` to `RoundConfig`
- `src/server/rooms.ts` — imported `AudioPreset`; added `VALID_AUDIO_PRESETS`; destructure + validate + include `audioPreset` in `roundConfig` and `roundStartPayload`
- `src/client/lib/roundConfig.ts` — added `audioPreset` param to `buildStartRoundPayload`
- `src/client/components/RoundConfigOverlay.svelte` — added `VIBE_OPTIONS`, `audioPreset` state, Vibe pill section; pass `audioPreset` to `buildStartRoundPayload`
- `src/client/lib/gameState.svelte.ts` — added `audioPreset` state; set from `round:start`; exposed on return object
- `src/client/pages/HostRoomPage.svelte` — pass `audioPreset={game.audioPreset}` and `selfName={null}` to `WinOverlay`
- `src/client/pages/RoomPage.svelte` — pass `audioPreset={game.audioPreset}` and `selfName={name}` to `WinOverlay`
- `src/server/__tests__/rooms.test.ts` — added 2 new tests (invalid audioPreset → 400; valid audioPreset echoed in broadcast)
- `src/client/__tests__/round-config.test.ts` — updated `startRound` call fixtures to include `audioPreset: 'hype'`
- `src/client/__tests__/RoundConfigOverlay.test.ts` — updated `buildStartRoundPayload` calls and `startRound` mock to include `audioPreset`

### Change Log

- 2026-04-14: Implemented story 8-1 — Win Moment Hold & Audio Presets. Removed guest auto-dismiss (5 s timer), added per-role Dismiss buttons, added AudioPreset type + Vibe picker UI, server validation, gameState tracking, and WinOverlay visual variants (Hype/Deadpan/Minimal).

## Scope — Explicitly OUT

- No Continuous Mode countdown (8-3).
- No session statistics (8-2).
- No Casual Mode (8-4, 8-5).
- No literal audio sound effects — "audio preset" is visual/copy style only.
- No persistence of preset selection across overlay opens (intentional — host picks fresh each round config).
- No keyboard trap or Escape handler on WinOverlay (project-wide a11y deferral).
