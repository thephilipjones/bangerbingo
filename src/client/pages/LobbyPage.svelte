<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { TRIVIA_FACTS, shuffle } from '../lib/trivia.ts'
  import { connectAsHost, applyPlayerEvent, copyRoomCode } from '../lib/ws.ts'
  import { getRooms } from '../lib/api.ts'
  import RoundConfigOverlay from '../components/RoundConfigOverlay.svelte'

  let {
    code,
    onRoundStarted,
  }: {
    code: string
    onRoundStarted: () => void
  } = $props()

  // ── Round Config Overlay ────────────────────────────────────────────────────
  let isConfigOpen = $state(false)
  let roomHostName = $state<string | null>(null)
  let hasEverOpenedConfig = $state(false)

  // ── Vinyl / header ──────────────────────────────────────────────────────────
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

  // ── Trivia cycling ──────────────────────────────────────────────────────────
  let facts = $state(shuffle([...TRIVIA_FACTS]))
  let factIndex = $state(0)
  let visible = $state(true)

  let triviaInterval: ReturnType<typeof setInterval>
  let triviaTimeout: ReturnType<typeof setTimeout>

  function advanceFact() {
    visible = false
    triviaTimeout = setTimeout(() => {
      factIndex = (factIndex + 1) % facts.length
      if (factIndex === 0) facts = shuffle([...TRIVIA_FACTS])
      visible = true
    }, 400)
  }

  // ── Player presence ─────────────────────────────────────────────────────────
  let players = $state<string[]>([])

  // ── Auth degraded banner ────────────────────────────────────────────────────
  let authDegraded = $state(false)
  let degradedDismissed = $state(false)

  // ── WS disconnected banner ──────────────────────────────────────────────────
  let wsDisconnected = $state(false)

  // ── WebSocket ───────────────────────────────────────────────────────────────
  let ws: WebSocket | null = null
  let cancelled = false

  onMount(() => {
    triviaInterval = setInterval(advanceFact, 12000)

    // Fetch host_name for this row; if unset and never opened, auto-open overlay.
    // Only auto-open when the row was actually found — treat missing row as no-op
    // (could be stale/deleted; don't erroneously pop the overlay).
    getRooms()
      .then((rooms) => {
        if (cancelled) return
        const row = rooms.find((r) => r.code === code)
        if (!row) return
        roomHostName = row.host_name ?? null
        if (roomHostName === null && !hasEverOpenedConfig) {
          isConfigOpen = true
          hasEverOpenedConfig = true
        }
      })
      .catch(() => {
        // fall-through safe default: leave roomHostName === null
      })

    ws = connectAsHost(code, {
      onConnect(initialPlayers, _hostName) {
        players = initialPlayers
      },
      onPlayerJoined(name) {
        players = applyPlayerEvent(players, { type: 'player:joined', name })
      },
      onPlayerLeft(name) {
        players = applyPlayerEvent(players, { type: 'player:left', name })
      },
      onAuthDegraded() {
        authDegraded = true
      },
      onDisconnected() {
        wsDisconnected = true
      },
    })
  })

  onDestroy(() => {
    cancelled = true
    clearInterval(triviaInterval)
    clearTimeout(triviaTimeout)
    ws?.close()
  })
</script>

<div class="lobby">
  <!-- Header: room code -->
  <header class="lobby-header">
    <button class="room-code" onclick={handleCopyCode} aria-label="Copy room code">
      {code}
      {#if copied}
        <span class="copied-tooltip">Copied!</span>
      {/if}
    </button>
    <span class="player-count">{players.length} player{players.length === 1 ? '' : 's'}</span>
  </header>

  <!-- WS disconnected banner -->
  {#if wsDisconnected}
    <p class="disconnected-banner">Connection lost — player list may be stale. Refresh to reconnect.</p>
  {/if}

  <!-- Auth degraded banner (stub for Epic 5) -->
  {#if authDegraded && !degradedDismissed}
    <p class="degraded-banner">
      Spotify session degraded — music may stop.
      <button onclick={() => (degradedDismissed = true)}>Dismiss</button>
    </p>
  {/if}

  <!-- Spinning vinyl -->
  <div class="vinyl" aria-hidden="true">
    <svg viewBox="0 0 80 80" width="80" height="80">
      <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#333" stroke-width="2" />
      <circle cx="40" cy="40" r="20" fill="#222" />
      <circle cx="40" cy="40" r="4" fill="#444" />
    </svg>
  </div>

  <!-- Trivia fact -->
  <p class="fact" class:visible>{facts[factIndex]}</p>

  <!-- Configure Round CTA -->
  <button class="configure-btn" onclick={() => { isConfigOpen = true; hasEverOpenedConfig = true }}>Configure Round →</button>
</div>

{#if isConfigOpen}
  <RoundConfigOverlay
    {code}
    initialHostName={roomHostName}
    onClose={() => (isConfigOpen = false)}
    onStarted={(name) => {
      if (name) roomHostName = name
      isConfigOpen = false
      onRoundStarted()
    }}
    onHostNameMaybeSaved={(name) => (roomHostName = name)}
  />
{/if}

<style>
  .lobby {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: 1.5rem;
    font-family: sans-serif;
    padding: 2rem;
  }

  .lobby-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
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

  .player-count {
    font-size: 0.9rem;
    color: #aaa;
  }

  .disconnected-banner {
    background: #1a1a2a;
    border: 1px solid #555;
    color: #aaa;
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }

  .degraded-banner {
    background: #3a1a1a;
    border: 1px solid #c0392b;
    color: #e74c3c;
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .degraded-banner button {
    background: none;
    border: 1px solid #e74c3c;
    color: #e74c3c;
    cursor: pointer;
    padding: 0.15rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.8rem;
  }

  .vinyl {
    animation: spin 3s linear infinite;
    margin-top: 4rem; /* clear fixed header */
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .fact {
    max-width: 36rem;
    text-align: center;
    font-size: 1rem;
    color: #ccc;
    line-height: 1.5;
    transition: opacity 0.4s;
    opacity: 0;
  }

  .fact.visible {
    opacity: 1;
  }

  .configure-btn {
    background: #1db954;
    color: #000;
    border: none;
    padding: 0.875rem 2.5rem;
    border-radius: 2rem;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    margin-top: 1rem;
  }

  .configure-btn:hover {
    background: #1ed760;
  }
</style>
