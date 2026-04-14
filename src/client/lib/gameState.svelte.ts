import { computePlayerCount } from './waitingRoom.ts'
import {
  initTiles,
  applyMask,
  startReveal,
  finishReveal,
  toggleMark,
  applyWinPath,
  restoreMarks,
  isWinningLine,
} from './bingo.ts'
import type { ClientTile, Tile, TitleRevealDelay } from './bingo.ts'
import { applyPlayerEvent } from './ws.ts'

export const WIN_LINES: number[][] = [
  [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
  [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
  [0,6,12,18,24], [4,8,12,16,20],
]

export type HistoryEntry = {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  songIndex: number
}

export type WinData = {
  winnerName: string
  winningTileIds: string[]
  songHistory: HistoryEntry[]
}

/**
 * Shared reactive game state for both the guest and host room pages.
 * Call this once during component initialisation; it uses Svelte 5 runes internally.
 *
 * Both pages call processWsMessage() for every incoming WS message and then handle
 * any page-specific state changes themselves (statusLine, isPlaying, etc.).
 */
export function createGameState({
  code,
  getPlayerName,
  initialPlayers = [],
  getMarksForCard,
  onTileMark,
}: {
  code: string
  /** Returns the player name to use when submitting a bingo claim. */
  getPlayerName: () => string | null
  initialPlayers?: string[]
  /**
   * Called on round:start with the raw card array.
   * Use this to update a localStorage key and return any saved marks.
   * Omit for hosts — no mark persistence needed.
   */
  getMarksForCard?: (card: Tile[]) => Set<string>
  /** Called after a tile is marked or unmarked — e.g. to persist to localStorage. */
  onTileMark?: (tiles: ClientTile[]) => void
}) {
  let tiles = $state<ClientTile[]>([])
  let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)
  let winData = $state<WinData | null>(null)
  let isClaiming = $state(false)
  let songHistory = $state<HistoryEntry[]>([])
  const playedTrackIds = $derived(new Set(songHistory.map(e => e.trackId)))
  const hasBingo = $derived(
    tiles.length > 0 &&
    winData === null &&
    WIN_LINES.some(line => isWinningLine(tiles, line, playedTrackIds))
  )
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let nopeIndex = $state<number | null>(null)
  let nopeTimer: ReturnType<typeof setTimeout> | undefined
  let showHistory = $state(false)
  let showPlayers = $state(false)
  let currentRevealed = $state(false)
  let songIndex = $state<number | null>(null)
  let players = $state<string[]>(initialPlayers)
  const playerCount = $derived(computePlayerCount(players))

  function handleTileClick(index: number) {
    const tile = tiles[index]
    if (!tile || tile.free) return
    if (tile.state !== 'marked' && !playedTrackIds.has(tile.trackId)) {
      clearTimeout(nopeTimer)
      nopeIndex = null
      queueMicrotask(() => { nopeIndex = index })
      nopeTimer = setTimeout(() => { nopeIndex = null }, 450)
      return
    }
    clearTimeout(nopeTimer)
    nopeIndex = null
    tiles = toggleMark(tiles, index)
    onTileMark?.(tiles)
  }

  async function handleBingoClick() {
    const playerName = getPlayerName()
    if (!playerName) return
    isClaiming = true
    const claimedTileIds = tiles
      .filter(t => t.state === 'marked' || t.state === 'free')
      .map(t => t.free ? 'FREE' : t.trackId)
    try {
      const res = await fetch(`/api/rooms/${code}/round/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, claimedTileIds }),
      })
      if (res.status !== 200) {
        isClaiming = false
      }
    } catch {
      isClaiming = false
    }
  }

  /**
   * Process a parsed WS message for all shared game state.
   * Call this first in every WS message handler, then handle page-specific
   * state (statusLine, isPlaying, etc.) for messages you also care about.
   */
  function processWsMessage(data: Record<string, unknown>): void {
    if (data.type === 'round:start') {
      clearTimeout(revealTimer)
      clearTimeout(nopeTimer)
      nopeIndex = null
      const card = data.card as Tile[]
      roundConfig = { titleRevealDelay: data.titleRevealDelay as TitleRevealDelay }
      winData = null
      isClaiming = false
      const rawHistory = (data.songHistory as HistoryEntry[] | undefined) ?? []
      songHistory = rawHistory.slice().reverse()
      const playedIds = new Set(rawHistory.map(e => e.trackId))
      tiles = restoreMarks(initTiles(card), getMarksForCard?.(card) ?? new Set<string>(), playedIds)
      songIndex = rawHistory.length > 0 ? rawHistory[rawHistory.length - 1].songIndex : null
      currentRevealed = (data.currentSongRevealed as boolean | undefined) ?? false
    } else if (data.type === 'song:start') {
      if (roundConfig) {
        tiles = applyMask(tiles, data.trackId as string, roundConfig.titleRevealDelay, data.songIndex as number)
      }
      songIndex = data.songIndex as number
      currentRevealed = false
      songHistory = [
        {
          trackId: data.trackId as string,
          title: data.title as string,
          artist: data.artist as string,
          albumArtUrl: data.albumArtUrl as string,
          songIndex: data.songIndex as number,
        },
        ...songHistory.filter(e => e.songIndex !== data.songIndex),
      ]
    } else if (data.type === 'song:reveal') {
      currentRevealed = true
      tiles = startReveal(tiles, data.trackId as string)
      clearTimeout(revealTimer)
      revealTimer = setTimeout(() => {
        tiles = finishReveal(tiles, data.trackId as string)
      }, 300)
    } else if (data.type === 'round:win') {
      tiles = applyWinPath(tiles, data.winningTileIds as string[])
      isClaiming = false
      winData = {
        winnerName: data.winnerName as string,
        winningTileIds: data.winningTileIds as string[],
        songHistory: data.songHistory as HistoryEntry[],
      }
    } else if (data.type === 'player:joined' || data.type === 'player:left') {
      players = applyPlayerEvent(players, {
        type: data.type as 'player:joined' | 'player:left',
        name: data.name as string,
      })
    }
    // song:pause, songs:exhausted, and all page-specific messages are handled by the caller.
  }

  /**
   * Reset game state when a round ends (for guest: tiles cleared → waiting room shown).
   * Does not clear winData — the win overlay stays visible until dismissed or next round:start.
   */
  function resetRound() {
    clearTimeout(nopeTimer)
    nopeIndex = null
    tiles = []
    roundConfig = null
  }

  function cleanup() {
    clearTimeout(revealTimer)
    clearTimeout(nopeTimer)
  }

  return {
    get tiles() { return tiles },
    get winData() { return winData },
    set winData(v: WinData | null) { winData = v },
    get isClaiming() { return isClaiming },
    get hasBingo() { return hasBingo },
    get songHistory() { return songHistory },
    get currentRevealed() { return currentRevealed },
    get nopeIndex() { return nopeIndex },
    get showHistory() { return showHistory },
    set showHistory(v: boolean) { showHistory = v },
    get showPlayers() { return showPlayers },
    set showPlayers(v: boolean) { showPlayers = v },
    get songIndex() { return songIndex },
    get players() { return players },
    set players(v: string[]) { players = v },
    get playerCount() { return playerCount },
    handleTileClick,
    handleBingoClick,
    processWsMessage,
    resetRound,
    cleanup,
  }
}
