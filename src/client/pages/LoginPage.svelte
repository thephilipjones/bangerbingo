<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getMe } from '../lib/api.ts'
  import Logo from '../lib/components/Logo.svelte'
  import Button from '../lib/components/Button.svelte'
  import ThemeToggle from '../lib/components/ThemeToggle.svelte'

  let { onAuthenticated }: { onAuthenticated: () => void } = $props()

  type ErrorInfo = { message: string; showAllowlistRequest?: boolean }

  const errorMessages: Record<string, ErrorInfo> = {
    spotify_denied: {
      message:
        'BangerBingo is in private beta — Philip needs to add your Spotify account to the allowlist before you can log in.',
      showAllowlistRequest: true,
    },
    missing_verifier: {
      message: 'Login timed out. Click Connect Spotify to start over.',
    },
    token_exchange_failed: {
      message: "Spotify login didn't complete. Try again.",
    },
    me_fetch_failed: {
      message: "Couldn't reach Spotify to confirm your account. Check your connection and try again.",
    },
    server_error: {
      message: 'Something went wrong on our end. Try again in a moment.',
    },
  }

  const params = new URLSearchParams(window.location.search)
  const errorCode = params.get('error')
  const errorInfo: ErrorInfo | null = errorCode
    ? errorMessages[errorCode] ?? { message: 'Login failed. Try again.' }
    : null

  const accessRequestMessage =
    'Hi Philip — please add me to the Bangerbingo Spotify allowlist.\n\n' +
    'Spotify display name (exactly as on my profile): \n' +
    'Email on my Spotify account: \n\n' +
    'Thanks!'

  let copied = $state(false)
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null

  async function copyAccessRequest() {
    try {
      await navigator.clipboard.writeText(accessRequestMessage)
      copied = true
      if (copyResetTimer) clearTimeout(copyResetTimer)
      copyResetTimer = setTimeout(() => { copied = false }, 2000)
    } catch {
      // clipboard blocked — no-op; user can still manually ping Philip
    }
  }

  onMount(async () => {
    try {
      const me = await getMe()
      if (me) onAuthenticated()
    } catch {
      // session check failed — stay on login page
    }
  })

  onDestroy(() => {
    if (copyResetTimer) clearTimeout(copyResetTimer)
  })
</script>

<div class="login-page">
  <div class="top-right">
    <ThemeToggle />
  </div>
  <Logo size={72} variant="full" />
  <div class="tagline">
    <p class="tagline-headline">Music bingo for your party.</p>
    <p class="tagline-sub">Host picks the playlist. Guests mark tiles. First to bingo wins.</p>
  </div>
  <Button variant="primary" size="lg" onclick={() => (window.location.href = '/auth/login')}>
    Connect Spotify
  </Button>
  {#if errorInfo}
    <div class="error-block">
      <p class="error u-small">{errorInfo.message}</p>
      {#if errorInfo.showAllowlistRequest}
        <Button variant="ghost" size="sm" onclick={copyAccessRequest}>
          {copied ? 'Copied — send to Philip' : 'Copy request message'}
        </Button>
      {/if}
    </div>
  {/if}
  <a href="/privacy" class="privacy-link">Privacy policy</a>
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

  .error-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 32rem;
    text-align: center;
  }

  .tagline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    text-align: center;
  }

  .tagline-headline {
    font-family: var(--font-display);
    font-size: 1.25rem;
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    margin: 0;
  }

  .tagline-sub {
    font-family: var(--font-body);
    font-size: 0.9rem;
    color: var(--fg-muted);
    margin: 0;
  }

  .error {
    color: var(--danger);
    margin: 0;
  }

  .privacy-link {
    position: absolute;
    bottom: var(--space-4);
    font-family: var(--font-body);
    font-size: 0.8rem;
    color: var(--fg-muted);
    text-decoration: none;
    opacity: 0.6;
  }

  .privacy-link:hover {
    opacity: 1;
  }

  @media (min-width: 768px) {
    .login-page {
      gap: var(--space-6);
      padding: var(--space-8);
    }
  }
</style>
