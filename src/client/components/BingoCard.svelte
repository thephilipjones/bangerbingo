<script lang="ts">
  import type { ClientTile } from '../lib/bingo.ts'

  let {
    tiles,
    onTileClick,
  }: {
    tiles: ClientTile[]
    onTileClick: (index: number) => void
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
        class:masked={tile.masked}
        class:revealing={tile.revealing}
        class:win-path={tile.winPath}
        title={tile.title}
        aria-label={tile.masked ? `${tile.songLabel} (masked)` : `${tile.title} by ${tile.artist}${tile.state === 'marked' ? ' (marked)' : ''}`}
        aria-pressed={tile.state === 'marked'}
        onclick={() => onTileClick(i)}
      >
        {#if tile.masked || tile.revealing}
          <span class="song-label">{tile.songLabel}</span>
        {/if}
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
    background: #1a1a1a;
    color: #fff;
  }

  .tile.marked {
    background: #1db954;
    color: #000;
  }

  .tile.free {
    background: #178a3e;
    color: #fff;
    cursor: default;
    pointer-events: none;
  }

  .tile.win-path {
    box-shadow: inset 0 0 0 2px #f5a623;
  }

  .tile-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 100%;
    text-align: center;
  }

  .tile.masked .tile-content {
    filter: blur(4px);
    user-select: none;
  }

  .tile.revealing .tile-content {
    filter: blur(0);
    transition: filter 300ms ease-out;
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

  .song-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    z-index: 1;
    white-space: nowrap;
    opacity: 1;
    transition: opacity 300ms ease-out;
    pointer-events: none;
  }

  .tile.revealing .song-label {
    opacity: 0;
    transition: opacity 300ms ease-out;
  }
</style>
