<script lang="ts">
  import { onDestroy } from 'svelte'
  import { getDevices } from '../lib/api.ts'
  import type { SpotifyDevice } from '../lib/api.ts'

  let {
    code,
    activeDeviceId,
    incomingError,
    onDeviceSelected,
    onClose,
    returnFocusEl,
    sdkFailed = false,
  }: {
    code: string
    activeDeviceId: string | null
    incomingError: string | null
    onDeviceSelected: (device: SpotifyDevice) => void
    onClose: () => void
    returnFocusEl?: HTMLElement
    sdkFailed?: boolean
  } = $props()

  type FetchState = 'loading' | 'ok' | 'error'
  let fetchState = $state<FetchState>('loading')
  let devices = $state<SpotifyDevice[]>([])
  let inlineError = $state<string | null>(null)
  let errorTimer: ReturnType<typeof setTimeout> | undefined
  let fetchController: AbortController | undefined
  let mounted = true

  async function loadDevices() {
    fetchController?.abort()
    fetchController = new AbortController()
    const ctrl = fetchController
    fetchState = 'loading'
    try {
      const result = await getDevices(code, ctrl.signal)
      if (!mounted || ctrl.signal.aborted) return
      devices = (result.devices ?? []).filter(d => d.id !== null)
      fetchState = 'ok'
    } catch (err) {
      if (!mounted || (err instanceof DOMException && err.name === 'AbortError')) return
      fetchState = 'error'
    }
  }

  $effect(() => {
    loadDevices()
  })

  $effect(() => {
    if (incomingError) {
      inlineError = incomingError
      clearTimeout(errorTimer)
      errorTimer = setTimeout(() => { inlineError = null }, 3000)
    }
  })

  function handleRowClick(device: SpotifyDevice) {
    if (device.is_restricted || device.id === null) return
    if (device.id === activeDeviceId) {
      onClose()
      return
    }
    onDeviceSelected(device)
    onClose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  function handleClose() {
    onClose()
  }

  function deviceIcon(type: string): string {
    if (type === 'Smartphone') return '📱'
    if (type === 'Speaker') return '🔊'
    if (type === 'Computer') return '💻'
    return '🎵'
  }

  onDestroy(() => {
    mounted = false
    fetchController?.abort()
    clearTimeout(errorTimer)
    if (returnFocusEl?.isConnected) returnFocusEl.focus()
  })
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div class="overlay" role="presentation" onclick={handleClose}></div>

<!-- Sheet -->
<div class="sheet" role="dialog" aria-labelledby="device-picker-title" aria-modal="true">
  <header class="sheet-header">
    <span class="sheet-title" id="device-picker-title">Playback Device</span>
    <div class="header-actions">
      <button
        class="refresh-btn"
        onclick={loadDevices}
        disabled={fetchState === 'loading'}
      >↺ Refresh</button>
      <button class="close-btn" onclick={handleClose} aria-label="Close">×</button>
    </div>
  </header>

  <div class="sheet-body">
    {#if inlineError}
      <p class="inline-error" role="alert">{inlineError}</p>
    {/if}

    {#if fetchState === 'loading'}
      <p class="status-msg" role="status">Loading devices…</p>
    {:else if fetchState === 'error'}
      <p class="status-msg error-msg" role="alert">Couldn't load devices — tap Refresh to retry.</p>
    {:else if devices.length === 0}
      {#if sdkFailed}
        <div class="status-msg onboarding" role="status">
          <p class="onboarding-heading">No Spotify devices found.</p>
          <ol class="onboarding-steps">
            <li>Open the Spotify app on your phone.</li>
            <li>Press play on any song.</li>
            <li>Come back here and tap Refresh.</li>
          </ol>
        </div>
      {:else}
        <p class="status-msg" role="status">No Spotify devices found. Open your Spotify app and press play on any song, then tap Refresh.</p>
      {/if}
    {:else}
      <ul class="device-list" role="listbox" aria-label="Available devices">
        {#each devices as device (device.id)}
          <li
            role="option"
            aria-selected={device.id === activeDeviceId}
            aria-disabled={device.is_restricted}
            class="device-row"
            class:active={device.id === activeDeviceId}
            class:restricted={device.is_restricted}
            tabindex={device.is_restricted ? -1 : 0}
            onclick={() => handleRowClick(device)}
            onkeydown={(e) => {
              if (device.is_restricted) return
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(device) }
            }}
          >
            <span class="device-icon" aria-hidden="true">{deviceIcon(device.type)}</span>
            <span class="device-name">{device.name}</span>
            {#if device.id === activeDeviceId}
              <span class="check-mark" aria-hidden="true">✓</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 155;
  }

  .sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 80vh;
    z-index: 156;
    background: var(--bg);
    border-top: var(--rule-thick) solid var(--rule);
    display: flex;
    flex-direction: column;
    color: var(--fg);
  }

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 1.15rem 0.5rem 0.95rem 1.25rem;
    border-bottom: var(--rule-thin) solid var(--rule);
    flex-shrink: 0;
  }

  .sheet-title {
    color: var(--fg);
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--track-display);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .refresh-btn {
    background: none;
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg-muted);
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.3rem 0.6rem;
    min-height: 44px;
    min-width: 44px;
  }
  @media (hover: hover) {
    .refresh-btn:hover:not(:disabled) { color: var(--fg); border-color: var(--fg); }
    .close-btn:hover { color: var(--fg); }
  }
  .refresh-btn:disabled { opacity: 0.4; cursor: default; }
  .refresh-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 0;
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .close-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .sheet-body {
    overflow-y: auto;
    flex: 1;
    padding: 0.5rem 0;
  }

  .status-msg {
    color: var(--fg-muted);
    font-size: 0.9rem;
    text-align: center;
    padding: 1.5rem 1.25rem;
    margin: 0;
  }

  .error-msg {
    color: var(--danger);
  }

  .onboarding {
    text-align: left;
  }
  .onboarding-heading {
    margin: 0 0 0.5rem;
    text-align: left;
  }
  .onboarding-steps {
    margin: 0;
    padding-left: 1.4rem;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .onboarding-steps li {
    margin-bottom: 0.25rem;
  }

  .inline-error {
    color: var(--danger);
    font-size: 0.85rem;
    padding: 0.5rem 1.25rem;
    margin: 0;
    border-bottom: var(--rule-thin) solid var(--rule);
  }

  .device-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .device-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 1.25rem;
    min-height: 56px;
    cursor: pointer;
    border-bottom: var(--rule-thin) solid var(--rule);
  }
  .device-row:last-child { border-bottom: none; }
  @media (hover: hover) {
    .device-row:hover:not(.restricted) { background: var(--bg-2); }
  }

  .device-row.active {
    background: var(--bg-2);
  }

  .device-row.restricted {
    cursor: default;
    opacity: 0.4;
  }

  .device-icon {
    font-size: 1.2rem;
    flex-shrink: 0;
  }

  .device-name {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .check-mark {
    color: var(--accent);
    font-size: 1rem;
    flex-shrink: 0;
  }

  @media (min-width: 768px) {
    .overlay {
      background: transparent;
    }

    .sheet {
      bottom: 72px;
      top: auto;
      right: 8px;
      left: auto;
      height: auto;
      max-height: 70vh;
      width: 360px;
      border: var(--rule-thick) solid var(--rule);
      box-shadow: var(--shadow-overlay);
    }
  }
</style>
