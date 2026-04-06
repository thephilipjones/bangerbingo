<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import { connectAsGuest, sanitizeCode, validateJoin } from '../lib/ws.ts'
  import { getStoredGuestName, setStoredGuestName } from '../lib/guestName.ts'

  let { prefillCode = '', onJoined, onHostLogin }: {
    prefillCode?: string
    onJoined: (name: string, role: string, players: string[], hostName: string | null, code: string, ws: WebSocket, pending: MessageEvent[]) => void
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
      // Auto-rejoin when waking up from a room URL with a stored name
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
      onConnect(role, players, hostName) {
        connecting = false
        const handedOff = activeWs!
        const pending = bufferedMessages
        activeWs = undefined // prevent onDestroy from closing the handed-off socket
        bufferedMessages = []
        setStoredGuestName(name)
        onJoined(name, role, players, hostName, code, handedOff, pending)
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
  <button type="button" class="host-login-btn" onclick={onHostLogin} disabled={connecting}>Host Login</button>
  <h1>BangerBingo</h1>
  <form onsubmit={handleSubmit}>
    <div class="field">
      <label for="name-input">Your name</label>
      <input
        id="name-input"
        type="text"
        bind:value={name}
        bind:this={nameInput}
        autocomplete="off"
        aria-describedby={nameError ? 'name-error' : undefined}
      />
      {#if nameError}
        <p class="error" id="name-error">{nameError}</p>
      {/if}
    </div>

    <div class="field">
      <label for="code-input">
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
          aria-describedby={codeError ? 'code-error' : undefined}
        />
      {:else}
        <input
          id="code-input"
          type="text"
          value={code}
          oninput={handleCodeInput}
          maxlength={4}
          aria-describedby={codeError ? 'code-error' : undefined}
        />
      {/if}
      {#if codeError}
        <p class="error" id="code-error">{codeError}</p>
      {/if}
    </div>

    <button type="submit" disabled={connecting}>
      {connecting ? 'Joining…' : 'Join'}
    </button>
  </form>
</div>

<style>
  .join-page.hidden {
    display: none;
  }

  .join-page {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: 1rem;
    font-family: sans-serif;
  }

  h1 {
    margin-bottom: 1rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 320px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  label {
    font-size: 0.875rem;
    color: #ccc;
  }

  input {
    background: #1e1e1e;
    border: 1px solid #444;
    border-radius: 0.375rem;
    color: #fff;
    font-size: 1rem;
    padding: 0 0.75rem;
    min-height: 44px;
    min-width: 44px;
    width: 100%;
  }

  input:focus {
    outline: 2px solid #1db954;
    outline-offset: 1px;
  }

  input[readonly] {
    opacity: 0.7;
    cursor: default;
  }

  button {
    background: #1db954;
    border: none;
    border-radius: 2rem;
    color: #000;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    min-height: 44px;
    min-width: 44px;
    padding: 0 2rem;
  }

  button:hover:not(:disabled) {
    background: #1ed760;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    color: #e74c3c;
    font-size: 0.8125rem;
    margin: 0;
  }

  .lock {
    font-size: 0.75rem;
  }

  .host-login-btn {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: transparent;
    border: 1px solid #444;
    border-radius: 1.25rem;
    color: #888;
    cursor: pointer;
    font-size: 0.8125rem;
    font-weight: 400;
    min-height: 44px;
    min-width: 44px;
    padding: 0 1rem;
  }

  .host-login-btn:hover:not(:disabled) {
    color: #ccc;
    border-color: #666;
  }

  .host-login-btn:focus-visible {
    outline: 2px solid #1db954;
    outline-offset: 2px;
  }

  .host-login-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
