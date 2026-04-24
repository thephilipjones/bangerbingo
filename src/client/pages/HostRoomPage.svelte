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
  import DevicePicker from '../components/DevicePicker.svelte'
  import { createGameState } from '../lib/gameState.svelte.ts'
  import { cardFingerprint } from '../lib/bingo.ts'
  import type { Tile } from '../lib/bingo.ts'
  import { postStartNextRound, postSetDevice, getDevices } from '../lib/api.ts'
  import type { SpotifyDevice } from '../lib/api.ts'
  import { readHostPrefs, writeHostPrefs } from '../lib/hostPrefs.ts'
  import { createWsClient, type WsClient, type WsState } from '../lib/wsClient.ts'
  import { isMobileHost } from '../lib/isMobileHost.ts'
  import { shouldFlushPending, type PendingPlayAction } from '../lib/pendingPlayAction.ts'
  import { playWinAudio } from '../lib/winAudio.ts'

  let { code, onRoundEnded, onSessionEnded }: {
    code: string
    onRoundEnded: () => void
    onSessionEnded: () => void
  } = $props()

  // Host-only state
  let currentTrack = $state<{ title: string; artist: string } | null>(null)
  let isPlaying = $state(false)
  let wsState = $state<WsState>('connecting')
  let sdkReady = $state(false)
  let sdkFailed = $state(false)
  let currentTrackId = $state<string | null>(null)
  let hostName = $state<string | null>(null)
  let authDegraded = $state(false)
  let showControls = $state(false)
  let isRoundConfigOpen = $state(false)
  let playbackError = $state(false)
  let pendingAutoPlay = $state(false)
  let awaitingFirstStart = $state(false)
  let nextRoundError = $state<string | null>(null)
  let playbackErrorTimer: ReturnType<typeof setTimeout> | undefined
  let nextRoundErrorTimer: ReturnType<typeof setTimeout> | undefined
  let selectedDevice = $state<{ id: string; name: string; type: string } | null>(null)
  let showDevicePicker = $state(false)
  let pickerError = $state<string | null>(null)
  let pickerSource = $state<'chip' | 'settings' | 'banner'>('chip')
  let isSwitchingDevice = $state(false)
  let confirmPill = $state<string | null>(null)
  let deviceSwitchResult = $state<'saved' | 'error' | null>(null)
  let confirmPillTimer: ReturnType<typeof setTimeout> | undefined
  let deviceSwitchResultTimer: ReturnType<typeof setTimeout> | undefined
  let hostMessage = $state<string | null>(null)
  let hostMessageTimer: ReturnType<typeof setTimeout> | null = null
  let sessionEnded = false
  let wsClient: WsClient | null = null
  let visibilityListener: (() => void) | null = null
  let player: Spotify.Player | undefined
  let sdkScript: HTMLScriptElement | undefined
  let sdkErrorFired = false
  let sdkReinitializing = false
  let preferredDeviceId: string | undefined = undefined
  let initialDevicesController: AbortController | undefined

  // Story 12-2: mobile-first branch state
  const mobileHost = isMobileHost()
  // On mobile the Spotify app is the player — there's no SDK to wait for, so
  // treat the "audio ready" gate as satisfied from the start. This lets play,
  // pause, autoplay, and the "Connecting to Spotify audio…" hint not block.
  if (mobileHost) sdkReady = true
  let mobileNoDevice = $state(false)
  let mobileDeviceRefreshing = $state(false)
  // Resume-reconcile UI state (desktop + mobile)
  let resumePausedChip = $state(false)
  // Desktop SDK reinit gating
  let sdkReconnecting = $state(false)
  let pendingPlayAction: PendingPlayAction | null = null
  let sdkReconnectTimer: ReturnType<typeof setTimeout> | undefined
  // Safety ceiling: if the SDK never fires `ready` (or fires an error we don't
  // listen for), clear the reconnect gate so controls don't hang forever.
  const SDK_RECONNECT_TIMEOUT_MS = 12_000
  let mobileDeviceController: AbortController | undefined
  // Serialize resume requests so two quick reconnects can't race each other.
  let resumeInFlight = false

  // Story 12-3: persist host marks to localStorage so refresh/reconnect restores
  // them. Mirrors guest RoomPage wiring verbatim — `bangerbingo:marks:{code}:{fingerprint}`.
  let marksKey = ''
  function loadMarks(): Set<string> {
    if (!marksKey) return new Set()
    try {
      return new Set(JSON.parse(localStorage.getItem(marksKey) ?? '[]'))
    } catch {
      return new Set()
    }
  }

  const game = createGameState({
    code: untrack(() => code),
    getPlayerName: () => hostName,
    getMarksForCard: (card: Tile[]) => {
      marksKey = `bangerbingo:marks:${code}:${cardFingerprint(card)}`
      return loadMarks()
    },
    onTileMark: (tiles) => {
      if (!marksKey) return
      const ids = tiles.filter(t => t.state === 'marked').map(t => t.trackId)
      localStorage.setItem(marksKey, JSON.stringify(ids))
    },
  })

  let casualModeOn = $state(false)

  function handleCasualToggle() {
    if (!hostName) return
    const next = !casualModeOn
    casualModeOn = next
    wsClient?.send({ type: 'player:casual-mode-changed', enabled: next })
  }

  function handleRename(newName: string) {
    wsClient?.send({ type: 'player:rename', newName })
  }

  function handleSessionEnd() {
    if (sessionEnded) return
    sessionEnded = true
    onSessionEnded()
  }

  function showPlaybackError() {
    playbackError = true
    clearTimeout(playbackErrorTimer)
    playbackErrorTimer = setTimeout(() => { playbackError = false }, 3000)
  }

  // Story 12-2: unified clear for the SDK-reconnect gate. Cancels the safety
  // timer and drops any pending play action so controls aren't stuck disabled
  // if the SDK never emits `ready` (error, throw, or just silence).
  function clearSdkReconnecting() {
    sdkReconnecting = false
    clearTimeout(sdkReconnectTimer)
    sdkReconnectTimer = undefined
    pendingPlayAction = null
  }

  function beginSdkReconnect() {
    if (mobileHost) return
    sdkReconnecting = true
    clearTimeout(sdkReconnectTimer)
    sdkReconnectTimer = setTimeout(() => {
      // Timeout: SDK never re-readied. Surface an error chip and re-enable
      // controls so the host can try again rather than hang on "Reconnecting…".
      clearSdkReconnecting()
      showPlaybackError()
    }, SDK_RECONNECT_TIMEOUT_MS)
    try {
      reinitSdk()
    } catch (err) {
      console.error('[host] reinitSdk threw', err)
      clearSdkReconnecting()
      showPlaybackError()
    }
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
        if (res.status === 401) {
          nextRoundError = null
          clearTimeout(nextRoundErrorTimer)
          authDegraded = true
          return
        }
        const msg = res.status === 403
          ? 'Only the host can start the next round'
          : res.status === 409
            ? "Previous round hasn't ended yet"
            : "Couldn't start next round — try again."
        nextRoundError = msg
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

  const playbackReady = $derived(sdkReady || selectedDevice?.id != null)

  $effect(() => {
    if (sdkReady && pendingAutoPlay && !sdkFailed) {
      pendingAutoPlay = false
      fetch(`/api/rooms/${code}/round/play`, { method: 'POST' })
        .then(res => { if (!res.ok) showPlaybackError() })
        .catch(() => showPlaybackError())
    }
  })

  function handlePlayPause() {
    const wasResumingPaused = resumePausedChip
    const action = () => fetch(`/api/rooms/${code}/round/${isPlaying ? 'pause' : 'play'}`, { method: 'POST' })
      .then(res => {
        if (!res.ok) {
          showPlaybackError()
        } else if (wasResumingPaused) {
          // Only dismiss the "Tap to resume" chip once the POST actually
          // succeeded — otherwise a failed tap leaves the host with no cue
          // that Spotify is still paused.
          resumePausedChip = false
        }
      })
      .catch(() => showPlaybackError())
    if (sdkReconnecting) {
      pendingPlayAction = { fn: action, t: Date.now() }
      return
    }
    action()
  }

  function handleNext() {
    const action = () => fetch(`/api/rooms/${code}/round/next`, { method: 'POST' })
      .then(res => { if (!res.ok) showPlaybackError() })
      .catch(() => showPlaybackError())
    if (sdkReconnecting) {
      pendingPlayAction = { fn: action, t: Date.now() }
      return
    }
    action()
  }

  function handleOpenDevicePicker(source: 'chip' | 'settings' | 'banner' = 'chip') {
    pickerSource = source
    pickerError = null
    showDevicePicker = true
  }

  async function handleDeviceSelected(device: SpotifyDevice) {
    if (isSwitchingDevice || device.id === null) return
    isSwitchingDevice = true
    const deviceId = device.id
    const source = pickerSource
    const prevDevice = selectedDevice
    selectedDevice = { id: deviceId, name: device.name, type: device.type }
    try {
      const res = await postSetDevice(code, deviceId).catch(() => null)
      if (res && res.ok) {
        if (source === 'chip') {
          clearTimeout(confirmPillTimer)
          confirmPill = `Playing on ${device.name}`
          confirmPillTimer = setTimeout(() => { confirmPill = null }, 1500)
        }
        deviceSwitchResult = 'saved'
        clearTimeout(deviceSwitchResultTimer)
        deviceSwitchResultTimer = setTimeout(() => { deviceSwitchResult = null }, 1500)
        preferredDeviceId = deviceId
        writeHostPrefs({ preferredDeviceId: deviceId })
        if (sdkFailed) sdkFailed = false
      } else {
        selectedDevice = prevDevice
        clearTimeout(confirmPillTimer)
        confirmPill = null
        pickerError = "Couldn't switch device"
        deviceSwitchResult = 'error'
        clearTimeout(deviceSwitchResultTimer)
        deviceSwitchResultTimer = setTimeout(() => { deviceSwitchResult = null }, 3000)
      }
    } finally {
      isSwitchingDevice = false
    }
  }

  function handleStartNewRound() {
    showControls = false
    isRoundConfigOpen = true
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
      if (selectedDevice === null) {
        selectedDevice = { id: device_id, name: 'Bangerbingo (this browser)', type: 'Computer' }
      }
      // Story 12-2 AC #9/#10: clear reconnect gate and flush any pending play action.
      if (sdkReconnecting) {
        const pending = pendingPlayAction
        clearSdkReconnecting()
        if (shouldFlushPending(pending, Date.now())) {
          try { pending!.fn() } catch { /* ignore */ }
        }
      }
    })
    player.addListener('not_ready', () => { sdkReady = false })
    player.addListener('initialization_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true; sdkReady = false; sdkFailed = true
      // Controls must recover even when reinit fails — otherwise they'd stay
      // `disabled={sdkReconnecting}` forever.
      if (sdkReconnecting) clearSdkReconnecting()
    })
    player.addListener('authentication_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true; sdkReady = false; sdkFailed = true
      if (sdkReconnecting) clearSdkReconnecting()
    })
    player.addListener('account_error', () => {
      if (sdkErrorFired) return
      sdkErrorFired = true; sdkReady = false; sdkFailed = true
      if (sdkReconnecting) clearSdkReconnecting()
    })
    player.connect()
  }

  function reinitSdk() {
    if (mobileHost) return // Story 12-2: no SDK on mobile
    if (sdkReinitializing) return
    sdkReinitializing = true
    pendingAutoPlay = false
    player?.disconnect()
    sdkReady = false
    sdkFailed = false
    sdkErrorFired = false
    if (selectedDevice?.name === 'Bangerbingo (this browser)') selectedDevice = null
    initSdkPlayer()
  }

  // Story 12-2 AC #2/#3: choose the best Spotify device for mobile host.
  // Preference: active → saved preferredDeviceId → Smartphone → first non-restricted.
  // preferredDeviceId is checked before the fallback so we don't silently clobber
  // the host's saved pick with whatever device happens to be listed first.
  async function pickMobileDevice() {
    if (mobileDeviceRefreshing) return
    mobileDeviceRefreshing = true
    mobileDeviceController?.abort()
    mobileDeviceController = new AbortController()
    const ctrl = mobileDeviceController
    try {
      const result = await getDevices(code, ctrl.signal)
      if (ctrl.signal.aborted) return
      const usable = (result.devices ?? []).filter(d => d.id !== null && !d.is_restricted)
      if (usable.length === 0) {
        mobileNoDevice = true
        return
      }
      const active = usable.find(d => d.is_active)
      const preferred = preferredDeviceId ? usable.find(d => d.id === preferredDeviceId) : undefined
      const phone = usable.find(d => d.type === 'Smartphone')
      const pick = active ?? preferred ?? phone ?? usable[0]
      if (pick.id === null) {
        mobileNoDevice = true
        return
      }
      const deviceId = pick.id
      const res = await postSetDevice(code, deviceId).catch(() => null)
      if (ctrl.signal.aborted) return
      if (res && res.ok) {
        selectedDevice = { id: deviceId, name: pick.name, type: pick.type }
        // Only persist to hostPrefs when the pick matches an intentional
        // signal (host was actively using it, saved it before, or it's a
        // phone). Otherwise `usable[0]` could sticky-adopt a forgotten TV.
        if (pick === active || pick === preferred || pick === phone) {
          preferredDeviceId = deviceId
          writeHostPrefs({ preferredDeviceId: deviceId })
        }
        mobileNoDevice = false
      } else {
        mobileNoDevice = true
      }
    } catch {
      if (!ctrl.signal.aborted) mobileNoDevice = true
    } finally {
      mobileDeviceRefreshing = false
    }
  }

  // Story 12-2 AC #5/#7: reconcile server + client state with Spotify's truth.
  async function postHostResume() {
    if (resumeInFlight) return
    resumeInFlight = true
    try {
      const res = await fetch(`/api/rooms/${code}/host/resume`, { method: 'POST' })
      if (!res.ok) {
        // 503 (auth degraded) and 500s get swallowed otherwise; log so the
        // failure is visible in dev and observable from the console.
        console.warn(`[host] /host/resume responded ${res.status}`)
        return
      }
      const payload = await res.json().catch(() => null) as
        | { state: 'ok' | 'drift-corrected'; device?: { id: string; name: string; type: string } }
        | { state: 'spotify-paused'; device?: { id: string; name: string; type: string } }
        | { state: 'no-device' | 'drift-unresolvable' | 'advanced' }
        | null
      if (!payload) return
      if (payload.state === 'ok' || payload.state === 'drift-corrected') {
        resumePausedChip = false
        if (mobileHost) mobileNoDevice = false
        if (payload.state === 'drift-corrected' && payload.device) {
          selectedDevice = payload.device
        }
      } else if (payload.state === 'spotify-paused') {
        resumePausedChip = true
      } else if (payload.state === 'no-device') {
        if (mobileHost) mobileNoDevice = true
      } else if (payload.state === 'drift-unresolvable') {
        if (mobileHost) mobileNoDevice = true
      } else if (payload.state === 'advanced') {
        resumePausedChip = false
      } else {
        // Future server states will be seen here — warn so the gap surfaces
        // during development rather than silently no-op'ing.
        console.warn('[host] unknown /host/resume state', (payload as { state?: string }).state)
      }
    } catch { /* network hiccup — wait for next resume */ } finally {
      resumeInFlight = false
    }
  }

  function handleReauth() {
    const popup = window.open('/auth/login?popup=1', 'reauth', 'width=500,height=700,menubar=no,toolbar=no')
    if (!popup) window.location.href = '/auth/login'
  }

  onMount(() => {
    preferredDeviceId = readHostPrefs()?.preferredDeviceId

    // Story 12-2 AC #1: on mobile, skip Web Playback SDK entirely. Spotify app
    // acts as the default Connect target.
    if (!mobileHost) {
      if ((window as any).Spotify) {
        initSdkPlayer()
      } else {
        ;(window as any).onSpotifyWebPlaybackSDKReady = initSdkPlayer
        sdkScript = document.createElement('script')
        sdkScript.src = 'https://sdk.scdn.co/spotify-player.js'
        sdkScript.async = true
        document.head.appendChild(sdkScript)
      }
    }

    if (mobileHost) {
      pickMobileDevice()
    } else if (preferredDeviceId) {
      const capturedPreferredId = preferredDeviceId
      initialDevicesController = new AbortController()
      const ctrl = initialDevicesController
      getDevices(code, ctrl.signal)
        .then((result) => {
          if (ctrl.signal.aborted) return
          const hit = result.devices.find(d => d.id === capturedPreferredId && !d.is_restricted)
          if (hit) {
            selectedDevice = { id: hit.id, name: hit.name, type: hit.type }
          }
        })
        .catch(() => { /* aborted or network error; fall back to SDK default */ })
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?code=${code}`

    function handleWsMessage(data: Record<string, unknown>) {
      try {
        // Capture before processWsMessage sets winData — guards audio replay in Story 13-6.
        const isWinReplay = data.type === 'round:win' && game.winData !== null
        game.processWsMessage(data)
        if (data.type === 'round:win' && !isWinReplay) {
          try { playWinAudio(game.audioPreset) } catch (e) { if (!(e instanceof DOMException && e.name === 'NotAllowedError')) throw e }
        } else if (data.type === 'round:start') {
          isPlaying = false
          nextRoundError = null
          clearTimeout(nextRoundErrorTimer)
          const history = (data as Record<string, unknown>).songHistory as Array<{ trackId: string; title: string; artist: string }> | undefined
          const currentSongIndex = (data as Record<string, unknown>).currentSongIndex as number | undefined
          const paused = (data as Record<string, unknown>).paused as boolean | undefined
          if (!history || history.length === 0) {
            if (paused === true) {
              awaitingFirstStart = true
            } else if (sdkReady && !sdkFailed) {
              fetch(`/api/rooms/${code}/round/play`, { method: 'POST' })
                .then(res => { if (!res.ok) showPlaybackError() })
                .catch(() => showPlaybackError())
            } else {
              pendingAutoPlay = true
            }
          } else if (currentSongIndex !== undefined && currentSongIndex >= 0) {
            // Reconnect into an active round: hydrate the mini-player UI from the
            // last history entry (always the currently playing track — see
            // rooms.ts songHistory.push only on isTrackChange).
            const last = history[history.length - 1]
            currentTrack = { title: last.title, artist: last.artist }
            currentTrackId = last.trackId
            isPlaying = !(paused === true)
          }
        } else if (data.type === 'session:connect') {
          game.players = data.players ?? []
          hostName = data.hostName ?? null
          game.winsByName = (data.winsByName as Record<string, number> | undefined) ?? {}
          game.lastRoundWinner = (data.lastRoundWinner as string | null | undefined) ?? null
          const casualNames = (data.casualModeNames as string[] | undefined) ?? []
          game.casualModePlayers = new Set(casualNames)
          if (hostName !== null) casualModeOn = casualNames.includes(hostName)
          // Story 12-2 AC #7: reconcile with Spotify's truth on initial connect.
          postHostResume()
        } else if (data.type === 'host:device-changed') {
          const d = (data as Record<string, unknown>).device as { id: string; name: string; type: string } | undefined
          if (d && typeof d.id === 'string') {
            selectedDevice = { id: d.id, name: d.name, type: d.type }
            // Server-driven adoption is transient; don't persist to hostPrefs
            // here or a phone sleep/wake flap could clobber the host's saved
            // preference. Only explicit user picks and the mobile auto-pick
            // write to hostPrefs.
            if (mobileHost) mobileNoDevice = false
          }
        } else if (data.type === 'song:start') {
          currentTrack = { title: data.title, artist: data.artist }
          currentTrackId = data.trackId
          isPlaying = true
          pendingAutoPlay = false
          awaitingFirstStart = false
        } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
          isPlaying = false
          awaitingFirstStart = false
        } else if (data.type === 'round:win') {
          isPlaying = false
          awaitingFirstStart = false
          if (!isWinReplay) {
            // Story 13-6: play win jingle here
          }
        } else if (data.type === 'round:end') {
          pendingAutoPlay = false
          onRoundEnded()
        } else if (data.type === 'session:end') {
          pendingAutoPlay = false
          handleSessionEnd()
        } else if (data.type === 'player:renamed') {
          const newName = data.newName as string | undefined
          const isHost = data.isHost as boolean | undefined
          if (isHost && newName !== undefined) hostName = newName
        } else if (data.type === 'player:rename-rejected') {
          console.warn('[rename] rejected:', data.reason)
        } else if (data.type === 'auth:degraded') {
          authDegraded = true
        } else if (data.type === 'auth:restored') {
          authDegraded = false
          // Gate with sdkReconnecting so a click during the reinit window is
          // captured as pendingPlayAction rather than hitting a stale SDK.
          beginSdkReconnect()
        } else if (data.type === 'host:info' && typeof data.message === 'string') {
          if (hostMessageTimer) clearTimeout(hostMessageTimer)
          hostMessage = data.message
          const dismissMs = typeof data.autoDismissMs === 'number' ? data.autoDismissMs : 6000
          hostMessageTimer = setTimeout(() => { hostMessage = null; hostMessageTimer = null }, dismissMs)
        } else if (data.type === 'host:sdk-stale') {
          // Story 12-2 AC #9: ignore on mobile (no SDK to reinit). On desktop,
          // gate controls while the SDK re-initializes.
          if (mobileHost) {
            console.warn('[host] host:sdk-stale on mobile — no-op')
          } else {
            console.warn('[host] server reports SDK device stale; reinitializing')
            beginSdkReconnect()
          }
        }
      } catch {
        // ignore unparseable messages
      }
    }

    wsClient = createWsClient({
      url: wsUrl,
      onMessage: (raw) => handleWsMessage(raw as Record<string, unknown>),
      onStateChange: (s) => { wsState = s },
    })

    // Story 12-2 AC #7/#8: reconcile with Spotify on every resume. On mobile,
    // also re-run device auto-pick (after resume resolves, so host:device-changed
    // has already landed if the server adopted a new device).
    wsClient.onResume(async () => {
      await postHostResume()
      if (mobileHost) pickMobileDevice()
    })

    function onVisible() {
      if (document.visibilityState === 'visible') wsClient?.nudge()
    }
    document.addEventListener('visibilitychange', onVisible)
    visibilityListener = onVisible
  })

  onDestroy(() => {
    game.cleanup()
    clearTimeout(playbackErrorTimer)
    clearTimeout(nextRoundErrorTimer)
    clearTimeout(confirmPillTimer)
    clearTimeout(deviceSwitchResultTimer)
    clearTimeout(sdkReconnectTimer)
    if (hostMessageTimer) { clearTimeout(hostMessageTimer); hostMessageTimer = null }
    initialDevicesController?.abort()
    mobileDeviceController?.abort()
    if (visibilityListener) {
      document.removeEventListener('visibilitychange', visibilityListener)
      visibilityListener = null
    }
    wsClient?.close()
    wsClient = null
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

{#if wsState === 'reconnecting'}
  <div class="reconnecting-chip" role="status" aria-live="polite">Reconnecting…</div>
{/if}

{#if wsState === 'dead'}
  <div class="error-banner" role="alert">Connection lost — please refresh the page.</div>
{/if}

{#if playbackError}
  <div class="error-banner" role="alert">Playback control failed — check Spotify is active.</div>
{/if}

{#if hostMessage}
  <div class="info-toast" role="status" aria-live="polite">{hostMessage}</div>
{/if}

{#if sdkFailed}
  <SdkFailureBanner onPickDevice={() => handleOpenDevicePicker('banner')} />
{/if}

{#if game.showHistory}
  <SongHistoryDrawer entries={game.songHistory} currentRevealed={game.currentRevealed} onClose={() => { game.showHistory = false }} />
{/if}

{#if game.showPlayers}
  <PlayersOverlay players={game.players} {hostName} selfName={null} winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} casualModeNames={game.casualModePlayers} onClose={() => { game.showPlayers = false }} onRename={handleRename} isClaiming={game.isClaiming} />
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
        playbackStartedAt={game.playbackStartedAt}
        effectiveDurationMs={game.effectiveDurationMs}
        playbackPausedAt={game.pausedAt}
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
  titleRevealDelay={game.titleRevealDelay}
  currentRevealed={game.currentRevealed}
  onPlayPause={handlePlayPause}
  onNext={handleNext}
  onGearClick={() => { showControls = true }}
  controlsOpen={showControls}
  {selectedDevice}
  onDeviceChipClick={() => handleOpenDevicePicker('chip')}
  {confirmPill}
  devicePickerOpen={showDevicePicker}
  disabled={sdkReconnecting}
  {awaitingFirstStart}
  {playbackReady}
/>

{#if mobileHost && mobileNoDevice}
  <div class="mobile-no-device" role="status">
    <p>Open Spotify on your phone and play any song to activate it, then tap Refresh.</p>
    <button class="mobile-refresh-btn" onclick={pickMobileDevice} disabled={mobileDeviceRefreshing}>
      {mobileDeviceRefreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>
{/if}

{#if sdkReconnecting}
  <div class="status-chip" role="status" aria-live="polite">Reconnecting playback…</div>
{/if}

{#if resumePausedChip}
  <button type="button" class="status-chip resume-chip" onclick={handlePlayPause} aria-label="Tap to resume">
    Tap to resume
  </button>
{/if}

{#if showDevicePicker}
  <DevicePicker
    {code}
    activeDeviceId={selectedDevice?.id ?? null}
    incomingError={pickerError}
    onDeviceSelected={handleDeviceSelected}
    onClose={() => { showDevicePicker = false }}
    {sdkFailed}
  />
{/if}

{#if isRoundConfigOpen}
  <RoundConfigOverlay
    {code}
    initialHostName={hostName}
    roundActive={game.tiles.length > 0 && game.winData === null}
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
    onStartNewRound={handleStartNewRound}
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
    activeDeviceName={selectedDevice?.name ?? null}
    onOpenDevicePicker={() => handleOpenDevicePicker('settings')}
    {deviceSwitchResult}
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

  .reconnecting-chip {
    position: fixed;
    top: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg-muted);
    padding: var(--space-1) var(--space-3);
    font-size: 12px;
    z-index: 210;
    letter-spacing: 0.04em;
  }

  .info-toast {
    position: fixed;
    top: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    padding: var(--space-2) var(--space-4);
    font-size: 13px;
    z-index: 190;
    max-width: calc(100vw - 32px);
    text-align: center;
    animation: info-toast-fade 0.2s ease-out;
  }
  @keyframes info-toast-fade {
    from { opacity: 0; transform: translate(-50%, -4px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }

  .status-chip {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    padding: var(--space-1) var(--space-3);
    font-size: 13px;
    z-index: 25;
    letter-spacing: 0.04em;
  }
  .resume-chip {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
    cursor: pointer;
    min-height: 36px;
  }
  .resume-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .mobile-no-device {
    position: fixed;
    bottom: 80px;
    left: 16px;
    right: 16px;
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    padding: var(--space-3);
    font-size: 14px;
    z-index: 25;
    text-align: center;
  }
  .mobile-no-device p { margin: 0 0 var(--space-2); }
  .mobile-refresh-btn {
    min-height: 44px;
    padding: 0 var(--space-4);
    background: var(--accent);
    color: var(--accent-fg);
    border: var(--rule-thin) solid var(--accent);
    font-weight: 600;
    cursor: pointer;
  }
  .mobile-refresh-btn:disabled { opacity: 0.4; cursor: default; }
  .mobile-refresh-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
    padding: 80px 8px 64px;
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
