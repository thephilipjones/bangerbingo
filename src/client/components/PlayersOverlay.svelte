<script lang="ts">
  import { computePlayerCount } from '../lib/waitingRoom.ts'
  import PlayerList from './PlayerList.svelte'

  let {
    players,
    hostName,
    selfName,
    winsByName = {},
    lastRoundWinner = null,
    showStats = false,
    casualModeNames = new Set(),
    onClose,
  }: {
    players: string[]
    hostName: string | null
    selfName: string | null
    winsByName?: Record<string, number>
    lastRoundWinner?: string | null
    showStats?: boolean
    casualModeNames?: Set<string>
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
      <PlayerList {players} {hostName} {selfName} {winsByName} {lastRoundWinner} {showStats} {casualModeNames} />
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
    background: var(--bg);
    border-top: var(--rule-thick) solid var(--rule);
    display: flex;
    flex-direction: column;
    color: var(--fg);
  }

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px;
    border-bottom: var(--rule-thin) solid var(--rule);
    flex-shrink: 0;
  }

  .sheet-title {
    color: var(--fg);
    font-size: 16px;
    font-weight: 700;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
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
  .close-btn:hover { color: var(--fg); }
  .close-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .sheet-body {
    overflow-y: auto;
    flex: 1;
    padding: 8px 0;
  }

  .empty {
    color: var(--fg-muted);
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
