<script lang="ts">
  let {
    currentTrack,
    isPlaying,
    sdkReady,
    sdkFailed,
    currentTrackId,
    onPlayPause,
    onNext,
    onGearClick,
    controlsOpen = false,
  }: {
    currentTrack: { title: string; artist: string } | null
    isPlaying: boolean
    sdkReady: boolean
    sdkFailed: boolean
    currentTrackId: string | null
    onPlayPause: () => void
    onNext: () => void
    onGearClick: () => void
    controlsOpen?: boolean
  } = $props()
</script>

<div class="mini-player">
  <div class="left-controls">
    {#if sdkFailed}
      <a
        class="ctrl-btn spotify-link"
        href={currentTrackId ? `spotify:track:${currentTrackId}` : 'https://open.spotify.com'}
      >Open Spotify</a>
    {:else}
      <button class="ctrl-btn play-pause-btn" onclick={onPlayPause} disabled={!sdkReady} aria-label={isPlaying ? 'Pause' : 'Play'}>
        <span class="btn-icon">{isPlaying ? '‖' : '▶'}</span><span class="btn-label">{isPlaying ? 'Pause' : 'Play'}</span>
      </button>
    {/if}
    <button class="ctrl-btn next-btn" onclick={onNext} aria-label="Next">
      <span class="btn-icon">⏭</span><span class="btn-label">Next</span>
    </button>
  </div>

  <div class="track-info">
    {#if currentTrack}
      <span class="track-text">{currentTrack.title} — {currentTrack.artist}</span>
    {:else}
      <span class="track-text waiting">Waiting for round to start…</span>
    {/if}
  </div>

  <button class="ctrl-btn gear-btn" class:active={controlsOpen} onclick={onGearClick} aria-label="Host controls">
    <span class="btn-icon">⚙</span><span class="btn-label">Host</span>
  </button>
</div>

<style>
  .mini-player {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 64px;
    background: #1a1a1a;
    border-top: 1px solid #333;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    font-family: sans-serif;
    color: #fff;
    gap: 12px;
  }

  .track-info {
    flex: 1;
    min-width: 0;
    text-align: center;
  }

  .track-text {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  .track-text.waiting {
    color: #888;
    font-weight: 400;
  }

  .left-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .ctrl-btn {
    min-width: 44px;
    min-height: 44px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
    background: #333;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-label {
    display: none;
  }

  .play-pause-btn {
    width: 44px;
    background: #1db954;
    color: #000;
  }

  .next-btn {
    width: 44px;
    background: #1db954;
    color: #000;
    font-size: 14px;
  }

  .gear-btn {
    width: 44px;
    background: none;
    border: 1px solid #444;
    color: #aaa;
    border-radius: 6px;
    font-size: 20px;
  }

  .gear-btn:hover {
    color: #fff;
    border-color: #666;
  }

  .gear-btn.active {
    color: #fff;
    border-color: #1db954;
  }

  .spotify-link {
    text-decoration: none;
    background: #1db954;
    color: #000;
    padding: 0 12px;
    font-size: 13px;
    width: auto;
  }

  @media (min-width: 768px) {
    .btn-label {
      display: inline;
    }

    .play-pause-btn,
    .next-btn,
    .gear-btn {
      width: 90px;
      font-size: 14px;
    }

    .gear-btn .btn-icon {
      font-size: 16px;
    }
  }
</style>
