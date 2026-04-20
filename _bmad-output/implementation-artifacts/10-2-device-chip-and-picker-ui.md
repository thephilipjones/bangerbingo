# Story 10.2: Device Chip + Picker UI

Status: done

## Story

As a host,
I want a compact device chip in my playback bar that opens a bottom-sheet list of my Spotify Connect devices (and surfaces in the live Host Controls Advanced Settings row so I can swap mid-round too),
so that I can pick any audio device without leaving the game screen, and see a brief confirmation when audio transfers.

## Background

Story 10-1 added the server endpoints (`GET /player/devices` and `POST /player/device`). This story wires up the client UI that drives those endpoints. The server is the single source of truth for `sdkDeviceId`; the client tracks the currently selected device locally for display and reverts on failure.

The UX model is: chip in the Mini Player (always visible) + mirrored row in HostControlsOverlay Advanced Settings (reachable during live round). **One `DevicePicker` component**, opened from either surface. No duplicate fetch or POST logic.

Story 10-3 adds preference persistence (`preferredDeviceId` in `hostPrefs`) and the SDK-default chip label ("Bangerbingo (this browser)"). This story does NOT touch `hostPrefs` or the `SdkFailureBanner` copy — those are explicitly 10-3 scope.

## Acceptance Criteria

### DeviceChip in Mini Player

1. **Chip renders.** A `DeviceChip` component appears in the `HostMiniPlayer` row, positioned between the track-info area and the gear button (or replacing part of the flex layout) so the full row remains usable at 375px. The chip shows `[icon  name ▾]` where icon is derived from the Spotify `type` field: 📱 Smartphone, 🔊 Speaker, 💻 Computer, generic (🎵 or ♫) for all other types.

2. **No-device label.** Given no device has been selected via the picker yet (fresh session — Story 10-3 will add SDK-default tracking), when the chip renders, it shows "Pick a device ▾" as a neutral fallback label.

3. **Opens picker.** Tapping or clicking the chip opens the `DevicePicker` sheet. If the picker is already open, the tap is a no-op.

4. **Mobile compactness.** At <768px viewport width, the chip shows only the device-type icon + "▾" (no device-name text) to avoid crowding the playback controls. At ≥768px it shows the full `[icon  name ▾]` label inline. This matches the existing `HostMiniPlayer` pattern where `.btn-label` is `display: none` on mobile.

### DevicePicker sheet

5. **Fetch and display on open.** When the picker opens, the client immediately fires `GET /api/rooms/:code/player/devices` and renders a loading state (spinner/skeleton or "Loading devices…" copy) until the response arrives. On success, it lists every device with its type icon, device name, and a check mark (✓) or highlight on the currently selected `deviceId`.

6. **Select a device.** Given the picker is open and the host taps a device row that is NOT currently selected, the client:
   a. Optimistically updates the chip label to the new device name + icon.
   b. POSTs `{ deviceId: <id> }` to `POST /api/rooms/:code/player/device`.
   c. Closes the picker.
   d. On a non-200 response: reverts the chip label to the previous selection (or "Pick a device ▾" if there was none), stores an error string `"Couldn't switch device"` that is shown as an inline message the next time the picker opens (auto-clears after 3 seconds once visible).

7. **Refresh button.** The picker header includes a "Refresh" button. Tapping it re-fires `GET /player/devices`, re-renders the list, and keeps the currently selected id highlighted if still present in the new list. The button is disabled during an in-flight fetch.

8. **Empty state.** Given the server returns `{ devices: [] }`, the picker renders: _"No Spotify devices found. Open your Spotify app and press play on any song, then tap Refresh."_ The Refresh button remains visible and active.

9. **GET failure state.** Given `GET /player/devices` returns a non-200 or throws, the picker renders: _"Couldn't load devices — tap Refresh to retry."_ The Refresh button remains active.

10. **Restricted devices.** Given a device has `is_restricted: true`, the picker renders that row visually grayed (muted text + cursor: default) and non-interactive. The device cannot be selected.

11. **Tapping the current device is a no-op.** Given the picker is open and the host taps the row that IS the currently selected device, the client POSTs nothing and closes the picker.

12. **Confirmation pill.** Given the host is mid-round AND successfully swaps to a new device via the picker (POST returns 200), the Mini Player area shows a brief `"Playing on {deviceName}"` confirmation pill that auto-dismisses after ~1.5s. Round state (card, song history, players, playback controls) is visually unaffected — only the chip label and the confirmation pill change.

### DevicePicker accessibility

13. **Tap targets.** All interactive rows, the Refresh button, and the close (×) button meet the existing WCAG AA ≥44×44px baseline (matches UX-DR21 project convention).

14. **Dismiss behaviour.** The picker dismisses on: backdrop tap, the × close button, and the `Escape` key. Focus returns to the chip button that opened it on dismiss (same pattern used for `SongHistoryDrawer` and `PlayersOverlay`).

### AdvancedSettings "Playback device" row (live mode)

