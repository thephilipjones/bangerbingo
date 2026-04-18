<script lang="ts">
  let { onReauth }: { onReauth: () => void } = $props()
</script>

<div class="banner" role="alert">
  <span class="message">Spotify auth expired — playback may stop</span>
  <button class="reauth-btn" onclick={onReauth}>Re-authenticate →</button>
</div>

<style>
  .banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 210;
    background: var(--danger);
    color: var(--accent-fg);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    font-size: 14px;
    flex-wrap: wrap;
  }

  .message {
    flex: 1;
    min-width: 0;
  }

  .reauth-btn {
    background: var(--accent-fg);
    color: var(--danger);
    border: var(--rule-thin) solid var(--accent-fg);
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    min-height: 44px;
    min-width: 44px;
  }
  .reauth-btn:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }

  .reauth-btn:hover {
    background: var(--bg-2);
  }
</style>
