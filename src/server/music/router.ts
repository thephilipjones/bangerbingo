import { Hono } from 'hono'
import { requireAuth, type AuthEnv } from '../auth.ts'
import { refreshWithRetry, isHostDegraded } from '../refresh.ts'
import { getHostById } from '../db.ts'
import { PRESETS } from './presets.ts'
import { searchPlaylists, getPlaylistTracks, SpotifyApiError, InsufficientTracksError } from './spotify.ts'

export const musicRouter = new Hono<AuthEnv>()

// GET /api/music/presets
musicRouter.get('/music/presets', requireAuth, async (ctx) => {
  let host = ctx.var.host

  if (host.token_expires_at - Date.now() < 60_000) {
    await refreshWithRetry(host.user_id)
    if (isHostDegraded(host.user_id)) return ctx.json({ message: 'Spotify authentication failed' }, 401)
    const refreshed = getHostById(host.user_id)
    if (!refreshed) return ctx.json({ message: 'Unauthorized' }, 401)
    host = refreshed
  }

  return ctx.json(PRESETS)
})

// GET /api/music/search?q=<query>
musicRouter.get('/music/search', requireAuth, async (ctx) => {
  const query = ctx.req.query('q')
  if (!query) return ctx.json({ message: 'Missing query parameter q' }, 400)

  let host = ctx.var.host

  if (host.token_expires_at - Date.now() < 60_000) {
    await refreshWithRetry(host.user_id)
    if (isHostDegraded(host.user_id)) return ctx.json({ message: 'Spotify authentication failed' }, 401)
    const refreshed = getHostById(host.user_id)
    if (!refreshed) return ctx.json({ message: 'Unauthorized' }, 401)
    host = refreshed
  }

  try {
    const results = await searchPlaylists(query, host.access_token)
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

  let host = ctx.var.host

  if (host.token_expires_at - Date.now() < 60_000) {
    await refreshWithRetry(host.user_id)
    if (isHostDegraded(host.user_id)) return ctx.json({ message: 'Spotify authentication failed' }, 401)
    const refreshed = getHostById(host.user_id)
    if (!refreshed) return ctx.json({ message: 'Unauthorized' }, 401)
    host = refreshed
  }

  try {
    const tracks = await getPlaylistTracks(playlistId, host.access_token)
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
