# Story 11.1: Phosphor Icon System

Status: ready-for-dev

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

- [ ] Task 1 — Install package (AC: 1)
  - [ ] `npm install @phosphor-icons/svelte`
  - [ ] Verify it appears in `package.json` dependencies

- [ ] Task 2 — Playback controls: `src/client/components/HostMiniPlayer.svelte` (AC: 2)
  - [ ] Import `Play, Pause, SkipForward, GearSix`
  - [ ] Replace `▶`/`‖` conditional with `<Play size={20} weight="fill" />` / `<Pause size={20} weight="fill" />`
  - [ ] Replace `⏭` with `<SkipForward size={18} weight="fill" />`
  - [ ] Replace `⚙` with `<GearSix size={18} />`

- [ ] Task 3 — Device chip: `src/client/components/DeviceChip.svelte` (AC: 2, 3)
  - [ ] Import `DeviceMobile, SpeakerHigh, Desktop, MusicNote, CaretDown`
  - [ ] Remove `deviceIcon()` helper function
  - [ ] Replace `<span class="chip-icon">{deviceIcon(...)}</span>` with `{#if}` block of Phosphor components (size 16, no weight prop = regular)
  - [ ] Replace `<span class="chip-caret">▾</span>` — put `<CaretDown size={12} weight="fill" />` inside the existing span (keep span for layout/opacity styles)

- [ ] Task 4 — Device picker: `src/client/components/DevicePicker.svelte` (AC: 2, 3)
  - [ ] Import `DeviceMobile, SpeakerHigh, Desktop, MusicNote, Check, X`
  - [ ] Remove `deviceIcon()` helper function (same as DeviceChip — do not duplicate)
  - [ ] Replace device emoji rendering with `{#if}` block (size 16)
  - [ ] Replace `✓` selected-device mark with `<Check size={14} weight="bold" />`
  - [ ] Replace `×` close button with `<X size={16} weight="bold" />`

- [ ] Task 5 — Player list: `src/client/components/PlayerList.svelte` (AC: 3)
  - [ ] Import `Couch, Check`
  - [ ] Replace `☕` casual mode indicator with `<Couch size={14} />`
  - [ ] Replace "Last round ✓" text: change to `<Check size={13} weight="bold" /> Last round`

- [ ] Task 6 — Close buttons in overlays/sheets (AC: 2)
  - [ ] `src/client/components/RoundConfigOverlay.svelte` — import `X`; replace all 3× `✕` with `<X size={16} weight="bold" />`
  - [ ] `src/client/components/HostControlsOverlay.svelte` — import `X, ArrowLeft`; replace `×` close with `<X size={16} weight="bold" />`; replace `←` in "← Sessions" footer button with `<ArrowLeft size={14} />` before "Sessions" text
  - [ ] `src/client/components/PlayersOverlay.svelte` — import `X`; replace `&times;` with `<X size={16} weight="bold" />`

- [ ] Task 7 — Info, win, history (AC: 2, 3)
  - [ ] `src/client/components/InfoTooltip.svelte` — import `Info`; replace `ⓘ` with `<Info size={16} />`
  - [ ] `src/client/components/WinOverlay.svelte` — import `Star`; replace `🎉` in dismiss button with `<Star size={16} weight="fill" />`
  - [ ] `src/client/components/SongHistoryDrawer.svelte` — import `MusicNote`; replace `♪` fallback with `<MusicNote size={24} />`

- [ ] Task 8 — Banners and page-level icons (AC: 2, 3, 4, 5)
  - [ ] `src/client/components/SdkFailureBanner.svelte` — import `Warning`; add `<Warning size={16} weight="fill" />` before `.msg` span
  - [ ] `src/client/components/AuthDegradedBanner.svelte` — import `Warning, ArrowRight`; add `<Warning size={16} weight="fill" />` before `.message` span; replace `→` suffix in "Re-authenticate →" with `<ArrowRight size={14} />` after button text
  - [ ] `src/client/pages/DashboardPage.svelte` — import `Trash`; replace `🗑` with `<Trash size={16} />`
  - [ ] `src/client/pages/JoinPage.svelte` — import `Lock`; replace `🔒` with `<Lock size={16} weight="fill" />`
  - [ ] `src/client/pages/LobbyPage.svelte` — import `Link, ArrowLeft`; replace inline link-chain SVG with `<Link size={18} />`; replace `←` back nav with `<ArrowLeft size={18} />`
  - [ ] `src/client/pages/GuestWaitingRoom.svelte` — import `Link, ArrowLeft`; replace duplicate inline link-chain SVG with `<Link size={18} />`; replace `←` back nav with `<ArrowLeft size={18} />`

- [ ] Task 9 — Straggler grep and final check (AC: 7, 8)
  - [ ] Run: `grep -r "▶\|‖\|⏭\|⚙\|✕\|×\|&times;\|ⓘ\|♪\|☕\|🗑\|🔒\|🎵\|📱\|🔊\|💻\|▾" src/client --include="*.svelte"` — fix any remaining hits
  - [ ] Run `npm run check` — zero errors
  - [ ] Manual visual spot-check: play/pause controls, device chip, any modal close button, info tooltip

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

_to be filled by dev agent_

### Debug Log References

### Completion Notes List

### File List
