---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - "_bmad-output/prd.md"
  - "/Users/Philip/.claude/plans/make-a-comprehensive-roundup-moonlit-gadget.md"
workflow: complete
---

# UX Design Specification — Icon System

**Author:** Philip
**Date:** 2026-04-20
**Project:** bangerbingo

---

## 1. Overview

The current UI has no coherent icon system. Icons are implemented as a mix of Unicode symbols (▶ ‖ ⏭ ⚙), three different close-button characters (✕ U+2715, × U+00D7, `&times;` HTML entity), emoji repurposed as UI actions (🗑 🔒 ☕), duplicated inline SVGs, and error banners with no icon at all.

**Outcome of this spec:** Standardize on **Phosphor Svelte** (`@phosphor-icons/svelte`) as the single icon library across the entire client UI. All inconsistent symbols replaced. Existing branded custom SVGs (vinyl, logo, Spotify mark, theme sun/moon) and free-tile emblems are explicitly preserved.

---

## 2. Design Decisions

### 2.1 Library: Phosphor Svelte

- **Package:** `@phosphor-icons/svelte`
- **Style rationale:** Geometric, minimal, 2px-stroke `regular` weight matches the editorial-rock aesthetic (Space Grotesk typography, sharp edges, warm paper palette). Not precious, not cartoon.
- **Integration:** Direct per-component imports. No wrapper component. Tree-shakeable.
- **Color:** All icons inherit `currentColor` — no explicit color props. Respects the CSS token system (light/dark theme) automatically.

### 2.2 Weight System

| Weight | Used for |
|--------|----------|
| `regular` | Default — navigation, info, status, settings |
| `fill` | Active/selected states, decisive actions (play, pause, skip, locked), warning severity |
| `bold` | High-emphasis interactive elements (close buttons, checkmarks) |

### 2.3 Size Scale

| Context | Size |
|---------|------|
| Dense inline (chips, compact buttons, chevrons) | `14` |
| Standard button / inline-with-body-text | `16` |
| Header / standalone icon buttons | `18` |
| Playback controls | `18–20` |
| Decorative / fallback states | `24` |

---

## 3. Icon Replacement Map

### 3.1 Playback Controls — `HostMiniPlayer.svelte`

| Current | Replacement | Weight | Size |
|---------|------------|--------|------|
| `▶` play | `Play` | `fill` | 20 |
| `‖` pause | `Pause` | `fill` | 20 |
| `⏭` skip | `SkipForward` | `fill` | 18 |
| `⚙` settings | `GearSix` | `regular` | 18 |

### 3.2 Device Type Icons — `DeviceChip.svelte`, `DevicePicker.svelte`

| Current | Replacement | Weight | Size |
|---------|------------|--------|------|
| `📱` smartphone | `DeviceMobile` | `regular` | 16 |
| `🔊` speaker | `SpeakerHigh` | `regular` | 16 |
| `💻` computer | `Desktop` | `regular` | 16 |
| `🎵` default | `MusicNote` | `regular` | 16 |
| `▾` dropdown caret | `CaretDown` | `fill` | 12 |
| `✓` selected device | `Check` | `bold` | 14 |
| `×` close picker | `X` | `bold` | 16 |

### 3.3 Player Status — `PlayerList.svelte`

| Current | Replacement | Weight | Size | Note |
|---------|------------|--------|------|------|
| `☕` casual mode | `Couch` | `regular` | 14 | ☕ is conceptually wrong; `Couch` = lounging/autopilot |
| `✓` last-round winner | `Check` | `bold` | 13 | Inline before "Last round" text |

### 3.4 Close Buttons — All Overlays/Sheets

Standardize all three variants (✕ / × / &times;) to one:

| Component | Replacement | Weight | Size |
|-----------|------------|--------|------|
| `RoundConfigOverlay.svelte` (3×) | `X` | `bold` | 16 |
| `HostControlsOverlay.svelte` | `X` | `bold` | 16 |
| `PlayersOverlay.svelte` | `X` | `bold` | 16 |
| `DevicePicker.svelte` | `X` | `bold` | 16 |

### 3.5 Navigation Arrows

