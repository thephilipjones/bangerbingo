<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import HostControlsPanel from '../components/HostControlsPanel.svelte'
  import SdkFailureBanner from '../components/SdkFailureBanner.svelte'
  import WinOverlay from '../components/WinOverlay.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import AuthDegradedBanner from '../components/AuthDegradedBanner.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import { computePlayerCount } from '../lib/waitingRoom.ts'
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

  type WinData = {
    winnerName: string
    winningTileIds: string[]
    songHistory: Array<{ trackId: string; title: string; artist: string; albumArtUrl: string; songIndex: number }>
  }

  type HistoryEntry = {
    trackId: string
    title: string
    artist: string
    albumArtUrl: string
    songIndex: number
  }

  let tiles = $state<ClientTile[]>([])
  let statusLine = $state('Waiting for round to start…')
  let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)
  let currentTrack = $state<{ title: string; artist: string } | null>(null)
  let isPlaying = $state(false)
  let players = $state<string[]>([])
  let panelOpen = $state(false)
  let wsError = $state(false)
  let sdkReady = $state(false)
  let sdkFailed = $state(false)
  let currentTrackId = $state<string | null>(null)
  let winData = $state<WinData | null>(null)
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let songHistory = $state<HistoryEntry[]>([])
  let showHistory = $state(false)
  let currentRevealed = $state(false)
  let showPlayers = $state(false)
  let hostName = $state<string | null>(null)
  let songIndex = $state<number | null>(null)
  let authDegraded = $state(false)
  const playerCount = $derived(computePlayerCount(players))
  let ws: WebSocket
  let player: Spotify.Player | undefined
  let sdkScript: HTMLScriptElement | undefined
  let sdkErrorFired = false
  let sdkReinitializing = false

  function handleTileClick(index: number) {
    tiles = toggleMark(tiles, index)
  }

  function initSdkPlayer() {
    player = new Spotify.Player({
      name: 'Bangerbingo',
      getOAuthToken: async (callback) => {
        const res = await fetch('/auth/token')
        const data = await res.json()
        callback(data.accessToken)
      },
      volume: 0.8,
    })
    player.addListener('ready', async ({ device_id }) => {
      sdkReinitializing = false
      await fetch(`/api/rooms/${code}/sdk/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device_id }),
      })
      sdkReady = true
    })
    player.addListener('not_ready', () => { sdkReady = false })
    player.addListener('initialization_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true
      sdkReady = false
      sdkFailed = true
    })
    player.addListener('authentication_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true
      sdkReady = false
      sdkFailed = true
    })
    player.addListener('account_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true
      sdkReady = false
      sdkFailed = true
    })
    player.connect()
  }

  function reinitSdk() {
    if (sdkReinitializing) return
    sdkReinitializing = true
    player?.disconnect()
    sdkReady = false
    sdkFailed = false
    sdkErrorFired = false
    initSdkPlayer()
  }

  function handleReauth() {
    const popup = window.open('/auth/login?popup=1', 'reauth', 'width=500,height=700,menubar=no,toolbar=no')
    if (!popup) {
      window.location.href = '/auth/login'
    }
  }

  onMount(() => {
    // SDK init — if already loaded (e.g. re-mount), init synchronously; otherwise inject script (AC 1)
    if ((window as any).Spotify) {
      initSdkPlayer()
    } else {
      ;(window as any).onSpotifyWebPlaybackSDKReady = initSdkPlayer
      sdkScript = document.createElement('script')
      sdkScript.src = 'https://sdk.scdn.co/spotify-player.js'
      sdkScript.async = true
      document.head.appendChild(sdkScript)
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?code=${code}`
    ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'session:connect') {
          players = data.players ?? []
          hostName = data.hostName ?? null
        } else if (data.type === 'round:start') {
          tiles = initTiles(data.card)
          roundConfig = { titleRevealDelay: data.titleRevealDelay }
          statusLine = 'Waiting for next song…'
          isPlaying = false
          winData = null
          const rawHistory = (data.songHistory ?? []) as Array<{ trackId: string; title: string; artist: string; albumArtUrl: string; songIndex: number }>
          songHistory = rawHistory.slice().reverse()
          songIndex = rawHistory.length > 0 ? rawHistory[rawHistory.length - 1].songIndex : null
          currentRevealed = (data.currentSongRevealed as boolean | undefined) ?? false
        } else if (data.type === 'song:start') {
          if (roundConfig) {
            tiles = applyMask(tiles, data.trackId, roundConfig.titleRevealDelay, data.songIndex)
          }
          songIndex = data.songIndex
          statusLine = `Song ${data.songIndex + 1} of this round`
          currentTrack = { title: data.title, artist: data.artist }
          currentTrackId = data.trackId
          isPlaying = true
          currentRevealed = false
          songHistory = [{ trackId: data.trackId, title: data.title, artist: data.artist, albumArtUrl: data.albumArtUrl, songIndex: data.songIndex }, ...songHistory.filter(e => e.songIndex !== data.songIndex)]
        } else if (data.type === 'song:reveal') {
          currentRevealed = true
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
          isPlaying = false
          winData = { winnerName: data.winnerName, winningTileIds: data.winningTileIds, songHistory: data.songHistory }
        } else if (data.type === 'round:end') {
          onRoundEnded()
        } else if (data.type === 'auth:degraded') {
          authDegraded = true
        } else if (data.type === 'auth:restored') {
          authDegraded = false
          reinitSdk()
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
    player?.disconnect()
    if (sdkScript && document.head.contains(sdkScript)) {
      document.head.removeChild(sdkScript)
    }
    delete (window as any).onSpotifyWebPlaybackSDKReady
  })
</script>

{#if authDegraded}
  <AuthDegradedBanner onReauth={handleReauth} />
{/if}

{#if wsError}
  <div class="error-banner" role="alert">Connection lost — please refresh the page.</div>
{/if}

{#if sdkFailed}
  <SdkFailureBanner trackId={currentTrackId} />
{/if}

{#if showHistory}
  <SongHistoryDrawer entries={songHistory} {currentRevealed} onClose={() => { showHistory = false }} />
{/if}

{#if showPlayers}
  <PlayersOverlay {players} {hostName} selfName={null} onClose={() => { showPlayers = false }} />
{/if}

{#if winData !== null}
  <WinOverlay
    winnerName={winData.winnerName}
    winningSongs={winData.songHistory.filter(e => winData.winningTileIds.includes(e.trackId))}
    isHost={true}
    onStartNextRound={onRoundEnded}
    onDismiss={() => { winData = null }}
  />
{/if}

<div class="host-game">
  <div class="card-area">
    {#if tiles.length > 0}
      <GameHeader {playerCount} {code} {songIndex} onPlayersClick={() => { showPlayers = true }} onHistoryClick={() => { showHistory = true }} />
      <BingoCard {tiles} onTileClick={handleTileClick} />
      <p class="status-line" role="status">{statusLine}</p>
    {:else}
      <p class="status-line" role="status">{statusLine}</p>
    {/if}
    {#if !sdkReady && !sdkFailed}
      <p class="sdk-status" role="status">Connecting to Spotify audio…</p>
    {/if}
  </div>

  <!-- Desktop: controls always visible in right column -->
  <div class="panel-desktop">
    <HostControlsPanel
      {code}
      {currentTrack}
      {isPlaying}
      {sdkReady}
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
      {isPlaying}
      {sdkReady}
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
    padding: 80px 16px 80px;
  }

  .status-line {
    margin-top: 12px;
    font-size: 14px;
    color: #aaa;
    text-align: center;
  }

  .sdk-status {
    margin-top: 8px;
    font-size: 13px;
    color: #888;
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
      padding-top: 80px;
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
