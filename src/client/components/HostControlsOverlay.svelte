<script lang="ts">
  import AdvancedSettings from './AdvancedSettings.svelte'
  import type { AudioPreset } from '../lib/api.ts'
  import type { TitleRevealDelay } from '../lib/bingo.ts'

  type ClipDuration = number | 'full'

  let {
    code,
    onClose,
    onStartNewRound,
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
    activeDeviceName = null,
    onOpenDevicePicker = undefined,
    deviceSwitchResult = null,
  }: {
    code: string
    onClose: () => void
    onStartNewRound: () => void
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
    activeDeviceName?: string | null
    onOpenDevicePicker?: () => void
    deviceSwitchResult?: 'saved' | 'error' | null
  } = $props()
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
          {activeDeviceName}
          {onOpenDevicePicker}
          {deviceSwitchResult}
        />
      </section>
    {:else}
      <p class="idle-msg">No round active.</p>
    {/if}
  </div>

  <footer class="sheet-footer">
    <button class="footer-nav" onclick={onHostManagement}>← Sessions</button>
    {#if roundActive}
      <button class="footer-danger" onclick={onStartNewRound}>Start a New Round</button>
    {/if}
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
  .footer-nav:hover { color: var(--fg); }
  .footer-nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .footer-danger {
    background: none;
    border: var(--rule-thin) solid var(--danger);
    color: var(--danger);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0.4rem 0.9rem;
    min-height: 36px;
    white-space: nowrap;
  }
  .footer-danger:hover {
    background: var(--danger);
    color: var(--accent-fg);
  }
  .footer-danger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
      border: var(--rule-thick) solid var(--rule);
      box-shadow: var(--shadow-overlay);
    }
  }
</style>
