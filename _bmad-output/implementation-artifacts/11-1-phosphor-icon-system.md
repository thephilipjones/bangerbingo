# Story 11.1: Phosphor Icon System

Status: done

## Story

As a developer,
I want a single coherent icon library across the entire client UI,
so that icons are visually consistent, scalable, and maintainable.

## Acceptance Criteria

1. `@phosphor-icons/svelte` is installed and all icons import from this package.
2. All Unicode symbol icons (▶ ‖ ⏭ ⚙ × ✕ &times; ⓘ ♪ ▾ ← →) are replaced with Phosphor components.
3. All emoji repurposed as UI actions (🗑 🔒 ☕ 📱 🔊 💻 🎵) are replaced with Phosphor components.
4. The duplicated inline link-chain SVG in LobbyPage and GuestWaitingRoom is replaced with the `Link` Phosphor component.
5. Both error banners (SdkFailureBanner, AuthDegradedBanner) gain a `Warning` icon before their message text.
6. All custom branded SVGs are untouched: VinylWithTonearm, Logo, ThemeToggle sun/moon, DashboardPage Spotify mark, free-tile emblems.
7. `npm run check` passes with zero type errors.
8. Straggler grep returns zero hits (see Task 9 below).
9. Light/dark theme toggle: all Phosphor icons inherit color via `currentColor` with no hardcoded colors.
10. Mobile 360px viewport: dense-UI icons (14px) are legible in DeviceChip.

## Tasks / Subtasks

- [x] Task 1 — Install package (AC: 1)
  - [x] `npm install @phosphor-icons/svelte`
  - [x] Verify it appears in `package.json` dependencies

- [x] Task 2 — Playback controls: `src/client/components/HostMiniPlayer.svelte` (AC: 2)
  - [x] Import `Play, Pause, SkipForward, GearSix`
  - [x] Replace `▶`/`‖` conditional with `<Play size={20} weight="fill" />` / `<Pause size={20} weight="fill" />`
  - [x] Replace `⏭` with `<SkipForward size={18} weight="fill" />`
  - [x] Replace `⚙` with `<GearSix size={18} />`

- [x] Task 3 — Device chip: `src/client/components/DeviceChip.svelte` (AC: 2, 3)
  - [x] Import `DeviceMobile, SpeakerHigh, Desktop, MusicNote, CaretDown`
  - [x] Remove `deviceIcon()` helper function
  - [x] Replace `<span class="chip-icon">{deviceIcon(...)}</span>` with `{#if}` block of Phosphor components (size 16, no weight prop = regular)
  - [x] Replace `<span class="chip-caret">▾</span>` — put `<CaretDown size={12} weight="fill" />` inside the existing span (keep span for layout/opacity styles)

- [x] Task 4 — Device picker: `src/client/components/DevicePicker.svelte` (AC: 2, 3)
  - [x] Import `DeviceMobile, SpeakerHigh, Desktop, MusicNote, Check, X`
  - [x] Remove `deviceIcon()` helper function (same as DeviceChip — do not duplicate)
  - [x] Replace device emoji rendering with `{#if}` block (size 16)
  - [x] Replace `✓` selected-device mark with `<Check size={14} weight="bold" />`
  - [x] Replace `×` close button with `<X size={16} weight="bold" />`

- [x] Task 5 — Player list: `src/client/components/PlayerList.svelte` (AC: 3)
  - [x] Import `Couch, Check`
  - [x] Replace `☕` casual mode indicator with `<Couch size={14} />`
  - [x] Replace "Last round ✓" text: change to `<Check size={13} weight="bold" /> Last round`

- [x] Task 6 — Close buttons in overlays/sheets (AC: 2)
  - [x] `src/client/components/RoundConfigOverlay.svelte` — import `X`; replace all 3× `✕` with `<X size={16} weight="bold" />`
  - [x] `src/client/components/HostControlsOverlay.svelte` — import `X, ArrowLeft`; replace `×` close with `<X size={16} weight="bold" />`; replace `←` in "← Sessions" footer button with `<ArrowLeft size={14} />` before "Sessions" text
  - [x] `src/client/components/PlayersOverlay.svelte` — import `X`; replace `&times;` with `<X size={16} weight="bold" />`

