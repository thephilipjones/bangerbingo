<script lang="ts">
  import { DeviceMobile, SpeakerHigh, Desktop, MusicNote, SpeakerSlash } from 'phosphor-svelte'

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
  <span class="chip-icon" aria-hidden="true">
    {#if !selectedDevice}
      <SpeakerSlash size={18} />
    {:else if selectedDevice.type === 'Smartphone'}
      <DeviceMobile size={18} />
    {:else if selectedDevice.type === 'Speaker'}
      <SpeakerHigh size={18} />
    {:else if selectedDevice.type === 'Computer'}
      <Desktop size={18} />
    {:else}
      <MusicNote size={18} />
    {/if}
  </span>
  {#if selectedDevice}
    <span class="chip-label">{selectedDevice.name}</span>
  {/if}
</button>

<style>
  .device-chip {
    width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 0;
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
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

  @media (min-width: 768px) {
    .device-chip {
      width: auto;
      max-width: 160px;
      gap: 6px;
      padding: 0 12px;
    }

    .chip-label {
      display: inline;
    }
  }
</style>
