<script lang="ts">
  import { isSelfRow } from '../lib/waitingRoom.ts'

  let {
    players,
    hostName,
    selfName,
    winsByName = {},
    lastRoundWinner = null,
    showStats = false,
  }: {
    players: string[]
    hostName: string | null
    selfName: string | null  // null = viewer is the host
    winsByName?: Record<string, number>
    lastRoundWinner?: string | null
    showStats?: boolean
  } = $props()

  const showYouOnHost = $derived(
    selfName === null || (hostName !== null && isSelfRow(hostName, selfName))
  )

  function winCount(name: string | null): number {
    if (!showStats || !name) return 0
    return winsByName[name] ?? 0
  }

  function isLastRoundWinner(name: string | null): boolean {
    return showStats && name !== null && name === lastRoundWinner
  }
</script>

<ul class="players-list">
  <li class="player-row">
    <span class="player-name">{hostName ?? 'Host'}</span>
    {#if winCount(hostName) > 0}
      <span class="win-count">×{winCount(hostName)}</span>
    {/if}
    {#if isLastRoundWinner(hostName)}
      <span class="last-round-pill">Last round ✓</span>
    {/if}
    <span class="host-pill">Host</span>
    {#if showYouOnHost}
      <span class="you-pill">You</span>
    {/if}
  </li>
  {#each players as playerName (playerName)}
    <li class="player-row">
      <span class="player-name">{playerName}</span>
      {#if winCount(playerName) > 0}
        <span class="win-count">×{winCount(playerName)}</span>
      {/if}
      {#if isLastRoundWinner(playerName)}
        <span class="last-round-pill">Last round ✓</span>
      {/if}
      {#if selfName !== null && isSelfRow(playerName, selfName)}
        <span class="you-pill">You</span>
      {/if}
    </li>
  {/each}
</ul>

<style>
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
    background: var(--player-row-bg, #1a1a1a);
    border: 1px solid #333;
    border-radius: 6px;
    font-size: 0.95rem;
    gap: 8px;
  }

  .player-name {
    flex: 1;
    color: #fff;
  }

  .win-count {
    font-size: 0.75rem;
    color: #888;
    padding: 0 6px;
  }

  .last-round-pill {
    padding: 2px 8px;
    background: #2a2a2a;
    color: #1db954;
    font-size: 0.6875rem;
    font-weight: 700;
    border-radius: 9999px;
    letter-spacing: 0.02em;
  }

  .host-pill {
    padding: 2px 8px;
    background: #1db954;
    color: #000;
    font-size: 0.6875rem;
    font-weight: 700;
    border-radius: 9999px;
    letter-spacing: 0.02em;
  }

  .you-pill {
    padding: 2px 8px;
    background: #333;
    color: #ccc;
    font-size: 0.6875rem;
    font-weight: 700;
    border-radius: 9999px;
    letter-spacing: 0.02em;
  }
</style>
