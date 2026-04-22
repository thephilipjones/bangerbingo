import type { Track } from '../music/spotify.ts'

export interface Tile {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  free?: true // only set on centre tile (index 12)
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function cardKey(card: Tile[]): string {
  return card.filter(t => !t.free).map(t => t.trackId).join(',')
}

export function buildPool(tracks: Track[], excludedIds: Set<string>): Track[] {
  return shuffle(tracks.filter(t => !excludedIds.has(t.id)))
}

export function generateCard(pool: Track[]): Tile[] {
  const sample = shuffle(pool).slice(0, 25)
  const tiles: Tile[] = sample.map(t => ({
    trackId: t.id,
    title: t.title,
    artist: t.artist,
    albumArtUrl: t.albumArtUrl,
  }))
  tiles[12] = { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
  return tiles
}

export function generateCards(pool: Track[], playerIds: string[]): Map<string, Tile[]> {
  const cards = new Map<string, Tile[]>()
  const generated: string[] = []

  for (const id of playerIds) {
    let card: Tile[]
    let attempts = 0
    do {
      card = generateCard(pool)
      attempts++
    } while (generated.includes(cardKey(card)) && attempts < 10)
    cards.set(id, card)
    generated.push(cardKey(card))
  }
  return cards
}
