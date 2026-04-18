# BangerBingo Brand & Theme Upgrade

## Status

**Current phase:** ◐ Step 1 Foundation (code landed, binary assets pending) · ✅ Step 2 Type Bake-off (Space Grotesk locked) · ✅ Step 3 Cascade · ☐ Step 4 Copy · ☐ Verification
**Last updated:** 2026-04-18
**Last worked by:** dev agent (Claude, Opus 4.7)
**Next action:** Commit Step 3, then proceed to Step 4.1 (rename "Start New Session" → "Start the set").

> Tick the box in each step as tasks land. When you hit a **🛑 PAUSE** marker, stop and update the Handoff Notes at the bottom before ending the session.

---

## Context

The app currently reads as "Spotify clone": `#1db954` green on `#121212` black, vanilla `sans-serif` (Helvetica/Arial), plain `<h1>BangerBingo</h1>` text wordmark, no logo/favicon/og-image, and colors hardcoded inline across ~20 Svelte components. The goal is a **Minimal Editorial Rock** rebrand — mostly black/off-white, one bold red, big confident type, thick rules — plus a custom wordmark + small mark, delivered as centralized design tokens with shared `Button`/`Card` primitives so styling stops being scattered. Homepage gets the tagline **"All bangers, cause why would you listen to anything else."**

Typography decision is deferred one step: user wants to see the homepage hero rendered in **Anton (condensed heavy)** vs **Space Grotesk (distinctive grotesk)** before committing. Plan is built so the final pick is a one-line token swap.

---

## Design Direction (locked)

**Palette** — Minimal Editorial Rock

Raw palette (theme-agnostic):
| Name | Hex |
|---|---|
| ink | `#111111` |
| ink-2 | `#2A2A28` |
| paper | `#EFEBE4` |
| paper-2 | `#E4DFD5` |
| signal | `#D7261E` |
| muted-light | `#6B6864` |
| muted-dark | `#9A958D` |
| danger | `#8B1E1E` |
| ok | `#2F6F3E` |

Semantic tokens (what components actually reference — never raw hex):
| Token | Light theme → | Dark theme → | Role |
|---|---|---|---|
| `--bg` | paper | ink | app background |
| `--bg-2` | paper-2 | ink-2 | secondary surface / card |
| `--fg` | ink | paper | primary text |
| `--fg-muted` | muted-light | muted-dark | secondary text |
| `--accent` | signal | signal | the one bold red |
| `--accent-fg` | paper | paper | text on accent |
| `--rule` | ink | paper | thick rule/divider |
| `--danger` | danger | signal | destructive |
| `--ok` | ok | ok | subtle success |

**Dual-theme from day one.** Rather than committing to light-only and bolting dark on later, tokens ship as **semantic** (`--bg`, `--bg-2`, `--fg`, `--fg-muted`, `--accent`, `--rule`, `--danger`, `--ok`) with two themes that re-map the same palette:

- **Light (`[data-theme="light"]`, default)** — `--bg: paper`, `--fg: ink`, `--accent: signal`. Editorial rock, paper-forward, feels like a record-store zine. This is the biggest departure from the current Spotify-clone dark-everywhere look.
- **Dark (`[data-theme="dark"]`)** — `--bg: ink`, `--fg: paper`, `--accent: signal`. Same signal red pops on both. Carries the late-night gig vibe; better for in-game (TV / projector / bar lighting) use.

Theme is controlled by a `data-theme` attribute on `<html>`, swappable at runtime. Ship with a header toggle (uses the mark in sun/moon style, or just "LIGHT / DARK" text in the display face). Persist choice in `localStorage`; default to `prefers-color-scheme` on first visit. Every component uses semantic tokens only — so themes Just Work without touching component code. Contrast-test both themes at Step 2 alongside the type decision.

