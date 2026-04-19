<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import GameOverView from '../components/GameOverView.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import GuestWaitingRoom from '../components/GuestWaitingRoom.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import { cardFingerprint } from '../lib/bingo.ts'
  import type { Tile } from '../lib/bingo.ts'
  import { createGameState } from '../lib/gameState.svelte.ts'

  let { name, code, ws, initialPlayers = [], hostName = null, initialWinsByName = {}, initialLastRoundWinner = null, initialCasualModeNames = [], pendingMessages = [], onLeave }: {
    name: string
    code: string
    ws: WebSocket
    initialPlayers?: string[]
    hostName?: string | null
    initialWinsByName?: Record<string, number>
    initialLastRoundWinner?: string | null
    initialCasualModeNames?: string[]
    pendingMessages?: MessageEvent[]
    onLeave?: () => void
  } = $props()

  let hostDisconnected = $state(false)
  let sessionEnded = $state(false)
  let statusLine = $state('Waiting for the host to start a round...')
  let marksKey = ''
  let toastMessage = $state<string | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  // Reconnect into an existing round delivers a buffered round:start whose reset
  // would clobber `casualModeOn` seeded from session:connect. Skip the reset the
  // first time so reconnected casual players keep their server-truth state.
  let hasSeenRoundStart = false

  function loadMarks(): Set<string> {
    if (!marksKey) return new Set()
    try {
      return new Set(JSON.parse(localStorage.getItem(marksKey) ?? '[]'))
    } catch {
      return new Set()
    }
  }

  let casualModeOn = $state(untrack(() => initialCasualModeNames.includes(name)))

  function handleCasualToggle() {
    const next = !casualModeOn
    casualModeOn = next
    ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: next }))
  }

  const game = createGameState({
    code: untrack(() => code),
    getPlayerName: () => name,
    initialPlayers: untrack(() => initialPlayers),
    initialWinsByName: untrack(() => initialWinsByName),
    initialLastRoundWinner: untrack(() => initialLastRoundWinner),
    initialCasualModeNames: untrack(() => initialCasualModeNames),
    getMarksForCard: (card: Tile[]) => {
      marksKey = `bangerbingo:marks:${code}:${cardFingerprint(card)}`
      return loadMarks()
    },
    onTileMark: (tiles) => {
      if (!marksKey) return
      const ids = tiles.filter(t => t.state === 'marked').map(t => t.trackId)
      localStorage.setItem(marksKey, JSON.stringify(ids))
    },
  })

  $effect(() => {
    const id = game.catchUpToastId
    if (id === null || id === undefined) return
    const count = game.catchUpToastCount ?? 0
    if (count <= 0) return
    toastMessage = `Caught up on ${count} song${count === 1 ? '' : 's'}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toastMessage = null
      game.clearCatchUpToast()
    }, 3000)
  })

  $effect(() => {
    if (game.hasBingo) game.handleBingoClick()
  })

  function handleWsData(data: Record<string, unknown>) {
    game.processWsMessage(data)
    if (data.type === 'round:start') {
      if (hasSeenRoundStart) {
        casualModeOn = false
      }
      hasSeenRoundStart = true
      clearTimeout(toastTimer)
      toastMessage = null
      statusLine = 'Waiting for next song…'
    } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
      statusLine = 'Waiting for next song…'
    } else if (data.type === 'round:end') {
      game.resetRound()
      statusLine = 'Waiting for the host to start a round...'
    } else if (data.type === 'session:end') {
      sessionEnded = true
      setTimeout(() => onLeave?.(), 2500)
    } else if (data.type === 'host:disconnected') {
      hostDisconnected = true
    } else if (data.type === 'host:reconnected') {
      hostDisconnected = false
    }
  }

  onMount(() => {
    for (const event of pendingMessages) {
      try { handleWsData(JSON.parse(event.data)) } catch { /* ignore */ }
    }
    ws.onmessage = (event) => {
      try { handleWsData(JSON.parse(event.data)) } catch { /* ignore */ }
    }
  })

  onDestroy(() => {
    clearTimeout(toastTimer)
    game.cleanup()
    ws.close()
  })
</script>

{#if sessionEnded}
  <div class="session-ended-banner" role="status">
    This session has ended.
  </div>
{/if}

{#if hostDisconnected}
  <div class="host-disconnected-banner" role="status">
    Host disconnected — waiting for them to reconnect…
  </div>
{/if}

{#if game.showHistory}
  <SongHistoryDrawer entries={game.songHistory} currentRevealed={game.currentRevealed} onClose={() => { game.showHistory = false }} />
{/if}

{#if game.showPlayers}
  <PlayersOverlay players={game.players} {hostName} selfName={name} winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} casualModeNames={game.casualModePlayers} onClose={() => { game.showPlayers = false }} />
{/if}

<main class="room-page" class:game-active={game.tiles.length > 0 || game.winData !== null}>
  {#if game.winData !== null}
    <GameOverView
      role="guest"
      selfName={name}
      winData={game.winData}
      audioPreset={game.audioPreset}
      ownTiles={game.tiles}
      playedTrackIds={game.playedTrackIds}
      playerCount={game.playerCount}
      {code}
      songIndex={game.songIndex}
      historyOpen={game.showHistory}
      playersOpen={game.showPlayers}
      onPlayersClick={() => { game.showPlayers = !game.showPlayers; game.showHistory = false }}
      onHistoryClick={() => { game.showHistory = !game.showHistory; game.showPlayers = false }}
    />
  {:else if game.tiles.length > 0}
    <GameHeader
      playerCount={game.playerCount}
      {code}
      songIndex={game.songIndex}
      historyOpen={game.showHistory}
      playersOpen={game.showPlayers}
      onPlayersClick={() => { game.showPlayers = !game.showPlayers; game.showHistory = false }}
      onHistoryClick={() => { game.showHistory = !game.showHistory; game.showPlayers = false }}
    />
    <BingoCard tiles={game.tiles} nopeIndex={game.nopeIndex} onTileClick={game.handleTileClick} />
    <p class="status-line" role="status">{statusLine}</p>
    {#if toastMessage}
      <div class="casual-toast" role="status" aria-live="polite">{toastMessage}</div>
    {/if}
    {#if game.allowCasualMode}
      <div class="casual-toggle-row">
        <span class="casual-label">Casual Mode</span>
        <button
          class="casual-btn"
          class:active={casualModeOn}
          onclick={handleCasualToggle}
          aria-pressed={casualModeOn}
        >{casualModeOn ? 'On' : 'Off'}</button>
      </div>
    {/if}
  {:else}
    <GuestWaitingRoom {code} selfName={name} {hostName} players={game.players} winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} {onLeave} allowCasualMode={game.allowCasualMode} {casualModeOn} onCasualToggle={handleCasualToggle} casualModeNames={game.casualModePlayers} />
  {/if}
</main>

<style>
  .session-ended-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: var(--fg);
    color: var(--bg);
    padding: 8px 16px;
    text-align: center;
    z-index: 100;
    font-size: 14px;
  }

  .host-disconnected-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: var(--accent);
    color: var(--accent-fg);
    padding: 8px 16px;
    text-align: center;
    z-index: 100;
    font-size: 14px;
  }

  .room-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--fg);
    padding: 16px;
    box-sizing: border-box;
  }

  .room-page.game-active {
    justify-content: flex-start;
    padding-top: 80px;
  }

  .status-line {
    margin-top: 12px;
    font-size: 14px;
    color: var(--fg-muted);
    text-align: center;
  }

  .casual-toggle-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 12px;
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

  .casual-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg);
    border: var(--rule-thick) solid var(--accent);
    color: var(--accent);
    padding: 10px 18px;
    font-size: 14px;
    z-index: 50;
  }

  @media (min-width: 768px) {
    .room-page {
      padding: var(--space-6) var(--space-7);
      gap: var(--space-4);
    }
    .room-page.game-active {
      padding-top: 96px;
    }
    .casual-toggle-row { margin-top: var(--space-4); }
  }
</style>
