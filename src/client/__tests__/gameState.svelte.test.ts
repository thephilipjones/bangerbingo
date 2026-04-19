// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGameState } from '../lib/gameState.svelte.ts'

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
