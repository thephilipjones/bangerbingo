<script lang="ts">
  let { trackId }: { trackId: string | null } = $props()
</script>

<div class="sdk-failure-banner" role="alert">
  <span>Spotify audio unavailable in this browser.</span>
  {#if trackId}
    <a href="spotify:track:{trackId}" class="open-link">Open in Spotify app</a>
  {:else}
    <a href="https://open.spotify.com" class="open-link">Open Spotify</a>
  {/if}
  <span class="hint">Open in the Spotify app to follow along.</span>
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

  .open-link {
    color: var(--accent-fg);
    font-weight: 600;
    text-decoration: underline;
  }

  .hint {
    font-size: 13px;
    opacity: 0.85;
  }
</style>
