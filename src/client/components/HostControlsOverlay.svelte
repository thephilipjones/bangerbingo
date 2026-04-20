<script lang="ts">
  import AdvancedSettings from './AdvancedSettings.svelte'
  import type { AudioPreset } from '../lib/api.ts'
  import type { TitleRevealDelay } from '../lib/bingo.ts'

  type ClipDuration = number | 'full'

  let {
    code,
    onClose,
    onEndRound,
    onSessionEnded,
    onHostManagement,
    roundActive,
    clipDuration,
    titleRevealDelay,
    audioPreset,
    allowCasualMode,
    onClipDurationChange,
    onTitleRevealDelayChange,
    onAudioPresetChange,
    onAllowCasualModeChange,
  }: {
    code: string
    onClose: () => void
    onEndRound: () => void
    onSessionEnded: () => void
    onHostManagement: () => void
    roundActive: boolean
    clipDuration: ClipDuration
    titleRevealDelay: TitleRevealDelay
    audioPreset: AudioPreset
    allowCasualMode: boolean
    onClipDurationChange: (v: ClipDuration) => void
    onTitleRevealDelayChange: (v: TitleRevealDelay) => void
    onAudioPresetChange: (v: AudioPreset) => void
    onAllowCasualModeChange: (v: boolean) => void
  } = $props()

  let showConfirm = $state(false)
  let endSessionError = $state('')
  let ending = $state(false)

  function handleEndRound() {
    onEndRound()
    onClose()
  }

  async function handleEndSessionConfirm() {
    ending = true
    endSessionError = ''
    try {
      const res = await fetch(`/api/rooms/${code}`, { method: 'DELETE' })
      if (res.ok) {
        onSessionEnded()
      } else {
        endSessionError = 'Failed to end session — try again.'
        ending = false
      }
    } catch {
      endSessionError = 'Failed to end session — try again.'
      ending = false
    }
  }
</script>

<!-- Background overlay -->
<div class="overlay" role="presentation" onclick={onClose}></div>

<!-- Sheet -->
<div class="sheet" role="dialog" aria-label="Host controls">
  <header class="sheet-header">
    <span class="sheet-title">Host Controls</span>
    <button class="close-btn" onclick={onClose} aria-label="Close controls">×</button>
  </header>

  <div class="sheet-body">
    {#if roundActive}
      <section class="round-settings" aria-label="Round Settings">
        <AdvancedSettings
          mode="live"
          {code}
          {clipDuration}
          {titleRevealDelay}
          {audioPreset}
          {allowCasualMode}
          {onClipDurationChange}
          {onTitleRevealDelayChange}
          {onAudioPresetChange}
          {onAllowCasualModeChange}
        />
      </section>
    {:else}
      <p class="idle-msg">No round active.</p>
    {/if}

    {#if showConfirm}
      <div class="confirm-dialog">
        <p class="confirm-title">End this session for everyone?</p>
        <p class="confirm-sub">All players will be disconnected.</p>
        {#if endSessionError}
          <p class="error-text">{endSessionError}</p>
        {/if}
        <div class="confirm-actions">
          <button class="confirm-cancel" onclick={() => { showConfirm = false; endSessionError = '' }} disabled={ending}>Cancel</button>
          <button class="confirm-end" onclick={handleEndSessionConfirm} disabled={ending}>End Session</button>
        </div>
      </div>
    {/if}
  </div>

  <footer class="sheet-footer">
    <button class="footer-nav" onclick={onHostManagement} disabled={ending}>← Sessions</button>
    <div class="footer-danger-group">
      <button class="footer-danger" onclick={handleEndRound} disabled={ending || !roundActive}>End Round</button>
      <button class="footer-danger" onclick={() => { showConfirm = true }} disabled={ending}>End Session</button>
    </div>
  </footer>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 149;
  }

  .sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 80vh;
    z-index: 150;
    background: var(--bg);
    border-top: var(--rule-thick) solid var(--rule);
    display: flex;
    flex-direction: column;
    color: var(--fg);
  }

  .round-settings {
    display: flex;
    flex-direction: column;
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

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 0;
    width: 36px;
    height: 36px;
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .close-btn:hover { color: var(--fg); }
  .close-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .sheet-body {
    overflow-y: auto;
    flex: 1;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .idle-msg {
    color: var(--fg-muted);
    font-size: 0.9rem;
    text-align: center;
    margin: 0.5rem 0;
  }

  .confirm-dialog {
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    padding: 0.75rem;
  }

  .confirm-title {
    color: var(--fg);
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0 0 0.25rem;
  }

  .confirm-sub {
    color: var(--fg-muted);
    font-size: 0.8rem;
    margin: 0 0 0.6rem;
  }

  .error-text {
    color: var(--danger);
    font-size: 0.8rem;
    margin: 0 0 0.5rem;
  }

  .confirm-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .confirm-cancel,
  .confirm-end {
    min-width: 44px;
    min-height: 36px;
    border: var(--rule-thin) solid var(--rule);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0 0.85rem;
  }

  .confirm-cancel {
    background: var(--bg);
    color: var(--fg);
  }

  .confirm-end {
    background: var(--danger);
    color: var(--accent-fg);
    border-color: var(--danger);
  }

  .confirm-cancel:disabled,
  .confirm-end:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sheet-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-top: var(--rule-thin) solid var(--rule);
    flex-shrink: 0;
    background: var(--bg);
  }

  .footer-nav {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.4rem 0.5rem;
    min-height: 36px;
    white-space: nowrap;
  }
  .footer-nav:hover:not(:disabled) { color: var(--fg); }
  .footer-nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .footer-nav:disabled { opacity: 0.5; cursor: default; }

  .footer-danger-group {
    display: flex;
    gap: 0.5rem;
  }

  .footer-danger {
    background: none;
    border: var(--rule-thin) solid var(--danger);
    color: var(--danger);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0.4rem 0.75rem;
    min-height: 36px;
    white-space: nowrap;
  }
  .footer-danger:hover:not(:disabled) {
    background: var(--danger);
    color: var(--accent-fg);
  }
  .footer-danger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .footer-danger:disabled { opacity: 0.4; cursor: default; }

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
      width: 400px;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }
  }
</style>
