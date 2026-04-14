<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { TRIVIA_FACTS, shuffle } from '../lib/trivia.ts'
  import { connectAsHost, applyPlayerEvent, copyRoomCode } from '../lib/ws.ts'
  import { getRooms } from '../lib/api.ts'
  import RoundConfigOverlay from '../components/RoundConfigOverlay.svelte'
  import VinylWithTonearm from '../components/VinylWithTonearm.svelte'
  import PlayerList from '../components/PlayerList.svelte'

  let {
    code,
    onRoundStarted,
    onBackToDashboard,
  }: {
    code: string
    onRoundStarted: () => void
    onBackToDashboard: () => void
  } = $props()

  // ── Round Config Overlay ────────────────────────────────────────────────────
  let isConfigOpen = $state(false)
  let roomHostName = $state<string | null>(null)
  let hasEverOpenedConfig = $state(false)

  // ── Vinyl / header ──────────────────────────────────────────────────────────
  let copied = $state(false)
  let copiedUrl = $state(false)

  async function handleCopyCode() {
    try {
      await copyRoomCode(code)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      // clipboard unavailable — no UI change
    }
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${code}`)
      copiedUrl = true
      setTimeout(() => (copiedUrl = false), 1500)
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
      onRoundActive: onRoundStarted,
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
    <button class="back-btn" onclick={onBackToDashboard} aria-label="Back to session manager">← Sessions</button>
    <div class="header-center">
      <div class="room-invite">
        Join at
        <button class="url-copy-btn" onclick={handleCopyUrl} aria-label="Copy room URL">
          {copiedUrl ? 'Copied!' : 'BangerBingo.net'}
          {#if !copiedUrl}<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M4 9h1v1H4c-1.5 0-3-1.69-3-3.5S2.55 3 4 3h4c1.45 0 3 1.69 3 3.5 0 1.41-.91 2.72-2 3.25V8.59c.58-.45 1-1.27 1-2.09C10 5.22 8.98 4 8 4H4c-.98 0-2 1.22-2 2.5S3 9 4 9zm9-3h-1v1h1c1 0 2 1.22 2 2.5S13.98 12 13 12H9c-.98 0-2-1.22-2-2.5 0-.83.42-1.64 1-2.09V6.25c-1.09.53-2 1.84-2 3.25C6 11.31 7.55 13 9 13h4c1.45 0 3-1.69 3-3.5S14.5 6 13 6z"/></svg>{/if}
        </button>
      </div>
      <button class="room-code" onclick={handleCopyCode} aria-label="Copy room code">
        {copied ? 'Copied!' : code}
      </button>
    </div>
    <div class="header-spacer"></div>
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

  <!-- Vinyl + needle -->
  <VinylWithTonearm />

  <!-- Start a Round CTA -->
  <button class="configure-btn" onclick={() => { isConfigOpen = true; hasEverOpenedConfig = true }}>Start a Round</button>

  <p class="waiting">Waiting for you…</p>

  <!-- Player list -->
  <div class="players-section">
    <h2 class="players-label">Players here ({players.length + 1})</h2>
    <PlayerList {players} hostName={roomHostName} selfName={null} winsByName={{}} lastRoundWinner={null} showStats={false} />
  </div>

  <!-- Trivia fact -->
  <p class="fact" class:visible>{facts[factIndex]}</p>
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
    min-height: 100dvh;
    gap: 1.5rem;
    font-family: sans-serif;
    padding: 6rem 1.5rem 3rem;
    box-sizing: border-box;
    background: #121212;
    color: #fff;
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
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }

  .back-btn {
    background: none;
    border: none;
    color: #aaa;
    font-size: 0.875rem;
    cursor: pointer;
    padding: 0.25rem 0;
    min-width: 6rem;
  }

  .back-btn:hover {
    color: #fff;
  }

  .header-spacer {
    min-width: 6rem;
  }

  .header-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }

  .room-invite {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: #666;
  }

  .url-copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    background: none;
    border: none;
    color: #666;
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0;
    font-family: sans-serif;
  }

  .url-copy-btn:hover {
    color: #aaa;
  }

  .room-code {
    font-size: 2rem;
    font-family: monospace;
    font-weight: 700;
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    letter-spacing: 0.1em;
    padding: 0;
    line-height: 1;
  }

  .room-code:hover {
    color: #1db954;
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

  .waiting {
    font-size: 0.8rem;
    color: #444;
    text-align: center;
    margin: 0;
  }

  .players-section {
    width: 100%;
    max-width: 24rem;
  }

  .players-label {
    font-size: 1rem;
    font-weight: 600;
    color: #fff;
    margin: 0 0 12px 0;
    text-align: left;
  }

  .fact {
    max-width: 24rem;
    min-height: 4.5rem;
    text-align: center;
    font-size: 0.95rem;
    color: #666;
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
  }

  .configure-btn:hover {
    background: #1ed760;
  }
</style>