15. **Row renders in live mode.** When `mode === 'live'`, `AdvancedSettings` renders a "Playback device" section below the existing four rows (`clipDuration`, `titleRevealDelay`, `audioPreset`, `allowCasualMode`), using the identical `.option-section` / `.row-header` / `.option-label` structure as its neighbours.

16. **Row shows current device.** The row displays the active device name (or "No device selected") as a single-pill-styled button that opens the `DevicePicker` on click.

17. **Same swap semantics.** Selecting a device from the picker opened via the AdvancedSettings row uses the exact same POST + confirmation flow as the chip — no duplicate network logic. The `DevicePicker` is a shared component invoked with the same props from either surface.

18. **Save/error feedback.** A successful device swap from the AdvancedSettings row shows a `"Switched to {name}"` saved-pill message (1.5s auto-dismiss, matching `SAVED_COPY` pattern in `AdvancedSettings`). A failure shows `"Couldn't switch device"` error-pill (3s auto-dismiss).

### Regression gates

19. **Play/Pause, Next, and Gear controls remain functional.** Adding the chip must not interfere with the existing `HostMiniPlayer` button handlers. No `z-index` or `pointer-events` issues.

20. **SDK `ready` callback and existing `/sdk/device` POST are untouched.** `HostRoomPage` still fires `POST /api/rooms/:code/sdk/device` from the `ready` listener (Story 10-1 kept the alias). The chip shows "Pick a device ▾" until the user picks explicitly (Story 10-3 will auto-select the SDK device).

21. **`bun run lint` + `bun run build:client` clean.** No new TypeScript errors, no new `svelte-check` errors. Current `svelte-check` baseline is 8 pre-existing errors — do not add to this count.

## Tasks / Subtasks

