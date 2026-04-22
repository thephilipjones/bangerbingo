---
title: 'Mobile board + playbar polish'
type: 'feature'
created: '2026-04-22'
status: 'done'
baseline_commit: 'dd65ea5'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On mobile, the bingo board wastes ~32px of horizontal room to page chrome and caps at 360px — tiles end up smaller than the viewport allows, cramping text. The host playback bar is crowded: four buttons (play, next, device, gear) plus a single-line "Title — Artist" ellipsis compete for one 64px row, and the device chip shows a redundant caret that makes it wider than the other three square buttons.

**Approach:** Shrink L/R page padding on mobile and raise the board's max-width so tiles grow with the viewport up to tablet. In `HostMiniPlayer`, stack track title and artist on two lines using the same visual treatment as bingo tiles (bold title, smaller muted artist). In `DeviceChip`, drop the caret and collapse the mobile button to a 44×44 square matching the other control buttons.

## Boundaries & Constraints

**Always:**
- Tap targets stay ≥44×44 on mobile (play, next, device, gear).
- All four bottom-bar icons (play/pause, next, device, gear) render at the **same pixel size** — pick one size (e.g., 18px or 20px) and apply it to every `<Phosphor* size={...} />` call in the bar, including the DeviceChip icon.
- Tile aspect-ratio remains 1:1; 5×5 grid unchanged.
- Tablet/desktop (≥768px) layout: unchanged except where naturally carried by the same rules.
- Title-reveal-blur behavior (`.track-text.blurred`) still works after two-line restructure.

**Ask First:**
- Any change that alters the device-picker open/close flow or DeviceChip's `aria-expanded` / `aria-haspopup` semantics.

**Never:**
- Don't change `BingoCard`'s grid logic, tile modes, win-path, or emblem code.
- Don't touch `RoomPage`/`HostRoomPage` business logic — style-only edits.
- Don't remove the caret on ≥768px if it already renders there (it currently renders at all sizes; dropping it globally is fine — this is a simplification, not a breakpoint change).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Narrow mobile (360px viewport), active round | guest/host viewing board | Board fills viewport with ≤8px L/R page padding; tiles visibly larger than current 360-cap | N/A |
| Tablet (≥768px), active round | guest/host viewing board | Board looks identical to today (640px max, 6px gap) | N/A |
| Host playback bar, long title + long artist | `currentTrack = { title: "…", artist: "…" }` | Title on line 1 (bold, ~14px), artist on line 2 (muted, ~11-12px); both single-line ellipsis | N/A |
| Host playback bar, title-reveal blur active | `blurred = true` | Both title and artist are blurred and click-to-reveal still works | N/A |
| DeviceChip on mobile, device selected | `selectedDevice = { type: 'Smartphone', … }` | 44×44 square button shows phone icon only; no caret, no label | N/A |
| DeviceChip, no device | `selectedDevice = null` | 44×44 square button shows a neutral "pick a device" icon (e.g., MusicNote) | N/A |

</frozen-after-approval>

## Code Map

- `src/client/components/BingoCard.svelte` — `.bingo-grid` max-width cap (360px) limits tile size on wider phones.
- `src/client/pages/RoomPage.svelte` — `.room-page` sets `padding: 16px` (guest game view).
- `src/client/pages/HostRoomPage.svelte` — `.card-area` sets `padding: 80px 16px 64px` (host game view).
- `src/client/components/HostMiniPlayer.svelte` — `.track-info` / `.track-text` render `"Title — Artist"` on one line.
- `src/client/components/DeviceChip.svelte` — button renders icon + label + `CaretDown`; `max-width: 160px`; padding `0 8px`.

## Tasks & Acceptance

