import { describe, it, expect, vi } from 'vitest'
import { buildPool, generateCard, generateCards } from '../game/cards.ts'
import type { Track } from '../music/spotify.ts'

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `track_${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    albumArtUrl: `https://img/${i}`,
    durationMs: 180000,
  }))
}

describe('buildPool', () => {
  it('returns all tracks when no excluded ids', () => {
    const tracks = makeTracks(30)
    const pool = buildPool(tracks, new Set())
    expect(pool).toHaveLength(30)
    const ids = pool.map(t => t.id)
    expect(ids.sort()).toEqual(tracks.map(t => t.id).sort())
  })

  it('excludes tracks from excludedIds', () => {
    const tracks = makeTracks(10)
    const excluded = new Set(['track_5', 'track_6'])
    const pool = buildPool(tracks, excluded)
    expect(pool).toHaveLength(8)
    const ids = new Set(pool.map(t => t.id))
    expect(ids.has('track_5')).toBe(false)
    expect(ids.has('track_6')).toBe(false)
  })

  it('returns empty pool when every track is excluded', () => {
    const tracks = makeTracks(5)
    const excluded = new Set(tracks.map(t => t.id))
    const pool = buildPool(tracks, excluded)
    expect(pool).toHaveLength(0)
  })
})

describe('generateCard', () => {
  it('returns exactly 25 tiles', () => {
    const pool = makeTracks(30)
    const card = generateCard(pool)
    expect(card).toHaveLength(25)
  })

  it('tile at index 12 is the FREE tile', () => {
    const pool = makeTracks(30)
    const card = generateCard(pool)
    expect(card[12].free).toBe(true)
    expect(card[12].trackId).toBe('')
  })

  it('all non-FREE tiles have trackId, title, artist, albumArtUrl', () => {
    const pool = makeTracks(30)
    const card = generateCard(pool)
    for (let i = 0; i < 25; i++) {
      if (i === 12) continue
      expect(card[i].trackId).toBeTruthy()
      expect(card[i].title).toBeTruthy()
      expect(card[i].artist).toBeTruthy()
      expect(card[i].free).toBeUndefined()
    }
  })

  it('only uses tracks from the pool', () => {
    const pool = makeTracks(100)
    const allowedIds = new Set(pool.map(t => t.id))
    const card = generateCard(pool)
    for (const tile of card) {
      if (!tile.free) {
        expect(allowedIds.has(tile.trackId)).toBe(true)
      }
    }
  })

  // Story 13-8: post-story this invariant also relies on getPlaylistTracks
  // deduping its input — the Spotify layer is the first safety net.
  it('does not duplicate track ids (excluding FREE tile)', () => {
    const pool = makeTracks(30)
    const card = generateCard(pool)
    const ids = card.filter(t => !t.free).map(t => t.trackId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Story 13-8: generateCard now shuffles the full pool before slicing, so
  // a pool larger than 25 tracks yields varying card subsets across calls.
  it('produces varying subsets across calls when pool > 25', () => {
    const pool = makeTracks(100)
    const subsets = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const card = generateCard(pool)
      const ids = card.filter(t => !t.free).map(t => t.trackId).sort().join(',')
      subsets.add(ids)
    }
    // A loose statistical check — effectively impossible to fail by chance.
    expect(subsets.size).toBeGreaterThanOrEqual(2)
  })
})

describe('generateCards', () => {
  it('returns a card for every player id', () => {
    const pool = makeTracks(30)
    const playerIds = ['alice', 'bob', 'charlie']
    const cards = generateCards(pool, playerIds)
    expect(cards.size).toBe(3)
    for (const id of playerIds) {
      expect(cards.has(id)).toBe(true)
      expect(cards.get(id)).toHaveLength(25)
    }
  })

  it('each card has FREE tile at index 12', () => {
    const pool = makeTracks(30)
    const cards = generateCards(pool, ['p1', 'p2', 'p3'])
    for (const card of cards.values()) {
      expect(card[12].free).toBe(true)
    }
  })

  it('produces unique cards for different players (with large pool)', () => {
    // Deterministic Math.random so this test can't flake. LCG produces
    // enough variation across five card generations for distinct shuffles.
    let seed = 0x9e3779b1
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    })
    try {
      const pool = makeTracks(100)
      const playerIds = Array.from({ length: 5 }, (_, i) => `player_${i}`)
      const cards = generateCards(pool, playerIds)
      const keys = [...cards.values()].map(card =>
        card.filter(t => !t.free).map(t => t.trackId).join(',')
      )
      const uniqueKeys = new Set(keys)
      expect(uniqueKeys.size).toBe(playerIds.length)
    } finally {
      spy.mockRestore()
    }
  })

  it('returns empty map for empty playerIds', () => {
    const pool = makeTracks(30)
    const cards = generateCards(pool, [])
    expect(cards.size).toBe(0)
  })

  // Story 13-8: with pool > 25 and independent per-player draws, cards
  // should differ in *content*, not just in tile order.
  it('produces different card contents (not just layouts) when pool > 25 and multiple players', () => {
    const pool = makeTracks(100)
    const cards = generateCards(pool, ['a', 'b', 'c'])
    const setA = new Set(cards.get('a')!.filter(t => !t.free).map(t => t.trackId))
    const setB = new Set(cards.get('b')!.filter(t => !t.free).map(t => t.trackId))
    // At least one track on A that isn't on B.
    const diff = [...setA].filter(id => !setB.has(id))
    expect(diff.length).toBeGreaterThan(0)
  })
})
