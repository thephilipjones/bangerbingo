<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import WinOverlay from '../components/WinOverlay.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import GuestWaitingRoom from '../components/GuestWaitingRoom.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import { cardFingerprint } from '../lib/bingo.ts'
  import type { Tile } from '../lib/bingo.ts'
  import { createGameState } from '../lib/gameState.svelte.ts'

  let { name, code, ws, initialPlayers = [], hostName = null, pendingMessages = [], onLeave }: {
    name: string
    code: string
    ws: WebSocket
    initialPlayers?: string[]
    hostName?: string | null
    pendingMessages?: MessageEvent[]
    onLeave?: () => void
  } = $props()

  let hostDisconnected = $state(false)
  let sessionEnded = $state(false)
  let statusLine = $state('Waiting for the host to start a round...')
  let marksKey = ''

  function loadMarks(): Set<string> {
    if (!marksKey) return new Set()
    try {
      return new Set(JSON.parse(localStorage.getItem(marksKey) ?? '[]'))
    } catch {
      return new Set()
    }
  }

  const game = createGameState({
    code: untrack(() => code),
    getPlayerName: () => name,
    initialPlayers: untrack(() => initialPlayers),
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

  function handleWsData(data: Record<string, unknown>) {
    game.processWsMessage(data)
    if (data.type === 'round:start') {
      statusLine = 'Waiting for next song…'
    } else if (data.type === 'song:start') {
      statusLine = `Song ${(data.songIndex as number) + 1} of this round`
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

{#if game.winData !== null}
  {@const wd = game.winData}
  <WinOverlay
    winnerName={wd.winnerName}
    winningSongs={wd.songHistory.filter(e => wd.winningTileIds.includes(e.trackId))}
    isHost={false}
    onStartNextRound={() => {}}
    onDismiss={() => { game.winData = null }}
    audioPreset={game.audioPreset}
    selfName={name}
  />
{/if}

{#if game.showHistory}
  <SongHistoryDrawer entries={game.songHistory} currentRevealed={game.currentRevealed} onClose={() => { game.showHistory = false }} />
{/if}

{#if game.showPlayers}
  <PlayersOverlay players={game.players} {hostName} selfName={name} onClose={() => { game.showPlayers = false }} />
{/if}

<main class="room-page" class:game-active={game.tiles.length > 0}>
  {#if game.tiles.length > 0}
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
    {#if game.hasBingo && !game.isClaiming}
      <button class="bingo-btn" onclick={game.handleBingoClick}>Bingo!</button>
    {:else if game.isClaiming}
      <button class="bingo-btn bingo-btn--disabled" disabled>Claiming…</button>
    {/if}
    <p class="status-line" role="status">{statusLine}</p>
  {:else}
    <GuestWaitingRoom {code} selfName={name} {hostName} players={game.players} {onLeave} />
  {/if}
</main>

<style>
  .session-ended-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #555;
    color: #fff;
    padding: 8px 16px;
    text-align: center;
    z-index: 100;
    font-size: 14px;
    font-family: sans-serif;
  }

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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    font-family: sans-serif;
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
    color: #aaa;
    text-align: center;
  }

  .bingo-btn {
    margin-top: 16px;
    background: #1db954;
    color: #000;
    border: none;
    border-radius: 24px;
    padding: 14px 36px;
    font-size: 20px;
    font-weight: 900;
    font-family: sans-serif;
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
    letter-spacing: 1px;
  }

  .bingo-btn--disabled {
    background: #555;
    color: #999;
    cursor: default;
  }
</style>
