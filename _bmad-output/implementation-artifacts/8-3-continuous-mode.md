# Story 8.3: Continuous Mode

Status: done

## Story

As a host,
I want to toggle Continuous Mode to keep games rolling back-to-back on the same playlist without reshuffling,
so that the party doesn't stall between rounds.

## Background

Today the room flow hard-stops between rounds: after a win ([rooms.ts:520-594](src/server/rooms.ts#L520-L594) `/round/claim`) the server broadcasts `round:win`, the host's `WinOverlay` CTA "Start Next Round" fires `onRoundEnded` → [App.svelte:69-75](src/client/App.svelte#L69-L75) `handleRoundEnded` → back to lobby to reconfigure. Continuous Mode short-circuits that detour: when enabled, dismissing the win overlay triggers a 10-second countdown and the server auto-starts a new round reusing the just-ended round's config — no lobby trip, no reshuffling Spotify, host stays on [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) the whole time.

**State shape:** Continuous Mode is in-memory on `RoomState` (not persisted to SQLite; not rehydrated). Session stats (Story 8-2) set the precedent.

**Dismiss semantics:** the overlay's "Dismiss" in Story 8-1 is a purely client-side `winData = null`. This story introduces a server-authoritative host-dismiss: host's click fires `POST /round/dismiss-win`, the server broadcasts `round:dismissed` (clears every client's overlay), and — if Continuous Mode is on — kicks off the countdown. Guest/winner dismiss in `WinOverlay` stays local-only.

**Round regeneration:** `roomState.pendingRound` already holds the last started `RoundConfig` and is **not** cleared by `/round/claim` (only `deleteActiveRoom` clears the DB snapshot). That's the record we replay. The round creation path in [rooms.ts:273-400](src/server/rooms.ts#L273-L400) must be refactored so the core "fetch playlist → build pool → generate cards → broadcast round:start → persist" steps can be invoked both from the HTTP handler and from the continuous auto-start timer.

**Cross-round variety:** `buildPool` already excludes / down-ranks `sessionPlayedIds`. Auto-started rounds must pass the accumulated `sessionPlayedIds` from the previous round. Important: `roomState.currentRound` is still in memory at dismiss time (with `active: false`, `ended: true`), so `sessionPlayedIds` is reachable.

## Acceptance Criteria

1. **Server `continuousMode` state.** In [src/server/ws.ts](src/server/ws.ts):
   - Add required boolean field `continuousMode: boolean` to `RoomState`.
   - Initialize `false` at every `roomSockets.set(code, { ... })` call site (host WS connect path around [ws.ts:277](src/server/ws.ts#L277), guest WS connect path around [ws.ts:334](src/server/ws.ts#L334), and `rehydrateRooms` around [ws.ts:127-149](src/server/ws.ts#L127-L149)).
   - Also add optional field `continuousCountdown?: { timer: ReturnType<typeof setTimeout>; endsAt: number }` — populated only while a countdown is active. Clear to `undefined` when cancelled or completed.
   - Continuous state is NOT persisted (`persistRoomState` does not write it; `rehydrateRooms` defaults `continuousMode` to `false`, never has an active countdown after restart). Add a one-line comment near the field explaining this.

2. **`POST /api/rooms/:code/continuous-mode` endpoint.** In [src/server/rooms.ts](src/server/rooms.ts):
   - `requireAuth`, 404 on unknown room, 403 on wrong host (same guards as `/round/end`).
   - Body: `{ enabled: boolean }`. Reject with 400 `{ message: 'Invalid continuousMode' }` if not a boolean.
   - Set `roomState.continuousMode = enabled`.
   - Broadcast `{ type: 'continuous-mode:changed', enabled }` to all clients.
   - **Side effect: cancel an in-flight countdown when disabling.** If `enabled === false` AND `roomState.continuousCountdown` is defined: `clearTimeout(roomState.continuousCountdown.timer)`, unset the field, broadcast `{ type: 'continuous:countdown-cancel' }`.
   - Return 200 `{}`.
   - If `roomState` is missing (no live WS session) return 503 `{ message: 'Room session not active' }` (same pattern as `/sdk/device` at [rooms.ts:473-489](src/server/rooms.ts#L473-L489)).

3. **`POST /api/rooms/:code/round/dismiss-win` endpoint.** In [src/server/rooms.ts](src/server/rooms.ts):
   - `requireAuth`, 404 / 403 as usual.
   - 503 if no live roomState. 409 `{ message: 'No winning round to dismiss' }` if `roomState.currentRound` is missing OR `roomState.currentRound.ended !== true` (dismiss is only valid after a `/round/claim` fired).
   - Broadcast `{ type: 'round:dismissed' }`. Every client handles this by clearing their `winData`.
   - **If `roomState.continuousMode === true` AND `roomState.pendingRound` exists:**
     - Compute `endsAt = Date.now() + 10_000`.
     - Broadcast `{ type: 'continuous:countdown-start', durationMs: 10_000, endsAt }`.
     - Schedule `setTimeout(() => startContinuousRound(code, roomState).catch(err => console.error('[continuous]', err)), 10_000)` and store `{ timer, endsAt }` on `roomState.continuousCountdown`.
     - Guard against double-start: if `roomState.continuousCountdown` already exists, reuse it — do NOT schedule a second timer. (Clicking Dismiss twice is a no-op.)
   - Return 200 `{}`.

4. **Refactor round creation into a reusable helper.** In [src/server/rooms.ts](src/server/rooms.ts), extract the post-validation body of the `POST /rooms/:code/round` handler into:
   ```ts
   async function startRound(
     code: string,
     roomState: RoomState,
     room: Room,
     host: HostRow,           // already-fresh-token host
     config: RoundConfig,     // playlistId, clipDuration, titleRevealDelay, roundNumber, audioPreset
   ): Promise<{ ok: true } | { ok: false; status: number; message: string }>
   ```
   The helper:
   - Fetches + shuffles playlist via `getPlaylistTracks(config.playlistId, host.access_token)`; maps `InsufficientTracksError` → `{ ok: false, status: 422, message }`, `SpotifyApiError` → `{ ok: false, status: 502, ... }`.
   - Builds pool with `sessionPlayedIds` from the previous round (`roomState.currentRound?.sessionPlayedIds ?? []`) + historic `getPlayedSongs(code)`.
   - Generates cards for `[host.user_id, ...roomState.guests.keys()]`.
   - Builds `roundStartPayload` (same shape as today — includes `audioPreset`).
   - Writes `roomState.currentRound` (active, currentSongIndex: -1, songHistory: [], timers: {}, paused: false, `sessionPlayedIds` = accumulated), sets `roomState.pendingRound = config`.
   - Broadcasts round:start to host + every open guest with their card (same loop as today at [rooms.ts:382-391](src/server/rooms.ts#L382-L391)).
   - `persistRoomState(code)` and `recordPlayedSongs(code, dealtTrackIds)`.
   - Returns `{ ok: true }`.
   - The existing `POST /rooms/:code/round` handler is rewritten to validate, do the `withFreshToken` dance, compute the next `roundNumber`, build `roundConfig`, then delegate to `startRound(...)`, mapping `ok: false` results back to `ctx.json(message, status)`.
   - **Behavioural parity is required:** no test currently touching `POST /rooms/:code/round` may break. Run `npm test` and fix regressions before moving on.

5. **`startContinuousRound(code, roomState)` auto-start path.** New internal helper, callable from the countdown timer:
   - Clear `roomState.continuousCountdown` before doing work.
   - `const host = getHostById(roomState.hostUserId)` → if null, broadcast `{ type: 'continuous:countdown-cancel', reason: 'host-missing' }` and bail.
   - `const freshHost = await withFreshToken(host)` → if null (token dead), broadcast `continuous:countdown-cancel` with `reason: 'auth-degraded'` and bail. (The existing `auth:degraded` path will surface the red banner separately — do not duplicate.)
   - `const room = getRoomByCode(code)` → if null (session deleted mid-countdown), bail silently (the session:end broadcast is handled elsewhere).
   - Build a new `RoundConfig` with `roundNumber = (roomState.currentRound?.roundNumber ?? roomState.pendingRound?.roundNumber ?? 0) + 1` and all other fields copied from `roomState.pendingRound` (playlistId, clipDuration, titleRevealDelay, audioPreset).
   - Call `startRound(code, roomState, room, freshHost, config)`. On `ok: false`, broadcast `continuous:countdown-cancel` with the error `message` as `reason` (client displays a toast; see AC #12).
   - Do NOT wrap `startRound` in a try/catch that swallows errors — let unexpected exceptions surface in the `.catch()` in AC #3's `setTimeout` wrapper.

6. **Session-connect includes continuous state for late joiners.** In [ws.ts:292-299](src/server/ws.ts#L292-L299) and [ws.ts:348-355](src/server/ws.ts#L348-L355):
   - Append to both host- and guest-path `session:connect` payloads:
     - `continuousMode: roomState.continuousMode`
     - `countdownRemainingMs: roomState.continuousCountdown ? Math.max(0, roomState.continuousCountdown.endsAt - Date.now()) : null`
   - A client joining mid-countdown renders the countdown immediately; the remaining ms is authoritative (no clock-skew negotiation).

7. **Client `gameState` tracks continuous state + countdown.** In [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts):
   - Add `let continuousMode = $state(false)` and `let countdownEndsAt = $state<number | null>(null)` (null = not counting; number = `Date.now() + remainingMs` captured when start/seed arrives).
   - `processWsMessage` handlers:
     - `continuous-mode:changed` → `continuousMode = data.enabled as boolean`
     - `continuous:countdown-start` → `countdownEndsAt = Date.now() + (data.durationMs as number)`
     - `continuous:countdown-cancel` → `countdownEndsAt = null`
     - `round:dismissed` → `winData = null` (do NOT touch `countdownEndsAt` here — the countdown-start broadcast fires separately in AC #3)
     - `round:start` → **add** `countdownEndsAt = null` to the existing branch (auto-started rounds must clear the countdown UI; also a safety net if the cancel broadcast was dropped).
   - Expose `get continuousMode() / set continuousMode(v)` (setter used by host session:connect seed path) and `get countdownEndsAt() / set countdownEndsAt(v)`.
   - `createGameState` params: add optional `initialContinuousMode?: boolean` (default `false`). Not plumbing into guest path beyond `session:connect` handler — the guest's initial snapshot comes via `RoomPage` props in the same way `initialWinsByName` flows; see AC #9.

8. **Host dismiss wires through to server.** In [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) `WinOverlay` usage (around line 230-239):
   - Change `onDismiss={() => { game.winData = null }}` to:
     ```ts
     onDismiss={() => {
       game.winData = null
       fetch(`/api/rooms/${code}/round/dismiss-win`, { method: 'POST' })
         .catch(() => { /* non-fatal; countdown just won't start */ })
     }}
     ```
   - Clearing `winData` immediately is intentional — the host's overlay closes snappily even if the network round-trip is slow. The `round:dismissed` broadcast reaching the host's own socket is a harmless no-op (`winData` already null).
   - When `game.continuousMode === true`, **do not** render the "Start Next Round" CTA in `WinOverlay`. Pass new prop `hideStartNextRound: boolean = false`; set `hideStartNextRound={game.continuousMode}`. In `WinOverlay`, the `{#if isHost && showCtas}` block becomes `{#if isHost && showCtas && !hideStartNextRound}` for the Start button, but keep the Dismiss button unconditional in the `{#if isHost && showCtas}` branch. Refactor the markup so only Start is gated.
   - Guest `RoomPage` `WinOverlay` call site is unchanged — guests still dismiss locally only (their `onDismiss` is purely client state) and `hideStartNextRound` stays at its default.

9. **Late-joiner seeds countdown from `session:connect`.** Plumb `continuousMode` and `countdownRemainingMs` through the guest join chain exactly like Story 8-2 plumbed `winsByName` / `lastRoundWinner`:
   - [ws.ts:80-87](src/client/lib/ws.ts#L80-L87): extend `GuestHandlers.onConnect` with `continuousMode: boolean, countdownRemainingMs: number | null`.
   - [ws.ts:133-142](src/client/lib/ws.ts#L133-L142): `connectAsGuest` forwards `data.continuousMode ?? false` and `data.countdownRemainingMs ?? null`.
   - [JoinPage.svelte](src/client/pages/JoinPage.svelte) `onConnect` handler: capture both and forward through `onJoined(...)`.
   - [App.svelte:40-61](src/client/App.svelte#L40-L61) `handleJoined`: add `continuousMode` and `countdownRemainingMs` params, store in new `$state` fields (`guestContinuousMode`, `guestCountdownRemainingMs`).
   - [App.svelte:108](src/client/App.svelte#L108) `<RoomPage .../>`: pass `initialContinuousMode={guestContinuousMode}` and `initialCountdownRemainingMs={guestCountdownRemainingMs}`.
   - [RoomPage.svelte](src/client/pages/RoomPage.svelte): add optional props `initialContinuousMode?: boolean = false` and `initialCountdownRemainingMs?: number | null = null`. Forward `initialContinuousMode` into `createGameState`. After `createGameState` but before the WS handler runs, if `initialCountdownRemainingMs !== null` set `game.countdownEndsAt = Date.now() + initialCountdownRemainingMs`.
   - [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) `session:connect` branch (around line 156-160): add `game.continuousMode = (data.continuousMode as boolean | undefined) ?? false` and `game.countdownEndsAt = (data.countdownRemainingMs as number | null | undefined) ? Date.now() + (data.countdownRemainingMs as number) : null`. (The host reconnect path also benefits — rare, but correct.)

10. **Host toggle UI.** Add a persistent on/off toggle in [HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte):
    - New prop `continuousMode: boolean` and `onContinuousToggle: () => void`.
    - Render a new button in `.left-controls` to the right of `.next-btn`: `<button class="ctrl-btn continuous-btn" class:active={continuousMode} onclick={onContinuousToggle} aria-label={continuousMode ? 'Continuous mode on' : 'Continuous mode off'} aria-pressed={continuousMode}>∞</button>`.
    - `.continuous-btn` styling: `width: 44px; background: #333; color: #aaa; border: 1px solid #444;`. `.continuous-btn.active { background: #1db954; color: #000; border-color: #1db954; }`. Font-size 20px so the ∞ glyph reads.
    - `.btn-label` responsive slot: on `min-width: 768px`, also render a `<span class="btn-label">Loop</span>` so desktop gets text + icon like play/next.
    - HostRoomPage wires: `continuousMode={game.continuousMode}` and `onContinuousToggle={handleContinuousToggle}` where:
      ```ts
      function handleContinuousToggle() {
        const next = !game.continuousMode
        game.continuousMode = next  // optimistic
        fetch(`/api/rooms/${code}/continuous-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        }).catch(() => {
          // revert on failure
          game.continuousMode = !next
          showPlaybackError()
        })
      }
      ```
    - The `continuous-mode:changed` WS echo from the server re-applies the authoritative value (idempotent with the optimistic update).

11. **Countdown display in mini-player + guest header.** Both host and guest see the countdown in the song-info area with label `"Next game starts in Xs"`.
    - **Host:** [HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte) accepts new prop `countdownSeconds: number | null` (null = not counting). When non-null, the `.track-info` content is replaced with `<span class="countdown-text">Next game starts in {countdownSeconds}s</span>` (still `font-size: 14px, font-weight: 600`, color `#1db954` to signal the green tick). When null, existing `currentTrack` logic stands.
    - **Guest:** the `.status-line` paragraph in [RoomPage.svelte:142](src/client/pages/RoomPage.svelte#L142) becomes `{countdownSeconds !== null ? ` + backtick-template `Next game starts in ${countdownSeconds}s` + `` : statusLine}` (use the same derived `countdownSeconds` computed in the page's script). Guest also needs the countdown to show on the `GuestWaitingRoom` fallback when no tiles exist (a late-joiner between rounds sees the waiting room first). Add optional prop `countdownSeconds?: number | null = null` to [GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte) and render it in place of the default waiting copy when non-null.
    - **Countdown derivation (shared pattern for both pages):** compute in the component script via a local `$state(0)` ticker updated by `setInterval(..., 200)` while `game.countdownEndsAt !== null`:
      ```ts
      let countdownSeconds = $state<number | null>(null)
      $effect(() => {
        const endsAt = game.countdownEndsAt
        if (endsAt === null) { countdownSeconds = null; return }
        const tick = () => {
          const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
          countdownSeconds = remaining
          if (remaining === 0) clearInterval(id)
        }
        tick()
        const id = setInterval(tick, 200)
        return () => clearInterval(id)
      })
      ```
    - The `0s` frame is visible briefly before `round:start` arrives from the server; that's acceptable. If `round:start` arrives first, `countdownEndsAt` is set to null by the AC #7 handler and `countdownSeconds` immediately flips to null.

12. **`continuous:countdown-cancel` with `reason` renders a non-blocking toast (host only).** When a client receives `continuous:countdown-cancel`, `gameState` clears `countdownEndsAt` (per AC #7). If `data.reason` is present and the page is the host's, [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) sets `playbackError = true` with message `Continuous round failed — ${reason}` using the same `showPlaybackError` infrastructure, clearing after 3 s. Guest clients silently hide the countdown — no toast. (A cancel with no reason is a normal toggle-off.)

13. **Defensive: `round:end` kills any active countdown.** The manual `POST /round/end` path is an escape hatch. Update [rooms.ts:491-518](src/server/rooms.ts#L491-L518) `/round/end` handler to, before `broadcast(code, { type: 'round:end' })`:
    ```ts
    if (roomState!.continuousCountdown) {
      clearTimeout(roomState!.continuousCountdown.timer)
      roomState!.continuousCountdown = undefined
      broadcast(code, { type: 'continuous:countdown-cancel' })
    }
    ```
    A no-op in the common case (countdown rarely overlaps with manual end), but prevents an auto-round from starting after the host has already decided to go back to lobby.

14. **Defensive: `destroyRoom` kills any active countdown.** In [ws.ts:182-216](src/server/ws.ts#L182-L216), after clearing round timers but before the `session:end` broadcast, also `clearTimeout(room.continuousCountdown?.timer)`. No broadcast needed — the socket close fires moments later.

15. **Regression + new tests.**
    - `npm run lint` (tsc --noEmit) clean.
    - `npm test` green.
    - **Server tests** in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) — add a new `describe('POST /api/rooms/:code/continuous-mode', ...)` block and two/three tests inside the existing `POST /api/rooms/:code/round/claim` / new `POST /api/rooms/:code/round/dismiss-win` blocks:
      - **`continuous-mode: enable broadcasts continuous-mode:changed`** — enable flips state, broadcast observed with `enabled: true`.
      - **`continuous-mode: disable while counting cancels timer and broadcasts cancel`** — seed `roomState.continuousCountdown = { timer: setTimeout(..., 10000), endsAt: Date.now()+10000 }` manually (or reach it through dismiss-win + fake timers), POST disable, assert broadcast contains `continuous:countdown-cancel` and `roomState.continuousCountdown === undefined`.
      - **`continuous-mode: 400 when body.enabled is not boolean`**.
      - **`dismiss-win: 409 when no ended round`** — POST before any claim, assert 409.
      - **`dismiss-win: broadcasts round:dismissed and starts countdown when continuous on`** — simulate a completed claim, set `roomState.continuousMode = true`, POST dismiss-win, assert (a) `round:dismissed` broadcast, (b) `continuous:countdown-start` broadcast with `durationMs: 10000` and numeric `endsAt`, (c) `roomState.continuousCountdown` populated.
      - **`dismiss-win: skips countdown when continuous off`** — same but `continuousMode = false`; only `round:dismissed` broadcast, no `continuous:countdown-start`, `continuousCountdown` undefined.
      - **`dismiss-win is idempotent`** — two dismiss-win POSTs back-to-back with continuous on; second call should reuse the existing timer and not schedule a second one (assert `continuousCountdown.endsAt` unchanged and the timer count is 1). Use `vi.useFakeTimers()` to control timer scheduling.
      - **`startRound helper wired through POST /rooms/:code/round`** — no new test; existing coverage for `POST /rooms/:code/round` validates the refactor (AC #4 behaviour parity).
      - **`startContinuousRound auto-starts after countdown elapses`** — with `vi.useFakeTimers()`, seed a continuous countdown via dismiss-win, call `vi.advanceTimersByTime(10_000)`, assert new `round:start` broadcast with `roundNumber` incremented and `audioPreset` carried from pendingRound. Mock `getPlaylistTracks` to return a fresh 30-track list. This test will require touching module internals for the mock — follow the pattern of the existing `Spotify Web API device recovery` describe block.
      - **`/round/end clears in-flight countdown`** — seed a live countdown, POST /round/end, assert `continuous:countdown-cancel` in broadcasts and `continuousCountdown === undefined`.
    - **Client: no new unit tests.** Existing Svelte component tests do not cover `HostMiniPlayer` / `WinOverlay` visually; manual verification is the coverage.
    - **Manual verification checklist** (Philip):
      - Host toggles Continuous Mode off → ∞ button grey, no label change mid-round.
      - Host toggles on → ∞ button glows green (`.active`), round currently running continues unaffected.
      - Round running → someone wins → host dismisses → host and all guests see "Next game starts in 10s" countdown in song-info / status line; counts down to 0.
      - Countdown reaches 0 → new round:start arrives → fresh cards on all clients, `round:start.audioPreset` matches the prior round's preset, `round:start.clipDuration` matches, no tiles carried over, song-history empty.
      - Pool exclusion: two rounds in a row; the second round's dealt 25 tracks contain no overlap with the first round's dealt 25 (unless the playlist is too small, in which case `buildPool` down-ranks — still acceptable).
      - Host toggles Continuous Mode OFF during countdown → countdown disappears everywhere, no auto-start.
      - Host toggles Continuous Mode OFF mid-round (before a win) → current round continues; after win + dismiss, no countdown, overlay-only flow (back to old behavior: host clicks "Start Next Round" → lobby).
      - Win overlay on host: with Continuous on, "Start Next Round" button is HIDDEN; only "Dismiss" shows.
      - Late-join guest during countdown → immediately sees the remaining countdown in the GuestWaitingRoom; transitions into the auto-started round on round:start.
      - Manual End Round while counting: host clicks gear → End Round (toast/undo flow) → countdown cancelled; host navigates back to lobby on `round:end`.
      - End Session mid-countdown → session:end + socket close; no stray auto-round fires after.

## Tasks / Subtasks

- [x] **Server: `RoomState` fields + defaults** (AC #1)
  - [x] Add `continuousMode: boolean` and `continuousCountdown?: { timer; endsAt }` to `RoomState` in [src/server/ws.ts](src/server/ws.ts).
  - [x] Initialize `continuousMode: false` at every `roomSockets.set(code, { ... })` call site (host path, guest path, `rehydrateRooms`).
  - [x] Add comment: continuous state is not persisted.

- [x] **Server: refactor to `startRound` helper** (AC #4)
  - [x] Extract post-validation body of `POST /rooms/:code/round` handler into `async function startRound(code, roomState, room, host, config)` in [src/server/rooms.ts](src/server/rooms.ts).
  - [x] Rewrite the HTTP handler to validate + `withFreshToken` + compute `roundNumber` + delegate to `startRound`, mapping `{ ok: false, status, message }` back to `ctx.json`.
  - [x] Run full test suite; all existing `POST /rooms/:code/round` tests must still pass.

- [x] **Server: `POST /continuous-mode` endpoint** (AC #2)
  - [x] Add route with auth + ownership + 503 guards.
  - [x] Validate `body.enabled` is a boolean.
  - [x] Update `roomState.continuousMode`, broadcast `continuous-mode:changed`.
  - [x] On disable-while-counting: `clearTimeout`, unset `continuousCountdown`, broadcast `continuous:countdown-cancel`.

- [x] **Server: `POST /round/dismiss-win` endpoint** (AC #3)
  - [x] Add route with auth + ownership + 503 + 409 guards.
  - [x] Broadcast `round:dismissed`.
  - [x] If `continuousMode` and `pendingRound`: schedule 10 s timer, populate `continuousCountdown`, broadcast `continuous:countdown-start { durationMs, endsAt }`.
  - [x] Idempotency: reuse existing timer if `continuousCountdown` already set.

- [x] **Server: `startContinuousRound` auto-start path** (AC #5)
  - [x] New helper that resolves host + fresh token + room, builds a bumped-`roundNumber` config from `pendingRound`, delegates to `startRound`.
  - [x] Failure paths (host-missing, auth-degraded, `startRound` error) broadcast `continuous:countdown-cancel { reason }` and bail.
  - [x] Clear `continuousCountdown` before doing work.

- [x] **Server: session-connect payload extension** (AC #6)
  - [x] Host path `session:connect` payload ([ws.ts:292-299](src/server/ws.ts#L292-L299)): append `continuousMode`, `countdownRemainingMs`.
  - [x] Guest path `session:connect` payload ([ws.ts:348-355](src/server/ws.ts#L348-L355)): same.

- [x] **Server: defensive cancels** (ACs #13, #14)
  - [x] `/round/end` handler clears in-flight countdown and broadcasts cancel.
  - [x] `destroyRoom` clears countdown timer (no broadcast needed).

- [x] **Client: `gameState` continuous state** (AC #7)
  - [x] Add `continuousMode`, `countdownEndsAt` state.
  - [x] Add `processWsMessage` branches for `continuous-mode:changed`, `continuous:countdown-start`, `continuous:countdown-cancel`, `round:dismissed`.
  - [x] Ensure `round:start` branch also nulls `countdownEndsAt`.
  - [x] Expose getters/setters; add `initialContinuousMode` param to `createGameState`.

- [x] **Client: guest plumbing for session-connect continuous state** (AC #9)
  - [x] `GuestHandlers.onConnect` signature + `connectAsGuest` forward.
  - [x] `JoinPage` captures and forwards through `onJoined`.
  - [x] `App.svelte` `handleJoined` + new state + `<RoomPage>` props.
  - [x] `RoomPage` new optional props + seed `game.countdownEndsAt` + forward `initialContinuousMode` into `createGameState`.
  - [x] `HostRoomPage` `session:connect` branch seeds `game.continuousMode` + `game.countdownEndsAt`.

- [x] **Client: host dismiss hits server** (AC #8)
  - [x] `HostRoomPage` win overlay `onDismiss` fires `POST /round/dismiss-win` alongside local `winData` clear.
  - [x] `WinOverlay` accepts new prop `hideStartNextRound: boolean = false`; gates only the Start button.
  - [x] `HostRoomPage` passes `hideStartNextRound={game.continuousMode}`.

- [x] **Client: host continuous toggle button** (AC #10)
  - [x] `HostMiniPlayer` new prop `continuousMode` + `onContinuousToggle` + `<button.continuous-btn>` with `aria-pressed` + `.active` style.
  - [x] `HostRoomPage` wires `game.continuousMode` + `handleContinuousToggle` (optimistic, reverts on error).

- [x] **Client: countdown display** (AC #11)
  - [x] `HostMiniPlayer` accepts `countdownSeconds` prop; overrides track text when non-null.
  - [x] `HostRoomPage` derives `countdownSeconds` via `$effect` + interval on `game.countdownEndsAt`; passes to `HostMiniPlayer`.
  - [x] `RoomPage` derives `countdownSeconds` the same way; renders in `.status-line`.
  - [x] `GuestWaitingRoom` accepts `countdownSeconds` prop; overrides waiting copy when non-null; `RoomPage` passes it through.

- [x] **Client: countdown-cancel reason toast (host only)** (AC #12)
  - [x] `HostRoomPage` WS handler: on `continuous:countdown-cancel` with a `reason`, call `showPlaybackError` with a custom message. (Refactor the existing `playbackError` boolean into a `playbackError: string | false` state, or keep boolean and add a `continuousError: string | null`. Simpler: new `continuousError` state + its own banner. Pick one; do not overload `playbackError` ambiguously.)

- [x] **Tests** (AC #15)
  - [x] New `describe('POST /api/rooms/:code/continuous-mode', ...)` block with enable/disable/cancel/400 tests.
  - [x] New `describe('POST /api/rooms/:code/round/dismiss-win', ...)` block with 409/broadcast/countdown-start/idempotency/off-mode tests.
  - [x] New test (in existing `POST /rooms/:code/round/claim` describe or a new `Continuous Mode auto-start` describe): fake timers + `getPlaylistTracks` mock + `advanceTimersByTime(10_000)` → assert new `round:start` broadcast.
  - [x] New test: `/round/end` during countdown broadcasts `continuous:countdown-cancel`.

- [ ] **Manual verification** (Philip — checklist above)

### Review Findings

- [x] [Review][Patch] Wrong error banner in `handleContinuousToggle` — calls `showPlaybackError()` on failure; should call `showContinuousError('Failed to toggle continuous mode')` [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] `dismiss-win` with `continuousMode=true` + `pendingRound=null` silently skips countdown — no broadcast, host left waiting with no feedback; should broadcast `continuous:countdown-cancel { reason: 'no-round-config' }` [src/server/rooms.ts]
- [x] [Review][Patch] `countdownRemainingMs: 0` from `session:connect` sets `countdownEndsAt = Date.now()+0` → ticker shows "0s" briefly; guard with `remaining > 0` check [src/client/pages/HostRoomPage.svelte, src/client/pages/RoomPage.svelte]
- [x] [Review][Patch] Missing 401/404/403 tests for `POST /round/dismiss-win` — all other new endpoints have these; this one jumps straight to 409/503 [src/server/__tests__/rooms.test.ts]
- [x] [Review][Patch] `dismiss-win` 409 test only covers "active round, not ended"; `!roomState.currentRound` (no round started at all) path of the same guard is untested [src/server/__tests__/rooms.test.ts]
- [x] [Review][Defer] `handleDismissWin` shows no error when POST fails with continuous on — spec explicitly says "non-fatal; countdown just won't start"; UX limitation by design — deferred, pre-existing
- [x] [Review][Defer] `_room` dead parameter in `startRound` helper — prefixed `_` to silence lint; consider a comment explaining future intent — deferred, pre-existing
- [x] [Review][Defer] `initialCountdownRemainingMs` seeded outside `gameState` constructor — works correctly but breaks encapsulation contract vs. `initialContinuousMode` — deferred, pre-existing
- [x] [Review][Defer] Duplicate `$effect` countdown ticker in `HostRoomPage` + `RoomPage` — DRY violation, refactor candidate for future extraction — deferred, pre-existing
- [x] [Review][Defer] No `durationMs` type guard in `continuous:countdown-start` handler — low risk since server controls both sides; defensive hardening for future — deferred, pre-existing

## Dev Notes

- **No SDK playback changes.** The existing `callSpotifyOnDevice` play/pause path is untouched. Continuous Mode operates entirely at the round-orchestration layer; the song-scheduling code in `startSong` / `advanceToNext` ([rooms.ts:101-188](src/server/rooms.ts#L101-L188)) doesn't need to know continuous is on.
- **`pendingRound` is the source of truth for replay.** It's set in the current `/round` handler at [rooms.ts:379](src/server/rooms.ts#L379). `/round/claim` (and our new `/round/dismiss-win`) do NOT clear it, so continuous auto-start reads the last full config directly. Do not store a separate `lastRoundConfig` — one source of truth is cleaner.
- **`sessionPlayedIds` carries across rounds correctly via the old round still in memory.** At dismiss time, `roomState.currentRound` is the just-ended round (`active: false, ended: true`); `startRound`'s `sessionPlayedIds = roomState.currentRound?.sessionPlayedIds ?? []` reads it. When `startRound` writes the new `roomState.currentRound`, the old one is overwritten — which is fine because the accumulator is already copied into the new round's `sessionPlayedIds`.
- **Countdown duration is a constant.** Hardcode `CONTINUOUS_COUNTDOWN_MS = 10_000` as a file-top const in [src/server/rooms.ts](src/server/rooms.ts). Do NOT introduce an env var or a config knob — the whole product is a ten-second countdown by design.
- **Round config clearing policy.** `POST /round/end` (manual escape hatch) already sets `roomState.currentRound = undefined` ([rooms.ts:504](src/server/rooms.ts#L504)); Continuous Mode's auto-start overwrites `currentRound`. Neither path leaks timers — `startContinuousRound` calls `startRound` which initializes a fresh `timers: {}`.
- **Continuous state does NOT belong in `sessionStats`.** Stats are about player wins; continuous mode is a host preference + transient timer. Separate fields.
- **Identity by display-name, still.** The dismiss-win endpoint is host-only and doesn't take a player name — no new exposure to the identity-by-name deferral.
- **Do not clear `winData` in `round:dismissed` for the winner path inadvertently.** `round:dismissed` fires on every client; each client clears `winData`. The winner who dismissed locally already has `winData === null`, so this is a no-op. Other guests still viewing the overlay get it snapped shut — consistent with "host is driving the show".
- **Optimistic-update race on the toggle.** Host clicks Continuous ON → client sets `continuousMode = true` optimistically → POST succeeds → server broadcasts `continuous-mode:changed { enabled: true }` → the echo re-sets the same value. If the POST fails, the client reverts. A rapid double-click is protected by the debounce-less nature of an idempotent PUT-style endpoint — just don't throw on already-enabled.
- **Audio preset + title-reveal-delay + clip-duration** all flow through `pendingRound` for free. No special-casing.
- **WS message name space** — all new types are lowercase-prefixed by feature area: `continuous-mode:changed`, `continuous:countdown-start`, `continuous:countdown-cancel`, `round:dismissed`. Keep this style for grep-ability.
- **Test fake timers sanity check** — `vi.useFakeTimers()` pairs with `vi.useRealTimers()` in `afterEach`. Existing tests in [rooms.test.ts](src/server/__tests__/rooms.test.ts) already use fake timers for auto-advance + reveal; follow that pattern exactly.
- **No dev-server run required for implementation** — all the new logic can be validated through unit tests + a single manual run. Philip will do the manual pass himself.

### Project Structure Notes

- No new files. All changes land in existing files:
  - Server: [src/server/ws.ts](src/server/ws.ts), [src/server/rooms.ts](src/server/rooms.ts), [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts).
  - Client: [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts), [src/client/lib/ws.ts](src/client/lib/ws.ts), [src/client/App.svelte](src/client/App.svelte), [src/client/pages/JoinPage.svelte](src/client/pages/JoinPage.svelte), [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte), [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte), [src/client/components/WinOverlay.svelte](src/client/components/WinOverlay.svelte), [src/client/components/HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte), [src/client/components/GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte).
- HostControlsOverlay (gear menu) is NOT the home for the continuous toggle — the AC requires a persistent visible indicator, and the gear menu is only visible when opened.

### References

- Epic 8 overview + Story 8-3 ACs: [_bmad-output/planning-artifacts/epics.md#L1266-L1380](_bmad-output/planning-artifacts/epics.md#L1266-L1380)
- Story 8-1 (win overlay + dismiss semantics + audio preset): [_bmad-output/implementation-artifacts/8-1-win-moment-hold-and-audio-presets.md](_bmad-output/implementation-artifacts/8-1-win-moment-hold-and-audio-presets.md)
- Story 8-2 (session stats + plumbing pattern for `session:connect` payload extension): [_bmad-output/implementation-artifacts/8-2-session-statistics.md](_bmad-output/implementation-artifacts/8-2-session-statistics.md)
- Round creation + win flow: [src/server/rooms.ts:273-594](src/server/rooms.ts#L273-L594)
- WS connection handler + session-connect: [src/server/ws.ts:245-396](src/server/ws.ts#L245-L396)
- Guest join plumbing chain: [src/client/lib/ws.ts:80-158](src/client/lib/ws.ts#L80-L158), [src/client/App.svelte:40-110](src/client/App.svelte#L40-L110), [src/client/pages/RoomPage.svelte:13-54](src/client/pages/RoomPage.svelte#L13-L54)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6) via `/bmad-dev-story` workflow.

### Debug Log References

- `npm run lint` — clean (tsc --noEmit, no errors)
- `npm test` — 349 passed (14 new continuous-mode tests added to rooms.test.ts)

### Completion Notes List

- Server: added `continuousMode` required field + `continuousCountdown` optional field to `RoomState`; initialized at all three `roomSockets.set` call sites (host connect, guest connect, rehydrateRooms).
- Server: extracted `startRound(code, roomState, _room, host, config)` helper in [rooms.ts](src/server/rooms.ts) — both the HTTP `POST /rooms/:code/round` handler and the new `startContinuousRound` auto-start helper delegate to it. The HTTP handler now returns 503 when `roomSockets.get(code)` is missing (was permissive before); all existing round tests still pass.
- Server: added `POST /api/rooms/:code/continuous-mode` and `POST /api/rooms/:code/round/dismiss-win` endpoints with auth + ownership + 503/409 guards, idempotent timer semantics, and defensive countdown cancellation in `/round/end` and `destroyRoom`.
- Server: `session:connect` payload now carries `continuousMode` + `countdownRemainingMs` for both host and guest paths (so late joiners render the countdown immediately).
- Client: `createGameState` tracks `continuousMode` + `countdownEndsAt`; exposes getters/setters for both; `processWsMessage` handles `continuous-mode:changed`, `continuous:countdown-start`, `continuous:countdown-cancel`, `round:dismissed`, and clears `countdownEndsAt` on `round:start`.
- Client: `WinOverlay` got a `hideStartNextRound` prop; only the "Start Next Round" CTA is gated, "Dismiss" stays unconditional.
- Client: `HostMiniPlayer` got `continuousMode` + `onContinuousToggle` + `countdownSeconds` props. The `∞` button lives to the right of Next with `.active` styling when on; countdown text replaces track info when counting.
- Client: `HostRoomPage` wires the toggle optimistically (reverts on HTTP failure), the host-authoritative dismiss (POST `/round/dismiss-win`), a `$effect`-driven `countdownSeconds` ticker (200 ms interval on `game.countdownEndsAt`), and a separate `continuousError` banner that surfaces `continuous:countdown-cancel.reason`.
- Client: `RoomPage` takes `initialContinuousMode` + `initialCountdownRemainingMs` props, seeds `game.countdownEndsAt`, derives its own `countdownSeconds` ticker, and renders it in the status-line + forwards it to `GuestWaitingRoom` (which shows "Next game starts in Xs" in place of the waiting copy when non-null).
- Client: `JoinPage`/`App.svelte` guest plumbing extended to carry `continuousMode` + `countdownRemainingMs` through `onJoined`, mirroring the Story 8-2 pattern.
- Tests: added `describe('POST /api/rooms/:code/continuous-mode')` (401/404/403/503/400/enable/disable-while-counting), `describe('POST /api/rooms/:code/round/dismiss-win')` (409/503/off-mode/on-mode/idempotent/auto-start), and a `/round/end cancels in-flight countdown` test inside the existing round/end block. The auto-start test uses `vi.useFakeTimers` + `vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))` + `advanceTimersByTimeAsync(10_000)` and asserts the new `round:start` has `roundNumber` bumped and `audioPreset` carried from `pendingRound`.
- Pre-existing `ws.test.ts` + `join.test.ts` session:connect assertions updated to include the new fields.

### File List

Server:
- src/server/ws.ts — RoomState continuous fields, session:connect payload extension, destroyRoom defensive cancel
- src/server/rooms.ts — CONTINUOUS_COUNTDOWN_MS constant, startRound helper, startContinuousRound, continuous-mode + dismiss-win endpoints, /round/end defensive cancel
- src/server/__tests__/rooms.test.ts — new continuous-mode + dismiss-win describes, /round/end cancel test, seedRoom init
- src/server/__tests__/ws.test.ts — session:connect assertions updated

Client:
- src/client/lib/gameState.svelte.ts — continuous state + getters + WS handlers
- src/client/lib/ws.ts — GuestHandlers.onConnect signature + connectAsGuest forward
- src/client/App.svelte — guest state + handleJoined + RoomPage props
- src/client/pages/JoinPage.svelte — onJoined signature + onConnect forward
- src/client/pages/RoomPage.svelte — initial props, countdown ticker, status-line + GuestWaitingRoom forwarding
- src/client/pages/HostRoomPage.svelte — session:connect seed, dismiss wiring, toggle handler, countdown ticker, continuous-error banner
- src/client/components/WinOverlay.svelte — hideStartNextRound prop
- src/client/components/HostMiniPlayer.svelte — continuous button + countdown text
- src/client/components/GuestWaitingRoom.svelte — countdownSeconds prop
- src/client/__tests__/join.test.ts — onConnect assertion updated

### Change Log

| Date | Description |
|------|-------------|
| 2026-04-14 | Story 8-3 implementation: continuous mode toggle, host-authoritative dismiss, 10 s auto-start countdown, late-joiner seeding. Status → review. |
