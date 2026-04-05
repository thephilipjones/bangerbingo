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
    background: #c0392b;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    font-family: sans-serif;
    font-size: 14px;
    flex-wrap: wrap;
  }

  .message {
    flex: 1;
    min-width: 0;
  }

  .reauth-btn {
    background: #fff;
    color: #c0392b;
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 700;
    font-family: sans-serif;
    cursor: pointer;
    white-space: nowrap;
    min-height: 44px;
    min-width: 44px;
  }

  .reauth-btn:hover {
    background: #f0f0f0;
  }
</style>