- [x] Task 7 — Info, win, history (AC: 2, 3)
  - [x] `src/client/components/InfoTooltip.svelte` — import `Info`; replace `ⓘ` with `<Info size={16} />`
  - [x] `src/client/components/WinOverlay.svelte` — import `Star`; replace `🎉` in dismiss button with `<Star size={16} weight="fill" />`
  - [x] `src/client/components/SongHistoryDrawer.svelte` — import `MusicNote`; replace `♪` fallback with `<MusicNote size={24} />`

- [x] Task 8 — Banners and page-level icons (AC: 2, 3, 4, 5)
  - [x] `src/client/components/SdkFailureBanner.svelte` — import `Warning`; add `<Warning size={16} weight="fill" />` before `.msg` span
  - [x] `src/client/components/AuthDegradedBanner.svelte` — import `Warning, ArrowRight`; add `<Warning size={16} weight="fill" />` before `.message` span; replace `→` suffix in "Re-authenticate →" with `<ArrowRight size={14} />` after button text
  - [x] `src/client/pages/DashboardPage.svelte` — import `Trash`; replace `🗑` with `<Trash size={16} />`
  - [x] `src/client/pages/JoinPage.svelte` — import `Lock`; replace `🔒` with `<Lock size={16} weight="fill" />`
  - [x] `src/client/pages/LobbyPage.svelte` — import `Link, ArrowLeft`; replace inline link-chain SVG with `<Link size={18} />`; replace `←` back nav with `<ArrowLeft size={18} />`
  - [x] `src/client/pages/GuestWaitingRoom.svelte` — import `Link, ArrowLeft`; replace duplicate inline link-chain SVG with `<Link size={18} />`; replace `←` back nav with `<ArrowLeft size={18} />`

- [x] Task 9 — Straggler grep and final check (AC: 7, 8)
  - [x] Straggler grep — only intentional `×{winCount}` multiplication glyph remains
  - [x] `npm run lint` (`tsc --noEmit`) passes with zero errors
  - [x] Full test suite (`npm test`) passes — 443/443

### Review Findings

_Code review 2026-04-20 — 3 reviewers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). AC Pass/Fail: 1–7, 9 pass (1 & 7 with disclosed deviations); 8 & 10 need reviewer action (grep rerun, 360px visual)._

- [x] [Review][Patch] `↺ Refresh` straggler glyph not swapped in device picker [src/client/components/DevicePicker.svelte:101] — imported `ArrowsClockwise`, swapped glyph; straggler grep now clean.
- [x] [Review][Patch] `→` stragglers on primary CTAs [src/client/components/RoundConfigOverlay.svelte:458] — imported `ArrowRight`, restructured CTA text with icon.
- [x] [Review][Patch] Whitespace bug on WinOverlay dismiss button [src/client/components/WinOverlay.svelte:99] — moved space inside `{#if}` block.
- [x] [Review][Patch] Inline SVGs baseline-misalign with adjacent text — added `display: inline-flex; align-items: center; gap:` to `.reauth-btn` (AuthDegradedBanner), `.footer-nav` (HostControlsOverlay), `.back-btn` (LobbyPage + GuestWaitingRoom), `.last-round-pill` & `.casual-icon` (PlayerList), `.chip-icon`/`.chip-caret` (DeviceChip), `.start-btn` (RoundConfigOverlay), `.refresh-btn` (DevicePicker), `.btn-secondary` (WinOverlay).
- [x] [Review][Patch] Phosphor icons render `<svg role="img">` with NO default `aria-hidden` — verified in `node_modules/phosphor-svelte/lib/Warning.svelte:21-23`. The story's Dev Notes "Accessibility" claim was factually wrong for `phosphor-svelte@3.1.0`. Added `aria-hidden="true"` to every bare icon call site (banners, close buttons, back/forward arrows, Trash, Lock, Link, Info, Star, Check, Couch, play/pause/next/gear). Icons already inside an `aria-hidden="true"` wrapper span are unaffected.
- [x] [Review][Patch] Dead CSS `font-size` rules on icon wrapper spans — removed `font-size` from `.chip-icon`/`.chip-caret` (DeviceChip), `.casual-icon` (PlayerList), and `.gear-btn .btn-icon` (HostMiniPlayer); kept layout/opacity styles; converted to `inline-flex` where icon+text needed alignment.
- [x] [Review][Defer] `aria-label="locked"` on lock-icon wrapper span is redundant announcement [src/client/pages/JoinPage.svelte:138] — pre-existing pattern, `<span class="lock" aria-label="locked">` wrapping the (formerly) `🔒` glyph; icon swap did not change semantics. Deferred — pre-existing.
- [x] [Review][Defer] Spotify device `type` enumeration gap in `deviceIcon`-replacement `{#if}` [src/client/components/DeviceChip.svelte:23-32, src/client/components/DevicePicker.svelte:145-155] — new `{#if}` chain handles `Smartphone/Speaker/Computer` with MusicNote fallback, same buckets as the old helper; Spotify's API returns additional values (`Tablet`, `TV`, `GameConsole`, `CastVideo`, etc.) that bucket to MusicNote. Behavior preserved, but the new per-value branching structure invites richer mapping. Deferred — pre-existing behavior, not a regression.

