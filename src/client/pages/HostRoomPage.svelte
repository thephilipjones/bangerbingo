<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import SdkFailureBanner from '../components/SdkFailureBanner.svelte'
  import WinOverlay from '../components/WinOverlay.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import AuthDegradedBanner from '../components/AuthDegradedBanner.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import HostMiniPlayer from '../components/HostMiniPlayer.svelte'
  import HostControlsOverlay from '../components/HostControlsOverlay.svelte'
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

  const WIN_LINES = [
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    [0,6,12,18,24], [4,8,12,16,20],
  ]

  let { code, onRoundEnded, onSessionEnded }: { code: string; onRoundEnded: () => void; onSessionEnded: () => void } = $props()

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
  let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)
  let currentTrack = $state<{ title: string; artist: string } | null>(null)
  let isPlaying = $state(false)
  let players = $state<string[]>([])
  let wsError = $state(false)
  let sdkReady = $state(false)
  let sdkFailed = $state(false)
  let currentTrackId = $state<string | null>(null)
  let winData = $state<WinData | null>(null)
  let isClaiming = $state(false)
  const hasBingo = $derived(
    tiles.length > 0 &&
    winData === null &&
    WIN_LINES.some(line => line.every(i => tiles[i]?.state === 'marked' || tiles[i]?.state === 'free'))
  )
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

  let showControls = $state(false)
  let toastVisible = $state(false)
  let undoTimer: ReturnType<typeof setTimeout> | undefined
  let sessionEnded = false

  function handleSessionEnd() {
    if (sessionEnded) return
    sessionEnded = true
    clearTimeout(undoTimer)
    onSessionEnded()
  }

  function handleTileClick(index: number) {
    tiles = toggleMark(tiles, index)
  }

  async function handleBingoClick() {
    if (!hostName) return
    isClaiming = true
    const claimedTileIds = tiles
      .filter(t => t.state === 'marked' || t.state === 'free')
      .map(t => t.free ? 'FREE' : t.trackId)
    try {
      const res = await fetch(`/api/rooms/${code}/round/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: hostName, claimedTileIds }),
      })
      if (res.status !== 200) {
        isClaiming = false
      }
    } catch {
      isClaiming = false
    }
  }

  function handlePlayPause() {
    const endpoint = isPlaying ? 'pause' : 'play'
    fetch(`/api/rooms/${code}/round/${endpoint}`, { method: 'POST' })
  }

  function handleNext() {
    fetch(`/api/rooms/${code}/round/next`, { method: 'POST' })
  }

  function handleEndRound() {
    clearTimeout(undoTimer)
    showControls = false
    toastVisible = true
    undoTimer = setTimeout(async () => {
      toastVisible = false
      await fetch(`/api/rooms/${code}/round/end`, { method: 'POST' })
    }, 2000)
  }

  function handleUndo() {
    toastVisible = false
    clearTimeout(undoTimer)
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
          isPlaying = false
        } else if (data.type === 'round:win') {
          tiles = applyWinPath(tiles, data.winningTileIds)
          isPlaying = false
          isClaiming = false
          winData = { winnerName: data.winnerName, winningTileIds: data.winningTileIds, songHistory: data.songHistory }
        } else if (data.type === 'round:end') {
          onRoundEnded()
        } else if (data.type === 'session:end') {
          handleSessionEnd()
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
    clearTimeout(undoTimer)
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

{#if toastVisible}
  <div class="toast" role="status">
    <span>Ending round…</span>
    <button class="undo-btn" onclick={handleUndo}>Undo</button>
  </div>
{/if}

<div class="host-game">
  <div class="card-area">
    {#if tiles.length > 0}
      <GameHeader {playerCount} {code} {songIndex} historyOpen={showHistory} playersOpen={showPlayers} onPlayersClick={() => { showPlayers = !showPlayers; showHistory = false }} onHistoryClick={() => { showHistory = !showHistory; showPlayers = false }} />
      <BingoCard {tiles} onTileClick={handleTileClick} />
      {#if hasBingo && !isClaiming}
        <button class="bingo-btn" onclick={handleBingoClick}>Bingo!</button>
      {:else if isClaiming}
        <button class="bingo-btn bingo-btn--disabled" disabled>Claiming…</button>
      {/if}
    {/if}
    {#if !sdkReady && !sdkFailed}
      <p class="sdk-status" role="status">Connecting to Spotify audio…</p>
    {/if}
  </div>
</div>

<HostMiniPlayer
  {currentTrack}
  {isPlaying}
  {sdkReady}
  {sdkFailed}
  {currentTrackId}
  onPlayPause={handlePlayPause}
  onNext={handleNext}
  onGearClick={() => { showControls = true }}
  controlsOpen={showControls}
/>

{#if showControls}
  <HostControlsOverlay
    {code}
    onClose={() => { showControls = false }}
    onEndRound={handleEndRound}
    onSessionEnded={handleSessionEnd}
    onHostManagement={handleSessionEnd}
  />
{/if}

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

  .bingo-btn {
    margin-top: 16px;
    background: #1db954;
    color: #000;
    border: none;
    border-radius: 8px;
    padding: 14px 40px;
    font-size: 18px;
    font-weight: 700;
    font-family: sans-serif;
    cursor: pointer;
    letter-spacing: 1px;
  }

  .bingo-btn--disabled {
    background: #555;
    color: #999;
    cursor: default;
  }

  .toast {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: #fff;
    padding: 10px 16px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 200;
    white-space: nowrap;
  }

  .undo-btn {
    background: none;
    border: 1px solid #fff;
    color: #fff;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 13px;
  }

  .sdk-status {
    margin-top: 8px;
    font-size: 13px;
    color: #888;
    text-align: center;
  }

  @media (min-width: 768px) {
    .host-game {
      max-width: 640px;
      margin: 0 auto;
      padding: 16px;
    }
    .card-area {
      padding-top: 80px;
    }
  }
</style>
