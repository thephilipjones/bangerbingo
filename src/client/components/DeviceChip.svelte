<script lang="ts">
  import { DeviceMobile, SpeakerHigh, Desktop, MusicNote, CaretDown } from 'phosphor-svelte'

  let {
    selectedDevice,
    onclick,
    expanded = false,
  }: {
    selectedDevice: { id: string; name: string; type: string } | null
    onclick: () => void
    expanded?: boolean
  } = $props()
</script>

<button
  class="device-chip"
  {onclick}
  aria-label={selectedDevice ? `Playback device: ${selectedDevice.name}` : 'Pick a playback device'}
  aria-haspopup="dialog"
  aria-expanded={expanded}
>
  {#if selectedDevice}
    <span class="chip-icon" aria-hidden="true">
      {#if selectedDevice.type === 'Smartphone'}
        <DeviceMobile size={16} />
      {:else if selectedDevice.type === 'Speaker'}
        <SpeakerHigh size={16} />
      {:else if selectedDevice.type === 'Computer'}
        <Desktop size={16} />
      {:else}
        <MusicNote size={16} />
      {/if}
    </span>
    <span class="chip-label">{selectedDevice.name}</span>
  {:else}
    <span class="chip-label chip-placeholder">Pick a device</span>
  {/if}
  <span class="chip-caret" aria-hidden="true"><CaretDown size={12} weight="fill" /></span>
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
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .chip-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: none;
  }

  .chip-caret {
    display: inline-flex;
    align-items: center;
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
