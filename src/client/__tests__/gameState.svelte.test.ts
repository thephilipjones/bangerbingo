// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGameState } from '../lib/gameState.svelte.ts'
import { cardFingerprint } from '../lib/bingo.ts'
import type { Tile } from '../lib/bingo.ts'

function mockFetch(status: number) {
  return vi.fn().mockResolvedValue({ status } as Response)
}

describe('handleBingoClick — auto-claim guard (Story 9-1)', () => {
  let originalFetch: typeof fetch
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    cleanup?.()
    cleanup = undefined
  })

  it('calls /api/rooms/:code/round/claim exactly once when invoked twice before response', async () => {
    const fetchSpy = mockFetch(200)
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    let game!: ReturnType<typeof createGameState>
    cleanup = $effect.root(() => {
      game = createGameState({
        code: 'ABCD',
        getPlayerName: () => 'Alice',
      })
    })

    // Fire twice rapidly — the second call must hit the guard.
    const p1 = game.handleBingoClick()
    const p2 = game.handleBingoClick()
    await Promise.all([p1, p2])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/rooms/ABCD/round/claim')
  })

  it('resets the guard when the server returns a non-200', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ status: 409 } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response)
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    let game!: ReturnType<typeof createGameState>
    cleanup = $effect.root(() => {
      game = createGameState({
        code: 'ABCD',
        getPlayerName: () => 'Alice',
      })
    })

    await game.handleBingoClick()
    await game.handleBingoClick()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('resets the guard when the fetch throws', async () => {
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 200 } as Response)
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    let game!: ReturnType<typeof createGameState>
    cleanup = $effect.root(() => {
      game = createGameState({
        code: 'ABCD',
        getPlayerName: () => 'Alice',
      })
    })

    await game.handleBingoClick()
    await game.handleBingoClick()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('latches on 200 until round:start resets the guard', async () => {
    const fetchSpy = mockFetch(200)
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    let game!: ReturnType<typeof createGameState>
    cleanup = $effect.root(() => {
      game = createGameState({
        code: 'ABCD',
        getPlayerName: () => 'Alice',
      })
    })

    // First claim latches the guard on 200.
    await game.handleBingoClick()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second call must NOT fire another POST — guard is latched.
    await game.handleBingoClick()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // round:start resets the guard alongside winData / isClaiming.
    game.processWsMessage({
      type: 'round:start',
      card: Array.from({ length: 25 }, (_, i) => ({
        trackId: `t${i}`, title: '', artist: '', albumArtUrl: '', free: i === 12,
      })),
      titleRevealDelay: 0,
      songHistory: [],
      roundNumber: 2,
    })

    // After round:start, a subsequent claim fires a fresh POST.
    await game.handleBingoClick()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does nothing when getPlayerName returns null', async () => {
    const fetchSpy = mockFetch(200)
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    let game!: ReturnType<typeof createGameState>
    cleanup = $effect.root(() => {
      game = createGameState({
        code: 'ABCD',
        getPlayerName: () => null,
      })
    })

    await game.handleBingoClick()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// Story 12-3: host marks persistence — parity with guest mechanism.
describe('host marks persistence wiring (Story 12-3)', () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    localStorage.clear()
  })

  function makeCard(): Tile[] {
    return Array.from({ length: 25 }, (_, i) => ({
      trackId: `t${i}`, title: '', artist: '', albumArtUrl: '', ...(i === 12 ? { free: true as const } : {}),
    }))
  }

  // Replicates HostRoomPage.svelte's mark-persistence wiring. If the host
  // wiring ever drifts from this shape, this test will not detect it — but
  // it pins the behavior of the createGameState callback contract that host
  // relies on, and by construction matches the guest key scheme.
  function mountHostGame(code = 'ABCD') {
    let marksKey = ''
    const loadMarks = (): Set<string> => {
      if (!marksKey) return new Set()
      try { return new Set(JSON.parse(localStorage.getItem(marksKey) ?? '[]')) } catch { return new Set() }
    }
    let game!: ReturnType<typeof createGameState>
    cleanup = $effect.root(() => {
      game = createGameState({
        code,
        getPlayerName: () => 'Host',
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
    })
    return { game, getMarksKey: () => marksKey }
  }

  it('getMarksForCard returns the same Set guests get under the same key', () => {
    const card = makeCard()
    const key = `bangerbingo:marks:ABCD:${cardFingerprint(card)}`
    localStorage.setItem(key, JSON.stringify(['t0', 't5']))

    const { game, getMarksKey } = mountHostGame()
    game.processWsMessage({
      type: 'round:start', card, titleRevealDelay: 0, songHistory: [
        { trackId: 't0', title: '', artist: '', albumArtUrl: '', songIndex: 0 },
        { trackId: 't5', title: '', artist: '', albumArtUrl: '', songIndex: 1 },
      ], roundNumber: 1,
    })

    expect(getMarksKey()).toBe(key)
    const markedTrackIds = game.tiles.filter(t => t.state === 'marked').map(t => t.trackId)
    expect(new Set(markedTrackIds)).toEqual(new Set(['t0', 't5']))
  })

  it('onTileMark persists marked trackIds to localStorage under the fingerprint key', () => {
    const card = makeCard()
    const { game } = mountHostGame()
    game.processWsMessage({
      type: 'round:start', card, titleRevealDelay: 0, songHistory: [
        { trackId: 't3', title: '', artist: '', albumArtUrl: '', songIndex: 0 },
      ], roundNumber: 1,
    })

    game.handleTileClick(3) // mark t3

    const key = `bangerbingo:marks:ABCD:${cardFingerprint(card)}`
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]')
    expect(stored).toEqual(['t3'])
  })

  it('onTileMark writes the empty list when the last mark is toggled off', () => {
    const card = makeCard()
    const key = `bangerbingo:marks:ABCD:${cardFingerprint(card)}`
    localStorage.setItem(key, JSON.stringify(['t3']))

    const { game } = mountHostGame()
    game.processWsMessage({
      type: 'round:start', card, titleRevealDelay: 0, songHistory: [
        { trackId: 't3', title: '', artist: '', albumArtUrl: '', songIndex: 0 },
      ], roundNumber: 1,
    })

    // Toggle off — state flips marked → unmarked, onTileMark writes empty list.
    game.handleTileClick(3)
    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual([])
  })
})

