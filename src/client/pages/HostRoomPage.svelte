<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import SdkFailureBanner from '../components/SdkFailureBanner.svelte'
  import WinOverlay from '../components/WinOverlay.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import AuthDegradedBanner from '../components/AuthDegradedBanner.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import HostMiniPlayer from '../components/HostMiniPlayer.svelte'
  import HostControlsOverlay from '../components/HostControlsOverlay.svelte'
  import { createGameState } from '../lib/gameState.svelte.ts'

  let { code, onRoundEnded, onSessionEnded }: {
    code: string
    onRoundEnded: () => void
    onSessionEnded: () => void
  } = $props()

  // Host-only state
  let currentTrack = $state<{ title: string; artist: string } | null>(null)
  let isPlaying = $state(false)
  let wsError = $state(false)
  let sdkReady = $state(false)
  let sdkFailed = $state(false)
  let currentTrackId = $state<string | null>(null)
  let hostName = $state<string | null>(null)
  let authDegraded = $state(false)
  let showControls = $state(false)
  let toastVisible = $state(false)
  let undoTimer: ReturnType<typeof setTimeout> | undefined
  let sessionEnded = false
  let ws: WebSocket
  let player: Spotify.Player | undefined
  let sdkScript: HTMLScriptElement | undefined
  let sdkErrorFired = false
  let sdkReinitializing = false

  const game = createGameState({
    code: untrack(() => code),
    getPlayerName: () => hostName,
  })

  function handleSessionEnd() {
    if (sessionEnded) return
    sessionEnded = true
    clearTimeout(undoTimer)
    onSessionEnded()
  }

  function handlePlayPause() {
    fetch(`/api/rooms/${code}/round/${isPlaying ? 'pause' : 'play'}`, { method: 'POST' })
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
      sdkErrorFired = true; sdkReady = false; sdkFailed = true
    })
    player.addListener('authentication_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true; sdkReady = false; sdkFailed = true
    })
    player.addListener('account_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true; sdkReady = false; sdkFailed = true
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
    if (!popup) window.location.href = '/auth/login'
  }

  onMount(() => {
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
    ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?code=${code}`)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        game.processWsMessage(data)
        if (data.type === 'round:start') {
          isPlaying = false
        } else if (data.type === 'session:connect') {
          game.players = data.players ?? []
          hostName = data.hostName ?? null
        } else if (data.type === 'song:start') {
          currentTrack = { title: data.title, artist: data.artist }
          currentTrackId = data.trackId
          isPlaying = true
        } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
          isPlaying = false
        } else if (data.type === 'round:win') {
          isPlaying = false
        } else if (data.type === 'round:end') {
          onRoundEnded()
        } else if (data.type === 'session:end') {
          handleSessionEnd()
        } else if (data.type === 'auth:degraded') {
          authDegraded = true
        } else if (data.type === 'auth:restored') {
          authDegraded = false
          reinitSdk()
        } else if (data.type === 'host:sdk-stale') {
          console.warn('[host] server reports SDK device stale; reinitializing')
          reinitSdk()
        }
      } catch {
        // ignore unparseable messages
      }
    }

    ws.onerror = () => { wsError = true }
    ws.onclose = (event) => { if (event.code !== 1000) wsError = true }
  })

  onDestroy(() => {
    game.cleanup()
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

{#if game.showHistory}
  <SongHistoryDrawer entries={game.songHistory} currentRevealed={game.currentRevealed} onClose={() => { game.showHistory = false }} />
{/if}

{#if game.showPlayers}
  <PlayersOverlay players={game.players} {hostName} selfName={null} onClose={() => { game.showPlayers = false }} />
{/if}

{#if game.winData !== null}
  {@const wd = game.winData}
  <WinOverlay
    winnerName={wd.winnerName}
    winningSongs={wd.songHistory.filter(e => wd.winningTileIds.includes(e.trackId))}
    isHost={true}
    onStartNextRound={onRoundEnded}
    onDismiss={() => { game.winData = null }}
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
    {#if game.tiles.length > 0}
      <GameHeader
        playerCount={game.playerCount}
        {code}
        songIndex={game.songIndex}
        historyOpen={game.showHistory}
        playersOpen={game.showPlayers}
        onPlayersClick={() => { game.showPlayers = !game.showPlayers; game.showHistory = false }}
        onHistoryClick={() => { game.showHistory = !game.showHistory; game.showPlayers = false }}
      />
      <BingoCard tiles={game.tiles} nopeIndex={game.nopeIndex} onTileClick={game.handleTileClick} />
      {#if game.hasBingo && !game.isClaiming}
        <button class="bingo-btn" onclick={game.handleBingoClick}>Bingo!</button>
      {:else if game.isClaiming}
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
    min-height: 100dvh;
    background: #121212;
    font-family: sans-serif;
  }

  .card-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 80px 16px 64px;
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
      padding-bottom: 64px;
    }
  }
</style>