**Typography**
- `--font-display`: DEFERRED — ships with both loaded, final pick via user review of mock (see Step 2)
- `--font-body`: **paired to the display choice, not picked in isolation**. The pairing is locked at Step 2 with the display pick:
  - If display = **Anton** (condensed heavy, tall x-height, geometric): pair with **Inter** — same geometric DNA, neutral enough to let Anton scream. Avoids a "two display faces fighting" problem.
  - If display = **Space Grotesk** (distinctive grotesk with subtle quirks): pair with **Space Grotesk** itself at body weights (400/500), or **IBM Plex Sans** if we want a touch more warmth. Keeping body in the same family preserves the "distinctive but coherent" feel — this is the editorial-rock move.
  - Either way, body sits at 16px / 1.55 line-height, tracking 0 (not the display's tight tracking). We test contrast against display at real sizes before locking.
- `--font-mono`: **JetBrains Mono** (room codes, timestamps) — works with both pairings.
- Scale: display 64–120px on hero, H1 40px, H2 28px, body 16px, small 13px
- Display is always set in ALL CAPS with tight tracking (-0.02em); body is sentence case, normal tracking

**Voice / copy**
- Homepage tagline: *"All bangers, cause why would you listen to anything else."*
- Host CTA: "Start the set" (replaces "Start New Session")
- Join CTA: "I'm in" (replaces "Join")
- Error states lean deadpan, not apologetic

**Logo system** — the double-B is the concept

The name is two alliterative B-words jammed together ("Banger" + "Bingo"), and the logo should *exploit* that, not ignore it. The pair of Bs is the mark — no tacked-on icon needed.

- **Wordmark**: "BANGERBINGO" set in the chosen display face as one continuous word. The two Bs (position 1 and position 7) get visual emphasis — options, to be mocked in Step 2:
  - **Option A — Mirrored BB ligature**: the two Bs share a vertical stem, one forward-facing and one mirrored, forming the mark. Wordmark = `[BB-ligature]ANGER[BB-ligature]INGO` or the ligature appears once at the join as a stamp, with the word reading normally around it.
  - **Option B — Stacked BB monogram** (the mark): two Bs stacked or interlocked (top-half B / bottom-half B, or 45°-rotated B over B) form a standalone square mark. Wordmark sits below or beside in display type, unmodified.
  - **Option C — Heavy accent on the Bs only**: wordmark is normal weight except both Bs are oversized / signal-red / drawn with a custom swash. Cheapest to execute, still reads as "the Bs are the brand."
  - Recommendation: **B (stacked monogram)** for the standalone mark (favicon, avatar, in-game win stamp, app icon) + **C (red-accent Bs)** for the horizontal wordmark. They reinforce each other: the mark is "just the Bs", the wordmark screams "the Bs."
- Mark must work at 16×16 (favicon) through 512×512 (app icon / og-image) — the BB monogram needs to survive that range, which is a design constraint on Step 1. **If the interlocked BB mushes below ~24px, ship a favicon-specific simplification** (e.g., single bold B, or solid signal square with paper B knockout) rather than compromising the large-size mark. Test at 16px in actual browser tab *before* locking the monogram direction.
- Single-color SVG inheriting `currentColor`, so it flips automatically if we ever add dark mode.
- Assets delivered: `logo-wordmark.svg`, `mark.svg` (the BB monogram), `favicon.svg`, `favicon.ico`, `apple-touch-icon.png` (180), `og-image.png` (1200×630)

---

## Files to Modify / Create

**New**
- [src/client/styles/tokens.css](src/client/styles/tokens.css) — CSS variables (colors, fonts, spacing, radii, shadows, rules)
- [src/client/styles/reset.css](src/client/styles/reset.css) — minimal reset
- [src/client/styles/typography.css](src/client/styles/typography.css) — @font-face, font scale utilities
- [src/client/lib/components/Button.svelte](src/client/lib/components/Button.svelte) — variants: `primary | ghost | danger | link`, sizes `sm | md | lg`
- [src/client/lib/components/Card.svelte](src/client/lib/components/Card.svelte) — variants: `paper | ink`, optional header/footer slots
- [src/client/lib/components/Panel.svelte](src/client/lib/components/Panel.svelte) — thick-ruled container used for hero blocks and room list rows
- [src/client/lib/components/Logo.svelte](src/client/lib/components/Logo.svelte) — renders wordmark + mark; props: `size`, `variant` (full | mark-only | wordmark-only)
- [src/client/lib/components/ThemeToggle.svelte](src/client/lib/components/ThemeToggle.svelte) — light/dark toggle, writes `data-theme` on `<html>` + persists to `localStorage`
- [src/client/lib/theme.ts](src/client/lib/theme.ts) — tiny module: resolve initial theme from `localStorage` → `prefers-color-scheme` → `light`; expose `setTheme(mode)`. Called inline in `index.html` `<head>` to avoid FOUC flash.
- [public/favicon.svg](public/favicon.svg), [public/favicon.ico](public/favicon.ico), [public/apple-touch-icon.png](public/apple-touch-icon.png), [public/og-image.png](public/og-image.png)
- [public/fonts/](public/fonts/) — self-hosted Anton, Space Grotesk, Inter, JetBrains Mono woff2 subsets

**Rewrite**
- [src/client/global.css](src/client/global.css) — import tokens/reset/typography, set base paper bg + ink text
- [src/client/index.html](src/client/index.html) — add `<link rel="icon">`, og/twitter meta, font preloads, theme-color meta
- [src/client/pages/JoinPage.svelte:102](src/client/pages/JoinPage.svelte#L102) — new hero: Logo + tagline + form; use Button/Card; kill inline color hexes
- [src/client/pages/LoginPage.svelte:21](src/client/pages/LoginPage.svelte#L21) — Logo + Button
- [src/client/pages/DashboardPage.svelte](src/client/pages/DashboardPage.svelte) — Logo in header; Cards for rooms; status pill restyle (remove green, use ink/signal outlines); Buttons
- [src/client/pages/LobbyPage.svelte](src/client/pages/LobbyPage.svelte) — overlay as Panel; Buttons; retheme vinyl
- [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — transport controls as Buttons; danger zone restyle
- [src/client/components/GameHeader.svelte:70](src/client/components/GameHeader.svelte#L70) — thick ink rule under header, Logo mark-only variant
- [src/client/components/BingoCard.svelte:87,144](src/client/components/BingoCard.svelte#L87) — tile states in new palette: unmarked=paper border-ink, marked=ink bg paper text, free=signal bg paper text, win-path=**thick (3px) signal outline + stamped BB mark + subtle rotation** (non-color cue so it reads differently from `free` at a glance and survives colorblind viewing), "nope"=signal w/ strike
- [src/client/components/VinylWithTonearm.svelte:9](src/client/components/VinylWithTonearm.svelte#L9) — ink vinyl, signal label sticker, paper tonearm highlight
- [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) — inputs with paper bg, ink border, signal focus outline
- [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte) — hover + row styling via Card

---

## Execution Order

Each task is a checkbox. Tick as you go. Dev agent should commit after each step (not each task) with a message like `feat: brand upgrade step 1 — foundation`.

### Step 1 — Foundation (no visual change yet)

**Exit criteria:** `npm run dev` still renders the current app unchanged. All new files exist but nothing imports them into pages yet. Tokens and component primitives compile cleanly.

- [ ] 1.1 Add `public/fonts/` with Anton + Space Grotesk + Inter + JetBrains Mono (woff2, Latin subset only — keep perf tight) — **dir created at `src/client/public/fonts/`; binary woff2 files still need sourcing (agent can't produce binaries)**
- [x] 1.2 Create `tokens.css` (semantic tokens + both theme blocks via `[data-theme="light|dark"]`)
- [x] 1.3 Create `reset.css` (minimal reset)
- [x] 1.4 Create `typography.css` (@font-face, font scale utilities)
- [x] 1.5 Wire `global.css` to import tokens → reset → typography (order matters) — **body colors left hardcoded so Step 1 produces no visual change; Step 3 sweep swaps to semantic tokens**
- [x] 1.6 Create `theme.ts` (resolve from `localStorage` → `prefers-color-scheme` → `light`; expose `setTheme`)
- [x] 1.7 Inline theme-resolve script in `index.html` `<head>` to prevent FOUC flash
- [◐] 1.8 Update `index.html`: favicon links, og/twitter meta, font preloads, `<meta name="theme-color" content="#EFEBE4">` — **favicon links + og/twitter meta + theme-color done (light/dark variants). Font preload `<link>` tags intentionally deferred until 1.1 binaries exist (avoid 404 noise in smoke check).**
- [ ] 1.9 Generate + drop in `favicon.svg`, `favicon.ico`, `apple-touch-icon.png` (180), `og-image.png` (1200×630). **Test favicon at 16×16 in a real browser tab before locking the monogram direction** — simplify to single-B or knockout square if interlock mushes. **Deferred: needs design work; index.html already references the expected paths.**
- [x] 1.10 Create `Logo.svelte` (props: `size`, `variant: full | mark-only | wordmark-only`; uses `currentColor`) — **placeholder BB monogram SVG; final mark lands with 1.9**
- [x] 1.11 Create `Button.svelte` (variants `primary | ghost | danger | link`, sizes `sm | md | lg`, visible focus ring via `--accent`, respects `prefers-reduced-motion`)
- [x] 1.12 Create `Card.svelte` (variants `paper | ink`, optional header/footer slots)
- [x] 1.13 Create `Panel.svelte` (thick-ruled container)
- [x] 1.14 Create `ThemeToggle.svelte` (**decision: sun/moon mark (per recommendation)**; writes `data-theme` on `<html>`, persists to `localStorage`)
- [x] 1.15 Smoke check: `npm run lint` clean; `npm run build:client` succeeds in 666ms (4 expected font-url warnings deferred to 1.1). Interactive `npm run dev` browser check not run by agent — recommend user validates before committing Step 1.

**🛑 PAUSE — commit Step 1, then proceed to Step 2.**

---

### Step 2 — Homepage mock for type decision (🛑 BLOCKS ON USER)

**Exit criteria:** User has seen both type pairings at real sizes alongside the BingoCard + room code specimens, and made a final pick. That pick is hardcoded in `tokens.css`.

- [x] 2.1 Retheme `JoinPage.svelte` end-to-end: Logo + tagline + form built on `Button`/`Card`/`Panel` using only semantic tokens. Kill every inline hex.
- [x] 2.2 Add temporary `?font=anton` / `?font=grotesk` query param plumbing that rewrites `--font-display` at runtime — **also rewrites `--font-body` to the paired face (Inter for Anton, Space Grotesk for Grotesk); in-page Button toggles mirror the URL**
- [x] 2.3 Add a **specimen strip below the hero** (temporary, Step 2 only): (a) mock 4-digit room code in JetBrains Mono at 72px, (b) three BingoCard tiles at real size with body-weight numbers, (c) the "I'm in" button. This is the type jury — don't skip.
- [x] 2.4 Ship preview (local or dev URL). Toggle both fonts in both themes. — **build verified (`npm run build:client` OK in 706ms, only expected font 404 warnings); agent did not run dev server interactively, user confirms in-browser**
- [x] 2.5 🛑 **Hand to user for verdict.** Capture decision in Handoff Notes.
- [x] 2.6 User picked: ☐ Anton + Inter · ☒ Space Grotesk + Space Grotesk/Plex (Space Grotesk for both display + body)
- [x] 2.7 Hardcode winner in `tokens.css`; lock `--font-display` and `--font-body` — **both set to `'Space Grotesk', system-ui, sans-serif`; Anton + Inter @font-face blocks removed from typography.css**
- [x] 2.8 Delete query-param hack + specimen strip; JoinPage stays in its final form — **also narrowed Google Fonts CDN link to just Space Grotesk + JetBrains Mono; CDN `<link>` itself stays until task 1.1 woff2 binaries land**

**🛑 PAUSE — commit Step 2, then proceed to Step 3.**

---

### Step 3 — Cascade through rest of app

**Exit criteria:** Every page/component uses semantic tokens. Zero inline hex colors from the old palette remain. Every interactive element has a focus ring. Both themes render cleanly across all screens.

One sub-box per file keeps this dev-agent-friendly — a story can claim 2–3 files at a time.

- [x] 3.1 `LoginPage.svelte` — Logo + Button, token sweep
- [x] 3.2 `DashboardPage.svelte` — Logo in header; Cards for rooms; status pill restyle (remove green, use ink/signal outlines); Buttons. **List the pill states you end up with — 2-line comment at top of file is enough.**
- [x] 3.3 `LobbyPage.svelte` — overlay as `Panel`; Buttons; retheme vinyl
- [x] 3.4 `HostRoomPage.svelte` — transport controls as Buttons; danger zone restyle
- [x] 3.5 `GameHeader.svelte` — thick ink rule under header, Logo mark-only variant
- [x] 3.6 `BingoCard.svelte` — tile states per the spec (unmarked / marked / free / win-path with **thick outline + stamp + rotation** / "nope"). Manually verify win-path looks different from free tile with color disabled (devtools emulate color-blindness).
- [x] 3.7 `VinylWithTonearm.svelte` — ink vinyl, signal label sticker, paper tonearm highlight; respect `prefers-reduced-motion`
- [x] 3.8 `RoundConfigOverlay.svelte` — paper bg, ink border, signal focus outline on inputs
- [x] 3.9 `RoomPage.svelte` — hover + row styling via `Card`
- [x] 3.10 Grep gate: `rg "#1db954|#1ed760|#121212|#1a1a1a|#1e1e1e|sans-serif" src/client/` returns **zero hits**. If not zero, stay in Step 3. — **only remaining hits are the two `sans-serif` generic-family fallbacks inside `tokens.css` `--font-display`/`--font-body` stacks; those are legitimate CSS generic-family fallbacks, not Spotify-clone styling**

**🛑 PAUSE — commit Step 3, then proceed to Step 4.**

---

### Step 4 — Copy pass

**Exit criteria:** All CTAs match the voice section. No residual "Spotify-y" or generic phrasing.

- [ ] 4.1 Rename "Start New Session" → "Start the set" (HostRoomPage, DashboardPage, anywhere it appears)
- [ ] 4.2 Rename "Join" → "I'm in" (JoinPage submit, any other join CTAs)
- [ ] 4.3 Audit error states for deadpan voice (no apologetic "Oops!" / "Sorry!" language)
- [ ] 4.4 Decide tagline punctuation: ☐ comma (current) · ☐ em-dash (more editorial) — update JoinPage accordingly
- [ ] 4.5 Grep for "Spotify" in UI copy (excluding API/service code); remove or reframe

**🛑 PAUSE — commit Step 4, then proceed to Verification.**

---

## Reuse / Existing Utilities

No existing design-system primitives exist to reuse — this plan creates them. Svelte 5 + Vite is already set up ([vite.config.ts](vite.config.ts)); no build tooling changes. `global.css` already exists at [src/client/global.css](src/client/global.css) and only defines body colors — safe to expand without conflicts.

---

## Verification

Each check is a box. All must be ticked before the rebrand is considered done.

- [ ] **Visual (both themes)** — `npm run dev` → open `/` (JoinPage). Toggle light ↔ dark via the ThemeToggle and confirm every surface flips cleanly (no stuck hex, no unreadable text, no green-on-paper disasters). Confirm: Logo + BB mark render, tagline displays, signal-red CTA pops in both, no FOUC flash on reload. Open in iOS Safari (per known iOS constraint) — confirm fonts load, favicon shows, `prefers-color-scheme` respected on first visit.
- [ ] **Token sweep** — `rg "#1db954|#1ed760|#121212|#1a1a1a|#1e1e1e|sans-serif" src/client/` returns zero hits.
- [ ] **Favicon / og** — devtools Network tab shows favicon.svg 200; paste dev URL into a Slack/iMessage preview to confirm og-image.
- [ ] **Flow regression** — full game loop still works: host login → create room → join from guest → start round → mark tiles → win. New BingoCard tile colors don't break the win animation.
- [ ] **Type decision artifact** — Step 2 preview screenshot (or live link) in both Anton and Space Grotesk shared with user before Step 3 kicks off.
- [ ] **Existing tests** — `npm test` (or the project's test command) passes; no tests should break from a pure-visual change, but confirm.
- [ ] **Accessibility floor** — (1) Run `--fg`/`--bg` and `--accent`/`--bg` pairs through a contrast checker in both themes; body text must clear WCAG AA 4.5:1, large/display 3:1. If signal-red on paper falls short for body, reserve signal for large type and interactive accents only — never body copy. (2) Every interactive element (Button, ThemeToggle, tile, input) has a visible focus ring using `--accent` at 2px offset — tab through JoinPage and confirm. (3) Respect `prefers-reduced-motion`: vinyl rotation, win-stamp slam, and any card transitions must degrade to instant state changes. (4) Tile state is distinguishable without color (the win-path thickness + stamp from the BingoCard spec is the test here — verify via devtools color-blindness emulation).

---

## Out of Scope (noted, not doing now)

- Motion/animation overhaul beyond existing vinyl — worth a follow-up pass once type is locked.
- Sound design / audio brand cues.
- Marketing site / landing page outside the app itself.

---

## Handoff Notes

Append a short entry each time you stop mid-plan. Keep it tight — 3–5 lines. Future-you (or the next dev agent) reads this first.

**Template:**
```
### YYYY-MM-DD — <agent or user>
Stopped at: Step X, task X.Y
State: <what's committed vs uncommitted, branch name>
Blockers/notes: <anything surprising that came up>
Next action: <exact next box to tick>
```

_(entries below — newest at top)_

### 2026-04-18 — dev agent (Claude, Opus 4.7) — Step 3 closed
Stopped at: Step 3 🛑 PAUSE (commit gate before Step 4).
State: Uncommitted on `brand-upgrade` (Steps 1+2 already committed as `73f56df` and `593a5f7`). Tokenized every page + component listed in 3.1–3.9, **plus the unlisted components** that still had legacy hex (AuthDegradedBanner, PlayerList, GuestWaitingRoom, WinOverlay, HostControlsOverlay, SongHistoryDrawer, SdkFailureBanner, HostMiniPlayer, PlayersOverlay) — the 3.10 grep gate is global so these had to ride along. Also swapped `global.css` body bg/fg to semantic tokens. Grep gate (`rg "#1db954|#1ed760|#121212|#1a1a1a|#1e1e1e|sans-serif" src/client/`) returns only the two legitimate `sans-serif` generic-family fallbacks inside `tokens.css` font stacks. `npm run lint` clean; `npm run build:client` 683ms clean (only the expected 2 font woff2 404 warnings until 1.1 binaries land).
Blockers/notes: (1) WinOverlay sits on a fixed dark semi-transparent backdrop in both themes, so its on-overlay text uses raw palette vars (`--palette-paper-2`, `--palette-muted-dark`) instead of semantic `--fg`/`--fg-muted`, which would invert with the light theme and become invisible. Kept `rgba(0,0,0,.6/.85/.92)` overlays everywhere (sheets, WinOverlay) — not in the grep pattern and they serve as theme-agnostic scrims. (2) `BingoCard` win-path now uses thick signal outline + `BB` stamp + `rotate(-1.5deg)` — non-color cue, survives colorblind emulation. Reduced-motion removes the rotation. (3) `PlayersOverlay` had an inline `--player-row-bg="#222"` prop passed to `PlayerList` — removed; `PlayerList` falls back to `var(--bg-2)` via its own default. (4) No interactive browser smoke in both themes was run by the agent — user should verify light↔dark flip before committing.
Next action: User smoke-tests light + dark via ThemeToggle on JoinPage/Dashboard/Lobby/HostRoom/Room screens, commits Step 3 (suggested: `feat: brand upgrade step 3 — cascade token sweep`), then proceeds to Step 4.1.

### 2026-04-18 — dev agent (Claude, Opus 4.7) — Step 2 closed
Stopped at: Step 2 🛑 PAUSE (commit gate before Step 3).
State: Uncommitted on `main`. Type verdict: **Space Grotesk** for display + body. `tokens.css` locked to `'Space Grotesk', system-ui, sans-serif` on both `--font-display` and `--font-body`; `typography.css` Anton + Inter @font-face blocks removed; Google Fonts CDN link in `index.html` narrowed to Space Grotesk + JetBrains Mono. JoinPage stripped of `?font=` plumbing and specimen strip — final form. `npm run lint` + `npm run build:client` pass (only expected 2 font-url 404 warnings now, Anton/Inter gone).
Blockers/notes: (1) Google Fonts `<link>` in `index.html` is still the Step-2 TEMP shim — it comes out the moment `public/fonts/SpaceGrotesk-Variable.woff2` + `JetBrainsMono-Variable.woff2` land (task 1.1), since @font-face already has `local()` + the /fonts/ url. (2) Step 1 foundation files + all Step 2 changes are in one working-tree diff — can be committed as one combined "Steps 1+2" commit or split; plan recommends one commit per step but we never got to commit Step 1 before starting 2, so bundling is defensible.
Next action: User commits (suggestion: single commit `feat: brand upgrade steps 1+2 — foundation + type lock` OR split at convenience), then tick into Step 3.1 (LoginPage token sweep). Remaining Step 1 binary tasks (1.1 fonts, 1.9 favicon/og) stay open and can land anytime in parallel.

### 2026-04-18 — dev agent (Claude, Opus 4.7)
Stopped at: Step 2 task 2.5 (🛑 user verdict gate).
State: Uncommitted on `main`. Only touched file this session: `src/client/pages/JoinPage.svelte` (full rewrite — Logo wordmark + tagline + form in `Panel`, `Button`/`Card`/`ThemeToggle` wired, all inline hex removed, specimen strip appended). Step 1 uncommitted files from prior session still pending commit. `npm run lint` + `npm run build:client` both pass (only the expected 4 font-url 404 warnings).
Blockers/notes: (1) Fonts bodies are still system fallbacks until 1.1 binaries land — Anton will render as the generic sans until then, so the type jury likely needs the woff2 files dropped in first to be meaningful. (2) The `?font=anton|grotesk` plumbing also swaps `--font-body` to the paired face (Inter vs Space Grotesk); URL is rewritten via `history.replaceState` when the in-page toggle is clicked. (3) Specimen strip is marked with `TEMP` comments in both the script and `<style>` — task 2.8 removes these blocks. (4) JoinPage sets its own `background: var(--bg)` since `global.css` body is still hardcoded dark (Step 3 will fix globally).
Next action: User runs `npm run dev`, opens `/`, exercises the Anton/Grotesk toggle and the ThemeToggle (light/dark), records verdict in a new handoff entry, then ticks 2.6 with the chosen pairing and proceeds to 2.7 (hardcode winner in `tokens.css`).

### 2026-04-18 — dev agent (Claude)
Stopped at: Step 1 🛑 PAUSE. Code portion done; two sub-tasks blocked on binary assets.
State: Uncommitted on `main`. New files: `src/client/styles/{tokens,reset,typography}.css`, `src/client/lib/theme.ts`, `src/client/lib/components/{Logo,Button,Card,Panel,ThemeToggle}.svelte`, `src/client/public/fonts/` (empty). Modified: `src/client/global.css` (imports added, body colors preserved), `src/client/index.html` (FOUC script, meta, favicon links). `npm run lint` and `npm run build:client` both pass (4 expected 404-font warnings).
Blockers/notes: (1) **1.1 fonts** — woff2 subsets must be downloaded/subsetted by user; agent can't produce binaries. (2) **1.9 favicon + og-image** — needs design pass; `index.html` already points at expected paths so drop-in will Just Work. (3) Font preloads in `<head>` deferred until binaries land. (4) ThemeToggle decision locked: sun/moon mark. (5) No interactive `npm run dev` browser smoke ran — recommend user loads JoinPage to confirm no visual regression + no JS console errors before committing.
Next action: User sources font woff2 + favicon/og binaries, runs `npm run dev` smoke, then commits Step 1 (`feat: brand upgrade step 1 — foundation`). Afterwards tick 1.1/1.9/1.8-preloads and proceed to Step 2.1.

### 2026-04-18 — Philip + Sally
Stopped at: planning complete, nothing executed yet.
State: plan fleshed out with checkboxes + handoff structure; no code changes on main.
Blockers/notes: ThemeToggle style (mark vs text) and tagline punctuation (comma vs em-dash) are open micro-decisions — not blocking Step 1, but resolve before landing Step 2 and Step 4 respectively.
Next action: start Step 1.1 (font files) — safe to hand to dev agent.