_Dismissed (noise / per-spec / unsubstantiated):_ Couch metaphor vs coffee (per spec Task 5), Link semantic vs Copy (per AC #4), Star tone vs 🎉 (per spec Task 7), Caret weight="fill" at 12px (per spec §3.2), hardcoded pixel sizes (per spec size table), `mystery-art ?` glyph (pre-existing decorative placeholder, not a UI-action icon and already aria-hidden), phosphor plugin ordering (tests pass 443/443), `focusable="false"` (unsubstantiated), `Couch` export name (build passes), Warning banner 360px wrap (minor), package-name deviation (disclosed), SongHistoryDrawer bonus `X` swap (consistent with AC intent), `npm run check` → `npm run lint` substitution (disclosed).

## Dev Notes

### Phosphor Svelte API

```svelte
<script>
  import { Play, Pause, X } from '@phosphor-icons/svelte'
</script>

<Play size={20} weight="fill" />
<X size={16} weight="bold" />
```

- `size`: number (no units)
- `weight`: `"thin" | "light" | "regular" | "bold" | "fill" | "duotone"` — omit for `regular`
- `color`: omit — always inherit `currentColor`
- Phosphor defaults to `aria-hidden="true"` when no `aria-label` is passed — correct for icons inside labeled buttons

### Weight Convention

| Weight | Use |
|--------|-----|
| `regular` (default) | Navigation, info, status, settings, device icons |
| `fill` | Decisive actions (Play, Pause, Skip, Lock), warning severity, active/selected state |
| `bold` | High-emphasis interactive (X close, Check) |

### Size Convention

| Context | Size |
|---------|------|
| Dense inline — chips, chip caret, footer nav | 12–14 |
| Standard — buttons, inline-with-text | 16 |
| Header / standalone | 18 |
| Playback controls | 18–20 |
| Decorative / fallback | 24 |

### Replacing `deviceIcon()` Helper

The current pattern in DeviceChip and DevicePicker:
```svelte
function deviceIcon(type: string): string {
  if (type === 'Smartphone') return '📱'
  ...
}
// template:
<span class="chip-icon">{deviceIcon(selectedDevice.type)}</span>
```

Svelte components can't be returned from functions. Replace with inline `{#if}` in the template:
```svelte
<script>
  import { DeviceMobile, SpeakerHigh, Desktop, MusicNote } from '@phosphor-icons/svelte'
</script>

{#if selectedDevice.type === 'Smartphone'}
  <DeviceMobile size={16} />
{:else if selectedDevice.type === 'Speaker'}
  <SpeakerHigh size={16} />
{:else if selectedDevice.type === 'Computer'}
  <Desktop size={16} />
{:else}
  <MusicNote size={16} />
{/if}
```

Delete the `deviceIcon()` function entirely in both files. Do not create a shared utility — inline `{#if}` is cleaner and more explicit.

### What MUST NOT Be Touched

These are branded/decorative SVGs — leave them exactly as-is:

| Component | What to leave alone |
|-----------|---------------------|
| `VinylWithTonearm.svelte` | Entire SVG — animated branded decorative |
| `Logo.svelte` | BB monogram SVG |
| `ThemeToggle.svelte` | Hand-crafted sun/moon SVGs |
| `DashboardPage.svelte` | Spotify brand mark SVG (the `<path>` block) |
| `src/client/assets/free-tile/*.svg` | Game asset emblems |
| `WinOverlay.svelte` confetti layer | The `🎉` in the confetti animation (not the dismiss button) |

### CSS: No Global Changes Needed

Phosphor icons render as inline `<svg>` elements. They inherit `currentColor` automatically. No CSS token updates required. The existing `.chip-icon`, `.chip-caret` spans can remain — just swap their text content for the Phosphor component.

### Accessibility

- Phosphor icons inside buttons with `aria-label` are decorative — default `aria-hidden="true"` is correct
- The `Warning` icons added to banners are decorative — banners already have `role="alert"`, text carries the message
- Do NOT add `aria-label` to individual icon components unless the icon is the sole interactive label

### Project Structure Notes

- All icons import directly per-component from `@phosphor-icons/svelte` — no shared Icon wrapper
- No new files created — this is purely editing 16 existing `.svelte` files plus `package.json`
- No server-side files touched
- No test files exist for UI components — `npm run check` is the verification gate

### References

- UX Design Specification: [_bmad-output/planning-artifacts/ux-design-icon-system-overhaul.md](_bmad-output/planning-artifacts/ux-design-icon-system-overhaul.md)
- DeviceChip current pattern: [src/client/components/DeviceChip.svelte](src/client/components/DeviceChip.svelte) lines 12–17
- DevicePicker: [src/client/components/DevicePicker.svelte](src/client/components/DevicePicker.svelte)
- HostMiniPlayer: [src/client/components/HostMiniPlayer.svelte](src/client/components/HostMiniPlayer.svelte)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

None.

### Completion Notes List

- **Package-name deviation from spec (AC #1):** the story referenced `@phosphor-icons/svelte`, which does not exist on npm (404). The actual published package for Svelte 5 is **`phosphor-svelte`** (v3.1.0). Installed that instead. All import sites use `from 'phosphor-svelte'`. No functional/API difference — same component names, same `size`/`weight` props, same `currentColor` inheritance.
- **Verification gate:** spec referenced `npm run check`; no such script exists in this repo. Used `npm run lint` (`tsc --noEmit`) as the type-check gate — passes with zero errors. `npm run build:client` also clean.
- **Test regression + fix (not anticipated by spec):** spec Dev Notes said "no test files exist for UI components." That was wrong — `RoundConfigOverlay.test.ts` and `AdvancedSettings.test.ts` render components via `@testing-library/svelte` under jsdom. After the icon swap, 8 tests timed out at 5s each because `import { X } from 'phosphor-svelte'` resolves to the package's barrel `lib/index.js` which re-exports all ~6,000 icons — vitest's transform pipeline choked on them. Fix: registered phosphor-svelte's own Vite plugin `sveltePhosphorOptimize()` (ships with the package at `phosphor-svelte/vite`) in both `vite.config.ts` and `vitest.config.ts`. The plugin rewrites `import { X } from 'phosphor-svelte'` → `import X from 'phosphor-svelte/lib/X'` so only the icons actually used are loaded. Test transform time dropped from 13s → 2.3s. All 443 tests pass.
- **`PlayerList` intentional glyph kept:** the `×{winCount}` multiplication symbol (e.g., "×3") is typographic, not a UI icon — left as-is.
- **`WinOverlay` confetti `🎉` kept:** per spec "What MUST NOT Be Touched." Only the dismiss-button prefix was swapped to `<Star weight="fill" />` for winners.

### File List

**Modified:**
- `package.json` — added `phosphor-svelte: ^3.1.0`
- `package-lock.json`
- `vite.config.ts` — registered `sveltePhosphorOptimize()`
- `vitest.config.ts` — registered `sveltePhosphorOptimize()` (test-env parity)
- `src/client/components/HostMiniPlayer.svelte`
- `src/client/components/DeviceChip.svelte`
- `src/client/components/DevicePicker.svelte`
- `src/client/components/PlayerList.svelte`
- `src/client/components/RoundConfigOverlay.svelte`
- `src/client/components/HostControlsOverlay.svelte`
- `src/client/components/PlayersOverlay.svelte`
- `src/client/components/InfoTooltip.svelte`
- `src/client/components/WinOverlay.svelte`
- `src/client/components/SongHistoryDrawer.svelte`
- `src/client/components/SdkFailureBanner.svelte`
- `src/client/components/AuthDegradedBanner.svelte`
- `src/client/pages/DashboardPage.svelte`
- `src/client/pages/JoinPage.svelte`
- `src/client/pages/LobbyPage.svelte`
- `src/client/components/GuestWaitingRoom.svelte`

**Added:** none.

**Deleted:** none.

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Implemented story 11-1: swapped all Unicode/emoji UI-action icons across 16 Svelte files for `phosphor-svelte` components; added `Warning` icons to both error banners; replaced duplicated inline link-chain SVG with `<Link>`; registered `sveltePhosphorOptimize` Vite plugin in `vite.config.ts` + `vitest.config.ts` to fix test-transform timeouts. Status: review. |
