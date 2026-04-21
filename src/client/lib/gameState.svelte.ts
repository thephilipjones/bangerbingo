import type { AudioPreset } from './api.ts'

export type ClipDuration = number | 'full'
import { computePlayerCount } from './waitingRoom.ts'
import {
  initTiles,
  applyMask,
  applyAutoMarks,
  startReveal,
  finishReveal,
  toggleMark,
  applyWinPath,
  restoreMarks,
  isWinningLine,
} from './bingo.ts'
import type { ClientTile, Tile, TitleRevealDelay } from './bingo.ts'
import { applyPlayerEvent } from './ws.ts'
import { isValidClipDuration, isValidTitleRevealDelay, isValidAudioPreset } from './hostPrefs.ts'

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
  winnerCard: Tile[]
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
  initialWinsByName = {},
  initialLastRoundWinner = null,
  initialCasualModeNames = [],
  getMarksForCard,
  onTileMark,
}: {
  code: string
  /** Returns the player name to use when submitting a bingo claim. */
  getPlayerName: () => string | null
  initialPlayers?: string[]
  initialWinsByName?: Record<string, number>
  initialLastRoundWinner?: string | null
  initialCasualModeNames?: string[]
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
  let clipDuration = $state<ClipDuration>(30)
  let audioPreset = $state<AudioPreset>('minimal')
  let winData = $state<WinData | null>(null)
  let isClaiming = $state(false)
  let hasAutoClaimedThisRound = false
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
  let winsByName = $state<Record<string, number>>({ ...initialWinsByName })
  let lastRoundWinner = $state<string | null>(initialLastRoundWinner)
  let highestRoundNumber = $state(0)
  let hasStats = $state(Object.keys(initialWinsByName).length > 0 || initialLastRoundWinner !== null)
  const showStats = $derived(hasStats && highestRoundNumber >= 2)
  let allowCasualMode = $state(false)
  let casualModePlayers = $state<Set<string>>(new Set(initialCasualModeNames))
  let catchUpToastCount = $state<number | null>(null)
  let catchUpToastId = $state<number | null>(null)

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
    if (hasAutoClaimedThisRound) return
    const playerName = getPlayerName()
    if (!playerName) return
    hasAutoClaimedThisRound = true
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
        hasAutoClaimedThisRound = false
        isClaiming = false
      }
    } catch {
      hasAutoClaimedThisRound = false
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
      clipDuration = (data.clipDuration as ClipDuration | undefined) ?? 30
      audioPreset = (data.audioPreset as AudioPreset | undefined) ?? 'minimal'
      allowCasualMode = (data.allowCasualMode as boolean | undefined) ?? false
      casualModePlayers = new Set()
      catchUpToastCount = null
      catchUpToastId = null
      winData = null
      isClaiming = false
      hasAutoClaimedThisRound = false
      const rawHistory = (data.songHistory as HistoryEntry[] | undefined) ?? []
      songHistory = rawHistory.slice().reverse()
      const playedIds = new Set(rawHistory.map(e => e.trackId))
      tiles = restoreMarks(initTiles(card), getMarksForCard?.(card) ?? new Set<string>(), playedIds)
      songIndex = rawHistory.length > 0 ? rawHistory[rawHistory.length - 1].songIndex : null
      currentRevealed = (data.currentSongRevealed as boolean | undefined) ?? false
      highestRoundNumber = Math.max(highestRoundNumber, (data.roundNumber as number | undefined) ?? 0)
    } else if (data.type === 'round-config:changed') {
      const cfg = (data.config as Record<string, unknown> | undefined) ?? {}
      if ('clipDuration' in cfg && isValidClipDuration(cfg.clipDuration)) {
        clipDuration = cfg.clipDuration
      }
      if ('titleRevealDelay' in cfg && isValidTitleRevealDelay(cfg.titleRevealDelay)) {
        roundConfig = { titleRevealDelay: cfg.titleRevealDelay }
      }
      if ('audioPreset' in cfg && isValidAudioPreset(cfg.audioPreset)) {
        audioPreset = cfg.audioPreset
      }
      if ('allowCasualMode' in cfg && typeof cfg.allowCasualMode === 'boolean') {
        allowCasualMode = cfg.allowCasualMode
      }
    } else if (data.type === 'player:casual-mode-changed') {
      const s = new Set(casualModePlayers)
      if (data.enabled) s.add(data.name as string)
      else s.delete(data.name as string)
      casualModePlayers = s
    } else if (data.type === 'square:auto-marked') {
      const indices = (data.tileIndices as number[] | undefined) ?? []
      if (indices.length === 0) return
      tiles = applyAutoMarks(tiles, indices)
      onTileMark?.(tiles)
      if (data.catchUp === true) {
        catchUpToastCount = indices.length
        catchUpToastId = (catchUpToastId ?? 0) + 1
      }
    } else if (data.type === 'stats:updated') {
      winsByName = { ...((data.winsByName as Record<string, number> | undefined) ?? {}) }
      lastRoundWinner = (data.lastRoundWinner as string | null | undefined) ?? null
      hasStats = true
    } else if (data.type === 'song:start') {
      currentRevealed = (data.currentSongRevealed as boolean | undefined) ?? false
      if (roundConfig && !currentRevealed) {
        tiles = applyMask(tiles, data.trackId as string, roundConfig.titleRevealDelay, data.songIndex as number)
      }
      songIndex = data.songIndex as number
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
        winnerCard: (data.winnerCard as Tile[] | undefined) ?? [],
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
    get clipDuration() { return clipDuration },
    set clipDuration(v: ClipDuration) { clipDuration = v },
    get titleRevealDelay() { return roundConfig?.titleRevealDelay ?? null },
    set titleRevealDelay(v: TitleRevealDelay) { roundConfig = { titleRevealDelay: v } },
    get audioPreset() { return audioPreset },
    set audioPreset(v: AudioPreset) { audioPreset = v },
    get winData() { return winData },
    set winData(v: WinData | null) { winData = v },
    get isClaiming() { return isClaiming },
    get hasBingo() { return hasBingo },
    get songHistory() { return songHistory },
    get currentRevealed() { return currentRevealed },
    get playedTrackIds() { return playedTrackIds },
    get nopeIndex() { return nopeIndex },
    get showHistory() { return showHistory },
    set showHistory(v: boolean) { showHistory = v },
    get showPlayers() { return showPlayers },
    set showPlayers(v: boolean) { showPlayers = v },
    get songIndex() { return songIndex },
    get players() { return players },
    set players(v: string[]) { players = v },
    get playerCount() { return playerCount },
    get winsByName() { return winsByName },
    set winsByName(v: Record<string, number>) {
      winsByName = v
      if (Object.keys(v).length > 0) hasStats = true
    },
    get lastRoundWinner() { return lastRoundWinner },
    set lastRoundWinner(v: string | null) {
      lastRoundWinner = v
      if (v !== null) hasStats = true
    },
    get showStats() { return showStats },
    get allowCasualMode() { return allowCasualMode },
    set allowCasualMode(v: boolean) { allowCasualMode = v },
    get casualModePlayers() { return casualModePlayers },
    set casualModePlayers(v: Set<string>) { casualModePlayers = v },
    get catchUpToastCount() { return catchUpToastCount },
    get catchUpToastId() { return catchUpToastId },
    clearCatchUpToast() { catchUpToastCount = null },
    handleTileClick,
    handleBingoClick,
    processWsMessage,
    resetRound,
    cleanup,
  }
}
