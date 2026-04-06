<script lang="ts">
  import { formatSongOrdinal } from '../lib/gameHeader.ts'
  import { copyRoomCode } from '../lib/ws.ts'

  let {
    playerCount,
    code,
    songIndex,
    onPlayersClick,
    onHistoryClick,
  }: {
    playerCount: number
    code: string
    songIndex: number | null
    onPlayersClick: () => void
    onHistoryClick: () => void
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
  <button class="header-btn" onclick={onPlayersClick}>
    {playerCount} {playerCount === 1 ? 'Player' : 'Players'}
  </button>

  <button class="room-code" onclick={handleCopyCode}>
    {#if copied}
      <span class="copied-flash">Copied!</span>
    {:else}
      {code}
    {/if}
  </button>

  <button class="header-btn" onclick={onHistoryClick}>
    {songIndex !== null ? formatSongOrdinal(songIndex) : 'History'}
  </button>
</div>

<style>
  .game-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 8px;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
    padding: 6px 8px;
    border-radius: 6px;
    box-sizing: border-box;
  }

  .header-btn {
    background: none;
    border: 1px solid #444;
    color: #aaa;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    font-family: sans-serif;
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
    white-space: nowrap;
  }

  .header-btn:hover {
    color: #fff;
    border-color: #666;
  }

  .room-code {
    background: none;
    border: none;
    color: #888;
    font-family: monospace;
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
  }

  .copied-flash {
    color: #1db954;
    font-family: sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: normal;
    text-transform: none;
  }
</style>
