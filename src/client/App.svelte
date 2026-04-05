<script lang="ts">
  import { onMount } from 'svelte'
  import LoginPage from './pages/LoginPage.svelte'
  import JoinPage from './pages/JoinPage.svelte'
  import RoomPage from './pages/RoomPage.svelte'
  import DashboardPage from './pages/DashboardPage.svelte'
  import LobbyPage from './pages/LobbyPage.svelte'
  import RoundConfigPage from './pages/RoundConfigPage.svelte'
  import HostRoomPage from './pages/HostRoomPage.svelte'
  import { getMe } from './lib/api.ts'
  import { determineInitialPage, type Page } from './lib/ws.ts'

  let page: Page = $state('loading')
  let prefillCode = $state('')
  let guestName = $state('')
  let guestRoomCode = $state('')
  let guestWs: WebSocket | null = $state(null)
  let currentRoomCode = $state('')

  onMount(async () => {
    const me = await getMe().catch(() => null)
    const result = determineInitialPage(me, window.location.pathname)
    prefillCode = result.prefillCode ?? ''
    page = result.page
  })

  function handleAuthenticated() {
    page = 'dashboard'
  }

  function handleHostLogin() {
    page = 'login'
  }

  function handleJoined(name: string, _role: string, _players: string[], code: string, ws: WebSocket) {
    guestName = name
    guestRoomCode = code
    guestWs = ws
    page = 'room'
  }

  function handleEnterLobby(code: string) {
    currentRoomCode = code
    page = 'lobby'
  }

  function handleConfigureRound() {
    page = 'roundconfig'
  }

  function handleRoundStarted() {
    page = 'hostroom'
  }

  function handleRoundEnded() {
    page = 'lobby'
  }
</script>

{#if page === 'loading'}
  <!-- intentionally blank while checking session -->
{:else if page === 'login'}
  <LoginPage onAuthenticated={handleAuthenticated} />
{:else if page === 'join'}
  <JoinPage {prefillCode} onJoined={handleJoined} onHostLogin={handleHostLogin} />
{:else if page === 'dashboard'}
  <DashboardPage onEnterLobby={handleEnterLobby} />
{:else if page === 'lobby'}
  <LobbyPage code={currentRoomCode} onConfigureRound={handleConfigureRound} />
{:else if page === 'roundconfig'}
  <RoundConfigPage code={currentRoomCode} onRoundStarted={handleRoundStarted} />
{:else if page === 'room'}
  <RoomPage name={guestName} code={guestRoomCode} ws={guestWs!} />
{:else if page === 'hostroom'}
  <HostRoomPage code={currentRoomCode} onRoundEnded={handleRoundEnded} />
{/if}

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: #121212;
    color: #fff;
  }
</style>
