import { describe, it, expect, vi, afterEach } from 'vitest'
import { startRound } from '../lib/api.ts'

afterEach(() => vi.restoreAllMocks())

describe('startRound', () => {
  it('calls POST /api/rooms/:code/round with correct body', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ roundNumber: 1, playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }),
    } as Response)

    await startRound('ABCD', { playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 })

    expect(mockFetch).toHaveBeenCalledWith('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }),
    })
  })

  it('returns parsed response on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ roundNumber: 2, playlistId: 'pl2', clipDuration: 'full', titleRevealDelay: null }),
    } as Response)

    const result = await startRound('ABCD', { playlistId: 'pl2', clipDuration: 'full', titleRevealDelay: null })

    expect(result).toEqual({ roundNumber: 2, playlistId: 'pl2', clipDuration: 'full', titleRevealDelay: null })
  })

  it('throws with server error message on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid clipDuration' }),
    } as Response)

    await expect(startRound('ABCD', { playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }))
      .rejects.toThrow('Invalid clipDuration')
  })

  it('throws fallback message when error body has no message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response)

    await expect(startRound('ABCD', { playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }))
      .rejects.toThrow('Request failed')
  })

  it('throws fallback message when error body is not JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => { throw new Error('not json') },
    } as unknown as Response)

    await expect(startRound('ABCD', { playlistId: 'pl1', clipDuration: 30, titleRevealDelay: 5 }))
      .rejects.toThrow('Request failed')
  })
})