**Execution:**
- [x] `src/client/components/BingoCard.svelte` — Raise mobile `.bingo-grid` max-width (e.g., cap around `min(100%, 480px)` or remove mobile cap so the grid fills its container) and keep tablet rules unchanged. Verify the font-size/line-clamp still reads well at the larger mobile size; bump `.tile-title` / `.tile-artist` slightly if tiles grow meaningfully.
- [x] `src/client/pages/RoomPage.svelte` — Reduce `.room-page` L/R padding on mobile (e.g., `8px`, keep `16px` vertical or promote to a single side var). Leave desktop untouched.
- [x] `src/client/pages/HostRoomPage.svelte` — Reduce `.card-area` L/R padding on mobile to match; keep tablet `padding: 96px var(--space-5) 96px` intact.
- [x] `src/client/components/HostMiniPlayer.svelte` — Split `.track-info` into two stacked lines: `.track-title` (bold, current ~14px) and `.track-artist` (smaller, muted, e.g., 11-12px). Both single-line ellipsis; container `min-width: 0`. Keep blur button wrapping both lines; ensure `.track-text.waiting` still renders when no track (single line OK).
- [x] `src/client/components/DeviceChip.svelte` — Remove the `CaretDown` element and `.chip-caret` styles. Collapse mobile layout to a 44×44 square (no label, no caret). For the no-device state, render a neutral icon (e.g., `MusicNote` already imported) in place of the text placeholder. Keep `.chip-label` rendering at ≥768px so the device name still shows on tablet+.

**Acceptance Criteria:**
- Given a 360px-wide mobile viewport and an active round, when the bingo board renders, then each tile is visibly larger than today (grid fills viewport minus ≤16px total L/R chrome).
- Given the host view on mobile, when a track is playing, then the title and artist appear on two lines inside the existing 64px playback bar without forcing the bar taller and without pushing the four controls out.
- Given the host playback bar, when `blurred` is true, then both title and artist lines are blurred and tapping the wrapper still reveals them.
- Given the host playback bar on mobile, when rendered, then play/next/device/gear are four visually consistent ~44×44 square buttons (device chip no longer wider, no caret) **and all four icons inside them render at the same pixel size**.
- Given a tablet viewport (≥768px), when the host view renders, then the device chip still shows the device name label alongside the icon (no regression).

## Verification

**Commands:**
- `npm run lint` — expected: no new errors.
- `npm run typecheck` — expected: clean.
- `npm run test` — expected: existing `BingoCard.test.ts` still passes (no behavior change).

**Manual checks:**
- Open host view on a ~375-390px mobile emulator: board fills width, tile text readable, four bottom-bar buttons are equal-sized squares, track info stacked.
- Resize to ≥768px: tablet layout matches pre-change snapshot (chip label visible, board ≤640px, gaps unchanged).
- Toggle title-reveal delay and confirm blur → tap → reveal still works in the stacked layout.

## Suggested Review Order

**Host playback bar — icon parity + two-line track info**

- All four bottom-bar icons now render at 18px (Play/Pause was 20); sets the parity rule.
  [`HostMiniPlayer.svelte:61`](../../src/client/components/HostMiniPlayer.svelte#L61)

- Track info restructured into stacked title + muted artist spans, both ellipsed.
  [`HostMiniPlayer.svelte:72`](../../src/client/components/HostMiniPlayer.svelte#L72)

- New column flex layout on `.track-text` + sibling `.track-title` / `.track-artist` rules.
  [`HostMiniPlayer.svelte:131`](../../src/client/components/HostMiniPlayer.svelte#L131)

**DeviceChip — square icon-only on mobile, labeled on tablet+**

- No-device state uses `SpeakerSlash`; caret removed; placeholder text gone (`aria-label` still carries semantics).
  [`DeviceChip.svelte:23`](../../src/client/components/DeviceChip.svelte#L23)

- `.device-chip` is a 44×44 square on mobile; `@media (min-width: 768px)` restores label + 160px cap.
  [`DeviceChip.svelte:41`](../../src/client/components/DeviceChip.svelte#L41)

**Board breathing room — less L/R chrome, tiles scale up**

- `BingoCard` base `max-width` raised from 360 → 640 so tiles fill narrow-phone width up to the tablet rule.
  [`BingoCard.svelte:116`](../../src/client/components/BingoCard.svelte#L116)

- Tile text bumped one step (title 11→12, artist 10→11) now that tiles grow meaningfully.
  [`BingoCard.svelte:199`](../../src/client/components/BingoCard.svelte#L199)

- Mobile page padding: guest `.room-page` → `16px 8px` (tablet block unchanged).
  [`RoomPage.svelte:270`](../../src/client/pages/RoomPage.svelte#L270)

- Mobile host `.card-area` → `80px 8px 64px` (tablet override preserved).
  [`HostRoomPage.svelte:870`](../../src/client/pages/HostRoomPage.svelte#L870)
