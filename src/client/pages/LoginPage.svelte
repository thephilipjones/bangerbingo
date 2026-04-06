<script lang="ts">
  import { onMount } from 'svelte'
  import { getMe } from '../lib/api.ts'

  let { onAuthenticated }: { onAuthenticated: () => void } = $props()

  const params = new URLSearchParams(window.location.search)
  const loginError = params.get('error')

  onMount(async () => {
    try {
      const me = await getMe()
      if (me) onAuthenticated()
    } catch {
      // session check failed — stay on login page
    }
  })
</script>

<div class="login-page">
  <h1>BangerBingo</h1>
  <a href="/auth/login" class="connect-btn">Connect Spotify</a>
  {#if loginError}
    <p class="error">Login failed. Please try again.</p>
  {/if}
  <p class="ios-disclaimer">⚠ Use desktop Chrome or Firefox for audio</p>
</div>

<style>
  .login-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    gap: 1rem;
    font-family: sans-serif;
  }

  .connect-btn {
    display: inline-block;
    background: #1db954;
    color: #000;
    padding: 0.75rem 2rem;
    border-radius: 2rem;
    text-decoration: none;
    font-weight: 600;
    font-size: 1rem;
  }

  .connect-btn:hover {
    background: #1ed760;
  }

  .ios-disclaimer {
    font-size: 0.75rem;
    color: #888;
    margin-top: 0.5rem;
  }

  .error {
    color: #e74c3c;
    font-size: 0.875rem;
  }
</style>
