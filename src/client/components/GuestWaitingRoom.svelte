<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { TRIVIA_FACTS, shuffle } from '../lib/trivia.ts'
  import VinylWithTonearm from './VinylWithTonearm.svelte'
  import PlayerList from './PlayerList.svelte'

  let { code, selfName, hostName, players, winsByName = {}, lastRoundWinner = null, showStats = false, countdownSeconds = null, onLeave, allowCasualMode = false, casualModeOn = false, onCasualToggle, casualModeNames = new Set() }: { code: string; selfName: string; hostName: string | null; players: string[]; winsByName?: Record<string, number>; lastRoundWinner?: string | null; showStats?: boolean; countdownSeconds?: number | null; onLeave?: () => void; allowCasualMode?: boolean; casualModeOn?: boolean; onCasualToggle?: () => void; casualModeNames?: Set<string> } = $props()

  // Host row is always rendered (with name or generic "Host"), so always count host as +1
  const playerCount = $derived(players.length + 1)

  // ── Header copy ─────────────────────────────────────────────────────────────
  let copied = $state(false)
  let copiedUrl = $state(false)

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(code)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch { /* unavailable */ }
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${code}`)
      copiedUrl = true
      setTimeout(() => (copiedUrl = false), 1500)
    } catch { /* unavailable */ }
  }

  // ── Trivia cycling ─────────────────────────────────────────────────────────
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

  onMount(() => {
    triviaInterval = setInterval(advanceFact, 12000)
  })

  onDestroy(() => {
    clearInterval(triviaInterval)
    clearTimeout(triviaTimeout)
  })
</script>

<div class="waiting-room">
  <!-- Header -->
  <header class="header">
    {#if onLeave}
      <button class="back-btn" onclick={onLeave} aria-label="Leave session">← Leave</button>
    {:else}
      <div class="header-spacer"></div>
    {/if}
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

  <!-- Vinyl + needle -->
  <VinylWithTonearm />

  <!-- Headline -->
  <h1 class="headline">You're in!</h1>

  <!-- Waiting -->
  {#if countdownSeconds !== null}
    <p class="waiting countdown">Next game starts in {countdownSeconds}s</p>
  {:else}
    <p class="waiting">Waiting for host to start the round…</p>
  {/if}

  <!-- Player list -->
  <div class="players-section">
    <h2 class="players-label">Players here ({playerCount})</h2>
    <PlayerList {players} {hostName} {selfName} {winsByName} {lastRoundWinner} {showStats} {casualModeNames} />
  </div>

  <!-- Casual Mode toggle (waiting room) -->
  {#if allowCasualMode}
    <div class="casual-toggle-row">
      <span class="casual-label">Casual Mode</span>
      <button
        class="casual-btn"
        class:active={casualModeOn}
        onclick={onCasualToggle}
        aria-pressed={casualModeOn}
      >{casualModeOn ? 'On' : 'Off'}</button>
    </div>
  {/if}

  <!-- Trivia -->
  <p class="fact" class:visible>{facts[factIndex]}</p>
</div>

<style>
  .waiting-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--fg);
    padding: 6rem 1.5rem 3rem;
    box-sizing: border-box;
    gap: 1.5rem;
  }

  .header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: var(--bg);
    border-bottom: var(--rule-thick) solid var(--rule);
    z-index: 10;
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 0.875rem;
    cursor: pointer;
    padding: 0.25rem 0;
    min-width: 5rem;
    text-align: left;
  }

  .back-btn:hover { color: var(--fg); }
  .back-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .header-spacer {
    min-width: 5rem;
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
    color: var(--fg-muted);
  }

  .url-copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 0.75rem;
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
    text-transform: uppercase;
    padding: 0;
    line-height: 1;
  }

  .room-code:hover { color: var(--accent); }

  .headline {
    font-family: var(--font-display);
    font-size: 1.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    text-align: center;
    margin: 0;
  }

  .waiting {
    font-size: 0.95rem;
    color: var(--fg-muted);
    text-align: center;
    margin: 0;
  }

  .waiting.countdown {
    color: var(--accent);
    font-weight: 600;
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

  .casual-toggle-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .casual-label {
    font-size: 14px;
    color: var(--fg-muted);
  }

  .casual-btn {
    padding: 0.35rem 0.9rem;
    min-height: 36px;
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .casual-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .casual-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
</style>