| Current | Component | Replacement | Weight | Size |
|---------|-----------|------------|--------|------|
| `←` back | `LobbyPage`, `GuestWaitingRoom`, `HostControlsOverlay` footer | `ArrowLeft` | `regular` | 18 (page nav), 14 (footer) |
| `→` CTA suffix | `AuthDegradedBanner` "Re-authenticate →" | `ArrowRight` | `regular` | 14 |

### 3.6 Actions

| Current | Component | Replacement | Weight | Size |
|---------|-----------|------------|--------|------|
| `🗑` delete session | `DashboardPage` | `Trash` | `regular` | 16 |
| `🔒` locked field | `JoinPage` | `Lock` | `fill` | 16 |
| Link chain inline SVG (×2) | `LobbyPage`, `GuestWaitingRoom` | `Link` | `regular` | 18 |

### 3.7 Info & Status

| Current | Component | Replacement | Weight | Size |
|---------|-----------|------------|--------|------|
| `ⓘ` tooltip trigger | `InfoTooltip` | `Info` | `regular` | 16 |
| `♪` album art fallback | `SongHistoryDrawer` | `MusicNote` | `regular` | 24 |

### 3.8 Win Overlay

| Current | Replacement | Weight | Size | Rationale |
|---------|------------|--------|------|-----------|
| `🎉` dismiss btn | `Star` | `fill` | 16 | `Confetti` skews too "hype" for deadpan/minimal win modes; `Star` is neutral win symbolism |

### 3.9 Error Banners — New Additions

Neither banner has an icon currently. Add for visual hierarchy:

| Component | New Icon | Weight | Size | Placement |
|-----------|---------|--------|------|-----------|
| `SdkFailureBanner.svelte` | `Warning` | `fill` | 16 | Before message text |
| `AuthDegradedBanner.svelte` | `Warning` | `fill` | 16 | Before message text |

---

## 4. What Is Explicitly Preserved

| Element | Component | Reason |
|---------|-----------|--------|
| Animated vinyl + tonearm SVG | `VinylWithTonearm.svelte` | Branded decorative, unique |
| BB monogram | `Logo.svelte` | Brand identity |
| Sun / moon SVGs | `ThemeToggle.svelte` | Hand-crafted, intentional |
| Spotify brand mark SVG | `DashboardPage.svelte` | Can't substitute brand icon |
| Free-tile emblems (12×) | `src/client/assets/free-tile/` | Game assets, not UI icons |
| `🎉` in win overlay hype animation | `WinOverlay.svelte` confetti layer | Decorative, not an action icon |

---

## 5. Accessibility Notes

- Phosphor icons default to `aria-hidden="true"` when no `aria-label` prop is passed — correct for button-contained icons
- Every parent button/trigger must retain its existing `aria-label` text
- Warning icons added to banners: banners already carry `role="alert"`, so `aria-hidden` on the icon is correct (text carries the message)

---

## 6. Verification Checklist

- [ ] `npm run check` passes — no broken imports
- [ ] Visual review: playback controls, device chip, all modal X buttons, info tooltip, win dismiss, error banners
- [ ] Light ↔ dark toggle: all icons inherit color via `currentColor`
- [ ] Mobile 360px viewport: 14px dense-UI icons remain legible
- [ ] Straggler grep returns zero hits:
  ```
  grep -r "▶\|‖\|⏭\|⚙\|✕\|×\|&times;\|ⓘ\|♪\|☕\|🗑\|🔒\|🎵\|📱\|🔊\|💻\|▾\|←\|→" src/client --include="*.svelte"
  ```

---

## 7. Files to Modify

```
package.json
src/client/components/HostMiniPlayer.svelte
src/client/components/DeviceChip.svelte
src/client/components/DevicePicker.svelte
src/client/components/PlayerList.svelte
src/client/components/RoundConfigOverlay.svelte
src/client/components/HostControlsOverlay.svelte
src/client/components/PlayersOverlay.svelte
src/client/components/InfoTooltip.svelte
src/client/components/WinOverlay.svelte
src/client/components/SongHistoryDrawer.svelte
src/client/components/SdkFailureBanner.svelte
src/client/components/AuthDegradedBanner.svelte
src/client/pages/DashboardPage.svelte
src/client/pages/JoinPage.svelte
src/client/pages/LobbyPage.svelte
src/client/pages/GuestWaitingRoom.svelte
```
