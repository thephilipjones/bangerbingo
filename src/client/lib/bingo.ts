export type TitleRevealDelay = 0 | 5 | 10 | 15 | null

export interface Tile {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  free?: true
}

export interface ClientTile {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  free: boolean
  state: 'unmarked' | 'marked' | 'free'
  masked: boolean
  revealing: boolean
  winPath: boolean
  songLabel: string
}

export function initTiles(card: Tile[]): ClientTile[] {
  return card.map((tile, i) => ({
    trackId: tile.trackId,
    title: tile.title,
    artist: tile.artist,
    albumArtUrl: tile.albumArtUrl,
    free: i === 12 || tile.free === true,
    state: i === 12 || tile.free === true ? 'free' : 'unmarked',
    masked: false,
    revealing: false,
    winPath: false,
    songLabel: '',
  }))
}

export function applyMask(
  tiles: ClientTile[],
  trackId: string,
  titleRevealDelay: TitleRevealDelay,
  songIndex: number = 0,
): ClientTile[] {
  if (titleRevealDelay === 0) return tiles
  return tiles.map((tile) =>
    tile.trackId === trackId
      ? { ...tile, masked: true, songLabel: `Song ${songIndex + 1}` }
      : tile,
  )
}

export function startReveal(tiles: ClientTile[], trackId: string): ClientTile[] {
  return tiles.map((tile) =>
    tile.trackId === trackId ? { ...tile, revealing: true } : tile,
  )
}

export function finishReveal(tiles: ClientTile[], trackId: string): ClientTile[] {
  return tiles.map((tile) =>
    tile.trackId === trackId ? { ...tile, masked: false, revealing: false } : tile,
  )
}

export function toggleMark(tiles: ClientTile[], index: number): ClientTile[] {
  return tiles.map((tile, i) => {
    if (i !== index) return tile
    if (tile.free) return tile
    return { ...tile, state: tile.state === 'marked' ? 'unmarked' : 'marked' }
  })
}

/** FNV-1a hash of the card's track IDs — stable key for localStorage mark persistence. */
export function cardFingerprint(card: Tile[]): string {
  let h = 0x811c9dc5
  for (const tile of card) {
    for (let i = 0; i < tile.trackId.length; i++) {
      h ^= tile.trackId.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  return (h >>> 0).toString(36)
}

export function restoreMarks(tiles: ClientTile[], markedIds: Set<string>): ClientTile[] {
  if (markedIds.size === 0) return tiles
  return tiles.map((tile) =>
    !tile.free && markedIds.has(tile.trackId) ? { ...tile, state: 'marked' as const } : tile,
  )
}

export function applyWinPath(tiles: ClientTile[], winningTileIds: string[]): ClientTile[] {
  const idSet = new Set(winningTileIds)
  return tiles.map((tile) => {
    if (tile.free && idSet.has('FREE')) return { ...tile, winPath: true }
    if (idSet.has(tile.trackId)) return { ...tile, winPath: true }
    return tile
  })
}
