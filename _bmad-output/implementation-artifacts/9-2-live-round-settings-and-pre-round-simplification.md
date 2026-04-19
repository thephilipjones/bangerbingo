# Story 9-2: Live Round Settings & Pre-Round Simplification

Status: ready-for-dev

> **Scope amended by Story 9-3 (2026-04-19):** Autoplay Next Round row and HostMiniPlayer Loop removal excised. See 9-3 for context. `AdvancedSettings` now renders four rows: Clip Duration, Title Reveal, Win Reaction, Casual Mode. Struck items below are retained for traceability; do not implement them.

## Story

As a host,
I want the pre-round overlay to be minimal (playlist + start) and the secondary round settings to be adjustable mid-round from the Host Controls panel with clear explanations,
so that starting a party is low-friction and I can course-correct without restarting a whole round.

## Background

Today [RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) presents six decisions in sequence before any song plays (playlist, vibe, clip duration, title reveal, casual mode, host name), and the in-round [HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte) shows a `∞ Loop` button whose label does not reflect "Continuous Mode" semantics. All per-round settings are fixed at round-start; changing any requires ending the round and reconfiguring.

**What this story does:**
- Moves clip duration, title reveal, win reaction (formerly "Vibe"), and casual-mode permission into a live-editable Round Settings section inside [HostControlsOverlay.svelte](src/client/components/HostControlsOverlay.svelte).
- Extracts the settings rows into a new shared `AdvancedSettings.svelte` rendered in both the pre-round overlay ("Advanced settings" collapsible `<details>`) and the live host panel — identical UI in both places.
- Adds a `PATCH /api/rooms/:code/round-config` endpoint modeled on [rooms.ts:542](src/server/rooms.ts#L542) `/continuous-mode` — validates a partial config, mutates `roomState.currentRound.config` + `roomState.pendingRound` so song-scheduling (`startSong` reads `round.config.titleRevealDelay`, [rooms.ts:198](src/server/rooms.ts#L198)) picks up the new values on the next draw, and broadcasts `round-config:changed`.
- Persists last-used settings in `localStorage` so hosts don't reconfigure every session.
- Renames the `audioPreset` UI label from **"Vibe"** to **"Win Reaction"** (the `AudioPreset` data values `'hype' | 'deadpan' | 'minimal'` stay — today's scope is win-overlay presentation only, per [WinOverlay.svelte:33](src/client/components/WinOverlay.svelte#L33); expanding that scope is out-of-scope).
- Changes the host-name input placeholder from `"Play along!"` to `"Host"` to signal the default persisted server-side ([rooms.ts:510](src/server/rooms.ts#L510) `resolvedName = 'Host'`).

**Apply timing:** mid-round edits apply on the next song draw. The current clip finishes as-is; no mid-clip recalculation.

**Visual confirmation:** on each successful edit, a transient ~1.5s "Saved — applies to next song" (clip duration / title reveal / win reaction) or "Saved" (casual mode / autoplay) pill renders next to the changed row. Replaces any always-on helper text.

**Epic 9 fit:** This story does not depend on Story 9-1 (Game Over page state / auto-bingo) and can ship independently. It's bundled into Epic 9 rather than spun out as Epic 10 because both stories target the same theme of reducing friction at round boundaries.

## Acceptance Criteria

### Server — `PATCH /api/rooms/:code/round-config`

1. **Endpoint guards.** `requireAuth`, 404 on unknown room, 403 on wrong host, 503 on no live `roomState` (same guards as `/continuous-mode`, [rooms.ts:542-551](src/server/rooms.ts#L542-L551)).
2. **Body shape + validation.** Accepts a partial `{ clipDuration?, titleRevealDelay?, audioPreset?, allowCasualMode? }`. Each provided field runs through the same validators already used by `POST /round` ([rooms.ts:499-504](src/server/rooms.ts#L499-L504)):
   - `clipDuration ∈ VALID_CLIP_DURATIONS` ([rooms.ts:352](src/server/rooms.ts#L352))
   - `titleRevealDelay ∈ VALID_TITLE_REVEAL_DELAYS` ([rooms.ts:353](src/server/rooms.ts#L353))
   - `audioPreset ∈ VALID_AUDIO_PRESETS` ([rooms.ts:354](src/server/rooms.ts#L354))
   - `allowCasualMode` is a boolean
   - Reject with 400 `{ message: 'Invalid <field>' }` on any failure (message mirrors existing `POST /round` pattern).
   - Reject with 400 `{ message: 'No valid fields' }` if the body contains none of the four known keys.
3. **Active-round requirement.** 409 `{ message: 'No active round' }` if `roomState.currentRound?.active !== true`. Pre-round edits still flow through `POST /round`.
4. **Mutation.** On success, mutate *both* `roomState.currentRound.config` (so `startSong`'s next call reads the new `titleRevealDelay` and `allowCasualMode`) and `roomState.pendingRound` (so Continuous Mode's `startContinuousRound` auto-start at [rooms.ts:466-479](src/server/rooms.ts#L466-L479) inherits the newest values).
5. **Broadcast.** `broadcast(code, { type: 'round-config:changed', config })` where `config` is the merged final `RoundConfig` object (the same shape clients already see in `round:start`). Response body: same merged config, HTTP 200.
6. **Persistence note.** Do NOT call `persistRoomState` here — continuous state is in-memory; live config changes should survive a host reconnect only for the duration of the round in memory. Restart behaviour: after a server restart mid-round, rehydration falls back to the original `roundStartPayload` (unchanged from today).

### Server — WS type

7. Add `round-config:changed` to any WS message union in [src/server/ws.ts](src/server/ws.ts) (if the file maintains one) and to the client-side type narrowing in [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts).

### Client state — `gameState`

8. **Expose clip duration + win reaction + casual-mode permission.** `createGameState` already stores `audioPreset` and `allowCasualMode`; also expose `clipDuration` (capture it from `round:start` alongside `audioPreset` at [gameState.svelte.ts:154-155](src/client/lib/gameState.svelte.ts#L154-L155)) and `titleRevealDelay` (already partially captured via `roundConfig.titleRevealDelay` — extend so the whole four-field config is available as getters on the returned store).
9. **`round-config:changed` handler.** In `processWsMessage`: for each field present in the message's `config`, update the corresponding piece of game state (`clipDuration`, `titleRevealDelay` via `roundConfig`, `audioPreset`, `allowCasualMode`). Do not reset any in-flight round state (tiles, history, countdown).
10. **Setters.** Each of the four exposed getters needs a matching setter so that `AdvancedSettings` in live mode can optimistically update game state before the WS echo arrives.

### Client — `AdvancedSettings.svelte` (new shared component)

11. **Component contract.** Accepts:
    - `clipDuration`, `titleRevealDelay`, `audioPreset`, `allowCasualMode` (current values)
    - ~~`continuousMode?: boolean` (live mode only)~~ _(struck by 9-3)_
    - `mode: 'pre-round' | 'live'`
    - `code?: string` (required in `'live'` mode)
    - Change callbacks for `'pre-round'` mode (parent owns state): `onClipDurationChange`, `onTitleRevealDelayChange`, `onAudioPresetChange`, `onAllowCasualModeChange`.
12. **Rows (same in both modes):**
    1. **Clip Duration** — segmented button group: 20s / 30s / 45s / 60s / Full
    2. **Title Reveal** — segmented: Now / 5s / 10s / 15s / Never
    3. **Win Reaction** — segmented: Hype / Deadpan / Minimal (maps to `audioPreset`)
    4. **Casual Mode** — two-pill toggle: Off / Allow
    5. ~~**Autoplay Next Round** (live mode only, appended last) — two-pill toggle: Off / On~~ _(struck by 9-3 — Continuous Mode deleted; next-round choice now lives on Game Over screen)_
13. **Row visuals.** Each row has: label + `InfoTooltip` (§15) + control + (live mode only) transient success pill slot. Styling reuses the existing `.pill` / `.pill-group` / `.option-section` / `.option-label` tokens that today live inline in [RoundConfigOverlay.svelte:686-708](src/client/components/RoundConfigOverlay.svelte#L686-L708) — move those into the new component.
14. **Live-mode behaviour.** Each control's `onclick`:
    - Applies optimistic update (via the setters from AC #10)
    - Fires `PATCH /api/rooms/:code/round-config`
    - On success (res.ok): set a per-row "saved" flag to `true`; after ~1.5s `setTimeout`, reset to `false`. Per-row success copy:
      - Clip Duration / Title Reveal / Win Reaction → "Saved — applies to next song"
      - Casual Mode → "Saved"
    - On failure: revert the optimistic update and set a per-row `error` string to a short "Couldn't save" message; clear on the next successful change or after ~3s.
    - Rapid repeat clicks on the same control: latest value wins; in-flight request for the previous value is ignored on arrival (guard via a per-row incrementing `seq` counter).

### Client — `InfoTooltip.svelte` (new shared component)

15. **Behaviour.** Minimal ⓘ icon button:
    - Desktop: shows popover on hover AND keyboard focus; hides on blur / mouseleave / `Escape`.
    - Mobile: tap toggles; outside-tap / `Escape` dismisses.
    - Uses `aria-describedby` to link the icon to the popover's id.
    - Styled with existing tokens (`--bg-2`, `--rule`, `--fg`, `--accent`).
    - Positioned so that on mobile it does not clip off the right edge of the overlay.
16. **Tooltip copy.** Source of truth lives co-located with `AdvancedSettings.svelte`:
    - Clip Duration — "How long each song plays before moving on."
    - Title Reveal — "When the song title and artist appear on cards."
    - Win Reaction — "Style of the celebration overlay when someone wins — Hype (loud), Deadpan (dry), Minimal (subtle)."
    - Casual Mode — "Lets players tap squares to auto-mark instead of listening for the full song."
    - ~~Autoplay Next Round — "Keep rocking this playlist (no repeats) after the Winner gets their due."~~ _(struck by 9-3)_

### Client — host panel & mini player

17. **HostControlsOverlay — Round Settings section.** Above the existing End Round / End Session actions, render a `<section>` headed "Round Settings" containing `<AdvancedSettings mode="live" ... />`. Reuse the existing `.divider` pattern below the new section. The section is only rendered when a round is currently active (`game.tiles.length > 0` is the existing proxy; if the controls overlay can be opened between rounds, hide the Round Settings section in that case).
18. ~~**HostMiniPlayer — Loop removed.** Remove the `.continuous-btn` block at [HostMiniPlayer.svelte:46-54](src/client/components/HostMiniPlayer.svelte#L46-L54) and its associated `.continuous-btn` / `.continuous-btn.active` CSS rules. Remove the `continuousMode` and `onContinuousToggle` props. Keep the countdown-text `.track-info` branch unchanged.~~ _(struck by 9-3 — Loop button removal migrated to 9-3 AC #16 as part of Continuous Mode deletion.)_
19. ~~**HostRoomPage — re-wire continuous toggle.** Props `continuousMode` and `onContinuousToggle` pass from [HostRoomPage.svelte:366-367](src/client/pages/HostRoomPage.svelte#L366-L367) into `HostControlsOverlay` (which forwards them to `AdvancedSettings`) instead of `HostMiniPlayer`.~~ _(struck by 9-3 — `continuousMode` / `onContinuousToggle` props are deleted entirely; no re-route needed.)_

### Client — pre-round overlay

20. **RoundConfigOverlay — collapse Advanced.** Replace the inline pill sections at [RoundConfigOverlay.svelte:344-406](src/client/components/RoundConfigOverlay.svelte#L344-L406) (Vibe, Clip Duration, Title Reveal, Casual Mode) with a single `<details>` titled "Advanced settings" that renders `<AdvancedSettings mode="pre-round" ... />`. Collapsed by default.
21. **Host-name placeholder.** Change the placeholder at [RoundConfigOverlay.svelte:416](src/client/components/RoundConfigOverlay.svelte#L416) from `"Play along!"` to `"Host"`. No info tooltip on this field.
22. **Default seeding.** `RoundConfigOverlay`'s local state for the four advanced fields is seeded from `readHostPrefs()` (§23) on mount; falls back to `{ clipDuration: 30, titleRevealDelay: 10, audioPreset: 'minimal', allowCasualMode: false }` on missing/invalid.
23. **`localStorage` persistence.** New module `src/client/lib/hostPrefs.ts` exports `readHostPrefs()` / `writeHostPrefs(partial)`:
    - Key: `bb:host-prefs:v1`
    - Shape: `{ schemaVersion: 1, clipDuration, titleRevealDelay, audioPreset, allowCasualMode }`
    - `readHostPrefs` validates `schemaVersion === 1` and each field; on any mismatch returns `null`.
    - `writeHostPrefs(partial)` merges onto current prefs (or defaults) and writes back.
    - Called from: (a) `RoundConfigOverlay.handleStartRound` on successful start (full snapshot), (b) `AdvancedSettings` live mode after any successful PATCH (merges the single changed field).

### Tests

24. **Server tests** — new `describe('PATCH /api/rooms/:code/round-config', ...)` in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) covering:
    - 401 (unauth), 404 (unknown room), 403 (wrong host), 503 (no live session)
    - 400 on invalid `clipDuration`, invalid `titleRevealDelay`, invalid `audioPreset`, non-boolean `allowCasualMode`
    - 400 on empty/unknown-keys-only body
    - 409 when there is no active round
    - Happy path: partial update mutates `currentRound.config` AND `pendingRound`, broadcasts `round-config:changed` with the merged config, returns 200 with the same config
25. **Client tests** — extend [RoundConfigOverlay.test.ts](src/client/__tests__/RoundConfigOverlay.test.ts) only if selectors changed (the `<details>` wrapper will hide the advanced pills from initial DOM; tests that click those pills must first open the `<details>`). Payload tests in [round-config.test.ts](src/client/__tests__/round-config.test.ts) should pass unchanged.
26. **Client tests — `hostPrefs`** — small unit test for read / write / schema-mismatch fallback.
27. **Client tests — `AdvancedSettings` live mode** — one focused test: clicking a pill in live mode fires `fetch('/api/rooms/:code/round-config', { method: 'PATCH', … })` with the correct partial body; on failed response the optimistic value reverts.
28. **Regression.** `bun run lint` (tsc --noEmit) clean. `bun test` green.

## Tasks / Subtasks

- [ ] **Server: PATCH `/round-config` endpoint** (ACs #1–#6)
  - [ ] Extract per-field validators out of `POST /round` into reusable helpers (if not already shared) — `validateClipDuration`, `validateTitleRevealDelay`, `validateAudioPreset`, `validateAllowCasualMode`.
  - [ ] Add handler after the `/continuous-mode` route in [rooms.ts](src/server/rooms.ts).
  - [ ] Mutate both `roomState.currentRound.config` and `roomState.pendingRound`; broadcast `round-config:changed`.
- [ ] **Server: WS type note** (AC #7) — add `round-config:changed` to any existing message docstring / type catalogue.
- [ ] **Client: gameState** (ACs #8–#10)
  - [ ] Capture `clipDuration` from `round:start`.
  - [ ] Extend `roundConfig` getter or expose individual getters+setters for all four fields.
  - [ ] Handle `round-config:changed` in `processWsMessage`.
- [ ] **Client: api.ts** — add `patchRoundConfig(code, partial)` helper mirroring `startRound` error handling.
- [ ] **Client: `InfoTooltip.svelte`** (ACs #15, #16) — new file.
- [ ] **Client: `AdvancedSettings.svelte`** (ACs #11–#14) — new file. Extract segmented-pill CSS from `RoundConfigOverlay`.
- [ ] **Client: `HostControlsOverlay`** (AC #17) — Round Settings section.
- [ ] **Client: `HostMiniPlayer`** (AC #18) — remove Loop button block + CSS.
- [ ] **Client: `HostRoomPage`** (AC #19) — re-route `continuousMode` + `onContinuousToggle` props.
- [ ] **Client: `RoundConfigOverlay`** (ACs #20–#22) — collapse advanced settings into `<details>`; swap host-name placeholder; seed from `readHostPrefs`.
- [ ] **Client: `hostPrefs.ts`** (AC #23) — new file; wire write calls.
- [ ] **Tests** (ACs #24–#28) — server endpoint + hostPrefs unit + AdvancedSettings live flow; update RoundConfigOverlay test if needed.
- [ ] **Manual verification** (Philip — see §Verification in the plan file).

## Dev Notes

- **Why mutate `pendingRound` too?** Continuous Mode's `startContinuousRound` at [rooms.ts:466-479](src/server/rooms.ts#L466-L479) builds the next round's config from `roomState.pendingRound`. If the host live-edits the current round's clip duration and then an auto-start fires, the auto-started round should inherit the new duration. Writing to both `currentRound.config` AND `pendingRound` costs nothing and keeps both code paths correct.
- **Why not broadcast to one field at a time?** Always sending the full merged `RoundConfig` makes the client handler simple and idempotent; clients replace fields from the echoed payload.
- **Why not persist live-config changes in `persistRoomState`?** Continuous state isn't persisted by the existing snapshot contract ([ws.ts:82-85](src/server/ws.ts#L82-L85)); by the same logic, live-edited config values are ephemeral until the next round's `roundStartPayload` captures them. Rehydration correctness matters less than round-flow simplicity.
- **Why rename "Vibe" to "Win Reaction" rather than expand `audioPreset` scope?** Today the field only drives [WinOverlay.svelte](src/client/components/WinOverlay.svelte); calling it "Vibe" promises broader audio/pacing behaviour that doesn't exist. Renaming is a 1-line label change; broadening the field's effect is a separate design conversation.
- **`localStorage` schema-versioning.** Fields may change (new settings, different enums). A leading `schemaVersion: 1` check lets us throw away mismatches cleanly in the future without crashing on old data.
- **Live-edit apply timing.** Settings that affect song scheduling (`clipDuration`, `titleRevealDelay`) are read by `startSong` ([rooms.ts:198](src/server/rooms.ts#L198), [rooms.ts:208-209](src/server/rooms.ts#L208-L209), [rooms.ts:240-252](src/server/rooms.ts#L240-L252)) on each song change — both the broadcast payload and the reveal/advance timers pull from `round.config`. Writing to `round.config` means the next `startSong` call picks up the new value; the currently-playing clip finishes on its existing timer. No mid-clip recalculation.
- **`allowCasualMode` live toggle.** Changing this mid-round does not retroactively revoke player toggles already on (per Story 8-4 semantics — `playerCasualModes` is separate from the room-level permission). Turning the permission off should not force-disable existing players' toggles; it only prevents new players from enabling. (This is a conscious scope choice to keep the feature minimal; re-evaluate if feedback says otherwise.)

### Project Structure Notes

Files touched:

**Server:**
- src/server/rooms.ts — new PATCH endpoint; extracted field validators
- src/server/ws.ts — message type note (if applicable)
- src/server/__tests__/rooms.test.ts — new describe block

**Client:**
- src/client/lib/api.ts — `patchRoundConfig` helper + types
- src/client/lib/gameState.svelte.ts — extended state + `round-config:changed` handler
- src/client/lib/hostPrefs.ts — new file (localStorage)
- src/client/components/AdvancedSettings.svelte — new shared settings block
- src/client/components/InfoTooltip.svelte — new tooltip component
- src/client/components/HostControlsOverlay.svelte — Round Settings section
- src/client/components/HostMiniPlayer.svelte — Loop button removed
- src/client/components/RoundConfigOverlay.svelte — `<details>` Advanced + placeholder swap
- src/client/pages/HostRoomPage.svelte — re-route continuous-mode prop
- src/client/__tests__/RoundConfigOverlay.test.ts — selector update if needed
- src/client/__tests__/hostPrefs.test.ts — new file
- src/client/__tests__/AdvancedSettings.test.ts — new file (live flow)

### References

- Epic 9 intro: [_bmad-output/planning-artifacts/epics.md#L1467-L1477](_bmad-output/planning-artifacts/epics.md#L1467-L1477)
- Story 8-3 (continuous-mode endpoint + `RoomState` live-state pattern): [_bmad-output/implementation-artifacts/8-3-continuous-mode.md](_bmad-output/implementation-artifacts/8-3-continuous-mode.md)
- Story 7-3 (RoundConfigOverlay origin): [_bmad-output/implementation-artifacts/7-3-round-config-overlay-and-host-name.md](_bmad-output/implementation-artifacts/7-3-round-config-overlay-and-host-name.md)
- Story 7-6 (HostMiniPlayer + HostControlsOverlay origin): [_bmad-output/implementation-artifacts/7-6-host-mini-player-and-controls-overlay.md](_bmad-output/implementation-artifacts/7-6-host-mini-player-and-controls-overlay.md)
- Win reaction (audioPreset) scope today: [src/client/components/WinOverlay.svelte](src/client/components/WinOverlay.svelte)
