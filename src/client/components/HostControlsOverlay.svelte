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
  <div class="sheet-header">
    <span class="sheet-title">Host Controls</span>
    <button class="close-btn" onclick={onClose} aria-label="Close controls">×</button>
  </div>
  <div class="sheet-body">
    {#if roundActive}
      <section class="round-settings" aria-label="Round Settings">
        <h3 class="section-title">Round Settings</h3>
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
      <div class="divider"></div>
    {/if}

    <button class="action-btn" onclick={handleEndRound} disabled={ending}>
      <span class="action-icon">↻</span> End Round
    </button>

    <button class="action-btn" onclick={() => { showConfirm = true }} disabled={ending}>
      <span class="action-icon">⏻</span> End Session
    </button>

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

    <div class="divider"></div>

    <button class="mgmt-link" onclick={onHostManagement}>
      <span class="action-icon">→</span> Host Management
    </button>
  </div>
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
    gap: 0.75rem;
  }

  .section-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--fg);
    margin: 0;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px;
    border-bottom: var(--rule-thin) solid var(--rule);
    flex-shrink: 0;
  }

  .sheet-title {
    color: var(--fg);
    font-size: 16px;
    font-weight: 700;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    min-width: 44px;
    min-height: 44px;
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
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .action-btn {
    background: var(--bg-2);
    color: var(--fg);
    border: var(--rule-thin) solid var(--rule);
    padding: 14px 16px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    min-height: 44px;
  }
  .action-btn:hover { background: var(--fg); color: var(--bg); }
  .action-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .action-icon {
    margin-right: 8px;
  }

  .confirm-dialog {
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    padding: 16px;
  }

  .confirm-title {
    color: var(--fg);
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 4px;
  }

  .confirm-sub {
    color: var(--fg-muted);
    font-size: 13px;
    margin: 0 0 12px;
  }

  .error-text {
    color: var(--danger);
    font-size: 13px;
    margin: 0 0 8px;
  }

  .confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .confirm-cancel,
  .confirm-end {
    min-width: 44px;
    min-height: 44px;
    border: var(--rule-thin) solid var(--rule);
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    padding: 0 16px;
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

  .divider {
    height: 1px;
    background: var(--rule);
    margin: 4px 0;
  }

  .mgmt-link {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 14px;
    cursor: pointer;
    text-align: left;
    padding: 10px 0;
    min-height: 44px;
  }
  .mgmt-link:hover { color: var(--fg); }
  .mgmt-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
      max-height: 60vh;
      width: 280px;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }

    .sheet-header {
      display: none;
    }
  }
</style>
