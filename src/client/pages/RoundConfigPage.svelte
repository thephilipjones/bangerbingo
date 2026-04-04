<script lang="ts">
  import { copyRoomCode } from '../lib/ws.ts'

  let { code }: { code: string } = $props()

  let copied = $state(false)

  async function handleCopyCode() {
    try {
      await copyRoomCode(code)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      // clipboard unavailable — no UI change
    }
  }
</script>

<header class="round-config-header">
  <button class="room-code" onclick={handleCopyCode} aria-label="Copy room code">
    {code}
    {#if copied}
      <span class="copied-tooltip">Copied!</span>
    {/if}
  </button>
</header>

<div class="round-config-page">
  <h1>Round config (Epic 4)</h1>
</div>

<style>
  .round-config-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    padding: 0.75rem 1.5rem;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
  }

  .room-code {
    font-size: 2rem; /* 32px */
    font-family: monospace;
    font-weight: 700;
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    position: relative;
    letter-spacing: 0.1em;
    padding: 0;
  }

  .room-code:hover {
    color: #1db954;
  }

  .copied-tooltip {
    position: absolute;
    bottom: -1.5rem;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.75rem;
    font-family: sans-serif;
    font-weight: 400;
    color: #1db954;
    white-space: nowrap;
  }

  .round-config-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: sans-serif;
    padding-top: 4rem;
  }
</style>
