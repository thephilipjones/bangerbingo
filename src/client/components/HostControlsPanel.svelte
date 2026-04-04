<script lang="ts">
  let {
    code,
    currentTrack,
    players,
    isPlaying,
    onRoundEnded,
  }: {
    code: string
    currentTrack: { title: string; artist: string } | null
    players: string[]
    isPlaying: boolean
    onRoundEnded: () => void
  } = $props()

  import { onDestroy } from 'svelte'

  let showDialog = $state(false)
  let toastVisible = $state(false)
  let undoTimer: ReturnType<typeof setTimeout> | undefined

  onDestroy(() => clearTimeout(undoTimer))

  function handlePlayPause() {
    const endpoint = isPlaying ? 'pause' : 'play'
    fetch(`/api/rooms/${code}/round/${endpoint}`, { method: 'POST' })
  }

  function handleNext() {
    fetch(`/api/rooms/${code}/round/next`, { method: 'POST' })
  }

  function handleEndRoundClick() {
    showDialog = true
  }

  function handleDialogCancel() {
    showDialog = false
  }

  function handleEndRoundConfirmed() {
    showDialog = false
    toastVisible = true
    undoTimer = setTimeout(async () => {
      toastVisible = false
      await fetch(`/api/rooms/${code}/round/end`, { method: 'POST' })
      // Navigation is driven by the round:end WS event in HostRoomPage — do not call onRoundEnded() here
    }, 2000)
  }

  function handleUndo() {
    toastVisible = false
    clearTimeout(undoTimer)
  }
</script>

<div class="controls-panel">
  {#if toastVisible}
    <div class="toast" role="status">
      <span>Ending round…</span>
      <button class="undo-btn" onclick={handleUndo}>Undo</button>
    </div>
  {/if}

  <div class="track-info">
    {#if currentTrack}
      <p class="track-title">{currentTrack.title}</p>
      <p class="track-artist">{currentTrack.artist}</p>
    {:else}
      <p class="track-title">—</p>
    {/if}
  </div>

  <div class="playback-controls">
    <button class="ctrl-btn prev-btn" disabled aria-label="Previous (unavailable)">Prev</button>
    <button class="ctrl-btn play-pause-btn" onclick={handlePlayPause} aria-label={isPlaying ? 'Pause' : 'Play'}>
      {isPlaying ? 'Pause' : 'Play'}
    </button>
    <button class="ctrl-btn next-btn" onclick={handleNext} aria-label="Next">Next</button>
  </div>

  <div class="player-list">
    <p class="player-count">{players.length} player{players.length !== 1 ? 's' : ''}</p>
    <ul>
      {#each players as player}
        <li>{player}</li>
      {/each}
    </ul>
  </div>

  <div class="end-round-row">
    <button class="end-round-btn" onclick={handleEndRoundClick}>End Round</button>
  </div>
</div>

{#if showDialog}
  <div class="dialog-backdrop" role="presentation">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <p id="dialog-title">End this round?</p>
      <div class="dialog-actions">
        <button onclick={handleDialogCancel}>Cancel</button>
        <button onclick={handleEndRoundConfirmed}>Confirm</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .controls-panel {
    background: #1a1a1a;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-family: sans-serif;
    color: #fff;
    min-height: 100%;
  }

  .toast {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: #fff;
    padding: 10px 16px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 50;
    white-space: nowrap;
  }

  .undo-btn {
    background: none;
    border: 1px solid #fff;
    color: #fff;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 13px;
  }

  .track-info {
    text-align: center;
  }

  .track-title {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-artist {
    font-size: 13px;
    color: #aaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .playback-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .ctrl-btn {
    min-width: 44px;
    min-height: 44px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    background: #333;
    color: #fff;
  }

  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .play-pause-btn {
    background: #1db954;
    color: #000;
    padding: 0 20px;
  }

  .next-btn {
    background: #1db954;
    color: #000;
    font-size: 16px;
    padding: 0 24px;
    min-height: 52px;
  }

  .player-list {
    font-size: 13px;
  }

  .player-count {
    font-weight: 600;
    margin-bottom: 6px;
    color: #aaa;
  }

  .player-list ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .player-list li {
    padding: 4px 0;
    border-bottom: 1px solid #2a2a2a;
  }

  .end-round-row {
    display: flex;
    justify-content: flex-end;
  }

  .end-round-btn {
    background: none;
    border: 1px solid #555;
    color: #aaa;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
  }

  .end-round-btn:hover {
    border-color: #888;
    color: #fff;
  }

  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 24px;
    min-width: 260px;
    text-align: center;
    font-family: sans-serif;
  }

  .dialog p {
    font-size: 17px;
    font-weight: 600;
    margin-bottom: 20px;
  }

  .dialog-actions {
    display: flex;
    justify-content: center;
    gap: 12px;
  }

  .dialog-actions button {
    min-width: 80px;
    min-height: 44px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
  }

  .dialog-actions button:first-child {
    background: #333;
    color: #fff;
  }

  .dialog-actions button:last-child {
    background: #1db954;
    color: #000;
  }
</style>
