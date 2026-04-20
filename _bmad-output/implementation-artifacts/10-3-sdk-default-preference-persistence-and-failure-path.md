# Story 10.3: SDK Default, Preference Persistence & Failure Path

Status: done

## Story

As a host on any platform (desktop Chrome, desktop Firefox, or iOS Safari),
I want the app to default to the in-browser SDK device where it works, remember my last chosen device across reloads, and clearly route me to the device picker when the SDK fails to initialise,
so that desktop users keep the zero-configuration path they have today while iOS hosts (or anyone whose SDK breaks) get a coherent fallback instead of a dead-end error banner.

## Background

Stories 10-1 and 10-2 delivered the server endpoints and the client picker UI. Both stories explicitly deferred three things to this story, which this ticket closes out:

1. **SDK-first default on supported browsers.** Today `selectedDevice` starts as `null` and only populates after the host explicitly picks. The SDK `ready` callback already POSTs `/sdk/device` (aliased to `/player/device`) but the chip still reads "Pick a device ▾". 10-3 wires the `ready` callback so the chip reflects the SDK device as "Bangerbingo (this browser)" without requiring user action.
2. **Preference persistence (`preferredDeviceId`).** Extend the existing `bb:host-prefs:v1` schema in [src/client/lib/hostPrefs.ts](src/client/lib/hostPrefs.ts) to remember the last explicitly-picked device. On host page mount, apply it if the device is present in the current `/player/devices` response.
3. **SDK failure path.** Rewrite [src/client/components/SdkFailureBanner.svelte](src/client/components/SdkFailureBanner.svelte) from today's dead-end "Audio unavailable, open in app" copy to a picker-routed banner with a primary action. The banner auto-dismisses when the host picks any non-SDK device. Empty-device state includes a first-time iOS onboarding block (numbered 1-2-3 instructions).

This is the last story in Epic 10. After this ships, iOS Safari hosts (the original epic motivation) get a coherent flow, and desktop hosts keep the zero-config path they have today.

## Acceptance Criteria

### SDK-first default on supported browsers

1. **SDK `ready` populates `selectedDevice`.** Given the Web Playback SDK initialises successfully on the host page, when the SDK `ready` callback fires with a `device_id`, the existing POST to `/api/rooms/:code/sdk/device` continues to run exactly as today **AND** `selectedDevice` is set to `{ id: device_id, name: 'Bangerbingo (this browser)', type: 'Computer' }`. The chip then renders that label (with the 💻 icon on desktop, 💻 + ▾ only on mobile) instead of the placeholder "Pick a device ▾".

2. **SDK device label is canonical.** The string `'Bangerbingo (this browser)'` is the display name for the SDK device in the chip, the picker (if the SDK device appears in the `/player/devices` response alongside other Connect devices), and the AdvancedSettings Playback Device row. Do NOT use the Spotify-returned display name for the SDK device (which is just "Bangerbingo" and is indistinguishable from the app name on other devices).

3. **`preferredDeviceId` overrides the SDK default if present in the current device list.** Given a host mounts the page AND `preferredDeviceId` is set in `hostPrefs` AND the initial `GET /player/devices` response includes that id, when both the SDK `ready` fires and the devices fetch resolves, `selectedDevice` is set to the persisted device (not the SDK device). The SDK device remains registered server-side (the `/sdk/device` POST still fires on `ready`) so Spotify knows it exists, but client display and any `/player/device` POST uses the persisted id.

4. **`preferredDeviceId` absent from current device list → fall back to SDK default.** Given `preferredDeviceId` is set but the initial `GET /player/devices` response does NOT include that id, when the devices list resolves, `selectedDevice` falls back to the SDK device (if `ready` has fired) or remains `null` → "Pick a device ▾" (if SDK not ready or failed). `preferredDeviceId` is NOT cleared from `hostPrefs` in this case — the persisted device may reappear on a later Refresh.

### Preference persistence via hostPrefs

5. **`preferredDeviceId` added to schema.** The `HostPrefs` interface in [src/client/lib/hostPrefs.ts](src/client/lib/hostPrefs.ts) gains `preferredDeviceId?: string`. The `isValid` guard accepts either a string or `undefined` for this field (missing is valid). Schema version stays at `1` — this is a backward-compatible additive field and older stored blobs (no `preferredDeviceId`) still pass validation.

6. **Persist on successful explicit pick.** Given the host selects a device via `DevicePicker` AND `POST /api/rooms/:code/player/device` returns 200, `writeHostPrefs({ preferredDeviceId: device.id })` runs immediately after the success branch in `handleDeviceSelected` (in `HostRoomPage`). A subsequent reload of the host page reads it back via `readHostPrefs()`.

