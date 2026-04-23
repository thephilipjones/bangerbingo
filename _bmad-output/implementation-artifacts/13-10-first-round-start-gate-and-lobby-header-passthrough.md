# Story 13-10: First-Round Start Gate & Lobby-Header Passthrough During Config

## Status: done

## Context

Two adjacent pain points when a host creates a new session:

1. **Room code disappears behind the config modal.** [LobbyPage.svelte:150-167](src/client/pages/LobbyPage.svelte#L150-L167) shows the room code + "Join at BangerBingo.net" prominently in the lobby header. The RoundConfigOverlay auto-opens on first entry ([LobbyPage.svelte:113-116](src/client/pages/LobbyPage.svelte#L113-L116)) with a `rgba(0, 0, 0, 0.6)` backdrop ([RoundConfigOverlay.svelte:470-473](src/client/components/RoundConfigOverlay.svelte#L470-L473)) that covers the full viewport. The host never really sees the lobby, and late joiners can't read the code during the (sometimes long) playlist-picking window.

2. **Round 1 song 1 auto-fires before Spotify is actually ready.** On `round:start` with empty history, HostRoomPage auto-POSTs `/round/play` ([HostRoomPage.svelte:507-514](src/client/pages/HostRoomPage.svelte#L507-L514)). On mobile the host is often still switching to the Spotify app or picking a Connect device — the server broadcasts "playing" while no audio actually comes through the phone.

Both problems dissolve if the first round of a fresh session **starts paused**, the lobby header **peeks through** the modal (giving joiners continuous visibility of the code), and the existing HostMiniPlayer Play button becomes the explicit Go action, gated on Spotify readiness.

The fix reuses existing plumbing: `round.paused` ([ws.ts:54](src/server/ws.ts#L54)), `POST /round/play` → `startSong()` which already clears `paused` ([rooms.ts:252](src/server/rooms.ts#L252)), `persistRoomState` already serialises `paused` ([ws.ts:142](src/server/ws.ts#L142)), and restore logic already forces `paused: true` on recovery ([ws.ts:197](src/server/ws.ts#L197)). No new endpoints, no new WS message types, no new UI components.

The "first round of the session" signal is computed server-side: `historicPlayedIds.size === 0` at `startRound` time. This `Set` is already built for Story 13-8's filtered-pool logic at [rooms.ts:478](src/server/rooms.ts#L478). After the first song plays, `recordPlayedSongs` populates the table and subsequent rounds in the same session start unpaused (current behaviour).

---

## Changes

### A — `round.paused = isFirstRound` on `startRound`

**File:** `src/server/rooms.ts` — inside `startRound` (~lines 438–538)

1. Just after `let excluded = new Set(getPlayedSongs(code))` at [rooms.ts:478](src/server/rooms.ts#L478), compute:
   ```ts
   const isFirstRound = excluded.size === 0
   ```
   (Story 13-8 may rename this to `historicPlayedIds` — use whichever name lands in the shipping code. The Set is the signal.)

2. Include `paused` in the `roundStartPayload` at [rooms.ts:497-505](src/server/rooms.ts#L497-L505):
   ```ts
   const roundStartPayload = {
     type: 'round:start',
     roundNumber: config.roundNumber,
     playlist: pool,
     clipDuration: config.clipDuration,
     titleRevealDelay: config.titleRevealDelay,
     audioPreset: config.audioPreset,
     allowCasualMode: config.allowCasualMode,
     paused: isFirstRound,
   }
   ```

3. Replace the unconditional `paused: false` at [rooms.ts:517](src/server/rooms.ts#L517) with:
   ```ts
   paused: isFirstRound,
   ```

No other server changes needed. The existing `POST /round/play` → `startSong(code, roomState, 0)` path already clears `round.paused` at [rooms.ts:252](src/server/rooms.ts#L252) and broadcasts `song:start` — the host's Play tap drives it. The guard at [rooms.ts:687](src/server/rooms.ts#L687) (`POST /round/pause` rejects before song 1) continues to apply and prevents double-pause.

---

### B — Host client: gate auto-play on `paused` and track `awaitingFirstStart`

**File:** `src/client/pages/HostRoomPage.svelte` — `round:start` handler (~line 500-514)

1. `paused` is already destructured at [HostRoomPage.svelte:506](src/client/pages/HostRoomPage.svelte#L506). Keep it.

2. Add new `$state`:
   ```ts
   let awaitingFirstStart = $state(false)
   ```

3. Modify the empty-history branch at [HostRoomPage.svelte:507-514](src/client/pages/HostRoomPage.svelte#L507-L514):
   ```ts
   if (!history || history.length === 0) {
     if (paused === true) {
       awaitingFirstStart = true
     } else if (sdkReady && !sdkFailed) {
       fetch(`/api/rooms/${code}/round/play`, { method: 'POST' })
         .then(res => { if (!res.ok) showPlaybackError() })
         .catch(() => showPlaybackError())
     } else {
       pendingAutoPlay = true
     }
   }
   ```

4. Clear `awaitingFirstStart` on receipt of `song:start` (find the existing `song:start` handler and add `awaitingFirstStart = false`).

5. Compute `playbackReady` as a `$derived`:
   ```ts
   const playbackReady = $derived(sdkReady || selectedDevice?.id != null)
   ```
   (`selectedDevice?.id` is the existing host-side identifier for an active Connect device — see [HostRoomPage.svelte:763](src/client/pages/HostRoomPage.svelte#L763). `activeDeviceId` in the plan/scope is the same signal.)

6. Pass the two new props to HostMiniPlayer (~line 730+, where other props are passed):
   ```svelte
   <HostMiniPlayer
     …existing props…
     awaitingFirstStart={awaitingFirstStart}
     playbackReady={playbackReady}
   />
   ```

---

### C — HostMiniPlayer: readiness gate + 10s safety valve

**File:** `src/client/components/HostMiniPlayer.svelte`

1. Add two new optional props at [HostMiniPlayer.svelte:22-40](src/client/components/HostMiniPlayer.svelte#L22-L40):
   ```ts
   awaitingFirstStart = false,
   playbackReady = true,
   …
   awaitingFirstStart?: boolean
   playbackReady?: boolean
   ```
   Defaults keep every existing call-site unchanged.

2. Add an internal `$state` and `$effect` implementing the 10-second safety valve:
   ```ts
   let readinessTimedOut = $state(false)
   let readinessTimer: ReturnType<typeof setTimeout> | null = null

   $effect(() => {
     // Arm only while awaiting the first start and not yet ready.
     if (awaitingFirstStart && !playbackReady) {
       if (readinessTimer === null) {
         readinessTimer = setTimeout(() => { readinessTimedOut = true }, 10_000)
       }
     } else {
       if (readinessTimer !== null) { clearTimeout(readinessTimer); readinessTimer = null }
       readinessTimedOut = false
     }
     return () => {
       if (readinessTimer !== null) { clearTimeout(readinessTimer); readinessTimer = null }
     }
   })
   ```

3. Derive the Play-disabled flag and caption text:
   ```ts
   const waitingForPlayback = $derived(
     awaitingFirstStart && !playbackReady && !readinessTimedOut
   )
   const firstStartCaption = $derived(
     awaitingFirstStart
       ? (!playbackReady && !readinessTimedOut
           ? 'Waiting for Spotify…'
           : (!playbackReady && readinessTimedOut
               ? 'No device detected — tap Play to try anyway.'
               : null))
       : null
   )
   ```

4. Extend the Play button's disabled check at [HostMiniPlayer.svelte:60](src/client/components/HostMiniPlayer.svelte#L60):
   ```svelte
   <button class="ctrl-btn play-pause-btn" onclick={onPlayPause} disabled={!sdkReady || disabled || waitingForPlayback} aria-label={isPlaying ? 'Pause' : 'Play'}>
   ```
   Keep the existing `!sdkReady` guard intact — it covers normal mid-round behaviour when the SDK transiently disconnects.

5. Render the caption below the Play button (or wherever is visually coherent within the mini-player):
   ```svelte
   {#if firstStartCaption}
     <span class="first-start-caption" role="status" aria-live="polite">{firstStartCaption}</span>
   {/if}
   ```
   Style: small, muted, single line. Not a banner, not a toast.

6. Clear `readinessTimer` on component destroy (the `$effect` return handles it, but double-check Svelte 5 effect cleanup in the file's conventions).

**Do not** add any "prominent" / "Go" styling (explicitly rejected during planning). The existing Play button is the control — only its disabled state and caption change.

---

### D — Lobby header passthrough + z-index + backdrop alpha

**File:** `src/client/components/RoundConfigOverlay.svelte` — the `.backdrop` rule (~line 470-473)

Lower the backdrop alpha from `0.6` to **`0.85`** (note: this means a **darker** overlay with *slightly* more translucency around the edges; we want only a touch of warmth, not see-through). Concretely:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  …
}
```

Rationale: at 0.85, the lobby is nearly black behind the panel except for elements with a higher z-index. The lobby header — which is lifted above the backdrop in Change E — remains crisp; the vinyl, player list, trivia are obscured (as desired — just a hint of warmth, per user). If 0.85 proves too dark in practice, iterate between 0.7 and 0.9.

**File:** `src/client/pages/LobbyPage.svelte` — `.lobby-header` rule

Add:
```css
.lobby-header {
  …existing rules…
  position: relative;   /* if not already */
  z-index: 10010;        /* above the modal backdrop and panel */
}
```

Choose a z-index value that sits **above** both `.backdrop` and `.panel` in RoundConfigOverlay. Inspect those values during implementation and pick `max(backdrop, panel) + 10`. The header must render in front of both layers while remaining tappable.

Header buttons — code copy, URL copy, "Back to Sessions" — **all remain interactive while the modal is open** (explicit user decision during planning: these are safe actions and the Back button is a reasonable escape hatch). Do **not** apply `pointer-events: none` to the header.

---

### E — Fresh-session delay + slide-up animation

**File:** `src/client/pages/LobbyPage.svelte` — auto-open logic (~line 107-120)

Wrap the `isConfigOpen = true` assignment in a 1-second delay, gated on the same condition the auto-open already uses:

```ts
getRooms()
  .then((rooms) => {
    if (cancelled) return
    const row = rooms.find((r) => r.code === code)
    if (!row) return
    roomHostName = row.host_name ?? null
    if (roomHostName === null && !hasEverOpenedConfig) {
      setTimeout(() => {
        if (cancelled) return
        isConfigOpen = true
        hasEverOpenedConfig = true
      }, 1_000)
    }
  })
  .catch(() => { /* leave roomHostName === null */ })
```

Reconnect / between-rounds / user-initiated open ("Start a Round" button at [LobbyPage.svelte:189](src/client/pages/LobbyPage.svelte#L189)) are unchanged — no delay. Only the fresh-session auto-open path delays.

**File:** `src/client/components/RoundConfigOverlay.svelte` — panel + backdrop elements (~line 305 and the panel div)

Use Svelte's built-in transitions:

```svelte
<script>
  import { fly, fade } from 'svelte/transition'
  …
</script>

<div class="backdrop" transition:fade={{ duration: 300 }}>
  <div class="panel" transition:fly={{ y: 200, duration: 300 }}>
    …existing panel contents…
  </div>
</div>
```

Adjust structure if the panel is a sibling rather than a child of `.backdrop` — Svelte's `transition:` directive applies when the element enters/leaves the DOM, and `{#if isConfigOpen}…{/if}` in LobbyPage already drives mount/unmount, so placement is what matters. Keep the transitions compact (y: 200, duration: 300ms) — any more and it feels sluggish; any less and the "there's a lobby behind" cue is lost.

No `transition:` on the lobby itself — it's already mounted and should not animate.

---

### F — Persistence confirmation (no code change expected)

`round.paused` is already serialised by `persistRoomState` at [ws.ts:142](src/server/ws.ts#L142) and restored as `paused: true` unconditionally at [ws.ts:197](src/server/ws.ts#L197). This means:

- A round persisted while paused-at-round-1 restores paused. ✅
- A round persisted while actively playing restores paused (existing Story 6-4 behaviour — host must press Play after server restart to resume). ✅ No regression.

**Action:** verify both behaviours still hold after the Change A edit. Add one test in `ws.test.ts` asserting restored `currentRound.paused === true` after a round was persisted with `paused: true`. If the existing coverage from 13-2 already covers this, extend rather than duplicate.

---

## Acceptance Criteria

**AC 1 — First round of session is broadcast paused**
Given a fresh room with `played_songs` empty, when the host submits `POST /rooms/:code/round`, then `roundStartPayload.paused === true` and `roomState.currentRound.paused === true`.

**AC 2 — Subsequent rounds unchanged**
Given a room with at least one entry in `played_songs`, when the host submits a new round, then `roundStartPayload.paused === false` and `roomState.currentRound.paused === false` (current behaviour preserved).

**AC 3 — Host auto-play gate**
Given the host client receives `round:start` with `paused === true` and empty `songHistory`, then no `/round/play` POST is issued automatically. `awaitingFirstStart` becomes `true`.

**AC 4 — Host Play button disabled until Spotify ready**
Given `awaitingFirstStart === true` and neither `sdkReady` nor `selectedDevice?.id` is truthy, then the Play button is disabled and the caption reads "Waiting for Spotify…".

**AC 5 — Host Play button enables on readiness**
Given `awaitingFirstStart === true` and `sdkReady === true || selectedDevice?.id != null`, then the Play button is enabled and no caption is shown.

**AC 6 — Safety valve at 10 seconds**
Given `awaitingFirstStart === true` and readiness never arrives, after 10 seconds the Play button is re-enabled and the caption reads "No device detected — tap Play to try anyway." No permanent block.

**AC 7 — Tapping Play drives normal game loop**
Given AC 5 or AC 6 has fired and the host taps Play, then `POST /round/play` fires, `startSong(0)` executes, `round.paused` becomes `false`, `song:start` broadcasts, and both `awaitingFirstStart` and the caption clear on the host.

**AC 8 — Persistence across server restart**
Given a round is paused-at-round-1 when the server is killed, when the server restarts and the room state is restored, then `roomState.currentRound.paused === true` and the Play-gate re-applies on host reconnect.

**AC 9 — Fresh-session modal delay + slide-up**
Given a host clicks "New Session" and lands in the lobby with `roomHostName === null`, then the lobby renders fully for ~1 second (vinyl spinning, header visible, player list), then the RoundConfigOverlay appears: backdrop fades in (~300ms) and the panel flies up from below (~300ms, 200px distance).

**AC 10 — Reconnect/return entry does not delay**
Given a host returns to the lobby between rounds or reconnects (i.e., `roomHostName !== null` or `hasEverOpenedConfig === true`), when the page mounts, then no delay fires — the overlay behaviour matches today's (opens on "Start a Round" click, not auto-opened).

**AC 11 — Lobby header visible through modal**
Given the RoundConfigOverlay is open, then the lobby header (room code, "Join at BangerBingo.net", "Back to Sessions", theme toggle) is visibly crisp above the backdrop, the body of the lobby (vinyl, player list, trivia) is dimmed, and header controls (code copy, URL copy, Back to Sessions) remain clickable.

**AC 12 — Guest side unchanged**
Given a guest receives `round:start` with `paused === true` and empty history, then the guest page renders the card as today and the tiles become active on first `song:start`. No new banner, no new waiting state.

---

## Files Modified

**Server:**
- `src/server/rooms.ts` — Change A: `isFirstRound` from the existing `excluded` Set; `paused: isFirstRound` in both `roundStartPayload` and `roomState.currentRound`.

**Client:**
- `src/client/pages/HostRoomPage.svelte` — Change B: `awaitingFirstStart` `$state`; gate auto-play on `paused !== true`; `playbackReady` `$derived`; clear on `song:start`; pass new props to HostMiniPlayer.
- `src/client/components/HostMiniPlayer.svelte` — Change C: `awaitingFirstStart` + `playbackReady` optional props; 10s timeout `$effect`; extend `disabled` check; render caption.
- `src/client/pages/LobbyPage.svelte` — Change D: `.lobby-header` z-index above modal. Change E: wrap auto-open `isConfigOpen = true` in a 1-second `setTimeout` respecting `cancelled`.
- `src/client/components/RoundConfigOverlay.svelte` — Change D: `.backdrop` alpha to `0.85`. Change E: add `transition:fade` on backdrop and `transition:fly={{ y: 200, duration: 300 }}` on panel.

**Tests:**
- `src/server/__tests__/rooms.test.ts` — new cases for AC 1, AC 2.
- `src/server/__tests__/ws.test.ts` — new case for AC 8 (restore round with `paused: true`); extend any fixture that currently asserts against `roundStartPayload` shape to cover the new `paused` field.

No DB schema changes. No new dependencies.

---

## Tests

### New tests in `src/server/__tests__/rooms.test.ts`

- **`'startRound broadcasts paused:true on first round of session'`** — create a fresh room with `played_songs` empty; call `POST /rooms/:code/round` with valid config; assert the emitted `round:start` (both host and guest paths) carries `paused: true` and `roomState.currentRound.paused === true`. (AC 1)

- **`'startRound broadcasts paused:false when played_songs has entries'`** — seed `played_songs` with one entry via `recordPlayedSongs`; call `POST /rooms/:code/round`; assert `paused: false` in payload and state. (AC 2)

### New / extended tests in `src/server/__tests__/ws.test.ts`

- **`'paused field reaches both host and guest sockets on round:start'`** — open host + guest WS connections; trigger a first-round start; assert both received messages include `paused: true`. (AC 3 precondition — the client-side gate is out of scope for server tests, but the payload reaching the client is the testable contract.)

- **`'restored currentRound has paused: true after server restart'`** — persist a room state with `currentRound.paused = true`; reload via the restore path; assert `roomState.currentRound.paused === true`. If an existing test from Story 13-2 already covers this shape, extend it with an explicit `paused` assertion rather than adding a new case. (AC 8)

### Client tests — skip

The auto-play gate, readiness timer, and caption logic are manual-verification only. Covered end-to-end by the manual plan below. Svelte component tests for HostRoomPage / HostMiniPlayer are not established in this project and introducing them for this story is out of scope.

### Manual verification

1. `npm run typecheck` — clean.
2. `npm run test` — all suites green; new `paused` cases pass.
3. **Fresh session, host on mobile:**
   - Click "New Session" → lobby mounts, vinyl spins, room code visible in header.
   - After ~1s, backdrop fades in and config panel slides up from bottom. Header stays crisp above the backdrop.
   - Click the room code in the header — "Copied!" flash. Click "Join at BangerBingo.net" — "Copied!" flash.
   - Guest joins via URL → sees waiting room.
   - Host submits config. Card renders; Play button visible in HostMiniPlayer, disabled, caption "Waiting for Spotify…". No audio.
   - Open Spotify app on phone → device picker detects it. Play enables, caption clears.
   - Tap Play. `song:start` fires. Audio begins. Normal game loop.
4. **Round 2 of same session:** host reopens config, submits. Round 2 auto-plays immediately (no gate, no caption).
5. **Safety valve:** fresh session, submit round 1, never open Spotify. After ~10s, Play re-enables with "No device detected — tap anyway" caption. Tapping Play posts `/round/play`; the existing `callSpotifyOnDevice` fallback handles device activation.
6. **Server restart while paused:** kill server during round-1 pause; restart; host reconnects; `round:start` replays with `paused: true`; Play-gate re-applies.
7. **Return to lobby:** complete round 1, navigate back to the lobby (between-rounds). Config does **not** auto-open; no 1s delay; clicking "Start a Round" opens the modal immediately (no fly-up delay needed on re-entry — acceptable if the slide-up animation still fires since it's quick).

---

## Dev Notes

- **Do not change existing `paused` semantics.** `round.paused` remains "paused after `/pause`, cleared on `/play`." The only new case is "paused-at-start-of-round-1", which the existing `/play` path handles identically to resume-from-pause (it clears paused and broadcasts `song:start`). Do not special-case the initial transition.

- **`isFirstRound` signal.** Reuse the `excluded` / `historicPlayedIds` Set that Story 13-8 built in `startRound`. If Story 13-8 landed with a different local name, adapt. The signal is `Set.size === 0` before any potential auto-reset; **not after** (if auto-reset fires at [rooms.ts:480-488ish](src/server/rooms.ts#L480), compute `isFirstRound` from the pre-reset set so a playlist-cycle reset mid-session doesn't mistakenly trigger the round-1 pause).

- **`selectedDevice` vs `activeDeviceId`.** HostRoomPage uses `selectedDevice` as the local state; HostMiniPlayer already accepts `activeDeviceId` via DeviceChip's side of the plumbing ([HostRoomPage.svelte:763](src/client/pages/HostRoomPage.svelte#L763) passes `selectedDevice?.id ?? null`). For the readiness `$derived`, read `selectedDevice?.id` directly in HostRoomPage — don't duplicate the state into a new variable.

- **Svelte 5 `$effect` cleanup.** The safety-valve timer uses `$effect` with a return cleanup. Verify Svelte 5 accepts return functions from `$effect` in this codebase's convention (it does in Svelte 5.0+). If not, use `onDestroy` for the final clearTimeout.

- **Z-index discipline.** Pick the lobby header's z-index by inspecting the RoundConfigOverlay `.backdrop` and `.panel` values first — use `max(backdrop, panel) + 10`. Do not use `999999` or similar "nuclear" values; they bite later.

- **Transition edge case.** If `isConfigOpen` flips back to false quickly (user clicks X then reopens), Svelte will interrupt the fly-in and reverse. That's fine. But ensure the panel's `transition:fly` directive is on the single mounted `.panel` element (not wrapped in an extra `#if`) so Svelte tracks it cleanly.

- **Do not add a guest-side banner.** Explicitly out of scope. Guests see the card and wait for `song:start`. Do not add any "Round 1 starting soon…" copy or spinner — it was vetoed during planning.

- **Do not add a prominent "Go" button.** Explicitly out of scope. The HostMiniPlayer Play button is the start control — only its disabled state and caption change.

- **Commit style:** project convention — `feat: first-round start gate and lobby-header passthrough during config` (no scope parens). Reference: [feedback_commit_style.md in user memory].

- **Package manager:** `npm run test` / `npm run typecheck` — bun is not installed.

- **Backdrop alpha is a taste parameter.** 0.85 is the starting point; iterate between 0.7 and 0.9 during manual verification if it reads wrong on the target device. Do not exceed 0.95 (defeats the "touch of warmth" intent) or drop below 0.6 (distracting bleed-through).

---

## References

- Plan file: `/Users/Philip/.claude/plans/may-want-to-adjust-fizzy-key.md` (this story's source of truth; note title "may want to adjust..." was the user's message prefix — scope was finalised in party-mode discussion)
- Story 13-8: [13-8-independent-cards-exclude-played-auto-reset.md](_bmad-output/implementation-artifacts/13-8-independent-cards-exclude-played-auto-reset.md) — introduced the `excluded` / `historicPlayedIds` Set this story reuses as the "first round" signal
- Story 13-2: [13-2-casual-mode-persistence-across-restart.md](_bmad-output/implementation-artifacts/13-2-casual-mode-persistence-across-restart.md) — pattern for `persistRoomState` field additions; confirms `round.paused` is already persisted
- Story 13-1: [13-1-reconnect-after-win-state-replay.md](_bmad-output/implementation-artifacts/13-1-reconnect-after-win-state-replay.md) — established `roundStartPayload` as the reconnect replay payload; the new `paused` field must travel through it
- Story 10-2: [10-2-device-chip-and-picker-ui.md](_bmad-output/implementation-artifacts/10-2-device-chip-and-picker-ui.md) — introduced `selectedDevice` state used by the readiness gate
- Story 7-3: [7-3-round-config-overlay-and-host-name.md](_bmad-output/implementation-artifacts/7-3-round-config-overlay-and-host-name.md) — established the current RoundConfigOverlay auto-open behaviour now being augmented

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code, bmad-dev-story skill)

### Debug Log References

- `npm run test` — 567/567 passing after the change (29 test files).
- `npm run lint` — only pre-existing `AudioPreset` TS2304 in `src/client/__tests__/winAudio.test.ts` remains (unchanged on main; not introduced by this story).

### Completion Notes List

- Change A landed as specified. `isFirstRound` is computed from `excluded` BEFORE the `<25` auto-reset so a mid-session cycle-reset doesn't accidentally re-arm the round-1 pause (Dev Notes guidance). Both `roundStartPayload.paused` and `roomState.currentRound.paused` use `isFirstRound`.
- Change B: `awaitingFirstStart` `$state` added; auto-POST `/round/play` branch gated on `paused !== true`; `playbackReady = $derived(sdkReady || selectedDevice?.id != null)`; `awaitingFirstStart = false` on `song:start`; both new props passed to `HostMiniPlayer`.
- Change C: `awaitingFirstStart` + `playbackReady` optional props with safe defaults; 10s readiness timer via `$effect` with cleanup; Play button `disabled` now OR'd with `waitingForPlayback`; caption rendered inside the existing `.track-info` slot (keeps the 64px bar layout) swapping in "Waiting for Spotify…" or the post-10s "No device detected — tap Play to try anyway." message. No "Go"-style emphasis added (explicitly out of scope).
- Change D: backdrop alpha 0.6 → 0.85; lobby header z-index 20 → 110 (backdrop z-index 100 + 10 per Dev Notes). Header buttons remain interactive while modal is open.
- Change E: fresh-session auto-open wrapped in 1-second `setTimeout` respecting `cancelled`; Svelte `svelte/transition` `fade` on backdrop (300ms) and `fly` on panel (y: 200, 300ms). Reconnect / between-rounds / user-initiated opens unchanged.
- Change F: no server code change required. Added an explicit ws.test.ts case asserting a snapshot persisted with `paused:true` restores to `paused:true` (the existing "force-paused on rehydrate" test from Story 6-4 already covers the "paused while active restores paused" side).
- Existing test `initialises new RoundState fields on round start` flipped from `paused: false` to `paused: true` to match the new first-round contract.
- jsdom doesn't implement `Element.prototype.animate`; added a no-op polyfill inside `RoundConfigOverlay.test.ts`'s `beforeEach` so the transitions added in Change E don't break the existing DOM tests.
- Manual verification (fresh-session flow, mobile, 10s safety valve, server restart) not performed in-session — covered by the manual plan for reviewer.

### File List

**Server:**
- `src/server/rooms.ts` — Change A: `isFirstRound` + `paused: isFirstRound` in payload and RoundState.

**Client:**
- `src/client/pages/HostRoomPage.svelte` — Change B: `awaitingFirstStart` state, auto-play gate, `playbackReady` derived, clear on `song:start`, new props to `HostMiniPlayer`.
- `src/client/components/HostMiniPlayer.svelte` — Change C: `awaitingFirstStart` + `playbackReady` props, 10s timer `$effect`, extended Play `disabled`, caption.
- `src/client/pages/LobbyPage.svelte` — Change D: header `z-index: 110`. Change E: 1s fresh-session delay on auto-open.
- `src/client/components/RoundConfigOverlay.svelte` — Change D: backdrop alpha 0.85. Change E: `fade` on backdrop and `fly` on panel.

**Tests:**
- `src/server/__tests__/rooms.test.ts` — updated fresh-room assertion to `paused: true`; added AC 1 & AC 2 cases.
- `src/server/__tests__/ws.test.ts` — added AC 8 case (paused-true snapshot restores paused-true).
- `src/client/__tests__/RoundConfigOverlay.test.ts` — added `Element.prototype.animate` polyfill in `beforeEach` so Svelte transitions don't break jsdom mount tests.

### Change Log

- 2026-04-22 — Story 13-10 implemented: first-round start gate (server `paused: isFirstRound`), host client readiness gate + 10s safety valve, lobby-header passthrough (alpha 0.85 + z-index 110), fresh-session 1s delay and fade/fly-up animation. 3 new server tests; 1 test-harness polyfill. Status → review.

### Review Findings

- [x] [Review][Decision] Play button `!sdkReady` guard dropped — `handlePlayPause` calls a server endpoint, not the SDK directly; `!sdkReady` was a redundant proxy. Removed entirely: `disabled={disabled || waitingForPlayback}`. `disabled` prop (carrying `sdkReconnecting`) covers mid-round SDK transient drops. Also fixed pre-existing test gap: `window.matchMedia` stub added to `RoundConfigOverlay.test.ts` `beforeEach`.
- [x] [Review][Patch] topOffset guarded against negative on first render [`src/client/pages/LobbyPage.svelte`] — changed to `topOffset={headerHeight > 0 ? headerHeight - 4 : undefined}`.
- [x] [Review][Patch] `awaitingFirstStart` cleared on round end [`src/client/pages/HostRoomPage.svelte`] — added `awaitingFirstStart = false` to both `songs:exhausted` and `round:win` handlers.
- [x] [Review][Patch] `hasEverOpenedConfig` set synchronously before `setTimeout` [`src/client/pages/LobbyPage.svelte`] — flag now guards at decision time, preventing a second `getRooms()` resolution within the 1s window from queuing a duplicate timer.
