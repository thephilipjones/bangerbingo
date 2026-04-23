import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { initDb, upsertHost } from '../db.ts'

// Stub env BEFORE dynamic imports
vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { musicRouter } = await import('../music/router.ts')
const { signUserId } = await import('../auth.ts')

// ── Helpers ────────────────────────────────────────────────────────────────

function seedHost(userId = 'host_1', tokenExpiresAt = Date.now() + 3_600_000) {
  upsertHost({
    user_id: userId,
    display_name: 'Test Host',
    email: 'test@example.com',
    access_token: 'valid_token',
    refresh_token: 'ref_token',
    token_expires_at: tokenExpiresAt,
  })
}

function sessionCookie(userId = 'host_1') {
  return `session=${signUserId(userId)}`
}

function makeApp() {
  const app = new Hono()
  app.route('/api', musicRouter)
  return app
}

// ── GET /api/music/presets ─────────────────────────────────────────────────

describe('GET /api/music/presets', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('returns 401 without a session cookie', async () => {
    const app = makeApp()
    const res = await app.request('/api/music/presets')
    expect(res.status).toBe(401)
  })

  it('returns at least 6 presets each with name, description, playlistId', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/music/presets', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    const presets = await res.json() as Array<{ name: string; description: string; playlistId: string }>
    expect(presets.length).toBeGreaterThanOrEqual(6)
    for (const preset of presets) {
      expect(typeof preset.name).toBe('string')
      expect(typeof preset.description).toBe('string')
      expect(typeof preset.playlistId).toBe('string')
    }
  })
})

// ── GET /api/music/search ──────────────────────────────────────────────────

describe('GET /api/music/search', () => {
  function mockSpotifySearch(items: Array<{ id: string; name: string; owner: { display_name: string }; tracks: { total: number } }>, next: string | null = null) {
    return vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ playlists: { next, items } }),
    } as Response)
  }

  beforeEach(() => {
    initDb(':memory:')
    mockSpotifySearch([
      { id: 'pl1', name: 'Chill Vibes', owner: { display_name: 'Spotify' }, tracks: { total: 50 } },
      { id: 'pl2', name: 'Party Mix', owner: { display_name: 'User123' }, tracks: { total: 30 } },
    ])
  })

  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without a session cookie', async () => {
    const app = makeApp()
    const res = await app.request('/api/music/search?q=chill')
    expect(res.status).toBe(401)
  })

  it('returns mapped playlist results wrapped with hasMore=false when next is null', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/music/search?q=chill', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      results: Array<{ name: string; owner: string; trackCount: number; playlistId: string }>
      hasMore: boolean
    }
    expect(body.hasMore).toBe(false)
    expect(body.results).toHaveLength(2)
    expect(body.results[0]).toEqual({ name: 'Chill Vibes', owner: 'Spotify', trackCount: 50, playlistId: 'pl1' })
    expect(body.results[1]).toEqual({ name: 'Party Mix', owner: 'User123', trackCount: 30, playlistId: 'pl2' })
  })

  it('returns hasMore=true when Spotify response includes a next page URL', async () => {
    seedHost()
    vi.restoreAllMocks()
    mockSpotifySearch(
      [{ id: 'pl1', name: 'Chill Vibes', owner: { display_name: 'Spotify' }, tracks: { total: 50 } }],
      'https://api.spotify.com/v1/search?offset=10&limit=10&q=chill&type=playlist',
    )
    const app = makeApp()
    const res = await app.request('/api/music/search?q=chill', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { hasMore: boolean }
    expect(body.hasMore).toBe(true)
  })

  it('forwards the offset query param to Spotify', async () => {
    seedHost()
    vi.restoreAllMocks()
    const spy = mockSpotifySearch([], null)
    const app = makeApp()
    const res = await app.request('/api/music/search?q=chill&offset=20', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    const calledUrl = spy.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('offset=20')
    expect(calledUrl).toContain('limit=10')
  })

  it('returns 400 when offset is non-numeric', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/music/search?q=chill&offset=abc', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when offset exceeds Spotify cap (offset+limit > 1000)', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/music/search?q=chill&offset=991', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(400)
  })

  it('accepts offset=990 (Spotify boundary)', async () => {
    seedHost()
    vi.restoreAllMocks()
    mockSpotifySearch([], null)
    const app = makeApp()
    const res = await app.request('/api/music/search?q=chill&offset=990', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
  })

  it('triggers inline token refresh when token is expired', async () => {
    const expiredAt = Date.now() - 1000
    seedHost('host_refresh', expiredAt)

    const refreshModule = await import('../refresh.ts')
    const refreshSpy = vi.spyOn(refreshModule, 'refreshWithRetry').mockImplementation(async (userId) => {
      // Simulate what a real refresh does: update the token in the DB
      upsertHost({
        user_id: userId,
        display_name: 'Test Host',
        email: 'test@example.com',
        access_token: 'refreshed_token',
        refresh_token: 'ref_token',
        token_expires_at: Date.now() + 3_600_000,
      })
    })

    const app = makeApp()
    const res = await app.request('/api/music/search?q=test', {
      headers: { Cookie: `session=${signUserId('host_refresh')}` },
    })
    expect(res.status).toBe(200)
    expect(refreshSpy).toHaveBeenCalledWith('host_refresh')
  })
})

