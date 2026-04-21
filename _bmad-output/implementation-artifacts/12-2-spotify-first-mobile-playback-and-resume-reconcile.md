# Story 12.2: Spotify-First Mobile Playback, `/host/resume` Reconcile & Desktop SDK Reinit Gating

Status: ready-for-dev

## Story

As a host coming back from any interruption — a locked phone, a phone call, a backgrounded tab, a switched Connect device, or a skip from Bluetooth headphones —
I want the app to re-align with whatever Spotify is actually doing right now, and on mobile I want my phone's Spotify app to be the default playback target instead of an unreliable in-browser SDK,
so that playback survives interruptions, the 404 "switch to Bangerbingo, switch back" dance disappears, and the round stays in sync with reality.

## Acceptance Criteria

1. On mobile (`iPhone|iPad|iPod|Android` UA, or `navigator.maxTouchPoints > 1 && window.innerWidth < 900`), [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) does NOT load `https://sdk.scdn.co/spotify-player.js`, does NOT call `initSdkPlayer()`, and does NOT register `onSpotifyWebPlaybackSDKReady`. Verified via Network tab: no request to `sdk.scdn.co`.
2. On mobile, the host's active device auto-populates from Spotify's device list on mount: preference order is (a) any device with `is_active === true`, (b) first device with `type === 'Smartphone'`, (c) first non-restricted device. When picked, the existing `POST /api/rooms/:code/player/device` endpoint (at [rooms.ts:629-693](src/server/rooms.ts#L629-L693)) is called and `hostPrefs.preferredDeviceId` is updated.
3. On mobile with no available device, a compact empty state shows: "Open Spotify on your phone and play any song to activate it, then tap Refresh." Refresh re-fetches the device list (reuse the refresh path in [DevicePicker.svelte](src/client/components/DevicePicker.svelte)).
4. The device picker remains fully accessible on mobile. Users can still switch to any other Connect target (Sonos, car, speakers). Auto-select only sets the pre-selected default; it does not hide, disable, or limit the picker.
5. New server endpoint `POST /api/rooms/:code/host/resume` reconciles room state with Spotify's actual `/me/player` state. Returns a discriminated union:
   - `{ state: 'ok', device, track, position, isPlaying }` — Spotify matches server expectations (or round is not active and device is adopted).
   - `{ state: 'no-device' }` — Spotify reports no active device.
   - `{ state: 'spotify-paused', device, track, position }` — round is active but Spotify `is_playing === false`.
   - `{ state: 'drift-corrected', device, track, position }` — Spotify drifted (different track or paused+round-playing), server re-issued `PUT /me/player/play` to restore expected track/position on current device, and it succeeded.
   - `{ state: 'drift-unresolvable' }` — drift detected but re-issue failed (e.g., device went away); client falls back to empty state.
6. `/host/resume` logic handles these specific mismatches:
   - Active device differs from `roomState.activeDeviceId` → adopt it (`activeDeviceId = newId`, persist, broadcast `host:device-changed` to the room with new device info).
   - Round active AND expected track URI matches Spotify's current track AND Spotify position drifted >2s from server's expected position → accept Spotify's position as truth, adjust the next-song-change `setTimeout` to realign.
   - Round active AND Spotify is playing a *different* track than server expects → re-issue `PUT /me/player/play` for the expected track at expected position on the current device; return `drift-corrected` or `drift-unresolvable`.
   - Round active AND Spotify is paused → return `spotify-paused`; do not auto-resume.
7. The client calls `POST /host/resume` on every `wsClient.onResume` (from Story 12-1) AND on initial HostRoomPage mount after WS `session:connect`. Responses render:
   - `ok` / `drift-corrected` → no UI change (optional toast in dev).
   - `no-device` → empty state from AC #3.
   - `spotify-paused` → compact "Tap to resume" chip; one tap calls existing `POST /api/rooms/:code/round/play`.
   - `drift-unresolvable` → empty-state fallback from AC #3.
8. On mobile, `wsClient.onResume` also re-runs the A2 device auto-pick (AC #2) in case the active device changed while the tab was hidden.
9. On desktop (not `isMobileHost()`), SDK reinit gating: a new boolean `sdkReconnecting` blocks play/pause/skip buttons while the SDK is mid-re-init. On `host:sdk-stale` at [HostRoomPage.svelte:320-322](src/client/pages/HostRoomPage.svelte#L320-L322), set `sdkReconnecting = true`, call `reinitSdk()`, show "Reconnecting playback…" chip. On the next fresh SDK `ready` event at [HostRoomPage.svelte:194-205](src/client/pages/HostRoomPage.svelte#L194-L205), after POSTing `/sdk/device`, clear `sdkReconnecting`, and if `pendingPlayAction` is set AND <10s old, invoke it exactly once and clear it.
10. While `sdkReconnecting` is true on desktop, clicks on play/pause/skip do NOT call the server — they stash the intended action as `pendingPlayAction = () => fetch(...)` (with timestamp). [HostControlsOverlay.svelte](src/client/components/HostControlsOverlay.svelte) and [HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte) accept a `disabled` prop bound to `sdkReconnecting`.
11. New server WS event `host:device-changed` ([broadcast]) is added — payload `{ device: {id, name, type} }`. The room handler adopts the new device without causing a round restart. Existing `host:sdk-stale` behavior is unchanged.
12. `npm run lint` and `npm run test` pass. New tests cover: each of the 6 `/host/resume` reconcile cases with Spotify API stubbed, SDK reinit gating (button disabled, pendingPlayAction fires once on ready), mobile detection.
13. No regression: `AuthDegradedBanner` and `SdkFailureBanner` flows unchanged; device picker still works for explicit selection on both platforms; guest playback experience unchanged; `callSpotifyOnDevice` and its existing reactivation path at [rooms.ts:34-100](src/server/rooms.ts#L34-L100) unchanged.

## Tasks / Subtasks

- [ ] Task 1 — Mobile detection helper (AC: 1)
  - [ ] Module-level helper in [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte):
    ```ts
    const isMobileHost = () =>
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && window.innerWidth < 900)
    ```
  - [ ] In `onMount` at [HostRoomPage.svelte:239-250](src/client/pages/HostRoomPage.svelte#L239-L250): wrap the `sdk.scdn.co` script append, `onSpotifyWebPlaybackSDKReady` registration, and `initSdkPlayer()` call in `if (!isMobileHost())`.
  - [ ] `reinitSdk()` at [HostRoomPage.svelte:222-232](src/client/pages/HostRoomPage.svelte#L222-L232) should no-op on mobile — add an early return.
  - [ ] SDK's `ready` handler that auto-fills `selectedDevice = 'Bangerbingo (this browser)'` at [HostRoomPage.svelte:202-204](src/client/pages/HostRoomPage.svelte#L202-L204) naturally never fires on mobile — no change needed but verify.

- [ ] Task 2 — Mobile auto-select Spotify app device (AC: 2, 3, 4)
  - [ ] In `onMount` on mobile branch: call `getDevices(code, controller.signal)` (existing helper).
  - [ ] Pick order: `is_active === true` → `type === 'Smartphone'` → first `!is_restricted` device.
  - [ ] If found: POST `/api/rooms/${code}/player/device` with the device id (existing endpoint); on success set `selectedDevice` and `writeHostPrefs({ preferredDeviceId: id })`.
  - [ ] If not found: render the empty state from AC #3 with a Refresh button. Hook Refresh to re-run the auto-pick flow. Reuse [DevicePicker.svelte](src/client/components/DevicePicker.svelte)'s refresh path for visual consistency; add new copy only for the empty-state message.
  - [ ] Verify the existing device picker (chip + bottom sheet) continues to work for explicit switches. Do NOT touch [DeviceChip.svelte](src/client/components/DeviceChip.svelte) or [DevicePicker.svelte](src/client/components/DevicePicker.svelte)'s core logic.

- [ ] Task 3 — `/host/resume` server endpoint (AC: 5, 6, 11)
  - [ ] Add route in [src/server/rooms.ts](src/server/rooms.ts): `app.post('/api/rooms/:code/host/resume', ...)`. Gate: authenticated host of room.
  - [ ] Use the existing `withFreshToken` helper (used by `callSpotifyOnDevice`) to call `GET https://api.spotify.com/v1/me/player`.
  - [ ] Handle all 6 reconcile cases from AC #6 with explicit branches. Keep logic small and readable — each case is 3–10 lines.
  - [ ] When adopting a new device: update `roomState.activeDeviceId`, call `persistRoomState` (existing helper in [ws.ts:94-119](src/server/ws.ts#L94-L119)), and broadcast `{ type: 'host:device-changed', device }` to the room via the existing broadcast mechanism.
  - [ ] When re-issuing play for drift correction: reuse `callSpotifyOnDevice` with the current `activeDeviceId`, expected track URIs and position. Treat a 404 from the re-issue as `drift-unresolvable`.
  - [ ] For round-active position drift (same track, >2s off): adjust the existing next-song `setTimeout` so its fire time equals `Date.now() + (clipDurationMs - spotifyPositionMs)`. The existing round timer bookkeeping lives in [src/server/rooms.ts](src/server/rooms.ts) — locate and adjust (do not rewrite).
  - [ ] Log one structured line per resume: `[host:resume] code=<code> state=<state> device=<id>`.

- [ ] Task 4 — Client resume hook (AC: 7, 8)
  - [ ] After WS `session:connect` completes in HostRoomPage `onMount`, fire one `POST /api/rooms/${code}/host/resume` call.
  - [ ] Register `wsClient.onResume(() => postHostResume())` so subsequent reconnects trigger reconcile. (`wsClient.onResume` comes from Story 12-1.)
  - [ ] Response handling: create a small `HostResumeState` local signal + a switch that renders the UI affordances from AC #7.
  - [ ] On mobile, inside the resume callback also re-run the device auto-pick (Task 2's function). Do this after `postHostResume` resolves so the `host:device-changed` race is avoided — the server will have already adopted any new active device.

- [ ] Task 5 — Desktop SDK reinit gating (AC: 9, 10)
  - [ ] Add `let sdkReconnecting = $state(false)` and `let pendingPlayAction: { fn: () => void; t: number } | null = null`.
  - [ ] On `host:sdk-stale` at [HostRoomPage.svelte:320-322](src/client/pages/HostRoomPage.svelte#L320-L322): guard with `if (isMobileHost()) return;`, then `sdkReconnecting = true; reinitSdk()`. Show "Reconnecting playback…" chip.
  - [ ] In the SDK `ready` handler at [HostRoomPage.svelte:194-205](src/client/pages/HostRoomPage.svelte#L194-L205): after the existing `POST /sdk/device` succeeds, `sdkReconnecting = false`; if `pendingPlayAction && Date.now() - pendingPlayAction.t < 10_000`, call `pendingPlayAction.fn()`; then `pendingPlayAction = null`.
  - [ ] Intercept `handlePlayPause` at [HostRoomPage.svelte:125-129](src/client/pages/HostRoomPage.svelte#L125-L129) (and equivalent `handleNext` / `handleSkip` call sites): if `sdkReconnecting`, stash the action in `pendingPlayAction` instead of calling fetch.
  - [ ] Pass `disabled={sdkReconnecting}` to [HostControlsOverlay.svelte](src/client/components/HostControlsOverlay.svelte) and [HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte); add the prop and bind to button `disabled` attributes.

- [ ] Task 6 — `host:device-changed` client handler (AC: 11)
  - [ ] HostRoomPage: on `host:device-changed` message, update `selectedDevice` and `preferredDeviceId`. No further UI interruption.
  - [ ] RoomPage (guest): if guest UI displays the host's current device name anywhere, update it. If not, safely ignore.

- [ ] Task 7 — Tests (AC: 12)
  - [ ] Server unit tests for `/host/resume`: stub `fetch('/me/player')` responses for each reconcile case; assert returned state + any side effects (device adopted, round timer adjusted, play re-issued).
  - [ ] Client unit tests for SDK reinit gating: simulate `host:sdk-stale`, assert buttons disabled; simulate `ready`, assert pendingPlayAction fires exactly once and only if <10s old.
  - [ ] Client unit test for `isMobileHost()` — stub navigator / window.innerWidth for both platforms.
  - [ ] Integration check: existing `callSpotifyOnDevice` 404 test path unchanged.

- [ ] Task 8 — Regression + manual verification (AC: 13)
  - [ ] `npm run lint` clean.
  - [ ] `npm run test` — full suite passes.
  - [ ] Manual Journey A: iPhone host, Spotify running → arrive on room → no SDK script fetched, iPhone pre-selected as device, start round plays via Spotify app.
  - [ ] Manual Journey B: iPhone host locks mid-round → unlock → Reconnecting chip clears → `/host/resume` log shows `state=ok` or `drift-corrected`; Spotify kept playing.
  - [ ] Manual Journey C: iPhone host without Spotify running → empty state shows → open Spotify + tap any song → Refresh → device adopted.
  - [ ] Manual Journey D: iPhone host skips via Bluetooth during backgrounded tab → on return, `/host/resume` returns `drift-corrected`, server re-issues expected track.
  - [ ] Manual Journey E: Host pauses Spotify from lock screen → return → "Tap to resume" chip → tap → round track resumes.
  - [ ] Manual Journey F: Desktop host, force SDK deregistration (leave tab idle overnight or force via DevTools) → click play → "Reconnecting playback…" chip → succeeds on retry with no user click.
  - [ ] Manual: host switches to Connect speaker via device picker mid-round → playback transfers; `/host/resume` on next visibility change shows `state=ok` with new device.

## Dev Notes

### Why skip the SDK on mobile, not "try harder"

The Web Playback SDK on iOS Safari has documented, unfixable issues: autoplay blocked, device deregistration on background, token handoff races, audio context suspended. Every past attempt to "harden" it has been a whack-a-mole. The Spotify native app already solves the same problem — reliably — and registers as a Spotify Connect device. Using it removes the entire failure class on the platform that matters most. On desktop the SDK works fine; it's kept as the default there.

### `/host/resume` is the *generalized* solution

Don't think of `/host/resume` as a "fix for mobile resume" — it's a source-of-truth reconciliation that's useful any time the client lost context. Desktop benefits too: user switched to Connect speaker while tab was backgrounded, user skipped via the Spotify desktop app, etc. Implementing 6 explicit cases in one endpoint is cleaner than scattering drift-correction into 6 event handlers.

### Position-drift tolerance

>2s is chosen as the threshold because: (a) network + clock skew between server and Spotify's API easily produces sub-second drift; (b) Spotify's own reporting precision is ~1s; (c) below 2s, re-issuing a play command would cause audible glitches worse than the drift itself. Above 2s, re-anchoring is correct.

### Why `pendingPlayAction` is one-shot, not a queue

If the user clicks play three times in the 2 seconds the SDK is reinitializing, we want exactly one play command to fire after ready — not three. Always overwrite `pendingPlayAction`. The 10s staleness check prevents a pending action from surviving a long reinit and firing unexpectedly.

### Don't couple this story to Story 12-3

Story 12-3 handles marks and casual-mode catch-up. Those are server-to-client data replays. This story is playback-state reconciliation. They both happen on reconnect but are independent. If Story 12-3 ships first, this story's `onResume` handler just doesn't do anything extra for marks — that's fine.

### File structure

- Modified: `src/client/pages/HostRoomPage.svelte` (primary)
- Modified: `src/client/components/HostControlsOverlay.svelte`, `src/client/components/HostMiniPlayer.svelte` (add `disabled` prop)
- Modified: `src/client/components/DevicePicker.svelte` (empty-state copy only; core logic unchanged)
- Modified: `src/server/rooms.ts` (add `/host/resume`)
- Modified: `src/server/ws.ts` (broadcast `host:device-changed` — small helper)
- No new dependencies

### Existing patterns to reuse

- Spotify API calls with token refresh: `withFreshToken` wrapper used by `callSpotifyOnDevice` in [rooms.ts:34-100](src/server/rooms.ts#L34-L100). Use the same helper for `GET /me/player`.
- Device transfer endpoint `/api/rooms/:code/player/device` at [rooms.ts:629-693](src/server/rooms.ts#L629-L693) — no change needed.
- `getDevices` client helper and pre-fill loop at [HostRoomPage.svelte:252-265](src/client/pages/HostRoomPage.svelte#L252-L265) — adapt for mobile auto-pick (similar shape, different selection criteria).
- `hostPrefs` storage: [src/client/lib/hostPrefs.ts](src/client/lib/hostPrefs.ts) — reuse `readHostPrefs()` / `writeHostPrefs()`; the `preferredDeviceId` key already exists.
- Broadcast helper in [src/server/ws.ts](src/server/ws.ts) — same mechanism used by `player:joined`, `host:sdk-stale`, etc.
- `callSpotifyOnDevice` — reuse for drift-correction play re-issue; its existing 404 path will correctly return an error we interpret as `drift-unresolvable`.

### UA sniffing note

Story 10-3's acceptance bar explicitly said "failure path driven only by observed SDK events — no UA sniffing." That constraint applies to the *fallback* path (SDK failed → show picker). This story's mobile-first *default* path is a different decision: we pre-decide the default playback target based on platform. UA sniffing is appropriate here because it's about defaults, not about error handling. If the heuristic misfires (rare tablet with keyboard, etc.), the device picker remains available for explicit override (AC #4). Keep the check minimal and permissive.

### References

- Parent plan: [i-don-t-think-switching-giggly-hammock.md](~/.claude/plans/i-don-t-think-switching-giggly-hammock.md) — Track A (A1–A4).
- Parent epic: [_bmad-output/epics.md](_bmad-output/epics.md) — Epic 12.
- Depends on Story 12-1 shipping first (wsClient, `onResume` hook).
- Related prior work: Story 10-3 (SDK-default and failure path) and Story 6-5 (host Spotify disconnect/reconnect settings).

## Dev Agent Record

### Agent Model Used

_TBD_

### Debug Log References

_TBD_

### Completion Notes List

_TBD_

### File List

_TBD_

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created. Status: ready-for-dev. |
