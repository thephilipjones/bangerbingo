<script lang="ts">
  import type { ClientTile } from '../lib/bingo.ts'

  let {
    tiles,
    onTileClick,
    nopeIndex = null,
  }: {
    tiles: ClientTile[]
    onTileClick: (index: number) => void
    nopeIndex?: number | null
  } = $props()
</script>

<div class="bingo-grid" role="grid" aria-label="Bingo card">
  {#each tiles as tile, i}
    {#if tile.free}
      <div
        class="tile free"
        class:win-path={tile.winPath}
        aria-label="Free space"
        aria-disabled="true"
      >
        <div class="tile-content">
          <span class="free-label">FREE</span>
        </div>
      </div>
    {:else}
      <button
        class="tile"
        class:unmarked={tile.state === 'unmarked'}
        class:marked={tile.state === 'marked'}
        class:auto-marked={tile.autoMarked}
        class:win-path={tile.winPath}
        class:nope={i === nopeIndex}
        title={tile.title}
        aria-label={`${tile.title} by ${tile.artist}${tile.state === 'marked' ? ' (marked)' : ''}`}
        aria-pressed={tile.state === 'marked'}
        onclick={() => onTileClick(i)}
      >
        <div class="tile-content">
          <span class="tile-title">{tile.title}</span>
          <span class="tile-artist">{tile.artist}</span>
        </div>
      </button>
    {/if}
  {/each}
</div>

<style>
  .bingo-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    width: 100%;
    max-width: 360px;
    margin: 0 auto;
  }

  .tile {
    aspect-ratio: 1;
    min-width: 44px;
    min-height: 44px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    overflow: hidden;
    padding: 4px;
    box-sizing: border-box;
  }

  .tile.unmarked {
    background: var(--bg);
    color: var(--fg);
    border: var(--rule-thin) solid var(--rule);
  }

  .tile.marked {
    background: var(--fg);
    color: var(--bg);
    border: var(--rule-thin) solid var(--fg);
  }

  .tile.free {
    background: var(--accent);
    color: var(--accent-fg);
    cursor: default;
    pointer-events: none;
    border: var(--rule-thin) solid var(--accent);
  }

  /* Win path: thick accent outline + stamp + rotation — distinct from `.free`
     without relying on color alone (survives colorblind viewing). */
  .tile.win-path {
    outline: var(--rule-thick) solid var(--accent);
    outline-offset: -3px;
    transform: rotate(-1.5deg);
    position: relative;
  }
  .tile.win-path::after {
    content: 'BB';
    position: absolute;
    top: 2px;
    right: 3px;
    font-family: var(--font-display);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: -0.05em;
    color: var(--accent);
    background: var(--bg);
    padding: 0 2px;
    pointer-events: none;
  }
  .tile.marked.win-path::after {
    color: var(--accent);
    background: var(--bg);
  }
  @media (prefers-reduced-motion: reduce) {
    .tile.win-path { transform: none; }
  }

  .tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .tile-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 100%;
    text-align: center;
  }

  .tile-title {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }

  .tile-artist {
    font-size: 10px;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .free-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  @keyframes nope-wobble {
    0%   { transform: translateX(0) rotate(0); }
    20%  { transform: translateX(-3px) rotate(-2deg); }
    40%  { transform: translateX(3px)  rotate(2deg);  }
    60%  { transform: translateX(-2px) rotate(-1deg); }
    80%  { transform: translateX(2px)  rotate(1deg);  }
    100% { transform: translateX(0) rotate(0); }
  }

  .tile.nope {
    animation: nope-wobble 420ms ease-out;
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    text-decoration: line-through;
  }

  @media (prefers-reduced-motion: reduce) {
    .tile.nope { animation: none; }
  }

  @keyframes auto-mark-sweep {
    0%   { transform: scale(1);    opacity: 1; }
    30%  { transform: scale(0.94); opacity: 0.7; }
    100% { transform: scale(1);    opacity: 1; }
  }

  .tile.auto-marked {
    animation: auto-mark-sweep 520ms ease-out 120ms both;
  }

  @media (prefers-reduced-motion: reduce) {
    .tile.auto-marked { animation: none; }
  }

  @media (min-width: 768px) {
    .bingo-grid {
      max-width: 640px;
      gap: 6px;
    }
    .tile { padding: 6px; }
    .tile-title {
      font-size: 13px;
      -webkit-line-clamp: 3;
      line-clamp: 3;
    }
    .tile-artist { font-size: 11px; }
    .free-label { font-size: 15px; }
  }
</style>
