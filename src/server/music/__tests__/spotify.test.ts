import { describe, it, expect, vi, afterEach } from 'vitest'
import { getPlaylistTracks, InsufficientTracksError } from '../spotify.ts'

function makeItem(id: string, name = `Song ${id}`) {
  return {
    track: {
      id,
      name,
      artists: [{ name: `Artist ${id}` }],
      album: { images: [{ url: `https://img/${id}` }] },
    },
  }
}

function mockSpotifyOk(items: unknown[]): void {
  // Response bodies can only be consumed once, so return a fresh Response per call.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ items }), { status: 200 })
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getPlaylistTracks', () => {
  // Story 13-8: Spotify playlists can contain duplicate track ids (users add
  // the same track manually; Spotify doesn't dedupe). Ingest is the first
  // safety net against duplicate tiles on a card.
  it('dedupes by track id', async () => {
    const items: ReturnType<typeof makeItem>[] = []
    for (let i = 0; i < 24; i++) items.push(makeItem(`t${i}`))
    // 3 duplicates of already-seen ids: 27 items → 24 unique.
    items.push(makeItem('t0'), makeItem('t1'), makeItem('t2'))
    // Need ≥25 unique to avoid InsufficientTracksError, so add one more.
    items.push(makeItem('t24'))
    mockSpotifyOk(items)

    const tracks = await getPlaylistTracks('pl', 'tok')
    expect(tracks).toHaveLength(25)
    const ids = tracks.map(t => t.id)
    expect(new Set(ids).size).toBe(25)
  })

  it('throws InsufficientTracksError when unique count < 25', async () => {
    const items: ReturnType<typeof makeItem>[] = []
    // 30 items but only 20 unique ids — the other 10 are duplicates.
    for (let i = 0; i < 20; i++) items.push(makeItem(`t${i}`))
    for (let i = 0; i < 10; i++) items.push(makeItem(`t${i}`))
    mockSpotifyOk(items)

    await expect(getPlaylistTracks('pl', 'tok')).rejects.toMatchObject({
      name: 'InsufficientTracksError',
      count: 20,
    })
    await expect(getPlaylistTracks('pl', 'tok')).rejects.toBeInstanceOf(InsufficientTracksError)
  })
})