7. **Do NOT persist the SDK device as `preferredDeviceId`.** The `sdk/device` POST fired from the `ready` callback must NOT call `writeHostPrefs`. Only explicit user picks via the `DevicePicker` set `preferredDeviceId`. Rationale: if the host explicitly left their last session on an iPhone, a new desktop page load should still prefer the iPhone, not silently clobber it with the freshly-registered SDK id.

8. **Do NOT clear `preferredDeviceId` on device absence.** If the persisted id is not in the current device list (host's iPhone is asleep / offline), the chip falls back to the SDK default but `preferredDeviceId` stays in `hostPrefs`. Next page load, if the iPhone has been woken, the persisted id is picked up again.

9. **Corrupt / mismatched schema resets to defaults.** Given stored `hostPrefs` JSON fails to parse OR has a non-matching `schemaVersion`, when `readHostPrefs()` runs, it returns `null` (existing behaviour per Story 9-2). This applies to `preferredDeviceId` automatically — no separate handling. The next `writeHostPrefs` call rebuilds the blob with defaults + the new partial.

### SDK failure path — banner rewrite

10. **Banner copy reworked.** `SdkFailureBanner.svelte` no longer shows "Spotify audio unavailable in this browser." + "Open in Spotify app" deep link. New copy: primary line reads **"Browser playback unavailable — pick a device to play on"**; secondary element is a primary action button labelled **"Pick a device"**. The `trackId` prop and the `spotify:track:<id>` deep-link are removed (unused under the new copy).

11. **Banner "Pick a device" action opens the picker.** Given `sdkFailed === true` AND the banner is visible, when the host taps "Pick a device", the banner invokes a new `onPickDevice` prop (provided by `HostRoomPage`) that calls `handleOpenDevicePicker('banner')`. This reuses the existing picker mount — no duplicate picker component.

12. **Banner auto-dismisses on successful pick.** Given `sdkFailed === true` (banner visible) AND the host picks any device via the picker AND `POST /api/rooms/:code/player/device` returns 200, `sdkFailed` is set to `false` and the banner disappears. Rationale: the room is now in a playable state with an external device; the SDK failure no longer blocks the session. The `sdkErrorFired` guard is NOT reset — if the SDK is still broken, re-showing the banner on a subsequent `initialization_error` would loop; auto-dismiss is a one-way state transition for the current page life.

13. **Banner stays up if devices empty.** Given `sdkFailed === true` AND the host opens the picker via the banner AND `GET /player/devices` returns `{ devices: [] }`, the picker renders its existing empty-state copy (Story 10-2 AC #8) AND the banner remains visible. The banner only auto-dismisses after a successful POST (AC #12).

14. **No UA sniffing.** The decision to show the banner / "Pick a device" default is driven **only** by observed SDK events — `ready` sets `sdkFailed = false`, `initialization_error` / `authentication_error` / `account_error` set `sdkFailed = true`. No reads of `navigator.userAgent`, `navigator.platform`, `window.matchMedia('(hover: none)')`, or `'ontouchstart' in window` for this decision. (Existing `@media (hover: hover)` CSS rules in the picker for non-related hover UX are unaffected — they are styling, not a behavioural gate.)

### First-time onboarding copy

15. **Empty-state onboarding block.** Given the picker is open AND the devices list is empty AND `sdkFailed === true`, the picker's existing empty-state message is extended to include a numbered onboarding block:

    ```
    No Spotify devices found.

    1. Open the Spotify app on your phone.
    2. Press play on any song.
    3. Come back here and tap Refresh.
    ```

    The "tap Refresh" line replaces the current run-on "…then tap Refresh" sentence. When `sdkFailed === false` (normal case: host is on desktop with working SDK but Spotify mobile app closed), the existing one-line empty state copy remains: "No Spotify devices found. Open your Spotify app and press play on any song, then tap Refresh."

16. **Onboarding is part of the picker, not a separate modal.** Do NOT add a new `IosOnboardingModal`, `FirstTimeHelp` component, etc. The numbered block lives inside `DevicePicker.svelte`'s existing empty-state branch, gated on a new optional `sdkFailed` prop.

### Regression gates

17. **Existing 10-2 picker behaviour unchanged.** Optimistic update, revert-on-failure, confirmation pill, Refresh button, restricted rows, Escape/backdrop dismiss, focus-return, WCAG AA tap targets, 768px popover breakpoint, and the AdvancedSettings "Playback Device" row all continue to work exactly as they did in 10-2. No regressions to `selectedDevice` handling beyond the additions in ACs #1, #3, #4, #6.

18. **SDK `ready` still POSTs `/sdk/device`.** The existing `fetch('/api/rooms/${code}/sdk/device', ...)` call inside the `ready` listener at [src/client/pages/HostRoomPage.svelte:188-196](src/client/pages/HostRoomPage.svelte#L188-L196) runs unchanged. Story 10-1 kept the `/sdk/device` path as an alias that forwards to the same handler as `/player/device`. Do not "tidy" this by renaming the path — the server accepts both, and the alias is load-bearing for any in-flight host tabs during rollout.

19. **`reinitSdk()` still works.** On `auth:restored` and `host:sdk-stale` WS events, `reinitSdk()` resets `sdkFailed = false` and tries again. After this story, that reset correctly re-registers the SDK device via the `ready` callback AND re-applies the SDK-default → `preferredDeviceId` selection logic. If a reinit succeeds after a prior failure, `selectedDevice` must reflect the newly-ready SDK device (unless `preferredDeviceId` resolves first).

20. **`hostPrefs` tests updated.** [src/client/__tests__/hostPrefs.test.ts](src/client/__tests__/hostPrefs.test.ts) gains cases for `preferredDeviceId`: (a) `readHostPrefs` returns `undefined` for the field when absent from stored blob, (b) `writeHostPrefs({ preferredDeviceId: 'abc' })` round-trips the value, (c) corrupt JSON → `readHostPrefs() === null` → fallback path. Existing tests continue to pass with `preferredDeviceId` as `undefined` in their expected-value objects — adjust expectations if needed to accept partial-match semantics, OR explicitly set `preferredDeviceId: undefined` in the expected shape.

21. **Lint, test, build, and svelte-check baseline.** `npm run lint` clean. `npm test` all green (expect +3 new hostPrefs tests, so ≥ 443 total — the 10-2 baseline is 440). `npm run build:client` clean. `svelte-check` stays at the 8-error baseline (do not add new errors).

## Tasks / Subtasks

- [x] **`src/client/lib/hostPrefs.ts` — schema extension** (ACs #5, #9)
  - [x] Add `preferredDeviceId?: string` to the `HostPrefs` interface and `StoredHostPrefs` interface.
  - [x] Extend `isValid` to accept `s.preferredDeviceId === undefined || typeof s.preferredDeviceId === 'string'`.
  - [x] In `readHostPrefs`, return `preferredDeviceId` in the destructured return object.
  - [x] In `writeHostPrefs` default-object fallback (line 56-61), leave `preferredDeviceId` off the defaults — it should stay `undefined` until explicitly set.
  - [x] Schema version stays at `1`.

- [x] **`src/client/__tests__/hostPrefs.test.ts` — new test cases** (AC #20)
  - [x] Add tests:
    - `preferredDeviceId` round-trips through write+read.
    - A stored blob without `preferredDeviceId` still passes validation and returns `preferredDeviceId: undefined`.
    - A stored blob with `preferredDeviceId: 42` (wrong type) fails validation → `readHostPrefs()` returns `null`.
    - `writeHostPrefs({ preferredDeviceId: 'abc' })` on top of existing prefs preserves the other four fields.
  - [x] Update any existing `toEqual({...})` expectations that may need `preferredDeviceId: undefined` added to match. (vitest `toEqual` treats missing vs. `undefined` keys as equal — existing expectations stay unchanged.)

- [x] **`src/client/components/SdkFailureBanner.svelte` — copy rewrite** (ACs #10, #11)
  - [x] Remove the `trackId` prop and the `<a href="spotify:track:{trackId}">` / "Open in Spotify app" fallback block.
  - [x] New props: `{ onPickDevice: () => void }`.
  - [x] Render one `<span>` for the primary message and one `<button class="pick-btn" onclick={onPickDevice}>` for the action.
  - [x] Button styling matches a primary-accent button on the danger banner background (`var(--accent)` bg + `var(--accent-fg)` text, min-height 36px, padding 6px 12px, font-weight 600).
  - [x] Button must be reachable by keyboard (default button behaviour is fine, no tabindex needed) and have visible `:focus-visible` outline.
  - [x] `role="alert"` stays on the outer div.

- [x] **`src/client/components/DevicePicker.svelte` — empty-state extension** (AC #15, #16)
  - [x] Add new optional prop `sdkFailed?: boolean` (default `false`).
  - [x] In the empty-state branch (`{:else if devices.length === 0}`), render two variants:
    - `sdkFailed === true`: the numbered 3-step block from AC #15.
    - `sdkFailed === false`: the existing one-line copy unchanged.
  - [x] Use `<ol class="onboarding-steps">` with three `<li>` items for the numbered block — font-size ~0.9rem, left-aligned.

- [x] **`src/client/pages/HostRoomPage.svelte` — main wiring** (ACs #1, #2, #3, #4, #6, #7, #11, #12, #14, #18, #19)
  - [x] Import `readHostPrefs, writeHostPrefs` from `../lib/hostPrefs.ts`.
  - [x] Add module-scoped `preferredDeviceId` — seeded from `readHostPrefs()?.preferredDeviceId` inside `onMount`.
  - [x] In the SDK `ready` listener, after the existing `/sdk/device` POST and `sdkReady = true`, set `selectedDevice` to the SDK device only if `selectedDevice === null`. No `writeHostPrefs` in `ready`.
  - [x] Added `onMount` step: if `preferredDeviceId` is set, fire an initial `getDevices(code)` call via an `AbortController`. On success, resolve the persisted device (non-restricted match) and override `selectedDevice`. Aborted in `onDestroy`.
  - [x] In `handleDeviceSelected`, inside the `res.ok` branch: `writeHostPrefs({ preferredDeviceId: deviceId })`. Not written on failure.
  - [x] In the `res.ok` branch: also `if (sdkFailed) sdkFailed = false`. `sdkErrorFired` is NOT reset.
  - [x] Updated `<SdkFailureBanner>` call site — removed `trackId`, added `onPickDevice={() => handleOpenDevicePicker('banner')}`.
  - [x] Extended `pickerSource` enum and `handleOpenDevicePicker` signature to `'chip' | 'settings' | 'banner'`. Confirmation pill already gated on `source === 'chip'`, so `'banner'` naturally suppresses it.
  - [x] Passed `{sdkFailed}` to `<DevicePicker>`.

- [x] **Regression check** (ACs #17, #18, #19, #21)
  - [x] `npm run lint` — no errors.
  - [x] `npm test` — 443 passed (+3 new hostPrefs cases from 440 baseline).
  - [x] `npm run build:client` — clean.
  - [x] `npx svelte-check` — 0 errors (better than 8-error baseline; the 10-2 follow-up commit `c35f7ee` already cleared svelte-check; no new issues added).
  - [x] Manual verification deferred to reviewer per usual Epic 10 flow.

### Review Findings

- [x] [Review][Decision] AC19: `reinitSdk()` clears `selectedDevice` when host was on SDK device — fixed: `if (selectedDevice?.name === 'Bangerbingo (this browser)') selectedDevice = null` added to `reinitSdk()` [src/client/pages/HostRoomPage.svelte — reinitSdk()]
- [x] [Review][Patch] Stale closure: capture `preferredDeviceId` at dispatch time in `onMount` prefetch — fixed: `capturedPreferredId` const added, `!preferredDeviceId` guard removed from `.then()` [src/client/pages/HostRoomPage.svelte:252-264]
- [x] [Review][Defer] Pre-existing: double `onSpotifyWebPlaybackSDKReady` assignment on HMR/fast-nav [src/client/pages/HostRoomPage.svelte — initSdkPlayer] — deferred, pre-existing
- [x] [Review][Defer] Pre-existing: `device.id` could be null as Svelte keyed-each key in DevicePicker [src/client/components/DevicePicker.svelte] — deferred, pre-existing

## Dev Notes

### Load-order hazard: SDK `ready` vs devices-fetch race

The SDK `ready` callback and the initial `getDevices(code)` call are both async. Either can resolve first, and both can write `selectedDevice`. The precedence rule is:

1. If `preferredDeviceId` resolves to a device in the current list → that wins, regardless of SDK state.
2. Else if SDK `ready` has fired → SDK device wins.
3. Else → `selectedDevice` stays `null` → chip shows "Pick a device ▾".

Implement this with guards inside each async resolution, not with a shared "is selection done" flag:

```ts
// SDK ready handler
if (selectedDevice === null) {
  selectedDevice = { id: device_id, name: 'Bangerbingo (this browser)', type: 'Computer' }
}

// Devices fetch success handler
if (preferredDeviceId) {
  const hit = result.devices.find(d => d.id === preferredDeviceId && !d.is_restricted)
  if (hit) selectedDevice = { id: hit.id, name: hit.name, type: hit.type }
}
```

This pattern also handles `reinitSdk()` correctly — after `sdkFailed` is reset, the next `ready` event finds `selectedDevice === null` (assuming prior selection was cleared in `reinitSdk`) or leaves the existing picked device untouched (preferred).

**Open detail for implementer:** `reinitSdk()` does NOT currently reset `selectedDevice`. That's fine — if the host had picked an iPhone before the SDK hiccup, keeping that selection through the reinit is correct. Don't change this.

### Why `preferredDeviceId` overrides SDK default (AC #3)

The common iOS-host case: host sets up on desktop (SDK works, they pick their phone anyway to try it), then later opens a new tab on the phone (SDK fails, `preferredDeviceId` points to the phone id, which is now also the locally-registered device). In that case the persisted preference matches what the host wants by instinct. On desktop, if the host reopens, SDK comes up → `ready` fires → but `preferredDeviceId` still points at the phone. The rule "persisted wins if present in list" means desktop still routes audio to the phone by default, which matches the intent ("I always want to play on the good speaker in the living room"). If the phone is off, the persisted id is absent from the list → we fall back to the SDK device.

### Why NOT persist the SDK device id (AC #7)

The SDK device id is generated fresh per session (`new Spotify.Player()` → new id each time). Persisting it would:
- Fill `hostPrefs` with a stale id that never matches the new session's SDK id.
- Override a legitimate explicit pick from a prior session.

Only persist what the user explicitly picked. The SDK device is implicit — it "just works" when the browser supports it, and we don't need persistence to re-select it (the `selectedDevice === null` guard in the `ready` handler covers the default case).

### Why banner auto-dismiss is one-way (AC #12)

If the SDK is still broken (e.g. iOS Safari), `initialization_error` could theoretically fire again on re-init or re-connect, which would re-raise the banner. By NOT resetting `sdkErrorFired`, we keep the banner hidden for the rest of the page life once the host has a working device selected. The flip side: if `reinitSdk()` is called (AC #19), `sdkErrorFired` IS reset in the existing code at [src/client/pages/HostRoomPage.svelte:213-221](src/client/pages/HostRoomPage.svelte#L213-L221). That's intentional — a deliberate re-init (from an auth-restored event) should be allowed to re-show the banner if it fails again. The rule is "don't re-raise from an already-failed SDK, but DO re-raise after a deliberate retry."

### Why the banner button should be primary-styled, not a link

The old banner had an underlined text link. The new banner has a deliberate call-to-action that should look tappable on mobile. A button with background, padding, and an obvious tap target is the right affordance. Match the styling of existing primary buttons elsewhere in the app — `.casual-btn.active` in `HostRoomPage.svelte`'s style block is the closest precedent.

### Picker `sdkFailed` prop plumbing

`HostRoomPage` already owns `sdkFailed`. Just forward it to `DevicePicker`:

```svelte
<DevicePicker
  {code}
  activeDeviceId={selectedDevice?.id ?? null}
  incomingError={pickerError}
  onDeviceSelected={handleDeviceSelected}
  onClose={() => { showDevicePicker = false }}
  returnFocusEl={chipRef}
  {sdkFailed}
/>
```

`DevicePicker` only reads `sdkFailed` inside its empty-state branch; it does not affect any other render logic.

### Confirmation-pill suppression for banner-origin picks

Existing `pickerSource === 'chip'` gate in `handleDeviceSelected` at [src/client/pages/HostRoomPage.svelte:151-155](src/client/pages/HostRoomPage.svelte#L151-L155) already suppresses the `confirmPill` for `'settings'` picks (the AdvancedSettings row has its own saved-pill). When a banner pick succeeds, the user is being unblocked from a blocking failure state — a transient "Playing on {deviceName}" pill is not the right feedback; the banner disappearing IS the feedback. So extend the non-chip branch to include `'banner'`.

```ts
if (source === 'chip') {
  // show confirmPill
}
// For 'settings' and 'banner', no confirmation pill.
```

### Anti-patterns to avoid

- **Don't UA-sniff.** No `/iPhone|iPad|iPod/.test(navigator.userAgent)` anywhere. This is a hard spec rule (AC #14). The SDK event stream is the truth.
- **Don't mount a second picker inside `SdkFailureBanner`.** The banner is a thin UI layer; all picker state lives in `HostRoomPage`. The banner fires a callback, nothing more.
- **Don't write `preferredDeviceId` on SDK `ready`.** The SDK id changes every session — persisting it corrupts the "remember my explicit pick" semantic.
- **Don't reset `sdkErrorFired` on banner auto-dismiss.** That's what keeps the banner from flapping.
- **Don't clear `preferredDeviceId` when the persisted device is absent from the current list.** The host's iPhone might just be asleep; the next page load may resolve it successfully.
- **Don't persist `activeDeviceName` or `type`.** Only the id. Name and type are re-resolved from the `/player/devices` response on next load. Names and types can change Spotify-side (device renamed in the Spotify app) and we want the current value, not a stale cache.
- **Don't bump `schemaVersion` in `hostPrefs.ts`.** Adding an optional field is backward-compatible. Bumping the version would discard every host's existing `clipDuration` / `audioPreset` / `allowCasualMode` prefs from Story 9-2 — that would be a regression.
- **Don't introduce a new `SdkDeviceProvider` or wrapper component.** `HostRoomPage` is the right owner for this state; it already owns every other device-related piece of state.
- **Don't try to "fix" the `/sdk/device` path to `/player/device` in the `ready` listener.** The server aliases them. Changing client code here has no behavioural benefit and risks cold-reload issues during deploy.

### Server side is already correct

Story 10-1's `handleSetPlayerDevice` at [src/server/rooms.ts:618](src/server/rooms.ts#L618) handles both `/sdk/device` and `/player/device` identically. Both paths:
- Store `deviceId` into `roomState.sdkDeviceId`.
- Trigger `transfer_playback` on a mid-round active swap.
- Return 2xx on success, non-2xx on failure.

No server changes needed for this story.

### localStorage key and schema

The existing key `bb:host-prefs:v1` and `schemaVersion: 1` are preserved. The stored shape goes from:

```jsonc
{ "schemaVersion": 1, "clipDuration": 30, "titleRevealDelay": 10, "audioPreset": "minimal", "allowCasualMode": false }
```

to:

```jsonc
{ "schemaVersion": 1, "clipDuration": 30, "titleRevealDelay": 10, "audioPreset": "minimal", "allowCasualMode": false, "preferredDeviceId": "abc123" }
```

The `preferredDeviceId` is omitted when unset. Legacy stored blobs (no field) pass validation.

### Manual verification checklist

- Desktop Chrome, fresh session (no `preferredDeviceId` yet): page loads → SDK `ready` fires → chip shows "Bangerbingo (this browser)" with 💻 icon (desktop) or just 💻 + ▾ (mobile viewport emulation).
- Desktop, pick an external device (e.g. phone) → chip updates → reload page → chip still shows that phone (persisted via `preferredDeviceId`).
- Desktop, phone goes offline (closes Spotify app on phone) → reload → chip falls back to "Bangerbingo (this browser)". `preferredDeviceId` NOT cleared from localStorage (inspect via devtools). Re-wake phone, reload → chip shows phone again.
- iOS Safari (real device or force-fail by blocking sdk.scdn.co in devtools Network): `initialization_error` fires → SdkFailureBanner shows new copy "Browser playback unavailable — pick a device to play on" + "Pick a device" button → tap button → picker opens → select phone → banner disappears → chip shows phone.
- iOS Safari, SDK fails AND Spotify app is not running: picker empty-state shows numbered 3-step block.
- Corrupt `hostPrefs` (manually overwrite localStorage with `{"schemaVersion": 1}` missing required fields): page load → `readHostPrefs()` returns `null` → host gets default clip/reveal/preset/casual values, no `preferredDeviceId` applied. SDK default takes over as normal.
- Persistence survives across tabs: open game page in two tabs → pick phone in tab A → reload tab B → chip shows phone.
- Auth re-degrade + restore: simulate `auth:degraded` → `auth:restored` → `reinitSdk()` runs → `ready` fires again → chip shows correct device per the precedence rule.

## Previous Story Intelligence (from 10-1 and 10-2)

- **`bun run lint` = `tsc --noEmit`.** TypeScript gate. Unused imports from removed props (`trackId`) must be cleaned up in `SdkFailureBanner.svelte` or lint will fail.
- **`svelte-check` baseline: 8 pre-existing errors.** Run `npm run check` before handoff; additions surface here, not in `tsc`.
- **Test count baseline: 440** (per 10-2 completion notes). This story adds ≥ 3 `hostPrefs` tests → expect ≥ 443.
- **Error-shape on POST failures.** Server returns `{ message: string }` on non-200; client just checks `res.ok`. No parsing needed.
- **No new WS events.** Epic 10 design explicitly excludes WS broadcasts for device swaps / preferences. Everything is local + persisted on the host client.
- **`sdkDeviceId` field name not renamed.** The server's in-memory state still uses `sdkDeviceId` even for non-SDK devices. Don't "fix" this in client code — 10-1 documented it intentionally.
- **OAuth scope bump already done in 10-1.** `user-read-playback-state` and `user-modify-playback-state` are on the login redirect (see [src/server/auth.ts:105](src/server/auth.ts#L105)). Existing hosts from pre-10-1 must re-login once for `/player/devices` to work. This story inherits that requirement; no new action needed.
- **`pickerSource` gate pattern (from 10-2 review).** `HostRoomPage` already uses `pickerSource: 'chip' | 'settings'` to suppress the confirmation pill for non-chip picks. Extending this to `'banner'` is a small addition, not a rewrite.
- **Race guard (`isSwitchingDevice`) from 10-2 review.** Already in place for rapid repeat picks. No new guard needed; `handleDeviceSelected`'s existing early-return handles the concurrency.
- **Focus-return uses `returnFocusEl?.isConnected` check** (10-2 review finding). Already implemented in `DevicePicker.onDestroy`. No change here; the banner button becomes a valid `document.activeElement` target when tapped, so the existing focus-return flow works.

## Git Intelligence Summary

Recent commits on `main`:
- `c35f7ee fix(types): clear svelte-check errors` — housekeeping, cleared the svelte-check baseline after 10-2.
- `8a84cd7 feat(epic-10): story 10-2 — Device Chip + Picker UI` — DeviceChip + DevicePicker + HostRoomPage wiring + AdvancedSettings row.
- `a832a38 feat(epic-10): story 10-1 — Device List API & Live-Swap Endpoint` — server endpoints + OAuth scope bump.
- `6684a4b docs: draft spec — self-rename in Players list` — unrelated spec doc.
- `e61815f style(players-overlay): match song-history row styling in-game` — unrelated CSS tweak.

No recent commits touch `hostPrefs.ts` or `SdkFailureBanner.svelte`. Both files are stable and ready for extension.

## Latest Tech Information

- **Svelte 5 `$props()` optional with default.** `let { sdkFailed = false }: { sdkFailed?: boolean } = $props()` for `DevicePicker`. Works identically to other optional props already in that file.
- **Svelte 5 `$effect` for async race.** The devices-fetch vs SDK-ready race can be handled with sequential `await` in `onMount` (if the bootstrap runs linearly) or independent handlers that check `selectedDevice === null` before writing (preferred — decouples the two async paths and survives `reinitSdk` flows).
- **`AbortController` for mount-time fetches** (from 10-2 review). The initial `getDevices` call in `HostRoomPage.onMount` should use an `AbortController` and abort in `onDestroy` — matches the pattern DevicePicker uses internally. Prevents a stale response writing `selectedDevice` after unmount.
- **Spotify Web Playback SDK (April 2026).** No known API changes since 10-1/10-2. `Spotify.Player.addListener('ready', ...)` callback still receives `{ device_id: string }`; `initialization_error` / `authentication_error` / `account_error` fire once per failure mode. Re-issuing `new Spotify.Player()` in `reinitSdk` generates a new `device_id` — this is why we don't persist the SDK id.
- **localStorage quota on mobile Safari.** Mobile Safari in private browsing mode throws on `setItem`. Story 9-2's `writeHostPrefs` already wraps in `try/catch` — the `preferredDeviceId` write inherits that safety. No separate handling needed.

## Project Context Reference

No `project-context.md` in repo. Conventions carried forward from prior stories:

- CSS custom properties only (`var(--fg)`, `var(--bg-2)`, `var(--accent)`, `var(--danger)`, `var(--accent-fg)`). No Tailwind.
- Scoped `<style>` blocks per component.
- Svelte 5 runes: `$state`, `$derived`, `$effect`, `$props`. No stores.
- `onMount` / `onDestroy` imported from `'svelte'`.
- `bb:host-prefs:v1` as localStorage key, `schemaVersion: 1`.
- `@media (min-width: 768px)` breakpoint for mobile → desktop layout switches.
- `@media (hover: hover)` guard around `:hover` rules (10-2 review pattern) to prevent sticky hover on iOS touch.
- Tap target baseline: 44×44px minimum (UX-DR21).

## References

- Epic 10 brief: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) (Story 10-3: lines 1869–1941)
- Story 10-1 (done): [_bmad-output/implementation-artifacts/10-1-device-list-api-and-live-swap-endpoint.md](_bmad-output/implementation-artifacts/10-1-device-list-api-and-live-swap-endpoint.md)
- Story 10-2 (done): [_bmad-output/implementation-artifacts/10-2-device-chip-and-picker-ui.md](_bmad-output/implementation-artifacts/10-2-device-chip-and-picker-ui.md)
- hostPrefs (to modify): [src/client/lib/hostPrefs.ts](src/client/lib/hostPrefs.ts)
- hostPrefs tests (to extend): [src/client/__tests__/hostPrefs.test.ts](src/client/__tests__/hostPrefs.test.ts)
- SdkFailureBanner (to rewrite): [src/client/components/SdkFailureBanner.svelte](src/client/components/SdkFailureBanner.svelte)
- DevicePicker (extend empty-state): [src/client/components/DevicePicker.svelte](src/client/components/DevicePicker.svelte)
- HostRoomPage (main wiring): [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte)
- DeviceChip (untouched — already renders whatever `selectedDevice` we set): [src/client/components/DeviceChip.svelte](src/client/components/DeviceChip.svelte)
- Server device-write handler (untouched): [src/server/rooms.ts:614-684](src/server/rooms.ts#L614-L684)
- Spotify Web Playback SDK — initialization errors: https://developer.spotify.com/documentation/web-playback-sdk/reference#events

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

None.

### Completion Notes List

- Extended `HostPrefs` / `StoredHostPrefs` with optional `preferredDeviceId: string` and taught `isValid` to accept absent or string. Schema version stays at `1`, so older `bb:host-prefs:v1` blobs (no field) still pass validation (AC #5, #9). `readHostPrefs` returns the field (including `undefined`) via destructuring; `writeHostPrefs` defaults omit it so it only becomes present after an explicit partial write.
- Added 3 new `hostPrefs` tests (round-trip with existing fields preserved, absent field → `undefined`, wrong type → `null`). Existing `toEqual({...})` expectations were left unchanged — vitest treats missing vs. `undefined` keys as equal. Test total: 443 (was 440 per 10-2 baseline).
- `SdkFailureBanner.svelte` fully rewritten: removed `trackId` prop + Spotify deep-link fallback; new single `{ onPickDevice }` prop; renders one `<span class="msg">` + one `<button class="pick-btn">`. Button uses `var(--accent)` bg + `var(--accent-fg)` text, 36px min-height, 6px 12px padding, weight 600, with `:focus-visible` outline. `role="alert"` preserved.
- `DevicePicker.svelte` gained an optional `sdkFailed = false` prop. Empty-state branch now forks: when `sdkFailed`, renders the 3-step onboarding `<ol class="onboarding-steps">`; otherwise, the original single-line copy is unchanged. Left-aligned block via a small `.onboarding` / `.onboarding-steps` style addition.
- `HostRoomPage.svelte` wiring:
  - New local `preferredDeviceId: string | undefined` and `initialDevicesController: AbortController | undefined`. `preferredDeviceId` seeded in `onMount` from `readHostPrefs()?.preferredDeviceId`.
  - SDK `ready` listener: after the existing `/sdk/device` POST and `sdkReady = true`, sets `selectedDevice` to `{ id: device_id, name: 'Bangerbingo (this browser)', type: 'Computer' }` iff `selectedDevice === null`. Does NOT call `writeHostPrefs`.
  - New `onMount` branch: when `preferredDeviceId` is present, fires `getDevices(code, signal)` via an `AbortController`; on success, promotes the persisted device (iff present and non-restricted) over any SDK default. Aborted in `onDestroy`. Errors swallowed (fall back to SDK default / null).
  - `handleDeviceSelected` `res.ok` branch now: updates `preferredDeviceId`, calls `writeHostPrefs({ preferredDeviceId: deviceId })`, and clears `sdkFailed` if set. `sdkErrorFired` intentionally NOT reset (AC #12 one-way transition).
  - `pickerSource` widened to `'chip' | 'settings' | 'banner'`. `handleOpenDevicePicker` signature widened to match. Confirmation pill already gated on `source === 'chip'`, so the new `'banner'` source suppresses the pill naturally (matches spec — the banner disappearing IS the feedback).
  - `<SdkFailureBanner>` call site: `trackId` removed; `onPickDevice={() => handleOpenDevicePicker('banner')}` added.
  - `<DevicePicker>` call site now forwards `{sdkFailed}`.
- No server changes needed (Story 10-1 already aliased `/sdk/device` ↔ `/player/device`).
- No UA sniffing introduced anywhere (AC #14).
- `reinitSdk()` path unchanged — because the `ready` handler guards on `selectedDevice === null`, a reinit after prior failure will re-populate the SDK device only if no selection is currently resolved (preserves an explicit pick across reinit, per Dev Notes).

### File List

Modified:
- src/client/lib/hostPrefs.ts
- src/client/__tests__/hostPrefs.test.ts
- src/client/components/SdkFailureBanner.svelte
- src/client/components/DevicePicker.svelte
- src/client/pages/HostRoomPage.svelte
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/10-3-sdk-default-preference-persistence-and-failure-path.md

## Open Questions

None — all design decisions resolved by the epics spec and the 10-1/10-2 context. Two judgment calls the implementer can make freely without blocking:

1. **Exact button styling for SdkFailureBanner "Pick a device" action.** The spec calls for primary-button affordance; pick whichever `var(--accent)` + `var(--accent-fg)` combination reads best against the danger-red banner background. If contrast is poor, a white button with danger-red text is also acceptable.
2. **Whether to extend `pickerSource` to three values or fold `'banner'` into `'settings'` semantics.** Both satisfy the spec (both suppress the confirmation pill). Three explicit values is more self-documenting and recommended, but a two-value enum with a comment is fine.

## Change Log

| Date       | Change                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 2026-04-20 | Story 10-3 drafted — SDK-first default, `preferredDeviceId` persistence, SdkFailureBanner rewrite with picker CTA, empty-state onboarding block when `sdkFailed`. Client-only (server already done in 10-1). |
| 2026-04-20 | Story 10-3 implemented — hostPrefs extended with `preferredDeviceId` (+3 tests); SdkFailureBanner rewritten with "Pick a device" CTA; DevicePicker empty-state gains `sdkFailed` onboarding; HostRoomPage wires SDK-default, persisted-override, banner auto-dismiss. Lint + build + svelte-check clean; 443/443 tests pass. Status → review. |
