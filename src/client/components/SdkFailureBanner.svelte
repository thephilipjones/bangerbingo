<script lang="ts">
  let { onPickDevice }: { onPickDevice: () => void } = $props()
</script>

<div class="sdk-failure-banner" role="alert">
  <span class="msg">Browser playback unavailable — pick a device to play on</span>
  <button type="button" class="pick-btn" onclick={onPickDevice}>Pick a device</button>
</div>

<style>
  .sdk-failure-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: var(--danger);
    color: var(--accent-fg);
    padding: 8px 16px;
    text-align: center;
    z-index: 190;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .msg {
    font-weight: 500;
  }

  .pick-btn {
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    min-height: 36px;
    padding: 6px 12px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
  }
  .pick-btn:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
</style>
