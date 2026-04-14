<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import WinOverlay from '../components/WinOverlay.svelte'
  import SongHistoryDrawer from '../components/SongHistoryDrawer.svelte'
  import GuestWaitingRoom from '../components/GuestWaitingRoom.svelte'
  import GameHeader from '../components/GameHeader.svelte'
  import PlayersOverlay from '../components/PlayersOverlay.svelte'
  import { computePlayerCount } from '../lib/waitingRoom.ts'
  import {
    initTiles,
    applyMask,
    startReveal,
    finishReveal,
    toggleMark,
    applyWinPath,
    restoreMarks,
    cardFingerprint,
    isWinningLine,
  } from '../lib/bingo.ts'
  import { applyPlayerEvent } from '../lib/ws.ts'
  import type { ClientTile, TitleRevealDelay } from '../lib/bingo.ts'

  let { name, code, ws, initialPlayers = [], hostName = null, pendingMessages = [], onLeave }: { name: string; code: string; ws: WebSocket; initialPlayers?: string[]; hostName?: string | null; pendingMessages?: MessageEvent[]; onLeave?: () => void } = $props()

  type WinData = {
    winnerName: string
    winningTileIds: string[]
    songHistory: Array<{ trackId: string; title: string; artist: string; albumArtUrl: string; songIndex: number }>
  }

  type HistoryEntry = {
    trackId: string
    title: string
    artist: string
    albumArtUrl: string
    songIndex: number
  }

  const WIN_LINES: number[][] = [
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    [0,6,12,18,24], [4,8,12,16,20],
  ]

  let hostDisconnected = $state(false)
  let tiles = $state<ClientTile[]>([])
  let statusLine = $state('Waiting for the host to start a round...')
  let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let isClaiming = $state(false)
  let winData = $state<WinData | null>(null)
  let roundEnded = $state(false)
  let songHistory = $state<HistoryEntry[]>([])
  const playedTrackIds = $derived(new Set(songHistory.map(e => e.trackId)))
  let showHistory = $state(false)
  let showPlayers = $state(false)
  let songIndex = $state<number | null>(null)
  let currentRevealed = $state(false)
  let players = $state<string[]>(untrack(() => initialPlayers))
  const playerCount = $derived(computePlayerCount(players))
  let nopeIndex = $state<number | null>(null)
  let nopeTimer: ReturnType<typeof setTimeout> | undefined

  const hasBingo = $derived(
    tiles.length > 0 &&
    !roundEnded &&
    WIN_LINES.some(line => isWinningLine(tiles, line, playedTrackIds))
  )

  let marksKey = $state('')

  function saveMarks(t: ClientTile[]) {
    if (!marksKey) return
    const ids = t.filter(tile => tile.state === 'marked').map(tile => tile.trackId)
    localStorage.setItem(marksKey, JSON.stringify(ids))
  }

  function loadMarks(): Set<string> {
    if (!marksKey) return new Set()
    try {
      return new Set(JSON.parse(localStorage.getItem(marksKey) ?? '[]'))
    } catch {
      return new Set()
    }
  }

  function handleTileClick(index: number) {
    const tile = tiles[index]
    if (!tile || tile.free) return
    const alreadyMarked = tile.state === 'marked'
    if (!alreadyMarked && !playedTrackIds.has(tile.trackId)) {
      clearTimeout(nopeTimer)
      nopeIndex = null
      queueMicrotask(() => { nopeIndex = index })
      nopeTimer = setTimeout(() => { nopeIndex = null }, 450)
      return
    }
    clearTimeout(nopeTimer)
    nopeIndex = null
    tiles = toggleMark(tiles, index)
    saveMarks(tiles)
  }

  async function handleBingoClick() {
    isClaiming = true
    const claimedTileIds = tiles
      .filter(t => t.state === 'marked' || t.state === 'free')
      .map(t => t.free ? 'FREE' : t.trackId)

    try {
      const res = await fetch(`/api/rooms/${code}/round/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, claimedTileIds }),
      })
      if (res.status === 200) {
        // wait for round:win WS event; isClaiming cleared there
      } else {
        isClaiming = false // re-enable for retry (422) or silent reset (409, 4xx, 5xx)
      }
    } catch {
      isClaiming = false
    }
  }

  function handleWsData(data: Record<string, unknown>) {
    if (data.type === 'host:disconnected') {
      hostDisconnected = true
    } else if (data.type === 'host:reconnected') {
      hostDisconnected = false
    } else if (data.type === 'player:joined') {
      players = applyPlayerEvent(players, { type: 'player:joined', name: data.name as string })
    } else if (data.type === 'player:left') {
      players = applyPlayerEvent(players, { type: 'player:left', name: data.name as string })
    } else if (data.type === 'round:start') {
      clearTimeout(nopeTimer)
      nopeIndex = null
      marksKey = `bangerbingo:marks:${code}:${cardFingerprint(data.card as Parameters<typeof initTiles>[0])}`
      roundConfig = { titleRevealDelay: data.titleRevealDelay as TitleRevealDelay }
      statusLine = 'Waiting for next song…'
      roundEnded = false
      winData = null
      const rawHistory = (data.songHistory as HistoryEntry[] | undefined) ?? []
      songHistory = rawHistory.slice().reverse()
      const playedIds = new Set(rawHistory.map(e => e.trackId))
      tiles = restoreMarks(initTiles(data.card as Parameters<typeof initTiles>[0]), loadMarks(), playedIds)
      songIndex = rawHistory.length > 0 ? rawHistory[rawHistory.length - 1].songIndex : null
      currentRevealed = (data.currentSongRevealed as boolean | undefined) ?? false
    } else if (data.type === 'song:start') {
      if (roundConfig) {
        tiles = applyMask(tiles, data.trackId as string, roundConfig.titleRevealDelay, data.songIndex as number)
      }
      songIndex = data.songIndex as number
      statusLine = `Song ${(data.songIndex as number) + 1} of this round`
      currentRevealed = false
      songHistory = [{ trackId: data.trackId as string, title: data.title as string, artist: data.artist as string, albumArtUrl: data.albumArtUrl as string, songIndex: data.songIndex as number }, ...songHistory.filter(e => e.songIndex !== data.songIndex)]
    } else if (data.type === 'song:reveal') {
      currentRevealed = true
      tiles = startReveal(tiles, data.trackId as string)
      clearTimeout(revealTimer)
      revealTimer = setTimeout(() => {
        tiles = finishReveal(tiles, data.trackId as string)
      }, 300)
    } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
      statusLine = 'Waiting for next song…'
    } else if (data.type === 'round:win') {
      tiles = applyWinPath(tiles, data.winningTileIds as string[])
      roundEnded = true
      isClaiming = false
      winData = { winnerName: data.winnerName as string, winningTileIds: data.winningTileIds as string[], songHistory: data.songHistory as WinData['songHistory'] }
    } else if (data.type === 'round:end') {
      clearTimeout(nopeTimer)
      nopeIndex = null
      tiles = []
      statusLine = 'Waiting for the host to start a round...'
      roundConfig = null
    } else if (data.type === 'session:end') {
      onLeave?.()
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
    clearTimeout(revealTimer)
    clearTimeout(nopeTimer)
    ws.close()
  })

  function getWinningSongs(data: WinData) {
    return data.songHistory.filter(e => data.winningTileIds.includes(e.trackId))
  }
</script>

{#if hostDisconnected}
  <div class="host-disconnected-banner" role="status">
    Host disconnected — waiting for them to reconnect…
  </div>
{/if}

{#if winData !== null}
  <WinOverlay
    winnerName={winData.winnerName}
    winningSongs={getWinningSongs(winData)}
    isHost={false}
    onStartNextRound={() => {}}
    onDismiss={() => { winData = null }}
  />
{/if}

{#if showHistory}
  <SongHistoryDrawer entries={songHistory} {currentRevealed} onClose={() => { showHistory = false }} />
{/if}

{#if showPlayers}
  <PlayersOverlay {players} {hostName} selfName={name} onClose={() => { showPlayers = false }} />
{/if}

<main class="room-page" class:game-active={tiles.length > 0}>
  {#if tiles.length > 0}
    <GameHeader {playerCount} {code} {songIndex} historyOpen={showHistory} playersOpen={showPlayers} onPlayersClick={() => { showPlayers = !showPlayers; showHistory = false }} onHistoryClick={() => { showHistory = !showHistory; showPlayers = false }} />
    <BingoCard {tiles} {nopeIndex} onTileClick={handleTileClick} />
    {#if hasBingo && !isClaiming}
      <button class="bingo-btn" onclick={handleBingoClick}>Bingo!</button>
    {:else if isClaiming}
      <button class="bingo-btn bingo-btn--disabled" disabled>Claiming…</button>
    {/if}
    <p class="status-line" role="status">{statusLine}</p>
  {:else}
    <GuestWaitingRoom {code} selfName={name} {hostName} {players} {onLeave} />
  {/if}
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
