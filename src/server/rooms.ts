import { Hono } from 'hono'
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { createRoom, getRoomsByHost, getRoomByCode, getHostById, getPlayedSongs, recordPlayedSongs, type Room } from './db.ts'
import { requireAuth, type AuthEnv } from './auth.ts'
import { roomSockets, type RoundConfig, type ClipDuration, type TitleRevealDelay } from './ws.ts'
import { refreshWithRetry, isHostDegraded } from './refresh.ts'
import { getPlaylistTracks } from './music/spotify.ts'
import { buildPool, generateCards } from './game/cards.ts'

// ── Room code generation ───────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // 24 chars: A-Z minus O and I

export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  }
  return code
}

export function createRoomWithRetry(
  hostUserId: string,
  codeGen: () => string = generateRoomCode
): Room {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = codeGen()
    try {
      return createRoom(code, hostUserId)
    } catch (err: unknown) {
      // UNIQUE constraint violation — retry
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        continue
      }
      throw err
    }
  }
  throw new Error('Failed to generate unique room code after 10 attempts')
}

// ── Rooms router ───────────────────────────────────────────────────────────

export const roomsRouter = new Hono<AuthEnv>()

roomsRouter.post('/rooms', requireAuth, (ctx) => {
  const host = ctx.var.host
  try {
    const room = createRoomWithRetry(host.user_id)
    return ctx.json({ code: room.code, url: `/room/${room.code}`, created_at: room.created_at })
  } catch (err) {
    return ctx.json({ error: 'Failed to generate unique room code' }, 500)
  }
})

roomsRouter.get('/rooms', requireAuth, (ctx) => {
  const host = ctx.var.host
  const rooms = getRoomsByHost(host.user_id)
  return ctx.json(rooms)
})

// ── Round config ───────────────────────────────────────────────────────────

const VALID_CLIP_DURATIONS: ClipDuration[] = [20, 30, 45, 60, 'full']
const VALID_TITLE_REVEAL_DELAYS: TitleRevealDelay[] = [0, 5, 10, 15, null]

roomsRouter.post('/rooms/:code/round', requireAuth, async (ctx) => {
  let host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const body = await ctx.req.json().catch(() => null)
  if (!body) return ctx.json({ message: 'Invalid request body' }, 400)

  const { playlistId, clipDuration, titleRevealDelay } = body

  if (!playlistId || typeof playlistId !== 'string' || !playlistId.trim())
    return ctx.json({ message: 'playlistId is required' }, 400)
  if (!VALID_CLIP_DURATIONS.includes(clipDuration))
    return ctx.json({ message: 'Invalid clipDuration' }, 400)
  if (!VALID_TITLE_REVEAL_DELAYS.includes(titleRevealDelay))
    return ctx.json({ message: 'Invalid titleRevealDelay' }, 400)

  const roomState = roomSockets.get(code)
  const roundNumber = roomState?.currentRound
    ? roomState.currentRound.roundNumber + 1
    : roomState?.pendingRound
      ? roomState.pendingRound.roundNumber + 1
      : 1

  const roundConfig: RoundConfig = { playlistId, clipDuration, titleRevealDelay, roundNumber }

  // Inline token refresh before Spotify call
  if (host.token_expires_at - Date.now() < 60_000) {
    await refreshWithRetry(host.user_id)
    if (isHostDegraded(host.user_id)) {
      return ctx.json({ message: 'Spotify authentication degraded — please re-authenticate' }, 503)
    }
    const refreshed = getHostById(host.user_id)
    if (!refreshed) return ctx.json({ message: 'Unauthorized' }, 401)
    host = refreshed
  }

  // Fetch tracks — returns 422 if fewer than 25 (InsufficientTracksError thrown by getPlaylistTracks)
  let playlist
  try {
    playlist = await getPlaylistTracks(playlistId, host.access_token)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InsufficientTracksError') {
      return ctx.json({ message: err.message }, 422)
    }
    throw err
  }

  // Build pool with down-ranking
  const sessionPlayedIds = roomState?.currentRound?.sessionPlayedIds ?? []
  const historicPlayedIds = getPlayedSongs(code)
  const pool = buildPool(playlist, sessionPlayedIds, historicPlayedIds)

  // Generate a card per player (host + all connected guests)
  const hostKey = host.user_id
  const guestKeys = roomState ? Array.from(roomState.guests.keys()) : []
  const playerIds = [hostKey, ...guestKeys]
  const cards = generateCards(pool, playerIds)

  // Cache the round-start payload (without card — added per-player below)
  const roundStartPayload = {
    type: 'round:start',
    roundNumber,
    playlist,
    clipDuration,
    titleRevealDelay,
  }

  // Track session-played accumulation
  const dealtTrackIds = pool.slice(0, 25).map(t => t.id)
  const newSessionPlayed = [...sessionPlayedIds, ...dealtTrackIds]

  // Store round state
  if (roomState) {
    roomState.currentRound = {
      roundNumber,
      config: roundConfig,
      playlist,
      cards,
      roundStartPayload,
      sessionPlayedIds: newSessionPlayed,
      active: true,
    }
    roomState.pendingRound = roundConfig

    // Broadcast round:start per-client (each gets their own card)
    if (roomState.host?.readyState === WebSocket.OPEN) {
      const hostCard = cards.get(hostKey) ?? []
      roomState.host.send(JSON.stringify({ ...roundStartPayload, card: hostCard }))
    }
    for (const [guestName, ws] of roomState.guests) {
      if (ws.readyState === WebSocket.OPEN) {
        const guestCard = cards.get(guestName) ?? []
        ws.send(JSON.stringify({ ...roundStartPayload, card: guestCard }))
      }
    }
  }

  // Persist played songs to SQLite
  recordPlayedSongs(code, dealtTrackIds)

  return ctx.json(roundConfig)
})
