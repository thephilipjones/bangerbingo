<script lang="ts">
  import { onMount } from 'svelte'
  import { getMe } from '../lib/api.ts'
  import Logo from '../lib/components/Logo.svelte'
  import Button from '../lib/components/Button.svelte'
  import ThemeToggle from '../lib/components/ThemeToggle.svelte'

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
  <div class="top-right">
    <ThemeToggle />
  </div>
  <Logo size={72} variant="full" />
  <Button variant="primary" size="lg" onclick={() => (window.location.href = '/auth/login')}>
    Connect Spotify
  </Button>
  {#if loginError}
    <p class="error u-small">Login failed. Try again.</p>
  {/if}
  <p class="disclaimer u-small">Use desktop Chrome or Firefox for audio</p>
</div>

<style>
  .login-page {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    gap: var(--space-5);
    padding: var(--space-6);
    background: var(--bg);
    color: var(--fg);
  }

  .top-right {
    position: absolute;
    top: var(--space-4);
    right: var(--space-5);
  }

  .disclaimer {
    color: var(--fg-muted);
    margin-top: var(--space-2);
  }

  .error {
    color: var(--danger);
    margin: 0;
  }

  @media (min-width: 768px) {
    .login-page {
      gap: var(--space-6);
      padding: var(--space-8);
    }
  }
</style>
