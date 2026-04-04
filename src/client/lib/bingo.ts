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

export function applyWinPath(tiles: ClientTile[], winningTileIds: string[]): ClientTile[] {
  const idSet = new Set(winningTileIds)
  return tiles.map((tile) => {
    if (tile.free && idSet.has('FREE')) return { ...tile, winPath: true }
    if (idSet.has(tile.trackId)) return { ...tile, winPath: true }
    return tile
  })
}
