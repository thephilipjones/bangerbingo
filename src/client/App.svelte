<script lang="ts">
  import { onMount } from 'svelte'
  import LoginPage from './pages/LoginPage.svelte'
  import JoinPage from './pages/JoinPage.svelte'
  import RoomPage from './pages/RoomPage.svelte'
  import DashboardPage from './pages/DashboardPage.svelte'
  import LobbyPage from './pages/LobbyPage.svelte'
  import HostRoomPage from './pages/HostRoomPage.svelte'
  import { getMe } from './lib/api.ts'
  import { determineInitialPage, type Page } from './lib/ws.ts'
  import { setStoredGuestName } from './lib/guestName.ts'

  let page: Page = $state('loading')
  let prefillCode = $state('')
  let guestName = $state('')
  let guestRoomCode = $state('')
  let guestWs: WebSocket | null = $state(null)
  let guestPlayers = $state<string[]>([])
  let guestHostName = $state<string | null>(null)
  let guestWinsByName = $state<Record<string, number>>({})
  let guestLastRoundWinner = $state<string | null>(null)
  let guestCasualModeNames = $state<string[]>([])
  let guestPendingMessages = $state<MessageEvent[]>([])
  let currentRoomCode = $state('')

  onMount(async () => {
    const me = await getMe().catch(() => null)
    const result = determineInitialPage(me, window.location.pathname)
    prefillCode = result.prefillCode ?? ''
    if (result.roomCode) currentRoomCode = result.roomCode
    page = result.page
  })

  function handleAuthenticated() {
    history.pushState(null, '', '/host')
    page = 'dashboard'
  }

  function handleHostLogin() {
    page = 'login'
  }

  function handleJoinAsGuest(code?: string) {
    prefillCode = code ?? ''
    history.pushState(null, '', code ? `/${code}` : '/')
    page = 'join'
  }

  function handleJoined(
    name: string,
    _role: string,
    players: string[],
    hostName: string | null,
    winsByName: Record<string, number>,
    lastRoundWinner: string | null,
    code: string,
    ws: WebSocket,
    pending: MessageEvent[],
    casualModeNames: string[],
  ) {
    guestName = name
    guestRoomCode = code
    history.pushState(null, '', `/${code}`)
    guestWs = ws
    guestPlayers = players
    guestHostName = hostName
    guestWinsByName = winsByName
    guestLastRoundWinner = lastRoundWinner
    guestCasualModeNames = casualModeNames
    guestPendingMessages = pending
    page = 'room'
  }

  function handleEnterLobby(code: string) {
    currentRoomCode = code
    history.pushState(null, '', `/${code}`)
    page = 'lobby'
  }

  function handleRoundStarted() {
    page = 'hostroom'
  }

  function handleRoundEnded() {
    page = 'lobby'
  }

  function handleSessionEnded() {
    history.pushState(null, '', '/host')
    page = 'dashboard'
  }

  function handleBackToDashboard() {
    history.pushState(null, '', '/host')
    page = 'dashboard'
  }

  function handleGuestRename(newName: string) {
    guestName = newName
    setStoredGuestName(newName)
  }

  function handleGuestLeave() {
    if (guestWs?.readyState === WebSocket.OPEN) {
      guestWs.send(JSON.stringify({ type: 'guest:leave' }))
    }
    prefillCode = ''
    history.pushState(null, '', '/')
    page = 'join'
  }
</script>

{#if page === 'loading'}
  <!-- intentionally blank while checking session -->
{:else if page === 'login'}
  <LoginPage onAuthenticated={handleAuthenticated} />
{:else if page === 'join'}
  <JoinPage {prefillCode} onJoined={handleJoined} onHostLogin={handleHostLogin} />
{:else if page === 'dashboard'}
  <DashboardPage onEnterLobby={handleEnterLobby} onJoinAsGuest={() => handleJoinAsGuest()} />
{:else if page === 'lobby'}
  <LobbyPage code={currentRoomCode} onRoundStarted={handleRoundStarted} onBackToDashboard={handleBackToDashboard} onJoinAsGuest={handleJoinAsGuest} />
{:else if page === 'room'}
  <RoomPage name={guestName} code={guestRoomCode} ws={guestWs!} initialPlayers={guestPlayers} hostName={guestHostName} initialWinsByName={guestWinsByName} initialLastRoundWinner={guestLastRoundWinner} initialCasualModeNames={guestCasualModeNames} pendingMessages={guestPendingMessages} onLeave={handleGuestLeave} onSelfRename={handleGuestRename} />
{:else if page === 'hostroom'}
  <HostRoomPage code={currentRoomCode} onRoundEnded={handleRoundEnded} onSessionEnded={handleSessionEnded} />
{/if}

