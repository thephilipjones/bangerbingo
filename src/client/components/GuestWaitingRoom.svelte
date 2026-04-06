<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { isSelfRow } from '../lib/waitingRoom.ts'
  import { TRIVIA_FACTS, shuffle } from '../lib/trivia.ts'

  let { code, selfName, hostName, players }: { code: string; selfName: string; hostName: string | null; players: string[] } = $props()

  // Host row is always rendered (with name or generic "Host"), so always count host as +1
  const playerCount = $derived(players.length + 1)

  // ── Trivia cycling ─────────────────────────────────────────────────────────
  let facts = $state(shuffle([...TRIVIA_FACTS]))
  let factIndex = $state(0)
  let visible = $state(true)
  let triviaInterval: ReturnType<typeof setInterval>
  let triviaTimeout: ReturnType<typeof setTimeout>

  function advanceFact() {
    visible = false
    triviaTimeout = setTimeout(() => {
      factIndex = (factIndex + 1) % facts.length
      if (factIndex === 0) facts = shuffle([...TRIVIA_FACTS])
      visible = true
    }, 400)
  }

  onMount(() => {
    triviaInterval = setInterval(advanceFact, 12000)
  })

  onDestroy(() => {
    clearInterval(triviaInterval)
    clearTimeout(triviaTimeout)
  })
</script>

<div class="waiting-room">
  <!-- Header -->
  <header class="header">
    <div class="room-code">{code}</div>
  </header>

  <!-- Vinyl -->
  <div class="vinyl" aria-hidden="true">
    <svg viewBox="0 0 80 80" width="80" height="80">
      <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#333" stroke-width="2" />
      <circle cx="40" cy="40" r="20" fill="#222" />
      <circle cx="40" cy="40" r="4" fill="#444" />
    </svg>
  </div>

  <!-- Headline -->
  <h1 class="headline">You're in!</h1>

  <!-- Waiting -->
  <p class="waiting">Waiting for host to start the round…</p>

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

  <!-- Trivia -->
  <p class="fact" class:visible>{facts[factIndex]}</p>
</div>

<style>
  .waiting-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    background: #121212;
    color: #fff;
    font-family: sans-serif;
    padding: 80px 16px 48px;
    box-sizing: border-box;
    gap: 1.5rem;
  }

  .header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px 16px;
    background: #1a1a1a;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
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

  .vinyl {
    animation: spin 3s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .headline {
    font-size: 1.75rem;
    font-weight: 700;
    text-align: center;
    margin: 0;
  }

  .waiting {
    font-size: 0.95rem;
    color: #aaa;
    text-align: center;
    margin: 0;
  }

  .players-section {
    width: 100%;
    max-width: 400px;
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

  .fact {
    max-width: 36rem;
    text-align: center;
    font-size: 0.95rem;
    color: #666;
    line-height: 1.5;
    transition: opacity 0.4s;
    opacity: 0;
  }

  .fact.visible {
    opacity: 1;
  }
</style>
