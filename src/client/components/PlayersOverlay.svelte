<script lang="ts">
  import { computePlayerCount, isSelfRow } from '../lib/waitingRoom.ts'

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

  const playerCount = $derived(computePlayerCount(players, hostName))
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
      <ul class="players-list">
        {#if hostName}
          <li class="player-row">
            <span class="player-name">{hostName}</span>
            <span class="host-pill">host</span>
            {#if selfName !== null && isSelfRow(hostName, selfName)}
              <span class="you-suffix">(you)</span>
            {/if}
          </li>
        {:else}
          <li class="player-row">
            <span class="player-name">Host</span>
            <span class="host-pill">host</span>
          </li>
        {/if}

        {#each players as playerName (playerName)}
          <li class="player-row">
            <span class="player-name">{playerName}</span>
            {#if selfName !== null && isSelfRow(playerName, selfName)}
              <span class="you-suffix">(you)</span>
            {/if}
          </li>
        {/each}
      </ul>
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

  .players-list {
    list-style: none;
    padding: 8px 16px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .player-row {
    display: flex;
    align-items: center;
    padding: 12px;
    background: #222;
    border: 1px solid #333;
    border-radius: 6px;
    font-size: 0.95rem;
  }

  .player-name {
    flex: 1;
    color: #fff;
  }

  .host-pill {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 8px;
    background: #1db954;
    color: #000;
    font-size: 0.6875rem;
    font-weight: 700;
    border-radius: 9999px;
    vertical-align: middle;
    letter-spacing: 0.02em;
  }

  .you-suffix {
    margin-left: 6px;
    color: #888;
    font-size: 0.8125rem;
    font-weight: 400;
  }
</style>
