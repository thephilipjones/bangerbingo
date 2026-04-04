<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import {
    initTiles,
    applyMask,
    startReveal,
    finishReveal,
    toggleMark,
    applyWinPath,
  } from '../lib/bingo.ts'
  import type { ClientTile, TitleRevealDelay } from '../lib/bingo.ts'

  let { name, ws }: { name: string; ws: WebSocket } = $props()

  let hostDisconnected = $state(false)
  let tiles = $state<ClientTile[]>([])
  let statusLine = $state('Waiting for the host to start a round...')
  let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)
  let revealTimer: ReturnType<typeof setTimeout> | undefined

  function handleTileClick(index: number) {
    tiles = toggleMark(tiles, index)
  }

  onMount(() => {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'host:disconnected') {
          hostDisconnected = true
        } else if (data.type === 'host:reconnected') {
          hostDisconnected = false
        } else if (data.type === 'round:start') {
          tiles = initTiles(data.card)
          roundConfig = { titleRevealDelay: data.titleRevealDelay }
          statusLine = 'Waiting for next song…'
        } else if (data.type === 'song:start') {
          if (roundConfig) {
            tiles = applyMask(tiles, data.trackId, roundConfig.titleRevealDelay, data.songIndex)
          }
          statusLine = `Song ${data.songIndex + 1} of this round`
        } else if (data.type === 'song:reveal') {
          tiles = startReveal(tiles, data.trackId)
          clearTimeout(revealTimer)
          revealTimer = setTimeout(() => {
            tiles = finishReveal(tiles, data.trackId)
          }, 300)
        } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
          statusLine = 'Waiting for next song…'
        } else if (data.type === 'round:win') {
          tiles = applyWinPath(tiles, data.winningTileIds)
        } else if (data.type === 'round:end') {
          tiles = []
          statusLine = 'Waiting for the host to start a round...'
          roundConfig = null
        }
      } catch {
        // ignore unparseable messages
      }
    }
  })

  onDestroy(() => {
    clearTimeout(revealTimer)
    ws.close()
  })
</script>

{#if hostDisconnected}
  <div class="host-disconnected-banner" role="status">
    Host disconnected — waiting for them to reconnect…
  </div>
{/if}
<main class="room-page">
  {#if tiles.length > 0}
    <BingoCard {tiles} onTileClick={handleTileClick} />
    <p class="status-line" role="status">{statusLine}</p>
  {:else}
    <p role="status">{statusLine}</p>
  {/if}
</main>

<style>
  .host-disconnected-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #ff6b35;
    color: #fff;
    padding: 8px 16px;
    text-align: center;
    z-index: 100;
    font-size: 14px;
    font-family: sans-serif;
  }

  .room-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: sans-serif;
    padding: 16px;
    box-sizing: border-box;
  }

  .status-line {
    margin-top: 12px;
    font-size: 14px;
    color: #aaa;
    text-align: center;
  }
</style>
