<script lang="ts">
  import { computePlayerCount } from '../lib/waitingRoom.ts'
  import PlayerList from './PlayerList.svelte'

  let {
    players,
    hostName,
    selfName,
    onClose,
  }: {
    players: string[]
    hostName: string | null
    selfName: string | null
    onClose: () => void
  } = $props()

  const playerCount = $derived(computePlayerCount(players))
</script>

<!-- Background overlay -->
<div class="overlay" role="presentation" onclick={onClose}></div>

<!-- Sheet -->
<div class="sheet" role="dialog" aria-label="Players list">
  <div class="sheet-header">
    <span class="sheet-title">Players ({playerCount})</span>
    <button class="close-btn" onclick={onClose} aria-label="Close players">&times;</button>
  </div>
  <div class="sheet-body">
    {#if players.length === 0 && hostName === null}
      <p class="empty">No players yet.</p>
    {:else}
      <PlayerList {players} {hostName} {selfName} --player-row-bg="#222" />
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

  @media (min-width: 768px) {
    .overlay {
      background: transparent;
    }

    .sheet {
      top: 56px;
      bottom: auto;
      right: 8px;
      left: auto;
      height: auto;
      max-height: 60vh;
      width: 260px;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }

    .sheet-header {
      display: none;
    }
  }

</style>