- [x] **API layer — `src/client/lib/api.ts`** (ACs #5, #6)
  - [x] Add `SpotifyDevice` interface: `{ id: string; name: string; type: string; is_active: boolean; is_restricted: boolean; volume_percent: number | null }`.
  - [x] Add `getDevices(code: string): Promise<{ devices: SpotifyDevice[] }>` — `fetch('/api/rooms/${code}/player/devices')`, throw on non-200.
  - [x] Add `postSetDevice(code: string, deviceId: string): Promise<Response>` — raw `fetch` returning the `Response` so the caller can inspect the status code (matches `patchRoundConfig` pattern at [src/client/lib/api.ts:113-119](src/client/lib/api.ts#L113-L119)).

- [x] **`DeviceChip.svelte` — new component** (ACs #1, #2, #3, #4)
  - [x] Props: `selectedDevice: { id: string; name: string; type: string } | null`, `onclick: () => void`.
  - [x] Render a `<button class="device-chip">` with min-height 44px, min-width 44px.
  - [x] Icon map function `deviceIcon(type: string): string` → `'📱'` (Smartphone), `'🔊'` (Speaker), `'💻'` (Computer), `'🎵'` (else).
  - [x] Mobile (<768px): `.chip-label { display: none }` — show only icon + `▾`.
  - [x] Desktop (≥768px): show icon + truncated name + `▾`.
  - [x] Style: `background: var(--bg-2)`, `border: var(--rule-thin) solid var(--rule)`, matches `.ctrl-btn` appearance in `HostMiniPlayer`.

- [x] **`DevicePicker.svelte` — new component** (ACs #5–#14)
  - [x] Props: `code: string`, `activeDeviceId: string | null`, `incomingError: string | null`, `onDeviceSelected: (device: SpotifyDevice) => void`, `onClose: () => void`.
  - [x] On mount, fire `getDevices(code)` and set loading state.
  - [x] Fetch states: `'loading' | 'ok' | 'error'` — render loading skeleton, device list, or error message.
  - [x] Device list: `<ul role="listbox">` with `<li role="option">` rows; each row: icon + name + check mark if `device.id === activeDeviceId`; grayed + `aria-disabled="true"` if `device.is_restricted`.
  - [x] Row tap: call `onDeviceSelected(device)` then `onClose()`.
  - [x] Current device row tap (`device.id === activeDeviceId`): call `onClose()` only — no `onDeviceSelected`.
  - [x] Refresh button in header: disabled during in-flight fetch; re-calls `getDevices()` on click.
  - [x] If `incomingError` is non-null, render it as a `.picker-error` message (3s auto-dismiss via `setTimeout` on mount; clear on close).
  - [x] Backdrop: `<div class="overlay" onclick={onClose}>` at z-index 155.
  - [x] Sheet: `position: fixed; bottom: 0; left: 0; right: 0; max-height: 80vh; z-index: 156` (above `HostControlsOverlay` at 150).
  - [x] Desktop ≥768px: render as a popover (`position: fixed; bottom: 72px; right: 8px; width: 360px; z-index: 156`) with `box-shadow: var(--shadow-overlay)` — same breakpoint pattern as `HostControlsOverlay`.
  - [x] `Escape` key: `onkeydown` on the sheet element or `window` listener — call `onClose()`.
  - [x] Return focus to the chip button on close: `document.activeElement` captured in `handleOpenDevicePicker` before open, passed as `returnFocusEl` to `DevicePicker`.

- [x] **`HostMiniPlayer.svelte` — modify** (ACs #1, #4, #12, #19)
  - [x] New props: `selectedDevice: { id: string; name: string; type: string } | null`, `onDeviceChipClick: () => void`, `confirmPill: string | null`.
  - [x] Import and render `<DeviceChip>` between the track-info div and the gear button.
  - [x] Render `{#if confirmPill}<p class="confirm-pill" role="status">{confirmPill}</p>{/if}` — positioned `absolute; bottom: calc(100% + 6px)` above chip, does not disturb mini-player layout.
  - [x] On mobile, the chip's icon-only mode should consume ≤44px width so the mini-player layout remains valid at 375px.

- [x] **`HostRoomPage.svelte` — modify** (ACs #2, #3, #6, #12, #20)
  - [x] New state: `selectedDevice`, `showDevicePicker`, `pickerError`, `confirmPill`, `deviceSwitchResult`, `confirmPillTimer`, `deviceSwitchResultTimer`, `chipRef`.
  - [x] `handleDeviceSelected(device: SpotifyDevice)`: optimistic update, POST, revert + error on failure, confirmPill + deviceSwitchResult='saved' on success.
  - [x] `handleOpenDevicePicker()`: captures `document.activeElement` as `chipRef`, sets `showDevicePicker = true`.
  - [x] Import and conditionally render `<DevicePicker>` when `showDevicePicker`.
  - [x] Pass `{selectedDevice}`, `onDeviceChipClick={handleOpenDevicePicker}`, `{confirmPill}` to `<HostMiniPlayer>`.
  - [x] Pass `activeDeviceId`, `activeDeviceName`, `onOpenDevicePicker`, `deviceSwitchResult` to `<HostControlsOverlay>`.
  - [x] Clear all timers in `onDestroy`.

- [x] **`HostControlsOverlay.svelte` — modify** (ACs #15, #16, #17, #18)
  - [x] New optional props: `activeDeviceId`, `activeDeviceName`, `onOpenDevicePicker`, `deviceSwitchResult`.
  - [x] Pass these through to `<AdvancedSettings>`.

- [x] **`AdvancedSettings.svelte` — modify** (ACs #15, #16, #17, #18)
  - [x] New optional props: `activeDeviceName`, `onOpenDevicePicker`, `deviceSwitchResult`.
  - [x] Add "Playback Device" section (rendered only when `mode === 'live'`), after Casual Mode section.
  - [x] Section structure: `.row-header` with `.option-label` "Playback Device" + saved/error pills, then a `<button class="pill device-pill">` showing `activeDeviceName ?? 'No device selected'`.
  - [x] Saved/error feedback via `$effect` reacting to `deviceSwitchResult` prop, `deviceSaved`/`deviceError` state flags, auto-dismiss timers.

- [x] **Regression check** (ACs #19, #20, #21)
  - [x] `npm run lint` (= `tsc --noEmit`) clean — no errors.
  - [x] `npm test` — 440 tests, all pass unchanged.
  - [x] `npm run build:client` clean — build succeeds.
  - [x] `svelte-check` error count = 8 (baseline maintained).

## Dev Notes

### Component architecture — one picker, two entry points

The `DevicePicker` is **always mounted at the `HostRoomPage` level** (same as `SongHistoryDrawer` and `PlayersOverlay`), not inside `HostMiniPlayer` or `AdvancedSettings`. This avoids z-index stacking issues with the `HostControlsOverlay` (z-index 150) and keeps the open/close state in one place. Both entry points (chip click, AdvancedSettings row button) call the same `handleOpenDevicePicker()` function in `HostRoomPage` which sets `showDevicePicker = true`.

The `handleDeviceSelected` handler in `HostRoomPage` owns the optimistic update, POST, revert, confirmation pill, and error state. Neither `DevicePicker`, `DeviceChip`, nor `AdvancedSettings` make direct fetch calls — they receive callbacks.

### z-index layers

```
190   SdkFailureBanner / error banners
200   wsError banner
160+  (reserved for future modals)
156   DevicePicker sheet
155   DevicePicker backdrop
150   HostControlsOverlay / SongHistoryDrawer / PlayersOverlay sheet
149   HostControlsOverlay backdrop
20    HostMiniPlayer
```

The `DevicePicker` must sit above `HostControlsOverlay` (150) so the AdvancedSettings row can open it without it being hidden behind the overlay.

### Mini Player layout at 375px

Current mini-player is a `display: flex; justify-content: space-between` row with three sections:
- `.left-controls` (Play/Pause + Next, both 44×44px, gap 8px) → ~96px
- `.track-info` (flex: 1) → grows to fill
- `.gear-btn` (44×44px) → 44px
- padding: 24px total

Adding a chip between `.track-info` and `.gear-btn`:
- Mobile: chip is icon-only (44×44px max). The `.track-info` shrinks but still shows truncated text. Test at 375px — if space is too tight, reduce `min-width` on the chip to 40px.
- Desktop: chip shows icon + name (up to ~120px) with `overflow: hidden; text-overflow: ellipsis` on the name span.

Use `flex-shrink: 0` on `.left-controls`, the chip, and `.gear-btn` so only `.track-info` shrinks.

### Icon mapping

```ts
function deviceIcon(type: string): string {
  if (type === 'Smartphone') return '📱'
  if (type === 'Speaker') return '🔊'
  if (type === 'Computer') return '💻'
  return '🎵'
}
```

Spotify's documented `type` values include: `Computer`, `Tablet`, `Smartphone`, `Speaker`, `TV`, `AVR`, `STB`, `AudioDongle`, `GameConsole`, `CastVideo`, `CastAudio`, `Automobile`, `Unknown`. The generic `'🎵'` covers all non-listed types cleanly.

### Optimistic update + revert pattern

```ts
// In HostRoomPage
async function handleDeviceSelected(device: SpotifyDevice) {
  const prevDevice = selectedDevice
  selectedDevice = { id: device.id, name: device.name, type: device.type }
  const res = await postSetDevice(code, device.id).catch(() => null)
  if (res && res.ok) {
    clearTimeout(confirmPillTimer)
    confirmPill = `Playing on ${device.name}`
    confirmPillTimer = setTimeout(() => { confirmPill = null }, 1500)
  } else {
    selectedDevice = prevDevice
    pickerError = "Couldn't switch device"
  }
}
```

`pickerError` is passed as `incomingError` to `DevicePicker`. The picker shows it as an inline message for 3s then clears it. The error only shows once the picker is re-opened (already closed on POST; on failure, the picker remains closed — the error surfaces on next open).

Wait — re-reading AC #6d: "stores an error string that is shown as an inline message the next time the picker opens". The picker closes before the POST resolves (optimistic). So the error appears on next open. `pickerError` is set in `HostRoomPage`; `DevicePicker` receives it as `incomingError` on next mount. Implement `$effect(() => { if (incomingError) { ... start 3s timer } })` on mount.

### AdvancedSettings device feedback

`AdvancedSettings` doesn't own the POST — `HostRoomPage` does. To show the saved/error pill in the AdvancedSettings row, use a reactive prop:

```ts
// In AdvancedSettings
let {
  // ... existing props ...
  activeDeviceName = null,
  onOpenDevicePicker = undefined,
  deviceSwitchResult = null,  // 'saved' | 'error' | null
}: {
  // ...
  activeDeviceName?: string | null
  onOpenDevicePicker?: () => void
  deviceSwitchResult?: 'saved' | 'error' | null
} = $props()

// React to deviceSwitchResult changes
$effect(() => {
  if (deviceSwitchResult === 'saved') markSaved('device')
  else if (deviceSwitchResult === 'error') markError('device')
})
```

`HostRoomPage` sets `deviceSwitchResult` based on the POST outcome and clears it after the timer. Or simpler: add a `deviceSaved` and `deviceError` flag to the existing `savedFlags`/`errorMsgs` maps in `AdvancedSettings` and expose a `setDeviceResult(result: 'saved' | 'error')` method via Svelte's `bind:this` or just use the reactive prop approach above.

**Prefer the reactive prop** — no component refs needed, matches the existing `mode`-based conditional rendering pattern.

### DevicePicker dismiss and focus return

Capture the triggering element before opening the picker and restore focus on close:

```ts
// In HostRoomPage
let chipRef = $state<HTMLElement | undefined>(undefined)

function handleOpenDevicePicker() {
  // chipRef is bound to the DeviceChip button via bind:chipEl or passed as prop
  showDevicePicker = true
}

function handlePickerClose() {
  showDevicePicker = false
  pickerError = null
  chipRef?.focus()
}
```

Pass `bind:chipEl` on `<DeviceChip>` or expose a `chipRef` via a wrapper div in `HostMiniPlayer`. The simplest approach: `HostRoomPage` doesn't need the ref directly; `DevicePicker` accepts an optional `returnFocusEl?: HTMLElement` prop and calls `returnFocusEl?.focus()` on close.

### Svelte 5 patterns in use

- All state: `$state()` — no stores, no `writable()`.
- Derived: `$derived()` for computed values.
- Side effects: `$effect()` for reactive reactions to prop changes (e.g. `deviceSwitchResult`).
- No `svelte/store` imports needed.
- Cleanup: `onDestroy()` for `setTimeout` refs — import from `svelte`.

### Desktop popover for DevicePicker

At ≥768px, the `DevicePicker` should render as a popover anchored below the chip, not a full bottom-sheet. Use a CSS `@media (min-width: 768px)` block that overrides `bottom: 0; left: 0; right: 0` to `bottom: 72px; right: 8px; width: 360px` (mirrors `HostControlsOverlay`'s desktop transformation). The backdrop becomes `background: transparent` on desktop. This is purely CSS — no JS branching needed.

### Anti-patterns to avoid

- **Don't mount DevicePicker inside HostMiniPlayer or AdvancedSettings.** Z-index stack will fail when HostControlsOverlay is open.
- **Don't call `getDevices()` from DeviceChip's click handler.** The picker fetches on mount — the chip just sets `showDevicePicker = true`.
- **Don't close the picker before the POST resolves.** The picker DOES close immediately on row tap (optimistic). The POST runs in `handleDeviceSelected` in `HostRoomPage` after the picker is already closed.
- **Don't clear `pickerError` on picker close.** Set it to null only after it has been displayed (the picker reads it, displays it, and `HostRoomPage` clears it via `onClose` callback after the picker has had a chance to read it — or use a `$effect` in DevicePicker to clear after display).
- **Don't add new WS events.** No server broadcast for device swaps — the host owns their device selection locally.
- **Don't modify `callSpotifyOnDevice` or any play/pause/next server route.** These are untouched by this story.
- **Don't add `preferredDeviceId` to hostPrefs.** That's Story 10-3.
- **Don't rewrite SdkFailureBanner copy.** Story 10-3 owns the banner UX.

### Key files to modify

- `src/client/lib/api.ts` — add `SpotifyDevice` interface + `getDevices()` + `postSetDevice()`
- `src/client/components/DeviceChip.svelte` — new
- `src/client/components/DevicePicker.svelte` — new
- `src/client/components/HostMiniPlayer.svelte` — add chip + confirmPill props
- `src/client/components/HostControlsOverlay.svelte` — add device props + pass to AdvancedSettings
- `src/client/components/AdvancedSettings.svelte` — add "Playback device" section (live mode)
- `src/client/pages/HostRoomPage.svelte` — device state + `handleDeviceSelected` + mount DevicePicker

### Files explicitly NOT touched

- `src/server/rooms.ts` — endpoints are done, no server changes
- `src/server/auth.ts` — scopes already bumped in Story 10-1
- `src/server/__tests__/rooms.test.ts` — no server changes
- `src/client/components/SdkFailureBanner.svelte` — copy rewrite is Story 10-3
- `src/client/lib/hostPrefs.ts` — preference persistence is Story 10-3
- `src/client/lib/gameState.svelte.ts` — no game state changes needed
- `src/server/ws.ts` — no WS events added

### Manual verification checklist

- 375px mobile viewport: Mini Player has all five elements (Play/Pause, Next, track info, chip, gear) visible without overflow; chip shows icon + ▾ only.
- Desktop (≥768px): chip shows icon + device name + ▾ truncated if long.
- No device selected: chip shows "Pick a device ▾".
- Tap chip → picker opens with loading state → devices list appears; phone device shows 📱, computer shows 💻.
- Tap a different device → chip label updates optimistically → picker closes → 1.5s "Playing on {name}" pill appears near chip.
- Tap current device row → picker closes, no POST fired (check Network tab).
- Tap Refresh button → spinner appears → fresh device list.
- Empty state: disconnect all Spotify clients → picker shows "No Spotify devices found" message.
- HostControlsOverlay → Advanced Settings (during active round) → "Playback device" row shows current name → tap → same picker opens → select new device → overlay stays open, chip updates, "Switched to {name}" saved-pill appears in the row.
- Force a POST failure (network tab block or use a bogus code): chip reverts; reopen picker → "Couldn't switch device" appears; auto-clears after 3s.
- Escape key closes the picker; focus returns to chip.
- Backdrop tap closes picker.
- `bun run lint` clean. `bun run build:client` clean. `bun run test` all green.

## Previous Story Intelligence (from 10-1)

- **`bun run lint` = `tsc --noEmit`.** TypeScript gate. Unused imports from new props surface here.
- **`svelte-check` baseline: 8 pre-existing errors.** This story adds client Svelte — be careful not to add new `svelte-check` errors. Run `bun run check` (or `npx svelte-check`) to verify.
- **Error-shape on POST failures.** The server returns `{ message: string }` on non-200. The client doesn't need to parse this — just check `res.ok`.
- **No new WS events.** Epic 10 design intent explicitly excludes WS broadcasts for device swaps. The client drives state locally.
- **`postSetDevice` vs `patchRoundConfig` pattern.** `patchRoundConfig` returns the raw `Response` for status inspection. Use the same pattern for `postSetDevice` — don't `throw` on non-200; let the caller check `res.ok`.
- **OAuth scope bump already done.** `user-read-playback-state` and `user-modify-playback-state` were added to [src/server/auth.ts:105](src/server/auth.ts#L105) in Story 10-1. Existing hosts must re-login once for the `/player/devices` GET to return non-403.
- **`sdkDeviceId` field name not renamed.** The server's in-memory state still uses `sdkDeviceId` even for non-SDK devices. Don't try to "fix" this in client code — it's a pre-existing naming inconsistency documented in 10-1 Dev Notes.

## Git Intelligence Summary

Recent commits:
- `a832a38 feat(epic-10): story 10-1 — Device List API & Live-Swap Endpoint` — unified `handleSetPlayerDevice`, `GET /player/devices`, OAuth scope bump, 23 new tests. Server-only; no client touches.
- `6684a4b docs: draft spec — self-rename in Players list` — spec doc only.
- `e61815f style(players-overlay): match song-history row styling in-game` — cosmetic CSS tweak to `PlayersOverlay.svelte`. Pattern reference: row borders, spacing.
- `c2fa491 docs: draft story 10-1` — planning only.
- `a323f2f fix(tests): cast m.name to satisfy filtered message array type` — test type fix.

No recent commits touch `HostMiniPlayer`, `AdvancedSettings`, `HostControlsOverlay`, or `api.ts`. Baseline is clean for this story's changes.

## Latest Tech Information

- **Svelte 5 `$props()` with optional props.** Use `prop = defaultValue` in the destructuring: `let { activeDeviceName = null, onOpenDevicePicker = undefined } = $props()`. TypeScript type for optional prop: `activeDeviceName?: string | null`.
- **Svelte 5 `$effect` for prop reactions.** `$effect(() => { if (deviceSwitchResult === 'saved') { ... } })` runs synchronously after the DOM update that changed `deviceSwitchResult`. No `beforeUpdate`/`afterUpdate` needed.
- **`onDestroy` still works in Svelte 5.** Import from `'svelte'`. Use it for `clearTimeout` cleanup in `DevicePicker` (incomingError 3s timer) and `HostRoomPage` (confirmPillTimer).
- **Spotify device `type` values (current API, April 2026).** Documented types: `Computer`, `Tablet`, `Smartphone`, `Speaker`, `TV`, `AVR`, `STB`, `AudioDongle`, `GameConsole`, `CastVideo`, `CastAudio`, `Automobile`, `Unknown`. Icon mapping needs to handle all of these gracefully — the generic fallback covers non-listed types.
- **`GET /player/devices` returns 503 when host is auth-degraded.** `DevicePicker`'s GET-failure state handles this gracefully — "Couldn't load devices — tap Refresh to retry." The host's `AuthDegradedBanner` (already rendered) is the re-auth path.

## Project Context Reference

No `project-context.md` in repo. Conventions derived from recent story files and component code. Key reference points:
- Design system: CSS custom properties only (`var(--fg)`, `var(--bg-2)`, `var(--accent)`, etc.). No Tailwind.
- Component style: scoped `<style>` blocks. No CSS modules.
- Svelte 5 runes throughout — no `writable()` stores, no `$:` reactive statements.
- Bottom-sheet pattern: [src/client/components/HostControlsOverlay.svelte](src/client/components/HostControlsOverlay.svelte) is the canonical reference.
- Pill/row pattern: [src/client/components/AdvancedSettings.svelte](src/client/components/AdvancedSettings.svelte) is the canonical reference.
- Mini Player: [src/client/components/HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte).
- API module: [src/client/lib/api.ts](src/client/lib/api.ts) — `patchRoundConfig` is the template for `postSetDevice`.

## References

- Epic 10 brief: [_bmad-output/planning-artifacts/epics.md](/_bmad-output/planning-artifacts/epics.md) (lines ~1719–1942)
- Story 10-2 acceptance criteria (epics file): lines ~1797–1865
- Story 10-1 (done, server endpoints): [_bmad-output/implementation-artifacts/10-1-device-list-api-and-live-swap-endpoint.md](_bmad-output/implementation-artifacts/10-1-device-list-api-and-live-swap-endpoint.md)
- HostMiniPlayer (to modify): [src/client/components/HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte)
- HostControlsOverlay (to modify): [src/client/components/HostControlsOverlay.svelte](src/client/components/HostControlsOverlay.svelte)
- AdvancedSettings (to modify): [src/client/components/AdvancedSettings.svelte](src/client/components/AdvancedSettings.svelte)
- HostRoomPage (to modify): [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte)
- API module: [src/client/lib/api.ts](src/client/lib/api.ts)
- hostPrefs (not touched — Story 10-3): [src/client/lib/hostPrefs.ts](src/client/lib/hostPrefs.ts)
- SdkFailureBanner (not touched — Story 10-3): [src/client/components/SdkFailureBanner.svelte](src/client/components/SdkFailureBanner.svelte)
- Spotify API — Get Available Devices: https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None.

### Completion Notes List

All 8 tasks and subtasks implemented and verified:
- `SpotifyDevice` interface + `getDevices` + `postSetDevice` added to `api.ts` — matches `patchRoundConfig` raw-Response pattern.
- `DeviceChip.svelte` — icon-only on mobile (<768px), icon+name+▾ on desktop; "Pick a device ▾" fallback; 44px min tap target.
- `DevicePicker.svelte` — bottom-sheet on mobile, 360px popover on desktop; loading/ok/error/empty states; keyboard (Escape + Enter/Space); `returnFocusEl` focus-return on close; `incomingError` 3s auto-dismiss; Refresh button disabled during fetch; restricted rows grayed+non-interactive.
- `HostMiniPlayer.svelte` — chip inserted between track-info and gear; `confirm-pill` positioned `absolute; bottom: calc(100% + 6px)` so it floats above without disturbing layout.
- `HostRoomPage.svelte` — device state + optimistic-update handler; `handleOpenDevicePicker` captures `document.activeElement`; `DevicePicker` mounted at page level (correct z-index above HostControlsOverlay); `deviceSwitchResult` propagated to HostControlsOverlay; all timers cleared in `onDestroy`.
- `HostControlsOverlay.svelte` — four new optional device props threaded through to AdvancedSettings.
- `AdvancedSettings.svelte` — "Playback Device" section in live mode; `$effect` reacts to `deviceSwitchResult` prop; saved/error pills auto-dismiss matching existing row pattern.
- Regression: `tsc --noEmit` clean, 440 tests pass, `vite build` succeeds, `svelte-check` at 8 pre-existing errors (baseline maintained).

### File List

- src/client/lib/api.ts
- src/client/components/DeviceChip.svelte (new)
- src/client/components/DevicePicker.svelte (new)
- src/client/components/HostMiniPlayer.svelte
- src/client/components/HostControlsOverlay.svelte
- src/client/components/AdvancedSettings.svelte
- src/client/pages/HostRoomPage.svelte

## Open Questions

None — all design decisions resolved by the epics spec and 10-1 context. If the 375px layout proves too tight with the chip in the mini-player, the preferred fallback is to have the chip display icon-only (no chevron text) on mobile and accept that the confirmation pill is the primary UX signal for success.

## Change Log

| Date       | Change                                                                    |
| ---------- | ------------------------------------------------------------------------- |
| 2026-04-20 | Story 10-2 drafted — DeviceChip + DevicePicker UI; AdvancedSettings "Playback device" row; wires into Story 10-1 server endpoints. Client-only. |
| 2026-04-20 | Implemented: DeviceChip + DevicePicker components; HostMiniPlayer chip+pill; HostRoomPage device state + optimistic swap handler; HostControlsOverlay + AdvancedSettings "Playback Device" section. All 440 tests pass, lint clean, build clean, svelte-check at baseline 8. |
| 2026-04-20 | Code review (3 layers: Acceptance Auditor, Blind Hunter, Edge Case Hunter). 1 decision-needed, 17 patches, 4 deferred, 15 dismissed. See Review Findings section. |

## Review Findings

### Decision Needed

- [x] [Review][Decision] Confirm-pill scope when swap initiated from AdvancedSettings — AC #12 ambiguity. **Resolved:** option (b) — suppress `confirmPill` when the swap originates from the AdvancedSettings row; the row's own saved-pill is sufficient feedback there. Implemented via `pickerSource` state in `HostRoomPage`.

### Patches (HIGH)

- [x] [Review][Patch] Race on rapid successive device picks — stale POST response reverts `selectedDevice` to an outdated `prevDevice` [src/client/pages/HostRoomPage.svelte:137-155]. Add in-flight guard (disable chip during switch) or a request-sequence token; the current `prevDevice = selectedDevice` capture is per-call and corrupts state when responses interleave.
- [x] [Review][Patch] `pickerError` lifecycle is broken end-to-end [src/client/pages/HostRoomPage.svelte:137-155, src/client/components/DevicePicker.svelte:41-75]. Picker closes synchronously via `handleRowClick` before POST resolves, so the inline error is never rendered on the failing attempt. `pickerError` is only cleared on picker *close* (not on *open*), so a stale error from a previous failure surfaces on the next open. Fix: clear `pickerError` on picker *open* and keep it on close (matches the Dev Notes anti-pattern "Don't clear pickerError on picker close").

### Patches (MEDIUM)

- [x] [Review][Patch] `SpotifyDevice.id` typed as `string` but Spotify can return `null` — breaks `{#each devices as device (device.id)}` keyed iteration on collisions and sends `{"deviceId": null}` on tap. [src/client/lib/api.ts:~198-205, src/client/components/DevicePicker.svelte:~89-107]. Fix: type `id: string | null`, filter null-id devices from the list before render.
- [x] [Review][Patch] In-flight `getDevices` not aborted; writes to state after unmount [src/client/components/DevicePicker.svelte:28-43]. Closing the sheet mid-fetch or double-tapping Refresh leaves an orphan promise that resolves into a destroyed component (or overwrites fresh state with stale response). Fix: `AbortController` or a mounted-guard + request-id.
- [x] [Review][Patch] `confirmPill` not cleared on error path [src/client/pages/HostRoomPage.svelte:137-155]. If success pill is showing and a subsequent swap fails within 1.5s, "Playing on X" lingers alongside "Couldn't switch device" error-pill in AdvancedSettings. Fix: `clearTimeout(confirmPillTimer); confirmPill = null` in the else branch.
- [x] [Review][Patch] `.confirm-pill` overflows viewport at 375px for long device names [src/client/components/HostMiniPlayer.svelte:~171-184]. `white-space: nowrap` + `translateX(-50%)` anchored near the right edge → clips or introduces horizontal scroll. Fix: `max-width: calc(100vw - 32px)` + `overflow: hidden; text-overflow: ellipsis`, or reposition.
- [x] [Review][Patch] `deviceSwitchResult` timer duplicated in parent and child [src/client/pages/HostRoomPage.svelte:~145-153, src/client/components/AdvancedSettings.svelte:30-42]. Both run independent 1500ms timers; setting the same value twice may not retrigger the `$effect` (Svelte's equality bail), so a rapid second success can end early. Fix: pick one owner — either the child reacts to value transitions only and owns the timer, or the parent owns the timer and the child renders the flag without its own `setTimeout`.

### Patches (LOW)

- [x] [Review][Patch] Double focus-return on close [src/client/components/DevicePicker.svelte:61-75]. `handleClose()` calls `onClose(); returnFocusEl?.focus()` and then `onDestroy` also calls `returnFocusEl?.focus()`. Remove the explicit call in `handleClose` — `onDestroy` covers all close paths.
- [x] [Review][Patch] `chipRef` captures `document.activeElement` which on iOS Safari tap is often `<body>`; also becomes detached if HostControlsOverlay closes while picker is open [src/client/pages/HostRoomPage.svelte:~256]. Fix: use `bind:this` on the chip element passed explicitly as `returnFocusEl`, and validate `returnFocusEl.isConnected` before focusing in `DevicePicker.onDestroy`.
- [x] [Review][Patch] Device-type emoji icons lack `aria-hidden="true"` [src/client/components/DeviceChip.svelte:~353, src/client/components/DevicePicker.svelte:~550]. Screen readers verbalize "mobile phone iPhone" etc. Mark decorative glyphs hidden.
- [x] [Review][Patch] `DeviceChip` button missing `aria-haspopup="dialog"` and `aria-expanded` [src/client/components/DeviceChip.svelte:~351]. Assistive tech cannot discover the disclosure affordance. Add these attributes wired to picker-open state.
- [x] [Review][Patch] Refresh button `aria-label="Refresh device list"` overrides visible text "↺ Refresh" — WCAG 2.5.3 "Label in Name" failure [src/client/components/DevicePicker.svelte:~515-520]. Fix: drop the aria-label (visible text suffices) or align it with visible text.
- [x] [Review][Patch] Dialog uses `aria-label="Choose playback device"` while visible title reads "Playback Device" — duplicate announcements [src/client/components/DevicePicker.svelte:~511]. Switch to `aria-labelledby` pointing at the `.sheet-title` span.
- [x] [Review][Patch] `activeDeviceId` prop threaded through `HostControlsOverlay` is never forwarded to `AdvancedSettings` — dead prop [src/client/components/HostControlsOverlay.svelte:~89-104]. Remove it or pass it through if intended.
- [x] [Review][Patch] `:hover` rule on `.device-row` fires on iOS touch and sticks after tap [src/client/components/DevicePicker.svelte `.device-row:hover`]. Wrap in `@media (hover: hover) { ... }`.
- [x] [Review][Patch] `devices = result.devices` with no runtime validation — if server returns `{}` or `null`, `#each` crashes [src/client/components/DevicePicker.svelte:~34]. Defensive `result.devices ?? []`.
- [x] [Review][Patch] Restricted-row keydown calls `e.preventDefault()` before the restricted guard, breaking spacebar scrolling when focused via `.focus()` [src/client/components/DevicePicker.svelte:~546-548]. Swap the order: guard first, then preventDefault.

### Deferred

- [x] [Review][Defer] No focus trap inside DevicePicker modal — deferred, accessibility enhancement beyond spec ACs (#13/#14 only require tap-target size and dismiss behavior). Consistent with other overlays in this codebase.
- [x] [Review][Defer] Listbox lacks arrow-key navigation / roving tabindex / `aria-activedescendant` — deferred, beyond WAI-ARIA listbox conformance scope of this story; AC #13 only requires tap-target baseline.
- [x] [Review][Defer] `selectedDevice` not initialized from server on mount — deferred, explicitly Story 10-3 scope (SDK-default tracking + `preferredDeviceId`). AC #2 and #20 require "Pick a device ▾" fallback until user picks.
- [x] [Review][Defer] `handleDeviceSelected` collapses all POST failures to one message — deferred, matches existing `patchRoundConfig` pattern; finer-grained 401/404/5xx routing is an enhancement.