// ── GET /api/music/tracks/:playlistId ─────────────────────────────────────

describe('GET /api/music/tracks/:playlistId', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without a session cookie', async () => {
    const app = makeApp()
    const res = await app.request('/api/music/tracks/somePlaylistId')
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid playlistId format (contains underscore / too short)', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/music/tracks/bad_id', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('Invalid playlist ID')
  })

  it('returns 400 for path traversal characters in playlistId (AC-5)', async () => {
    seedHost()
    const app = makeApp()
    // %2F = URL-encoded slash; param value becomes ../etc — non-alphanumeric, rejected
    const res = await app.request('/api/music/tracks/..%2F..%2Fetc', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('Invalid playlist ID')
  })

  it('returns mapped tracks for a playlist with >= 25 tracks', async () => {
    seedHost()

    // Build 25 mock tracks
    const mockItems = Array.from({ length: 25 }, (_, i) => ({
      track: {
        id: `track_${i}`,
        name: `Song ${i}`,
        artists: [{ name: `Artist ${i}` }],
        album: { images: [{ url: `https://img.example.com/${i}.jpg` }] },
        duration_ms: 210_000,
      },
    }))

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: mockItems }),
    } as Response)

    const app = makeApp()
    const res = await app.request('/api/music/tracks/37i9dQZF1DXcBWIGoYBM5M', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    const tracks = await res.json() as Array<{
      id: string; title: string; artist: string; albumArtUrl: string
    }>
    expect(tracks).toHaveLength(25)
    expect(tracks[0]).toEqual({
      id: 'track_0',
      title: 'Song 0',
      artist: 'Artist 0',
      albumArtUrl: 'https://img.example.com/0.jpg',
      durationMs: 210_000,
    })
  })

  it('returns 422 when playlist has fewer than 25 usable tracks', async () => {
    seedHost()

    const mockItems = Array.from({ length: 10 }, (_, i) => ({
      track: {
        id: `track_${i}`,
        name: `Song ${i}`,
        artists: [{ name: `Artist ${i}` }],
        album: { images: [] },
      },
    }))

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: mockItems }),
    } as Response)

    const app = makeApp()
    const res = await app.request('/api/music/tracks/37i9dQZF1DXcBWIGoYBM5M', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('25')
  })

  it('filters out null tracks (local files / removed tracks)', async () => {
    seedHost()

    // 20 valid + 10 nulls => should return 422 (< 25 usable)
    const mockItems = [
      ...Array.from({ length: 20 }, (_, i) => ({
        track: {
          id: `track_${i}`,
          name: `Song ${i}`,
          artists: [{ name: `Artist ${i}` }],
          album: { images: [] },
        },
      })),
      ...Array.from({ length: 10 }, () => ({ track: null })),
    ]

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: mockItems }),
    } as Response)

    const app = makeApp()
    const res = await app.request('/api/music/tracks/37i9dQZF1DXcBWIGoYBM5M', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(422)
  })

  it('returns 502 when Spotify returns a non-2xx response', async () => {
    seedHost()

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    } as Response)

    const app = makeApp()
    const res = await app.request('/api/music/tracks/37i9dQZF1DXcBWIGoYBM5M', {
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(502)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('Spotify API error')
  })
})
