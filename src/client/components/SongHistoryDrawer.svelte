<script lang="ts">
  type HistoryEntry = {
    trackId: string
    title: string
    artist: string
    albumArtUrl: string
    songIndex: number
  }

  let { entries, currentRevealed = false, onClose }: { entries: HistoryEntry[]; currentRevealed?: boolean; onClose: () => void } = $props()
  let failedImages = $state(new Set<number>())
</script>

<!-- Background overlay -->
<div class="overlay" role="presentation" onclick={onClose}></div>

<!-- Sheet -->
<div class="sheet" role="dialog" aria-label="Song history">
  <div class="sheet-header">
    <span class="sheet-title">Song History</span>
    <button class="close-btn" onclick={onClose} aria-label="Close history">×</button>
  </div>
  <div class="sheet-body">
    {#if entries.length === 0}
      <p class="empty">No songs played yet.</p>
    {:else}
      {#each entries as entry, i (entry.songIndex)}
        {@const blurred = i === 0 && !currentRevealed}
        <div class="entry">
          <span class="song-number">#{entry.songIndex + 1}</span>
          <div class="art-wrapper" class:art-blurred={blurred}>
            {#if entry.albumArtUrl && !failedImages.has(entry.songIndex)}
              <img
                class="album-art"
                src={entry.albumArtUrl}
                alt=""
                width="40"
                height="40"
                onerror={() => { failedImages = new Set([...failedImages, entry.songIndex]) }}
              />
            {:else}
              <div class="art-fallback" aria-hidden="true">♪</div>
            {/if}
            <div class="mystery-art" aria-hidden="true">?</div>
          </div>
          <div class="track-info" class:track-blurred={blurred}>
            <span class="track-title">{entry.title}</span>
            <span class="track-artist">{entry.artist}</span>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 149;
  }

  .sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 70vh;
    z-index: 150;
    background: #1a1a1a;
    border-radius: 12px 12px 0 0;
    display: flex;
    flex-direction: column;
    font-family: sans-serif;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .sheet-title {
    color: #fff;
    font-size: 16px;
    font-weight: 700;
  }

  .close-btn {
    background: none;
    border: none;
    color: #aaa;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .close-btn:hover {
    color: #fff;
  }

  .sheet-body {
    overflow-y: auto;
    flex: 1;
    padding: 8px 0;
  }

  .empty {
    color: #888;
    text-align: center;
    padding: 24px 16px;
    font-size: 14px;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid #2a2a2a;
  }

  .song-number {
    color: #888;
    font-size: 12px;
    min-width: 28px;
    text-align: right;
    flex-shrink: 0;
  }

  /* Art wrapper — positions real art and mystery icon on top of each other */
  .art-wrapper {
    position: relative;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }

  .album-art {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    display: block;
    transition: opacity 400ms ease-out;
  }

  .art-fallback {
    width: 40px;
    height: 40px;
    background: #333;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 18px;
    transition: opacity 400ms ease-out;
  }

  .art-wrapper.art-blurred .album-art,
  .art-wrapper.art-blurred .art-fallback {
    opacity: 0;
  }

  .mystery-art {
    position: absolute;
    inset: 0;
    border-radius: 4px;
    background: #242424;
    border: 1px solid #333;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 700;
    color: #1db954;
    opacity: 0;
    transition: opacity 400ms ease-out;
    pointer-events: none;
  }

  .art-wrapper.art-blurred .mystery-art {
    opacity: 1;
  }

  /* Track text */
  .track-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    filter: blur(0px);
    transition: filter 400ms ease-out;
    transform: translateZ(0);
  }

  .track-info.track-blurred {
    filter: blur(10px);
    user-select: none;
  }

  .track-title {
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-artist {
    color: #aaa;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (min-width: 768px) {
    .overlay {
      background: transparent;
    }

    .sheet {
      top: 56px;
      bottom: auto;
      left: 8px;
      right: auto;
      height: auto;
      max-height: 60vh;
      width: 320px;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }

    .sheet-header {
      display: none;
    }
  }
</style>
