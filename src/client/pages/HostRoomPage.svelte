<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import SdkFailureBanner from '../components/SdkFailureBanner.svelte'
  import GameOverView from '../components/GameOverView.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import AuthDegradedBanner from '../components/AuthDegradedBanner.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import HostMiniPlayer from '../components/HostMiniPlayer.svelte'
  import HostControlsOverlay from '../components/HostControlsOverlay.svelte'
  import RoundConfigOverlay from '../components/RoundConfigOverlay.svelte'
  import { createGameState } from '../lib/gameState.svelte.ts'
  import { postStartNextRound } from '../lib/api.ts'

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
  let isRoundConfigOpen = $state(false)
  let toastVisible = $state(false)
  let playbackError = $state(false)
  let pendingAutoPlay = $state(false)
  let nextRoundError = $state<string | null>(null)
  let undoTimer: ReturnType<typeof setTimeout> | undefined
  let playbackErrorTimer: ReturnType<typeof setTimeout> | undefined
  let nextRoundErrorTimer: ReturnType<typeof setTimeout> | undefined
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

  let casualModeOn = $state(false)
  // Mirrors guest RoomPage — skip the first round:start after session:connect so a
  // reconnect-into-active-round doesn't clobber casualModeOn seeded from session:connect.
  let hasSeenRoundStart = false

  function handleCasualToggle() {
    if (!hostName) return
    const next = !casualModeOn
    casualModeOn = next
    ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: next }))
  }

  function handleSessionEnd() {
    if (sessionEnded) return
    sessionEnded = true
    clearTimeout(undoTimer)
    onSessionEnded()
  }

  function showPlaybackError() {
    playbackError = true
    clearTimeout(playbackErrorTimer)
    playbackErrorTimer = setTimeout(() => { playbackError = false }, 3000)
  }

  function handleChangeItUp() {
    clearTimeout(nextRoundErrorTimer)
    nextRoundError = null
    isRoundConfigOpen = true
  }

  async function handleLetItRide() {
    if (isRoundConfigOpen) return
    nextRoundError = null
    try {
      const res = await postStartNextRound(code)
      if (!res.ok) {
        nextRoundError = "Couldn't start next round — try again."
        clearTimeout(nextRoundErrorTimer)
        nextRoundErrorTimer = setTimeout(() => { nextRoundError = null }, 3000)
      }
    } catch {
      nextRoundError = "Couldn't start next round — try again."
      clearTimeout(nextRoundErrorTimer)
      nextRoundErrorTimer = setTimeout(() => { nextRoundError = null }, 3000)
    }
  }

  $effect(() => {
    if (game.hasBingo) game.handleBingoClick()
  })

  $effect(() => {
    if (sdkReady && pendingAutoPlay && !sdkFailed) {
      pendingAutoPlay = false
      fetch(`/api/rooms/${code}/round/play`, { method: 'POST' })
        .then(res => { if (!res.ok) showPlaybackError() })
        .catch(() => showPlaybackError())
    }
  })

  function handlePlayPause() {
    fetch(`/api/rooms/${code}/round/${isPlaying ? 'pause' : 'play'}`, { method: 'POST' })
      .then(res => { if (!res.ok) showPlaybackError() })
      .catch(() => showPlaybackError())
  }

  function handleNext() {
    fetch(`/api/rooms/${code}/round/next`, { method: 'POST' })
      .then(res => { if (!res.ok) showPlaybackError() })
      .catch(() => showPlaybackError())
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
    pendingAutoPlay = false
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
          if (hasSeenRoundStart) {
            casualModeOn = false
          }
          hasSeenRoundStart = true
          isPlaying = false
          nextRoundError = null
          clearTimeout(nextRoundErrorTimer)
          const history = (data as Record<string, unknown>).songHistory as unknown[] | undefined
          if (!history || history.length === 0) {
            if (sdkReady && !sdkFailed) {
              fetch(`/api/rooms/${code}/round/play`, { method: 'POST' })
                .then(res => { if (!res.ok) showPlaybackError() })
                .catch(() => showPlaybackError())
            } else {
              pendingAutoPlay = true
            }
          }
        } else if (data.type === 'session:connect') {
          game.players = data.players ?? []
          hostName = data.hostName ?? null
          game.winsByName = (data.winsByName as Record<string, number> | undefined) ?? {}
          game.lastRoundWinner = (data.lastRoundWinner as string | null | undefined) ?? null
          const casualNames = (data.casualModeNames as string[] | undefined) ?? []
          game.casualModePlayers = new Set(casualNames)
          if (hostName !== null) casualModeOn = casualNames.includes(hostName)
        } else if (data.type === 'song:start') {
          currentTrack = { title: data.title, artist: data.artist }
          currentTrackId = data.trackId
          isPlaying = true
          pendingAutoPlay = false
        } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
          isPlaying = false
        } else if (data.type === 'round:win') {
          isPlaying = false
        } else if (data.type === 'round:end') {
          pendingAutoPlay = false
          onRoundEnded()
        } else if (data.type === 'session:end') {
          pendingAutoPlay = false
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
    clearTimeout(playbackErrorTimer)
    clearTimeout(nextRoundErrorTimer)
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

{#if playbackError}
  <div class="error-banner" role="alert">Playback control failed — check Spotify is active.</div>
{/if}

{#if sdkFailed}
  <SdkFailureBanner trackId={currentTrackId} />
{/if}

{#if game.showHistory}
  <SongHistoryDrawer entries={game.songHistory} currentRevealed={game.currentRevealed} onClose={() => { game.showHistory = false }} />
{/if}

{#if game.showPlayers}
  <PlayersOverlay players={game.players} {hostName} selfName={null} winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} casualModeNames={game.casualModePlayers} onClose={() => { game.showPlayers = false }} />
{/if}

{#if toastVisible}
  <div class="toast" role="status">
    <span>Ending round…</span>
    <button class="undo-btn" onclick={handleUndo}>Undo</button>
  </div>
{/if}

<div class="host-game" inert={isRoundConfigOpen || undefined}>
  <div class="card-area">
    {#if game.winData !== null}
      <GameOverView
        role="host"
        selfName={null}
        winData={game.winData}
        audioPreset={game.audioPreset}
        ownTiles={game.tiles}
        playedTrackIds={game.playedTrackIds}
        playerCount={game.playerCount}
        {code}
        songIndex={game.songIndex}
        historyOpen={game.showHistory}
        playersOpen={game.showPlayers}
        onPlayersClick={() => { game.showPlayers = !game.showPlayers; game.showHistory = false }}
        onHistoryClick={() => { game.showHistory = !game.showHistory; game.showPlayers = false }}
        onLetItRide={handleLetItRide}
        onChangeItUp={handleChangeItUp}
        {nextRoundError}
      />
    {:else if game.tiles.length > 0}
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
      {#if game.allowCasualMode && hostName !== null}
        <div class="casual-toggle-row">
          <span class="casual-label">Casual Mode</span>
          <button
            class="casual-btn"
            class:active={casualModeOn}
            onclick={handleCasualToggle}
            aria-pressed={casualModeOn}
          >{casualModeOn ? 'On' : 'Off'}</button>
        </div>
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

{#if isRoundConfigOpen}
  <RoundConfigOverlay
    {code}
    initialHostName={hostName}
    onClose={() => { isRoundConfigOpen = false }}
    onStarted={(name) => {
      if (name) hostName = name
      isRoundConfigOpen = false
    }}
    onHostNameMaybeSaved={(name) => { hostName = name }}
  />
{/if}

{#if showControls}
  <HostControlsOverlay
    {code}
    onClose={() => { showControls = false }}
    onEndRound={handleEndRound}
    onSessionEnded={handleSessionEnd}
    onHostManagement={handleSessionEnd}
    roundActive={game.tiles.length > 0}
    clipDuration={game.clipDuration}
    titleRevealDelay={game.titleRevealDelay}
    audioPreset={game.audioPreset}
    allowCasualMode={game.allowCasualMode}
    onClipDurationChange={(v) => { game.clipDuration = v }}
    onTitleRevealDelayChange={(v) => { game.titleRevealDelay = v }}
    onAudioPresetChange={(v) => { game.audioPreset = v }}
    onAllowCasualModeChange={(v) => { game.allowCasualMode = v }}
  />
{/if}

<style>
  .error-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: var(--danger);
    color: var(--accent-fg);
    padding: var(--space-2) var(--space-4);
    text-align: center;
    z-index: 200;
    font-size: 14px;
  }

  .host-game {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--fg);
  }

  .card-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 80px 16px 64px;
  }

  .toast {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--fg);
    color: var(--bg);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 200;
    white-space: nowrap;
    border: var(--rule-thin) solid var(--rule);
  }

  .undo-btn {
    background: none;
    border: var(--rule-thin) solid currentColor;
    color: inherit;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 13px;
  }

  .sdk-status {
    margin-top: 8px;
    font-size: 13px;
    color: var(--fg-muted);
    text-align: center;
  }

  .casual-toggle-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 12px;
  }

  .casual-label {
    font-size: 14px;
    color: var(--fg-muted);
  }

  .casual-btn {
    padding: 0.35rem 0.9rem;
    min-height: 36px;
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .casual-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .casual-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  @media (min-width: 768px) {
    .host-game {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--space-6) var(--space-7);
    }
    .card-area {
      padding: 96px var(--space-5) 96px;
      gap: var(--space-5);
    }
  }
</style>
