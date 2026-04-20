<script lang="ts">
  let {
    selectedDevice,
    onclick,
    expanded = false,
  }: {
    selectedDevice: { id: string; name: string; type: string } | null
    onclick: () => void
    expanded?: boolean
  } = $props()

  function deviceIcon(type: string): string {
    if (type === 'Smartphone') return '📱'
    if (type === 'Speaker') return '🔊'
    if (type === 'Computer') return '💻'
    return '🎵'
  }
</script>

<button
  class="device-chip"
  {onclick}
  aria-label={selectedDevice ? `Playback device: ${selectedDevice.name}` : 'Pick a playback device'}
  aria-haspopup="dialog"
  aria-expanded={expanded}
>
  {#if selectedDevice}
    <span class="chip-icon" aria-hidden="true">{deviceIcon(selectedDevice.type)}</span>
    <span class="chip-label">{selectedDevice.name}</span>
  {:else}
    <span class="chip-label chip-placeholder">Pick a device</span>
  {/if}
  <span class="chip-caret" aria-hidden="true">▾</span>
</button>

<style>
  .device-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    min-width: 44px;
    padding: 0 8px;
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
  }
  .device-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .chip-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .chip-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: none;
  }

  .chip-caret {
    font-size: 11px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .chip-placeholder {
    font-size: 12px;
    color: var(--fg-muted);
    font-weight: 400;
  }

  @media (min-width: 768px) {
    .chip-label {
      display: inline;
    }

    .device-chip {
      max-width: 160px;
    }
  }
</style>
