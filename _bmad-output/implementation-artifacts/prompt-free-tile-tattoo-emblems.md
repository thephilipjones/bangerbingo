# Prompt — Generate Rock-and-Roll Tattoo Emblems for BingoCard FREE Tile (via Recraft MCP)

Copy everything below into a new Claude Code session that has the **Recraft MCP** server connected. The session should generate 12 illustrations, pick the strongest, and wire them into the existing BingoCard component.

---

## Context

**Project:** Bangerbingo — a Spotify music bingo web app (Svelte 5 + Vite). The bingo card is a 5×5 grid of song tiles with a FREE space in the center (index 12). The FREE tile currently renders an inline SVG emblem (hand-drawn by a previous pass) — we want to replace it with real tattoo-flash / playing-card-back artwork generated via Recraft.

**Files already in place:**
- [src/client/components/FreeTileEmblem.svelte](src/client/components/FreeTileEmblem.svelte) — current placeholder with 6 inline-SVG variants selected by a `seed` prop. **Replace the contents** of this file, or keep the selection logic and swap the artwork.
- [src/client/components/BingoCard.svelte](src/client/components/BingoCard.svelte) — already imports `FreeTileEmblem` and passes a stable `seed` hashed from the tile list (same card → same emblem; new round → different one). No changes needed here unless the emblem consumption model changes.

**The FREE tile visual context:**
- Square tile, rendered roughly **60px on mobile, 120px on desktop**.
- Background: `var(--accent)` — a hot pink / magenta brand color (see [src/client/app.css](src/client/app.css) for the actual value).
- Foreground/ink: `var(--accent-fg)` — a near-black or deep neutral.
- Must read instantly at 60px. No fine hairlines, no tiny text, no fragile filigree.

## The Brief

The center FREE space should feel like **the back of a Bicycle playing card crossed with old-school American traditional tattoo flash** — forearm ink, Sailor Jerry energy, bold black lines, chunky fills, symmetrical-ish framing, optional ribbon/banner with "FREE" woven in. The square should feel like the *back* of a playing card (ornamental, iconic, centerpiece) rather than a face (informational).

This is a personal-use app for friends — the emblem is a **moment of delight**, the visual wink that says "this app has taste." When a player glances at the card mid-game their eye should catch on the FREE tile and like it a little more each round.

## Style Direction (feed these to Recraft)

- **Medium:** American traditional tattoo flash, old-school ink, heavy black outlines
- **Palette:** monochrome — solid black ink on transparent background (we'll composite onto the hot-pink accent tile ourselves). Two-tone is OK if the second color is solid black-or-white only; no gradients, no shading, no color fills that would clash with magenta backgrounds
- **Line weight:** bold, confident, tattoo-gun thick. Think 3–5px strokes at 500×500px rendering
- **Composition:** centered subject, symmetrical or near-symmetrical, square canvas with subtle corner flourishes so it reads as "back of a playing card"
- **The word FREE:** integrated into a classic tattoo banner/ribbon/scroll at the bottom, OR woven into the composition (e.g. written across a gravestone, on a dagger blade, on a record label). Not optional — every variant must contain the word FREE legibly
- **Mood:** rock and roll, slightly dangerous, grinning, not scary-scary. Fun dark, not edgelord

## Recraft Parameters (suggested)

- **Style:** `digital_illustration/2d_art_poster` or the closest Recraft equivalent to "tattoo flash / line art / vector illustration". If Recraft has a `vector_illustration` or `tattoo` style, use that.
- **Background:** transparent PNG (so the magenta tile shows through). If transparent isn't supported, white background and we'll remove it.
- **Size:** 1024×1024 square.
- **Negative/avoid:** photorealism, gradients, color fills, 3D rendering, soft shading, watercolor.

## The Twelve Designs

Generate all twelve. Each prompt should share the base style modifiers ("American traditional tattoo flash, bold black ink lines on transparent background, centered square composition, ornamental scroll banner reading FREE at bottom") plus the subject-specific description.

1. **Classic Rose + Banner** — a blooming five-petal rose with two leaves, thorny stem, banner underneath that reads "FREE"
2. **Flaming Heart** — anatomical-style heart wreathed in flames, banner reads "FREE"
3. **Crowned Skull** — grinning skull wearing a small pointed crown, "FREE" on a banner in its teeth
4. **Snake-Eyes Dice** — a pair of dice showing snake eyes (1-1) with radiating sunburst lines behind them, "FREE" banner below
5. **Serpent + Microphone** — a viper coiled around a vintage stage microphone, forked tongue out, "FREE" on a banner wrapped around the mic stand
6. **Lightning + Record** — a 7-inch vinyl record struck through by a lightning bolt, "FREE" etched onto the record label
7. **Anchor + Roses** — nautical anchor wrapped in rope with two roses flanking it, "FREE" on a banner across the shank
8. **All-Seeing Pyramid Eye** — a pyramid with a single eye at the top, radiating rays, "FREE" on a scroll at the base
9. **Cassette + Thorns** — a compact audio cassette tape wrapped in a thorny vine, "FREE" written across the cassette's label area
10. **Guitar-Skull** — a skull with an electric guitar laid diagonally behind it like crossed bones, "FREE" banner below
11. **Horseshoe + Bats** — a lucky horseshoe with two small bats flying out from the top, "FREE" on a banner underneath
12. **Moth with Moon** — a symmetrical moth (death's-head style) with a full moon behind it, "FREE" banner below

## Integration After Generation

1. Save the 12 PNGs to [src/client/assets/free-tile/](src/client/assets/free-tile/) as `emblem-01-rose.png`, `emblem-02-flaming-heart.png`, etc.
2. **Curate:** view all 12. Keep the **strongest 6–8**. Tattoo flash is all-or-nothing — a weak emblem will drag down the set. Delete the losers, don't ship them.
3. Rewrite [src/client/components/FreeTileEmblem.svelte](src/client/components/FreeTileEmblem.svelte) to:
   - Import the kept PNGs as Vite asset URLs
   - Select one by `seed % keptCount`
   - Render a single `<img>` with `alt="Free space"`, filling the tile (`width: 100%; height: 100%; object-fit: contain;`)
   - Remove all the inline-SVG variant markup
4. Keep the `seed` prop contract unchanged — BingoCard.svelte already passes a stable hash of the tile list.
5. Visual check: run `npm run dev`, open a game, confirm:
   - Emblem fills the center tile, doesn't overflow
   - Reads clearly at mobile width (DevTools → iPhone preset)
   - Doesn't clash with the hot-pink accent background (if it does, consider inverting to white ink, or adding a subtle white inner glow in the PNG)
   - `seed` produces the same emblem across re-renders of the same card

## Out of Scope (don't do these)

- Don't animate the emblem. Static is the right choice — it's backdrop, not focus.
- Don't add color tinting via CSS filters. If the art needs to be white instead of black, regenerate with Recraft, don't hack it at runtime.
- Don't replace or refactor the BingoCard seeding logic.
- Don't add new tests; a static asset swap doesn't warrant them.

## Acceptance

- 6–8 curated tattoo-flash emblems in `src/client/assets/free-tile/`
- `FreeTileEmblem.svelte` rewritten to render PNGs, selected by seed
- Dev server running, center tile visibly upgraded from placeholder SVG to real flash art
- Reports back with: which variants shipped, which were cut and why, any rendering quirks noticed
