import { Hono } from 'hono'
import { requireAuth, withFreshToken, type AuthEnv } from '../auth.ts'
import { PRESETS } from './presets.ts'
import { searchPlaylists, getPlaylistTracks, SpotifyApiError, InsufficientTracksError } from './spotify.ts'

export const musicRouter = new Hono<AuthEnv>()

// GET /api/music/presets
musicRouter.get('/music/presets', requireAuth, async (ctx) => {
  const freshHost = await withFreshToken(ctx.var.host)
  if (!freshHost) return ctx.json({ message: 'Spotify authentication degraded — please re-authenticate' }, 503)

  return ctx.json(PRESETS)
})

// GET /api/music/search?q=<query>
musicRouter.get('/music/search', requireAuth, async (ctx) => {
  const query = ctx.req.query('q')
  if (!query) return ctx.json({ message: 'Missing query parameter q' }, 400)

  const freshHost = await withFreshToken(ctx.var.host)
  if (!freshHost) return ctx.json({ message: 'Spotify authentication degraded — please re-authenticate' }, 503)

  try {
    const results = await searchPlaylists(query, freshHost.access_token)
    return ctx.json(results)
  } catch (err) {
    if (err instanceof SpotifyApiError) {
      return ctx.json({ message: `Spotify API error: ${err.message}` }, 502)
    }
    throw err
  }
})

// GET /api/music/tracks/:playlistId
musicRouter.get('/music/tracks/:playlistId', requireAuth, async (ctx) => {
  const playlistId = ctx.req.param('playlistId')
  if (!/^[A-Za-z0-9]{20,30}$/.test(playlistId)) {
    return ctx.json({ message: 'Invalid playlist ID' }, 400)
  }

  const freshHost = await withFreshToken(ctx.var.host)
  if (!freshHost) return ctx.json({ message: 'Spotify authentication degraded — please re-authenticate' }, 503)

  try {
    const tracks = await getPlaylistTracks(playlistId, freshHost.access_token)
    return ctx.json(tracks)
  } catch (err) {
    if (err instanceof InsufficientTracksError) {
      return ctx.json({ message: err.message }, 422)
    }
    if (err instanceof SpotifyApiError) {
      return ctx.json({ message: `Spotify API error: ${err.message}` }, 502)
    }
    throw err
  }
})
