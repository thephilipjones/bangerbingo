<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import HostControlsPanel from '../components/HostControlsPanel.svelte'
  import {
    initTiles,
    applyMask,
    startReveal,
    finishReveal,
    toggleMark,
    applyWinPath,
  } from '../lib/bingo.ts'
  import type { ClientTile, TitleRevealDelay } from '../lib/bingo.ts'
  import { applyPlayerEvent } from '../lib/ws.ts'

  let { code, onRoundEnded }: { code: string; onRoundEnded: () => void } = $props()

  let tiles = $state<ClientTile[]>([])
  let statusLine = $state('Waiting for round to start…')
  let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)
  let currentTrack = $state<{ title: string; artist: string } | null>(null)
  let isPlaying = $state(false)
  let players = $state<string[]>([])
  let panelOpen = $state(false)
  let wsError = $state(false)
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let ws: WebSocket

  function handleTileClick(index: number) {
    tiles = toggleMark(tiles, index)
  }

  onMount(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?code=${code}`
    ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'session:connect') {
          players = data.players ?? []
        } else if (data.type === 'round:start') {
          tiles = initTiles(data.card)
          roundConfig = { titleRevealDelay: data.titleRevealDelay }
          statusLine = 'Waiting for next song…'
          isPlaying = false
        } else if (data.type === 'song:start') {
          if (roundConfig) {
            tiles = applyMask(tiles, data.trackId, roundConfig.titleRevealDelay, data.songIndex)
          }
          statusLine = `Song ${data.songIndex + 1} of this round`
          currentTrack = { title: data.title, artist: data.artist }
          isPlaying = true
        } else if (data.type === 'song:reveal') {
          tiles = startReveal(tiles, data.trackId)
          clearTimeout(revealTimer)
          revealTimer = setTimeout(() => {
            tiles = finishReveal(tiles, data.trackId)
          }, 300)
        } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
          statusLine = 'Waiting for next song…'
          isPlaying = false
        } else if (data.type === 'round:win') {
          tiles = applyWinPath(tiles, data.winningTileIds)
        } else if (data.type === 'round:end') {
          onRoundEnded()
        } else if (data.type === 'player:joined' || data.type === 'player:left') {
          players = applyPlayerEvent(players, { type: data.type, name: data.name })
        }
      } catch {
        // ignore unparseable messages
      }
    }

    ws.onerror = () => { wsError = true }
    ws.onclose = (event) => { if (event.code !== 1000) wsError = true }
  })

  onDestroy(() => {
    clearTimeout(revealTimer)
    ws?.close()
  })
</script>

{#if wsError}
  <div class="error-banner" role="alert">Connection lost — please refresh the page.</div>
{/if}

<div class="host-game">
  <div class="card-area">
    {#if tiles.length > 0}
      <BingoCard {tiles} onTileClick={handleTileClick} />
      <p class="status-line" role="status">{statusLine}</p>
    {:else}
      <p class="status-line" role="status">{statusLine}</p>
    {/if}
  </div>

  <!-- Desktop: controls always visible in right column -->
  <div class="panel-desktop">
    <HostControlsPanel
      {code}
      {currentTrack}
      {players}
      {isPlaying}
      {onRoundEnded}
    />
  </div>
</div>

<!-- Mobile: fixed handle + slide-up panel -->
<div class="panel-mobile">
  <button class="panel-handle" onclick={() => (panelOpen = !panelOpen)}>
    Controls {panelOpen ? '▼' : '▲'}
  </button>

  <div class="panel-sheet" class:open={panelOpen} aria-hidden={!panelOpen}>
    <HostControlsPanel
      {code}
      {currentTrack}
      {players}
      {isPlaying}
      {onRoundEnded}
    />
  </div>
</div>

<style>
  .error-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #c0392b;
    color: #fff;
    padding: 8px 16px;
    text-align: center;
    z-index: 200;
    font-family: sans-serif;
    font-size: 14px;
  }

  .host-game {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: #121212;
    font-family: sans-serif;
  }

  .card-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 16px 80px;
  }

  .status-line {
    margin-top: 12px;
    font-size: 14px;
    color: #aaa;
    text-align: center;
  }

  /* Desktop layout */
  .panel-desktop {
    display: none;
  }

  .panel-mobile {
    display: block;
  }

  @media (min-width: 768px) {
    .host-game {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 24px;
      max-width: 960px;
      margin: 0 auto;
      padding: 16px;
      min-height: 100vh;
      align-items: start;
    }

    .card-area {
      padding: 0;
      padding-top: 16px;
    }

    .panel-desktop {
      display: block;
      position: sticky;
      top: 16px;
    }

    .panel-mobile {
      display: none;
    }
  }

  /* Mobile panel */
  .panel-handle {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #1a1a1a;
    color: #fff;
    border: none;
    border-top: 1px solid #333;
    padding: 14px 16px;
    font-size: 15px;
    font-weight: 600;
    font-family: sans-serif;
    cursor: pointer;
    z-index: 20;
    min-height: 44px;
    text-align: center;
  }

  .panel-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60vh;
    background: #1a1a1a;
    z-index: 10;
    overflow-y: auto;
    transform: translateY(100%);
    transition: transform 300ms ease;
    padding-bottom: 60px;
  }

  .panel-sheet.open {
    transform: translateY(0);
  }
</style>
