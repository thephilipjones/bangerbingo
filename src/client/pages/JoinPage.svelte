<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import { connectAsGuest, sanitizeCode, validateJoin } from '../lib/ws.ts'
  import { getStoredGuestName, setStoredGuestName } from '../lib/guestName.ts'
  import Logo from '../lib/components/Logo.svelte'
  import Button from '../lib/components/Button.svelte'
  import Panel from '../lib/components/Panel.svelte'
  import ThemeToggle from '../lib/components/ThemeToggle.svelte'

  let { prefillCode = '', onJoined, onHostLogin }: {
    prefillCode?: string
    onJoined: (
      name: string,
      role: string,
      players: string[],
      hostName: string | null,
      winsByName: Record<string, number>,
      lastRoundWinner: string | null,
      continuousMode: boolean,
      countdownRemainingMs: number | null,
      code: string,
      ws: WebSocket,
      pending: MessageEvent[],
      casualModeNames: string[],
    ) => void
    onHostLogin: () => void
  } = $props()

  let name = $state(untrack(() => getStoredGuestName()))
  let code = $state(untrack(() => prefillCode))
  let nameError = $state('')
  let codeError = $state('')
  const autoRejoining = untrack(() => !!(prefillCode && name))
  let autoRejoinFailed = $state(false)
  let connecting = $state(false)
  let nameInput: HTMLInputElement | undefined = $state()
  let activeWs: WebSocket | undefined
  let bufferedMessages: MessageEvent[] = []

  onMount(() => {
    if (prefillCode && name) {
      handleSubmit(new Event('submit'))
    } else {
      nameInput?.focus()
    }
  })

  onDestroy(() => {
    activeWs?.close()
  })

  function handleCodeInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const sanitized = sanitizeCode(input.value)
    code = sanitized
    input.value = sanitized
  }

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (connecting) return
    nameError = ''
    codeError = ''

    const errors = validateJoin(name, code)
    if (errors.nameError) {
      nameError = errors.nameError
      return
    }
    if (errors.codeError) {
      codeError = errors.codeError
      return
    }

    connecting = true
    bufferedMessages = []
    activeWs = connectAsGuest(name, code, {
      onConnect(role, players, hostName, winsByName, lastRoundWinner, continuousMode, countdownRemainingMs, casualModeNames) {
        connecting = false
        const handedOff = activeWs!
        const pending = bufferedMessages
        activeWs = undefined
        bufferedMessages = []
        setStoredGuestName(name)
        onJoined(name, role, players, hostName, winsByName, lastRoundWinner, continuousMode, countdownRemainingMs, code, handedOff, pending, casualModeNames)
      },
      onError(message) {
        connecting = false
        autoRejoinFailed = true
        if (message === 'That name is already taken') {
          nameError = message
        } else {
          codeError = message
        }
      },
      onMessage(event) {
        bufferedMessages.push(event)
      },
    })
  }
</script>

<div class="join-page" class:hidden={autoRejoining && !autoRejoinFailed}>
  <header class="top-bar">
    <Logo size={28} variant="mark-only" />
    <div class="top-bar__actions">
      <ThemeToggle />
      <Button variant="ghost" size="sm" onclick={onHostLogin} disabled={connecting}>Host Login</Button>
    </div>
  </header>

  <main class="hero">
    <div class="hero__mark">
      <Logo size={96} variant="wordmark-only" />
    </div>
    <p class="tagline">All bangers, cause why would you listen to anything else.</p>

    <Panel>
      <form onsubmit={handleSubmit} class="form">
        <div class="field">
          <label for="name-input" class="u-small">Your name</label>
          <input
            id="name-input"
            type="text"
            bind:value={name}
            bind:this={nameInput}
            autocomplete="off"
            aria-describedby={nameError ? 'name-error' : undefined}
          />
          {#if nameError}
            <p class="error u-small" id="name-error">{nameError}</p>
          {/if}
        </div>

        <div class="field">
          <label for="code-input" class="u-small">
            Room code
            {#if prefillCode}
              <span class="lock" aria-label="locked">🔒</span>
            {/if}
          </label>
          {#if prefillCode}
            <input
              id="code-input"
              type="text"
              value={code}
              readonly
              class="mono"
              aria-describedby={codeError ? 'code-error' : undefined}
            />
          {:else}
            <input
              id="code-input"
              type="text"
              value={code}
              oninput={handleCodeInput}
              maxlength={4}
              class="mono"
              aria-describedby={codeError ? 'code-error' : undefined}
            />
          {/if}
          {#if codeError}
            <p class="error u-small" id="code-error">{codeError}</p>
          {/if}
        </div>

        <Button type="submit" variant="primary" size="lg" disabled={connecting}>
          {connecting ? 'Joining…' : "I'm in"}
        </Button>
      </form>
    </Panel>
  </main>

</div>

<style>
  .join-page.hidden {
    display: none;
  }

  .join-page {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-body);
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: var(--rule-thick) solid var(--rule);
  }
  .top-bar__actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-7) var(--space-5);
    max-width: 640px;
    width: 100%;
    margin: 0 auto;
  }

  .hero__mark {
    display: flex;
    justify-content: center;
  }

  .tagline {
    font-family: var(--font-body);
    font-size: 20px;
    line-height: 1.4;
    text-align: center;
    max-width: 36ch;
    color: var(--fg);
    margin: 0;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    min-width: 280px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  label {
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  input {
    background: var(--bg);
    border: var(--rule-thin) solid var(--rule);
    border-radius: var(--radius-0);
    color: var(--fg);
    font-size: 22px;
    padding: 0 var(--space-5);
    min-height: 60px;
    width: 100%;
  }
  input.mono {
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    font-size: 22px;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  input[readonly] {
    opacity: 0.7;
    cursor: default;
  }

  .error {
    color: var(--danger);
    margin: 0;
  }

  .lock {
    font-size: 0.75rem;
  }

  @media (min-width: 768px) {
    .top-bar { padding: var(--space-5) var(--space-7); }
    .hero {
      gap: var(--space-6);
      padding: var(--space-8) var(--space-7);
    }
    .form { gap: var(--space-5); }
  }

</style>
