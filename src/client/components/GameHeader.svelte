<script lang="ts">
  import { formatSongOrdinal } from '../lib/gameHeader.ts'
  import { copyRoomCode } from '../lib/ws.ts'
  import Logo from '../lib/components/Logo.svelte'
  import ThemeToggle from '../lib/components/ThemeToggle.svelte'
  import PlaybackBar from './PlaybackBar.svelte'

  let {
    playerCount,
    code,
    songIndex,
    historyOpen = false,
    playersOpen = false,
    onPlayersClick,
    onHistoryClick,
    playbackStartedAt = 0,
    effectiveDurationMs = 0,
  }: {
    playerCount: number
    code: string
    songIndex: number | null
    historyOpen?: boolean
    playersOpen?: boolean
    onPlayersClick: () => void
    onHistoryClick: () => void
    playbackStartedAt?: number
    effectiveDurationMs?: number
  } = $props()

  let copied = $state(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    return () => { clearTimeout(copyTimer) }
  })

  async function handleCopyCode() {
    try {
      await copyRoomCode(code)
      copied = true
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => { copied = false }, 1500)
    } catch {
      // clipboard API rejected — code is still visible for manual copy
    }
  }
</script>

<div class="game-header">
  <button class="header-btn" class:active={historyOpen} onclick={onHistoryClick}>
    {songIndex !== null ? formatSongOrdinal(songIndex) : 'History'}
  </button>

  <button class="room-code" onclick={handleCopyCode}>
    {#if copied}
      <span class="copied-flash">Copied!</span>
    {:else}
      <Logo size={18} variant="mark-only" title="BangerBingo" />
      <span class="slash" aria-hidden="true">/</span>
      <span class="code-text">{code}</span>
    {/if}
  </button>

  <div class="right-cluster">
    <ThemeToggle />
    <button class="header-btn" class:active={playersOpen} onclick={onPlayersClick}>
      {playerCount} {playerCount === 1 ? 'Player' : 'Players'}
    </button>
  </div>

  <PlaybackBar startedAt={playbackStartedAt} durationMs={effectiveDurationMs} />
</div>

<style>
  .game-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg);
    padding: 10px 8px;
    box-sizing: border-box;
  }

  .right-cluster {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-btn {
    background: none;
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    padding: 6px 16px;
    font-size: 13px;
    font-family: var(--font-body);
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
    white-space: nowrap;
  }

  .header-btn:hover {
    background: var(--fg);
    color: var(--bg);
  }

  .header-btn.active {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: transparent;
  }

  .header-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .room-code {
    background: none;
    border: none;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 6px 12px;
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .room-code:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .slash {
    color: var(--fg-muted);
    font-weight: 400;
    letter-spacing: 0;
  }

  .copied-flash {
    color: var(--accent);
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: normal;
    text-transform: none;
  }
</style>
