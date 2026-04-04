<script lang="ts">
  import { onMount } from 'svelte'
  import LoginPage from './pages/LoginPage.svelte'
  import JoinPage from './pages/JoinPage.svelte'
  import RoomPage from './pages/RoomPage.svelte'
  import { getMe } from './lib/api.ts'
  import { sanitizeCode } from './lib/ws.ts'

  type Page = 'loading' | 'login' | 'join' | 'dashboard' | 'room'

  let page: Page = $state('loading')
  let prefillCode = $state('')
  let guestName = $state('')

  onMount(async () => {
    const path = window.location.pathname
    const roomMatch = path.match(/^\/room\/([A-Za-z]{4})$/)

    const me = await getMe().catch(() => null)

    if (me) {
      page = 'dashboard'
    } else if (roomMatch) {
      prefillCode = sanitizeCode(roomMatch[1])
      page = 'join'
    } else {
      page = 'join'
    }
  })

  function handleAuthenticated() {
    page = 'dashboard'
  }

  function handleJoined(name: string, _role: string, _players: string[]) {
    guestName = name
    page = 'room'
  }
</script>

{#if page === 'loading'}
  <!-- intentionally blank while checking session -->
{:else if page === 'login'}
  <LoginPage onAuthenticated={handleAuthenticated} />
{:else if page === 'join'}
  <JoinPage {prefillCode} onJoined={handleJoined} />
{:else if page === 'dashboard'}
  <div class="dashboard">
    <h1>Dashboard (coming soon)</h1>
  </div>
{:else if page === 'room'}
  <RoomPage name={guestName} />
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

  .dashboard {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: sans-serif;
  }
</style>
