<script lang="ts">
  type HistoryEntry = {
    trackId: string
    title: string
    artist: string
    albumArtUrl: string
    songIndex: number
  }

  let { entries, onClose }: { entries: HistoryEntry[]; onClose: () => void } = $props()
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
        <div class="entry" class:current={i === 0}>
          <span class="song-number">#{entry.songIndex + 1}</span>
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
          <div class="track-info">
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

  .album-art {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
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
    flex-shrink: 0;
  }

  .track-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .entry.current .track-info {
    filter: blur(4px);
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
</style>
