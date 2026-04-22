import { describe, it, expect, vi } from 'vitest'
import { buildPool, generateCard, generateCards } from '../game/cards.ts'
import type { Track } from '../music/spotify.ts'

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `track_${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    albumArtUrl: `https://img/${i}`,
  }))
}

describe('buildPool', () => {
  it('returns all tracks when no played ids', () => {
    const tracks = makeTracks(30)
    const pool = buildPool(tracks, [], [])
    expect(pool).toHaveLength(30)
    const ids = pool.map(t => t.id)
    expect(ids.sort()).toEqual(tracks.map(t => t.id).sort())
  })

  it('places fresh tracks before down-ranked tracks', () => {
    const tracks = makeTracks(10)
    const downrankedIds = ['track_0', 'track_1', 'track_2']
    const pool = buildPool(tracks, downrankedIds, [])
    const freshIds = pool.slice(0, 7).map(t => t.id)
    const downrankedResult = pool.slice(7).map(t => t.id)
    expect(freshIds.every(id => !downrankedIds.includes(id))).toBe(true)
    expect(downrankedResult.sort()).toEqual(downrankedIds.sort())
  })

  it('deduplicates tracks that appear in both session and historic played', () => {
    const tracks = makeTracks(10)
    const sessionPlayed = ['track_0', 'track_1']
    const historicPlayed = ['track_1', 'track_2'] // track_1 in both
    const pool = buildPool(tracks, sessionPlayed, historicPlayed)
    expect(pool).toHaveLength(10) // all tracks still present
    // track_0, track_1, track_2 should all be in the down-ranked portion (last 3)
    const downranked = pool.slice(7).map(t => t.id)
    expect(downranked.sort()).toEqual(['track_0', 'track_1', 'track_2'].sort())
  })

  it('down-ranks tracks from historicPlayedIds', () => {
    const tracks = makeTracks(10)
    const pool = buildPool(tracks, [], ['track_5', 'track_6'])
    const downranked = pool.slice(8).map(t => t.id)
    expect(downranked.sort()).toEqual(['track_5', 'track_6'].sort())
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

  it('only uses tracks from the pool (first 25)', () => {
    const pool = makeTracks(30)
    const allowedIds = new Set(pool.slice(0, 25).map(t => t.id))
    const card = generateCard(pool)
    for (const tile of card) {
      if (!tile.free) {
        expect(allowedIds.has(tile.trackId)).toBe(true)
      }
    }
  })

  it('does not duplicate track ids (excluding FREE tile)', () => {
    const pool = makeTracks(30)
    const card = generateCard(pool)
    const ids = card.filter(t => !t.free).map(t => t.trackId)
    expect(new Set(ids).size).toBe(ids.length)
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
})
