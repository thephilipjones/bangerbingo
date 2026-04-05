<script lang="ts">
  import { computePlayerCount, isSelfRow } from '../lib/waitingRoom.ts'

  let { code, selfName, hostName, players }: { code: string; selfName: string; hostName: string | null; players: string[] } = $props()

  const playerCount = $derived(computePlayerCount(players, hostName))
</script>

<div class="waiting-room">
  <!-- Header -->
  <header class="header">
    <div class="room-code">{code}</div>
    <div class="player-count">{playerCount}</div>
  </header>

  <!-- Headline -->
  <h1 class="headline">You're in!</h1>

  <!-- Player list -->
  <div class="players-section">
    <h2 class="players-label">Players here ({playerCount})</h2>
    <ul class="players-list">
      {#if hostName}
        <li class="player-row">
          <span class="player-name">{hostName}</span>
          <span class="host-pill">host</span>
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
          {#if isSelfRow(playerName, selfName)}
            <span class="you-suffix">(you)</span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>

  <!-- Footer -->
  <p class="footer">Waiting for host to start the round…</p>
</div>

<style>
  .waiting-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #121212;
    color: #fff;
    font-family: sans-serif;
    padding: 16px;
    box-sizing: border-box;
  }

  .header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
    z-index: 10;
  }

  .room-code {
    font-size: 2rem;
    font-family: monospace;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .player-count {
    font-size: 0.9rem;
    color: #aaa;
  }

  .headline {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 60px 0 32px 0;
    text-align: center;
  }

  .players-section {
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
  }

  .players-label {
    font-size: 1rem;
    font-weight: 600;
    color: #fff;
    margin: 0 0 12px 0;
    text-align: left;
  }

  .players-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .player-row {
    display: flex;
    align-items: center;
    padding: 12px;
    background: #1a1a1a;
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

  .footer {
    margin-top: 48px;
    font-size: 0.95rem;
    color: #aaa;
    text-align: center;
    max-width: 400px;
  }
</style>
