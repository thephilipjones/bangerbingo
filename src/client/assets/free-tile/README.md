# FREE tile emblems

12 tattoo-flash SVGs for the FREE tile. The [FreeTileEmblem component](../../components/FreeTileEmblem.svelte) picks one by `seed % 12`, where the seed is a stable hash of the tile list — same card → same emblem.

## Locked Recraft recipe

- Model: `recraftv3`
- Style: `vector_illustration`
- Substyle: `linocut`
- Size: `1024x1024`
- Background: white rect that we strip post-gen
- Ink: generated as black, color-swapped to paper off-white (`#EFEBE4`) post-gen

Prompt template (swap in `[SUBJECT]`):

> American traditional tattoo flash, Sailor Jerry style, centered [SUBJECT] — iconic, grim and confident, NOT cartoon, NOT goofy. A dominant oversized ornamental scroll banner fills the lower third of the canvas reading only the word FREE in enormous bold tattoo block letters. Subtle corner flourishes or stars frame the square canvas corners. Bold confident thick ink outlines, symmetrical composition, generous negative space, no cross-hatching, clean bold linework like linocut printmaking. No photorealism, no gradients, no shading, no color fills, no extra text or numerals.

## Post-generation fix (required)

Every Recraft linocut SVG arrives as black art on a full-canvas white rect. To use on the red tile, strip the white rect and recolor black → paper:

```bash
sed '/<path d="M 0 0 L 0 2048 L 2048 2048 L 2048 0 L 0 0 z" fill="rgb(255,255,255)"/d' input.svg \
  | sed 's/rgb(0,0,0)/rgb(239,235,228)/g' > output.svg
```

Occasionally the white rect path uses a slightly different ordering/color (e.g. `rgb(254,254,254)` or `L 2048 0 L 2048 2048 L 0 2048 ...`). Check `grep -oE 'fill="[^"]*"' file.svg | sort -u` — delete whichever full-canvas path uses the near-white fill.

## Swap one emblem

1. Generate a new SVG with the recipe above (via Recraft MCP: `generate_image` with the params in "Locked recipe").
2. Run the sed post-fix.
3. Overwrite the slot file — e.g. `cp new.svg src/client/assets/free-tile/emblem-07-anchor-roses.svg`.
4. Vite HMR reloads. No code change needed since the component imports by filename, not content.

## Remove one

1. Delete the SVG file.
2. Remove the matching import and array entry in [FreeTileEmblem.svelte](../../components/FreeTileEmblem.svelte). The `seed % EMBLEMS.length` math handles any count ≥ 1.

## Add a new one

1. Generate + post-fix as above.
2. Save as `emblem-NN-subject.svg` (next index).
3. Add the import and push into `EMBLEMS` in [FreeTileEmblem.svelte](../../components/FreeTileEmblem.svelte).

## Known Recraft quirks

- **Counted pips are unreliable.** Don't ask for "snake-eyes" or "three stars" — Recraft draws arbitrary dots. Describe the vibe instead.
- **Chain frames go circular.** Requesting a square chain border pulls toward an oval almost every time. Drop the chain for cleaner framing, or accept the oval.
- **Text prompt adherence.** Literal hex codes in the prompt (`#EFEBE4`) get rendered as text on the output — always describe colors in words.
- **Skull tone drifts** between menacing and cartoon across gens. Cherry-pick from 2 gens per skull subject.

## Cost

~$0.04 per generation (V3 Vector). One full 12-pack with moderate cherry-picking: ~$1.00.