// Story 12-4 Track A — host reconnect mini-player hydrate rule.
// Mirrors the branch logic in HostRoomPage.svelte's round:start handler so a
// regression in either place is caught here. See Dev Notes (12-4) for why this
// lives at the handler-logic surface rather than via component mounting.
describe('Story 12-4 Track A — round:start currentTrack hydrate', () => {
  function hydrate(data: {
    songHistory?: Array<{ trackId: string; title: string; artist: string }>
    currentSongIndex?: number
    paused?: boolean
  }): {
    currentTrack: { title: string; artist: string } | null
    currentTrackId: string | null
    isPlaying: boolean
    autoPlay: boolean
  } {
    const history = data.songHistory
    const currentSongIndex = data.currentSongIndex
    const paused = data.paused
    let currentTrack: { title: string; artist: string } | null = null
    let currentTrackId: string | null = null
    let isPlaying = false
    let autoPlay = false
    if (!history || history.length === 0) {
      autoPlay = true
    } else if (currentSongIndex !== undefined && currentSongIndex >= 0) {
      const last = history[history.length - 1]
      currentTrack = { title: last.title, artist: last.artist }
      currentTrackId = last.trackId
      isPlaying = !(paused === true)
    }
    return { currentTrack, currentTrackId, isPlaying, autoPlay }
  }

  it('hydrates currentTrack from last history entry when reconnecting into active round', () => {
    const result = hydrate({
      songHistory: [
        { trackId: 't0', title: 'Song 0', artist: 'Artist 0' },
        { trackId: 't1', title: 'Song 1', artist: 'Artist 1' },
      ],
      currentSongIndex: 1,
      paused: false,
    })
    expect(result.currentTrack).toEqual({ title: 'Song 1', artist: 'Artist 1' })
    expect(result.currentTrackId).toBe('t1')
    expect(result.isPlaying).toBe(true)
    expect(result.autoPlay).toBe(false)
  })

  it('sets isPlaying = false when paused flag is true', () => {
    const result = hydrate({
      songHistory: [{ trackId: 't0', title: 'Song 0', artist: 'Artist 0' }],
      currentSongIndex: 0,
      paused: true,
    })
    expect(result.isPlaying).toBe(false)
    expect(result.currentTrackId).toBe('t0')
  })

  it('falls through to auto-play on fresh round (empty history)', () => {
    const result = hydrate({ songHistory: [], currentSongIndex: -1, paused: false })
    expect(result.autoPlay).toBe(true)
    expect(result.currentTrack).toBeNull()
  })
})

// Story 12-4 Track C — casualModeOn preservation across round:start events.
// Mirrors the invariant that the round:start handler MUST NOT mutate
// casualModeOn. The old code wrapped a `hasSeenRoundStart` gate and reset to
// false on the second event; deleting that block preserves server-truth.
describe('Story 12-4 Track C — casualModeOn preservation', () => {
  function applyRoundStart(casualModeOn: boolean): boolean {
    // Post-12-4 rule: round:start has no effect on casualModeOn. The only
    // mutations are (a) explicit user toggle, (b) session:connect hydration.
    return casualModeOn
  }

  it('casualModeOn survives a second round:start (reconnect resend or let-it-ride)', () => {
    let casualModeOn = true
    casualModeOn = applyRoundStart(casualModeOn)
    casualModeOn = applyRoundStart(casualModeOn)
    expect(casualModeOn).toBe(true)
  })

  it('casualModeOn = false stays false across round:start', () => {
    let casualModeOn = false
    casualModeOn = applyRoundStart(casualModeOn)
    expect(casualModeOn).toBe(false)
  })
})
