<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import GameOverView from '../components/GameOverView.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import GuestWaitingRoom from '../components/GuestWaitingRoom.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import InfoTooltip from '../components/InfoTooltip.svelte'
  import { cardFingerprint } from '../lib/bingo.ts'
  import type { Tile } from '../lib/bingo.ts'
  import { createGameState } from '../lib/gameState.svelte.ts'
  import { createWsClient, type WsClient, type WsState } from '../lib/wsClient.ts'
  import { playWinAudio } from '../lib/winAudio.ts'
  import { setStoredGuestName } from '../lib/guestName.ts'

  let { name, code, ws, initialPlayers = [], hostName = null, initialWinsByName = {}, initialLastRoundWinner = null, initialCasualModeNames = [], pendingMessages = [], onLeave, onSelfRename }: {
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
    onSelfRename?: (newName: string) => void
  } = $props()

  // Tracks the current name — updated on successful self-rename
  let currentName = $state(untrack(() => name))
  // Mirror hostName locally so host renames propagate into this view.
  // Initialized from the prop; updated on `player:renamed` with isHost:true.
  let currentHostName = $state<string | null>(untrack(() => hostName))

  let sessionEnded = $state(false)
  let wsState = $state<WsState>('open')
  let wsClient: WsClient | null = null
  let visibilityListener: (() => void) | null = null
  let marksKey = ''
  let toastMessage = $state<string | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  function loadMarks(): Set<string> {
    if (!marksKey) return new Set()
    try {
      return new Set(JSON.parse(localStorage.getItem(marksKey) ?? '[]'))
    } catch {
      return new Set()
    }
  }

  let casualModeOn = $state(untrack(() => initialCasualModeNames.includes(currentName)))

  function handleCasualToggle() {
    const next = !casualModeOn
    casualModeOn = next
    wsClient?.send({ type: 'player:casual-mode-changed', enabled: next })
  }

  const game = createGameState({
    code: untrack(() => code),
    getPlayerName: () => currentName,
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

  function buildWsUrl(forName: string): string {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${window.location.host}/ws?name=${encodeURIComponent(forName)}&code=${encodeURIComponent(code)}`
  }

  function handleRename(newName: string) {
    // Persist before WS send so a drop between send and in-memory update uses new name
    setStoredGuestName(newName)
    wsClient?.send({ type: 'player:rename', newName })
  }

  function handleWsData(data: Record<string, unknown>) {
    // Capture before processWsMessage sets winData — guards audio replay in Story 13-6.
    const isWinReplay = data.type === 'round:win' && game.winData !== null
    game.processWsMessage(data)
    if (data.type === 'round:win' && !isWinReplay) {
      try { playWinAudio(game.audioPreset) } catch (e) { if (!(e instanceof DOMException && e.name === 'NotAllowedError')) throw e }
    } else if (data.type === 'session:connect') {
      // Fires on reconnect via wsClient — refresh server-truth state so the
      // subsequent buffered round:start (if any) doesn't stomp casualModeOn,
      // and the player list / wins stay accurate.
      const players = (data.players as string[] | undefined) ?? []
      game.players = players
      game.winsByName = (data.winsByName as Record<string, number> | undefined) ?? {}
      game.lastRoundWinner = (data.lastRoundWinner as string | null | undefined) ?? null
      const casualNames = (data.casualModeNames as string[] | undefined) ?? []
      game.casualModePlayers = new Set(casualNames)
      casualModeOn = casualNames.includes(currentName)
    } else if (data.type === 'player:renamed') {
      const oldName = data.oldName as string
      const newName = data.newName as string
      const isHost = data.isHost as boolean | undefined
      if (isHost) {
        currentHostName = newName
      } else if (oldName === currentName) {
        currentName = newName
        onSelfRename?.(newName)
        // Reconnects must use the new name — rebuild the ws query param.
        wsClient?.setUrl(buildWsUrl(newName))
      }
    } else if (data.type === 'player:rename-rejected') {
      console.warn('[rename] rejected:', data.reason)
      // Roll back the optimistic localStorage write in handleRename() so a
      // reload after a rejected rename doesn't re-join under the refused name.
      setStoredGuestName(currentName)
    } else if (data.type === 'round:start') {
      clearTimeout(toastTimer)
      toastMessage = null
    } else if (data.type === 'round:end') {
      game.resetRound()
    } else if (data.type === 'session:end') {
      sessionEnded = true
      setTimeout(() => onLeave?.(), 2500)
    }
  }

  onMount(() => {
    // Replay messages buffered between JoinPage's session:connect and handoff.
    for (const event of pendingMessages) {
      try { handleWsData(JSON.parse(event.data)) } catch { /* ignore */ }
    }

    wsClient = createWsClient({
      url: buildWsUrl(currentName),
      existingSocket: ws,
      onMessage: (raw) => handleWsData(raw as Record<string, unknown>),
      onStateChange: (s) => { wsState = s },
    })

    function onVisible() {
      if (document.visibilityState === 'visible') wsClient?.nudge()
    }
    document.addEventListener('visibilitychange', onVisible)
    visibilityListener = onVisible
  })

  onDestroy(() => {
    clearTimeout(toastTimer)
    game.cleanup()
    if (visibilityListener) {
      document.removeEventListener('visibilitychange', visibilityListener)
      visibilityListener = null
    }
    wsClient?.close()
    wsClient = null
  })
</script>

{#if sessionEnded}
  <div class="session-ended-banner" role="status">
    This session has ended.
  </div>
{/if}

{#if wsState === 'reconnecting'}
  <div class="reconnecting-chip" role="status" aria-live="polite">Reconnecting…</div>
{/if}

{#if wsState === 'dead'}
  <div class="error-banner" role="alert">Connection lost — please refresh the page.</div>
{/if}

{#if game.showHistory}
  <SongHistoryDrawer entries={game.songHistory} currentRevealed={game.currentRevealed} onClose={() => { game.showHistory = false }} />
{/if}

{#if game.showPlayers}
  <PlayersOverlay players={game.players} hostName={currentHostName} selfName={currentName} winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} casualModeNames={game.casualModePlayers} onClose={() => { game.showPlayers = false }} onRename={handleRename} isClaiming={game.isClaiming} />
{/if}

<main class="room-page" class:game-active={game.tiles.length > 0 || game.winData !== null}>
  {#if game.winData !== null}
    <GameOverView
      role="guest"
      selfName={currentName}
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
      playbackStartedAt={game.playbackStartedAt}
      effectiveDurationMs={game.effectiveDurationMs}
    />
    <BingoCard tiles={game.tiles} nopeIndex={game.nopeIndex} onTileClick={game.handleTileClick} />
    {#if toastMessage}
      <div class="casual-toast" role="status" aria-live="polite">{toastMessage}</div>
    {/if}
    {#if game.allowCasualMode}
      <div class="casual-toggle-row">
        <InfoTooltip label="Casual Mode" text="Automatically mark your squares at the end of each song" />
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
    <GuestWaitingRoom {code} selfName={currentName} hostName={currentHostName} players={game.players} winsByName={game.winsByName} lastRoundWinner={game.lastRoundWinner} showStats={game.showStats} {onLeave} allowCasualMode={game.allowCasualMode} {casualModeOn} onCasualToggle={handleCasualToggle} casualModeNames={game.casualModePlayers} onRename={handleRename} isClaiming={game.isClaiming} />
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

  .reconnecting-chip {
    position: fixed;
    top: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg-muted);
    padding: var(--space-1) var(--space-3);
    font-size: 12px;
    z-index: 110;
    letter-spacing: 0.04em;
  }

  .error-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: var(--danger);
    color: var(--accent-fg);
    padding: var(--space-2) var(--space-4);
    text-align: center;
    z-index: 200;
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
    padding: 16px 8px;
    box-sizing: border-box;
  }

  .room-page.game-active {
    justify-content: flex-start;
    padding-top: 80px;
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
