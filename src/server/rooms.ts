import { Hono } from 'hono'
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { createRoom, getRoomsByHost, getRoomByCode, getHostById, getPlayedSongs, recordPlayedSongs, deleteRoom, type Room } from './db.ts'
import { requireAuth, withFreshToken, type AuthEnv } from './auth.ts'
import { roomSockets, broadcast, destroyRoom, type RoundConfig, type ClipDuration, type TitleRevealDelay, type RoundState, type RoomState, type SongHistoryEntry } from './ws.ts'
import { getPlaylistTracks, SpotifyApiError } from './music/spotify.ts'
import { buildPool, generateCards } from './game/cards.ts'

// ── Win detection ─────────────────────────────────────────────────────────

const WIN_LINES: number[][] = [
  [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24], // rows
  [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24], // cols
  [0,6,12,18,24], [4,8,12,16,20], // diagonals
]

// ── Song scheduling constants and helpers ─────────────────────────────────

const SEEK_POSITION_MS = 60_000  // Fixed chorus-position offset for MVP (validated in Epic 2 spike)

function clearRoundTimers(round: RoundState): void {
  clearTimeout(round.timers.autoAdvance)
  clearTimeout(round.timers.reveal)
  round.timers.autoAdvance = undefined
  round.timers.reveal = undefined
}

function startSong(roomCode: string, roomState: RoomState, songIndex: number): void {
  const round = roomState.currentRound!

  // P3: guard against out-of-bounds index (e.g. empty playlist)
  if (songIndex < 0 || songIndex >= round.playlist.length) return

  const track = round.playlist[songIndex]

  clearRoundTimers(round)

  // P1: only append to history when starting a new song, not when resuming the same one
  if (round.currentSongIndex !== songIndex) {
    const entry: SongHistoryEntry = {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      albumArtUrl: track.albumArtUrl,
      songIndex,
    }
    round.songHistory.push(entry)
  }
  round.currentSongIndex = songIndex
  round.paused = false

  broadcast(roomCode, {
    type: 'song:start',
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    albumArtUrl: track.albumArtUrl,
    seekPositionMs: SEEK_POSITION_MS,
    clipDuration: round.config.clipDuration,
    titleRevealDelay: round.config.titleRevealDelay,
    songIndex,
    roundNumber: round.roundNumber,
  })

  // Fire-and-forget Spotify play via Web API (AC 5)
  const sdkDevice = roomState.sdkDeviceId
  if (sdkDevice) {
    const sdkHost = getHostById(roomState.hostUserId)
    if (sdkHost?.access_token) {
      fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(sdkDevice)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${sdkHost.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uris: [`spotify:track:${track.id}`],
            position_ms: SEEK_POSITION_MS,
          }),
        }
      ).catch((err) => console.error('[spotify:play]', err))
    }
  }

  // P4: capture roundNumber so stale timers from a previous round don't fire against a new one
  const capturedRoundNumber = round.roundNumber

  if (round.config.titleRevealDelay && round.config.titleRevealDelay > 0) {
    round.timers.reveal = setTimeout(() => {
      if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
      broadcast(roomCode, { type: 'song:reveal', trackId: track.id, songIndex })
    }, round.config.titleRevealDelay * 1000)
  }

  if (round.config.clipDuration !== 'full') {
    round.timers.autoAdvance = setTimeout(() => {
      if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
      advanceToNext(roomCode, roomState)
    }, (round.config.clipDuration as number) * 1000)
  }
}

// P2: returns true when playlist is exhausted so callers can reflect that in HTTP response
function advanceToNext(roomCode: string, roomState: RoomState): boolean {
  const round = roomState.currentRound
  if (!round?.active) return false
  clearRoundTimers(round)
  const nextIndex = round.currentSongIndex + 1
  if (nextIndex >= round.playlist.length) {
    broadcast(roomCode, { type: 'songs:exhausted' })
    return true
  }
  startSong(roomCode, roomState, nextIndex)
  return false
}

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

