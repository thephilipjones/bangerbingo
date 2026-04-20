<script lang="ts">
  import { Couch, Check } from 'phosphor-svelte'
  import { isSelfRow } from '../lib/waitingRoom.ts'

  let {
    players,
    hostName,
    selfName,
    winsByName = {},
    lastRoundWinner = null,
    showStats = false,
    casualModeNames = new Set(),
  }: {
    players: string[]
    hostName: string | null
    selfName: string | null  // null = viewer is the host
    winsByName?: Record<string, number>
    lastRoundWinner?: string | null
    showStats?: boolean
    casualModeNames?: Set<string>
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
    {#if hostName !== null && casualModeNames?.has(hostName)}
      <span class="casual-icon" aria-label="Casual Mode on"><Couch size={14} aria-hidden="true" /></span>
    {/if}
    {#if winCount(hostName) > 0}
      <span class="win-count">×{winCount(hostName)}</span>
    {/if}
    {#if isLastRoundWinner(hostName)}
      <span class="last-round-pill"><Check size={13} weight="bold" aria-hidden="true" /> Last round</span>
    {/if}
    <span class="host-pill">Host</span>
    {#if showYouOnHost}
      <span class="you-pill">You</span>
    {/if}
  </li>
  {#each players as playerName (playerName)}
    <li class="player-row">
      <span class="player-name">{playerName}</span>
      {#if casualModeNames?.has(playerName)}
        <span class="casual-icon" aria-label="Casual Mode on"><Couch size={14} aria-hidden="true" /></span>
      {/if}
      {#if winCount(playerName) > 0}
        <span class="win-count">×{winCount(playerName)}</span>
      {/if}
      {#if isLastRoundWinner(playerName)}
        <span class="last-round-pill"><Check size={13} weight="bold" aria-hidden="true" /> Last round</span>
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
    background: var(--player-row-bg, var(--bg-2));
    border: var(--rule-thin) solid var(--rule);
    font-size: 0.95rem;
    gap: 8px;
  }

  .player-name {
    flex: 1;
    color: var(--fg);
  }

  .casual-icon {
    display: inline-flex;
    align-items: center;
  }

  .win-count {
    font-size: 0.75rem;
    color: var(--fg-muted);
    padding: 0 6px;
  }

  .last-round-pill {
    padding: 2px 8px;
    background: transparent;
    color: var(--accent);
    border: var(--rule-thin) solid var(--accent);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .host-pill {
    padding: 2px 8px;
    background: var(--accent);
    color: var(--accent-fg);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .you-pill {
    padding: 2px 8px;
    background: var(--fg);
    color: var(--bg);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
</style>
