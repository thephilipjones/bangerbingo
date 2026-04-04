<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let { name, ws }: { name: string; ws: WebSocket } = $props()

  let hostDisconnected = $state(false)

  onMount(() => {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'host:disconnected') {
          hostDisconnected = true
        } else if (data.type === 'host:reconnected') {
          hostDisconnected = false
        }
      } catch {
        // ignore unparseable messages
      }
    }
  })

  onDestroy(() => {
    ws.close()
  })
</script>

{#if hostDisconnected}
  <div class="host-disconnected-banner" role="status">
    Host disconnected — waiting for them to reconnect…
  </div>
{/if}
<main class="room-page">
  <p>Welcome, {name}! Waiting for the host to start a round...</p>
</main>

<style>
  .host-disconnected-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #ff6b35;
    color: #fff;
    padding: 8px 16px;
    text-align: center;
    z-index: 100;
    font-size: 14px;
    font-family: sans-serif;
  }

  .room-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: sans-serif;
  }
</style>