roomsRouter.delete('/rooms/:code', requireAuth, (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  // Broadcast + close sockets + clear roomSockets BEFORE the DB delete so
  // in-flight reads of the room during teardown still see a valid row.
  destroyRoom(code)
  deleteRoom(code)

  return ctx.body(null, 204)
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

  const freshHost = await withFreshToken(host)
  if (!freshHost) return ctx.json({ message: 'Spotify authentication degraded — please re-authenticate' }, 503)
  host = freshHost

  // Fetch tracks — returns 422 if fewer than 25 (InsufficientTracksError thrown by getPlaylistTracks)
  let playlist
  try {
    playlist = await getPlaylistTracks(playlistId, host.access_token)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InsufficientTracksError') {
      return ctx.json({ message: err.message }, 422)
    }
    if (err instanceof SpotifyApiError) {
      return ctx.json({ message: 'Failed to fetch playlist from Spotify' }, 502)
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
      currentSongIndex: -1,
      songHistory: [],
      paused: false,
      timers: {},
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

roomsRouter.post('/rooms/:code/round/play', requireAuth, (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  const round = roomState?.currentRound
  if (!round?.active) return ctx.json({ message: 'No active round' }, 404)

  if (round.currentSongIndex === -1) {
    startSong(code, roomState!, 0)
  } else if (round.paused) {
    startSong(code, roomState!, round.currentSongIndex)
  } else {
    return ctx.json({ message: 'Round is already playing' }, 400)
  }

  return ctx.json({ songIndex: round.currentSongIndex })
})

roomsRouter.post('/rooms/:code/round/next', requireAuth, (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  const round = roomState?.currentRound
  if (!round?.active) return ctx.json({ message: 'No active round' }, 404)

  const exhausted = advanceToNext(code, roomState!)

  return ctx.json({ songIndex: round.currentSongIndex, exhausted })
})

roomsRouter.post('/rooms/:code/round/pause', requireAuth, (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  const round = roomState?.currentRound
  if (!round?.active) return ctx.json({ message: 'No active round' }, 404)

  // P6: cannot pause before the first song has started
  if (round.currentSongIndex === -1) return ctx.json({ message: 'Round not started' }, 400)

  clearRoundTimers(round)
  round.paused = true
  broadcast(code, { type: 'song:pause', songIndex: round.currentSongIndex })

  // Fire-and-forget Spotify pause via Web API (AC 6)
  const sdkDevice = roomState!.sdkDeviceId
  if (sdkDevice) {
    const sdkHost = getHostById(roomState!.hostUserId)
    if (sdkHost?.access_token) {
      fetch(
        `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(sdkDevice)}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${sdkHost.access_token}` },
        }
      ).catch((err) => console.error('[spotify:pause]', err))
    }
  }

  return ctx.json({})
})

roomsRouter.post('/rooms/:code/sdk/device', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const body = await ctx.req.json().catch(() => null)
  if (!body || typeof body.deviceId !== 'string') return ctx.json({ message: 'Invalid request body' }, 400)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)
  roomState.sdkDeviceId = body.deviceId

  return ctx.json({})
})

roomsRouter.post('/rooms/:code/round/end', requireAuth, (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  const round = roomState?.currentRound
  if (!round?.active) return ctx.json({ message: 'No active round' }, 404)

  clearRoundTimers(round)
  roomState!.currentRound = undefined
  broadcast(code, { type: 'round:end' })

  return ctx.json({})
})

roomsRouter.post('/rooms/:code/round/claim', async (ctx) => {
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)

  const roomState = roomSockets.get(code)
  const round = roomState?.currentRound
  if (!roomState || !round) return ctx.json({ message: 'No active round' }, 404)

  if (!round.active || round.ended) return ctx.json({ message: 'Round already ended' }, 409)

  // Set ended optimistically before any await to close the race window
  round.ended = true

  const body = await ctx.req.json().catch(() => null)
  if (!body || typeof body.playerName !== 'string' || !Array.isArray(body.claimedTileIds) ||
      !body.claimedTileIds.every((id: unknown) => typeof id === 'string')) {
    round.ended = false
    return ctx.json({ message: 'Invalid request body' }, 400)
  }

  const { playerName, claimedTileIds } = body as { playerName: string; claimedTileIds: string[] }

  const card = round.cards.get(playerName)
  if (!card) { round.ended = false; return ctx.json({ message: 'Player card not found' }, 422) }

  const effectiveId = (tile: { free?: boolean; trackId: string }) => tile.free ? 'FREE' : tile.trackId

  // All claimed IDs must be present on the player's card
  const allOnCard = claimedTileIds.every(id => card.some(t => effectiveId(t) === id))
  if (!allOnCard) { round.ended = false; return ctx.json({ message: 'Claimed tile not on player card' }, 422) }

  // Non-FREE claimed IDs must all be in song history (i.e. have been played)
  const nonFree = claimedTileIds.filter(id => id !== 'FREE')
  const allPlayed = nonFree.every(id => round.songHistory.some(e => e.trackId === id))
  if (!allPlayed) { round.ended = false; return ctx.json({ message: 'Claimed tile has not been played' }, 422) }

  // At least one complete WIN_LINE must exist in claimed set
  const claimedSet = new Set(claimedTileIds)
  let winningTileIds: string[] | null = null
  for (const line of WIN_LINES) {
    const lineIds = line.map(i => effectiveId(card[i]))
    if (lineIds.every(id => claimedSet.has(id))) {
      winningTileIds = lineIds
      break
    }
  }
  if (!winningTileIds) { round.ended = false; return ctx.json({ message: 'No complete winning line in claimed tiles' }, 422) }

  clearRoundTimers(round)
  round.active = false

  broadcast(code, {
    type: 'round:win',
    winnerName: playerName,
    winningTileIds,
    songHistory: round.songHistory,
  })

  return ctx.json({})
})
