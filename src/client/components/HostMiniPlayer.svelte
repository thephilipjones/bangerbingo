<script lang="ts">
  import { Play, Pause, SkipForward, GearSix } from 'phosphor-svelte'
  import DeviceChip from './DeviceChip.svelte'

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
    selectedDevice = null,
    onDeviceChipClick,
    confirmPill = null,
    devicePickerOpen = false,
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
    selectedDevice?: { id: string; name: string; type: string } | null
    onDeviceChipClick?: () => void
    confirmPill?: string | null
    devicePickerOpen?: boolean
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
        <span class="btn-icon">{#if isPlaying}<Pause size={20} weight="fill" aria-hidden="true" />{:else}<Play size={20} weight="fill" aria-hidden="true" />{/if}</span><span class="btn-label">{isPlaying ? 'Pause' : 'Play'}</span>
      </button>
    {/if}
    <button class="ctrl-btn next-btn" onclick={onNext} aria-label="Next">
      <span class="btn-icon"><SkipForward size={18} weight="fill" aria-hidden="true" /></span><span class="btn-label">Next</span>
    </button>
  </div>

  <div class="track-info">
    {#if currentTrack}
      <span class="track-text">{currentTrack.title} — {currentTrack.artist}</span>
    {:else}
      <span class="track-text waiting">Waiting for round to start…</span>
    {/if}
  </div>

  <div class="chip-wrap">
    <DeviceChip {selectedDevice} onclick={onDeviceChipClick ?? (() => {})} expanded={devicePickerOpen} />
    {#if confirmPill}
      <p class="confirm-pill" role="status">{confirmPill}</p>
    {/if}
  </div>

  <button class="ctrl-btn gear-btn" class:active={controlsOpen} onclick={onGearClick} aria-label="Host controls">
    <span class="btn-icon"><GearSix size={18} aria-hidden="true" /></span><span class="btn-label">Host</span>
  </button>
</div>

<style>
  .mini-player {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 64px;
    background: var(--bg);
    border-top: var(--rule-thick) solid var(--rule);
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    color: var(--fg);
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
    color: var(--fg-muted);
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
    border: var(--rule-thin) solid var(--rule);
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
    background: var(--bg-2);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .ctrl-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-label {
    display: none;
  }

  .play-pause-btn {
    width: 44px;
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }

  .next-btn {
    width: 44px;
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
    font-size: 14px;
  }

  .chip-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .confirm-pill {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100vw - 32px);
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    font-size: 12px;
    padding: 4px 10px;
    pointer-events: none;
    margin: 0;
  }

  .gear-btn {
    width: 44px;
    background: none;
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    font-size: 20px;
  }

  .gear-btn:hover {
    background: var(--fg);
    color: var(--bg);
  }

  .gear-btn.active {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }

  .spotify-link {
    text-decoration: none;
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
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
  }
</style>
