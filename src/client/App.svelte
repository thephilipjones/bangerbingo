<script lang="ts">
  import { onMount } from 'svelte'
  import LoginPage from './pages/LoginPage.svelte'
  import { getMe } from './lib/api.ts'

  type Page = 'loading' | 'login' | 'dashboard'

  let page: Page = $state('loading')

  onMount(async () => {
    const me = await getMe()
    if (me) {
      page = 'dashboard'
    } else {
      page = 'login'
    }
  })

  function handleAuthenticated() {
    page = 'dashboard'
  }
</script>

{#if page === 'loading'}
  <!-- intentionally blank while checking session -->
{:else if page === 'login'}
  <LoginPage onAuthenticated={handleAuthenticated} />
{:else if page === 'dashboard'}
  <div class="dashboard">
    <h1>Dashboard (coming soon)</h1>
  </div>
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
