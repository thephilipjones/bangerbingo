<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Link, ArrowLeft } from 'phosphor-svelte'
  import { TRIVIA_FACTS, shuffle } from '../lib/trivia.ts'
  import { connectAsHost, applyPlayerEvent, copyRoomCode } from '../lib/ws.ts'
  import { getRooms } from '../lib/api.ts'
  import RoundConfigOverlay from '../components/RoundConfigOverlay.svelte'
  import VinylWithTonearm from '../components/VinylWithTonearm.svelte'
  import PlayerList from '../components/PlayerList.svelte'
  import Button from '../lib/components/Button.svelte'
  import ThemeToggle from '../lib/components/ThemeToggle.svelte'

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
    <button class="back-btn" onclick={onBackToDashboard} aria-label="Back to session manager"><ArrowLeft size={18} aria-hidden="true" /> Sessions</button>
    <div class="header-center">
      <div class="room-invite">
        Join at
        <button class="url-copy-btn" onclick={handleCopyUrl} aria-label="Copy room URL">
          {copiedUrl ? 'Copied!' : 'BangerBingo.net'}
          {#if !copiedUrl}<Link size={18} aria-hidden="true" />{/if}
        </button>
      </div>
      <button class="room-code" onclick={handleCopyCode} aria-label="Copy room code">
        {copied ? 'Copied!' : code}
      </button>
    </div>
    <div class="header-right">
      <ThemeToggle />
    </div>
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
  <Button variant="primary" size="lg" onclick={() => { isConfigOpen = true; hasEverOpenedConfig = true }}>Start a Round</Button>

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
    gap: var(--space-5);
    padding: 6rem var(--space-5) var(--space-7);
    box-sizing: border-box;
    background: var(--bg);
    color: var(--fg);
  }

  .lobby-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    background: var(--bg);
    border-bottom: var(--rule-thick) solid var(--rule);
    z-index: 20;
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: var(--fs-small);
    cursor: pointer;
    padding: var(--space-1) 0;
    min-width: 6rem;
    text-align: left;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .back-btn:hover { color: var(--fg); }
  .back-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .header-right {
    min-width: 6rem;
    display: flex;
    justify-content: flex-end;
    align-items: center;
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
    gap: var(--space-1);
    font-size: var(--fs-small);
    color: var(--fg-muted);
  }

  .url-copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: var(--fs-small);
    cursor: pointer;
    padding: 0;
    font-family: inherit;
  }

  .url-copy-btn:hover { color: var(--fg); }

  .room-code {
    font-size: 2rem;
    font-family: var(--font-mono);
    font-weight: 700;
    background: none;
    border: none;
    color: var(--fg);
    cursor: pointer;
    letter-spacing: 0.1em;
    padding: 0;
    line-height: 1;
  }

  .room-code:hover { color: var(--accent); }

  .disconnected-banner {
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg-muted);
    padding: var(--space-2) var(--space-4);
    font-size: var(--fs-small);
  }

  .degraded-banner {
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--danger);
    color: var(--danger);
    padding: var(--space-2) var(--space-4);
    font-size: var(--fs-small);
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .degraded-banner button {
    background: none;
    border: var(--rule-thin) solid currentColor;
    color: inherit;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    font-size: var(--fs-small);
  }

  .waiting {
    font-size: var(--fs-small);
    color: var(--fg-muted);
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
    color: var(--fg);
    margin: 0 0 12px 0;
    text-align: left;
  }

  .fact {
    max-width: 24rem;
    min-height: 4.5rem;
    text-align: center;
    font-size: 0.95rem;
    color: var(--fg-muted);
    line-height: 1.5;
    transition: opacity 0.4s;
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .fact { transition: none; }
  }

  .fact.visible { opacity: 1; }

  @media (min-width: 768px) {
    .lobby {
      gap: var(--space-6);
      padding: 7rem var(--space-7) var(--space-8);
    }
    .lobby-header { padding: var(--space-4) var(--space-7); }
    .players-section,
    .fact { max-width: 32rem; }
  }
</style>
