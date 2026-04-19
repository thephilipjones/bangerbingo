import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { createRoom, getRoomsByHost, getRoomByCode, getHostById, getPlayedSongs, recordPlayedSongs, deleteRoom, setRoomHostName, deleteActiveRoom, clearHostTokens, type Room, type Host } from './db.ts'
import { requireAuth, verifySession, withFreshToken, type AuthEnv } from './auth.ts'
import { roomSockets, broadcast, destroyRoom, persistRoomState, type RoundConfig, type ClipDuration, type TitleRevealDelay, type AudioPreset, type RoundState, type RoomState, type SongHistoryEntry } from './ws.ts'
import { getPlaylistTracks, SpotifyApiError } from './music/spotify.ts'
import { refreshWithRetry } from './refresh.ts'
import { buildPool, generateCards, shuffle } from './game/cards.ts'

// Continuous Mode (Story 8-3) — auto-start delay between rounds. Hardcoded by design.
const CONTINUOUS_COUNTDOWN_MS = 10_000

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

// Shared Spotify Web API caller for device-scoped PUTs (play, pause).
// Handles 401 → refresh, and 404 → transfer-playback reactivation + single retry.
// Spotify drops dormant Web Playback SDK devices from the active-devices list; a
// transfer-playback PUT /me/player wakes the stored device_id without any client work.
async function callSpotifyOnDevice(
  roomCode: string,
  roomState: RoomState,
  label: 'play' | 'pause',
  buildRequest: (deviceId: string, accessToken: string) => { url: string; init: RequestInit },
): Promise<void> {
  const sdkDevice = roomState.sdkDeviceId
  if (!sdkDevice) return
  const sdkHost = getHostById(roomState.hostUserId)
  if (!sdkHost?.access_token) {
    console.warn(`[spotify:${label}] no access_token for host`, roomState.hostUserId)
    return
  }
  const accessToken = sdkHost.access_token

  const attempt = (): Promise<Response> => {
    const { url, init } = buildRequest(sdkDevice, accessToken)
    return fetch(url, init)
  }

  try {
    let res = await attempt()

    if (res.status === 401) {
      const body = await res.text().catch(() => '')
      console.error(`[spotify:${label}] 401`, body)
      refreshWithRetry(roomState.hostUserId).catch(() => {})
      return
    }

    if (res.status === 404) {
      const body = await res.text().catch(() => '')
      console.warn(`[spotify:${label}] 404 — attempting device reactivation`, body)
      const transferRes = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [sdkDevice], play: false }),
      })
      if (!transferRes.ok) {
        const transferBody = await transferRes.text().catch(() => '')
        console.error(`[spotify:${label}] transfer failed ${transferRes.status}`, transferBody)
        if (transferRes.status === 404) {
          roomState.sdkDeviceId = undefined
          broadcast(roomCode, { type: 'host:sdk-stale' })
        }
        return
      }
      res = await attempt()
      if (!res.ok) {
        const retryBody = await res.text().catch(() => '')
        console.error(`[spotify:${label}] retry ${res.status}`, retryBody)
      }
      return
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[spotify:${label}] ${res.status}`, body)
    }
  } catch (err) {
    console.error(`[spotify:${label}]`, err)
  }
}

// Casual Mode (Story 8-5) — per-player auto-mark sweep. Scans each target player's
// card for tiles whose trackId appears in songHistory (excluding the current song),
// and emits `square:auto-marked` with only the newly-matched indices. Idempotent via
// `round.autoMarkedTileIndices`. When `options.playerName` is omitted, iterates every
// guest with casual mode on (track-change trigger). When provided, sweeps only that
// player (used by enable-toggle and reconnect catch-up paths).
export function runCasualModeSweep(
  roomCode: string,
  roomState: RoomState,
  options: { playerName?: string; isCatchUp?: boolean; includeCurrent?: boolean } = {},
): void {
  void roomCode
  const round = roomState.currentRound
  if (!round || !round.active) return

  // `includeCurrent` is used on playlist exhaustion so the final song's tile
  // (which is still round.currentSongIndex) also gets auto-marked.
  const currentTrackId = options.includeCurrent
    ? null
    : round.currentSongIndex >= 0
      ? round.playlist[round.currentSongIndex]?.id ?? null
      : null
  const playedIds = new Set(
    round.songHistory
      .map(e => e.trackId)
      .filter(id => currentTrackId === null || id !== currentTrackId),
  )
  if (playedIds.size === 0) return

  const targetNames = options.playerName
    ? [options.playerName]
    : Array.from(roomState.playerCasualModes.entries())
        .filter(([, v]) => v)
        .map(([k]) => k)

  const hostName = getRoomByCode(roomCode)?.host_name ?? null

  for (const name of targetNames) {
    if (roomState.playerCasualModes.get(name) !== true) continue

    // Host plays with a card keyed by hostUserId on a dedicated socket.
    const isHost = hostName !== null && name === hostName
    const ws = isHost ? roomState.host : roomState.guests.get(name)
    if (!ws || ws.readyState !== WebSocket.OPEN) continue

    const cardKey = isHost ? roomState.hostUserId : name
    const card = round.cards.get(cardKey)
    if (!card) continue

    let alreadySwept = round.autoMarkedTileIndices.get(name)
    if (!alreadySwept) {
      alreadySwept = new Set<number>()
      round.autoMarkedTileIndices.set(name, alreadySwept)
    }

    const newIndices: number[] = []
    for (let i = 0; i < card.length; i++) {
      if (i === 12) continue // FREE space — defensive, trackId is '' so would never match anyway
      if (alreadySwept.has(i)) continue
      if (playedIds.has(card[i].trackId)) {
        alreadySwept.add(i)
        newIndices.push(i)
      }
    }

    if (newIndices.length === 0) continue
    try {
      ws.send(JSON.stringify({
        type: 'square:auto-marked',
        tileIndices: newIndices,
        catchUp: options.isCatchUp === true,
      }))
    } catch { /* ignore broken socket */ }
  }
}

function startSong(roomCode: string, roomState: RoomState, songIndex: number): void {
  const round = roomState.currentRound!

  // P3: guard against out-of-bounds index (e.g. empty playlist)
  if (songIndex < 0 || songIndex >= round.playlist.length) return

  const track = round.playlist[songIndex]

  clearRoundTimers(round)

  // P1: only append to history when starting a new song, not when resuming the same one
  let isTrackChange = false
  if (round.currentSongIndex !== songIndex) {
    isTrackChange = true
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
  round.currentSongRevealed = round.config.titleRevealDelay === 0
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

  persistRoomState(roomCode)

  // Casual Mode (Story 8-5) — sweep all casual-enabled players on real track changes.
  // Not on resume-from-pause. First song (prev -1 → 0) is a track change, but the
  // sweep excludes the new current song so no event is emitted. Correct.
  if (isTrackChange) runCasualModeSweep(roomCode, roomState)

  // Fire-and-forget Spotify play via Web API (AC 5)
  callSpotifyOnDevice(roomCode, roomState, 'play', (deviceId, token) => ({
    url: `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
    init: {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uris: [`spotify:track:${track.id}`],
        position_ms: SEEK_POSITION_MS,
      }),
    },
  })).catch(() => {})

  // P4: capture roundNumber so stale timers from a previous round don't fire against a new one
  const capturedRoundNumber = round.roundNumber

  if (round.config.titleRevealDelay && round.config.titleRevealDelay > 0) {
    round.timers.reveal = setTimeout(() => {
      if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
      roomState.currentRound.currentSongRevealed = true
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
    // Final song transitions from "playing" to "done" at this point — sweep it
    // into casual-mode players' cards so they don't miss their last tile.
    runCasualModeSweep(roomCode, roomState, { includeCurrent: true })
    broadcast(roomCode, { type: 'songs:exhausted' })
    return true
  }
  startSong(roomCode, roomState, nextIndex)
  return false
}

// ── Room code generation ───────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // 24 chars: A-Z minus O and I

const RESERVED_CODES = new Set(['AUTH', 'HELP', 'PLAY', 'GAME', 'CHAT', 'TEST'])

export function generateRoomCode(): string {
  for (;;) {
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
    }
    if (!RESERVED_CODES.has(code)) return code
  }
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

roomsRouter.post('/account/spotify/disconnect', requireAuth, (ctx) => {
  const host = ctx.var.host
  clearHostTokens(host.user_id)
  return ctx.json({})
})

roomsRouter.post('/rooms', requireAuth, (ctx) => {
  const host = ctx.var.host
  try {
    const room = createRoomWithRetry(host.user_id)
    return ctx.json({ code: room.code, url: `/${room.code}`, created_at: room.created_at, host_name: room.host_name })
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
const VALID_AUDIO_PRESETS: AudioPreset[] = ['hype', 'deadpan', 'minimal']

// Core round creation — fetches playlist, builds pool, deals cards, writes roomState,
// broadcasts round:start, persists. Invoked from both the HTTP handler and continuous
// auto-start (Story 8-3).
async function startRound(
  code: string,
  roomState: RoomState,
  _room: Room,
  host: Host,
  config: RoundConfig,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  let playlist
  try {
    playlist = shuffle(await getPlaylistTracks(config.playlistId, host.access_token))
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InsufficientTracksError') {
      return { ok: false, status: 422, message: err.message }
    }
    if (err instanceof SpotifyApiError) {
      return { ok: false, status: 502, message: 'Failed to fetch playlist from Spotify' }
    }
    throw err
  }

  const sessionPlayedIds = roomState.currentRound?.sessionPlayedIds ?? []
  const historicPlayedIds = getPlayedSongs(code)
  const pool = buildPool(playlist, sessionPlayedIds, historicPlayedIds)

  const hostKey = host.user_id
  const guestKeys = Array.from(roomState.guests.keys())
  const playerIds = [hostKey, ...guestKeys]
  const cards = generateCards(pool, playerIds)

  // Reset per-player casual mode opt-ins on every new round
  roomState.playerCasualModes = new Map()

  const roundStartPayload = {
    type: 'round:start',
    roundNumber: config.roundNumber,
    playlist,
    clipDuration: config.clipDuration,
    titleRevealDelay: config.titleRevealDelay,
    audioPreset: config.audioPreset,
    allowCasualMode: config.allowCasualMode,
  }

  const dealtTrackIds = pool.slice(0, 25).map(t => t.id)
  const newSessionPlayed = [...sessionPlayedIds, ...dealtTrackIds]

  roomState.currentRound = {
    roundNumber: config.roundNumber,
    config,
    playlist,
    cards,
    roundStartPayload,
    sessionPlayedIds: newSessionPlayed,
    active: true,
    currentSongIndex: -1,
    currentSongRevealed: false,
    songHistory: [],
    paused: false,
    timers: {},
    autoMarkedTileIndices: new Map(),
  }
  roomState.pendingRound = config

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

  persistRoomState(code)
  recordPlayedSongs(code, dealtTrackIds)

  return { ok: true }
}

// Continuous-mode auto-start — invoked by the countdown timer (Story 8-3).
// Clears the countdown, resolves a fresh host token, bumps roundNumber from
// pendingRound, delegates to startRound. Any failure broadcasts
// continuous:countdown-cancel with a reason and bails.
async function startContinuousRound(code: string, roomState: RoomState): Promise<void> {
  roomState.continuousCountdown = undefined

  const host = getHostById(roomState.hostUserId)
  if (!host) {
    broadcast(code, { type: 'continuous:countdown-cancel', reason: 'host-missing' })
    return
  }

  const freshHost = await withFreshToken(host)
  if (!freshHost) {
    broadcast(code, { type: 'continuous:countdown-cancel', reason: 'auth-degraded' })
    return
  }

  const room = getRoomByCode(code)
  if (!room) return // session deleted mid-countdown — session:end handled elsewhere

  const base = roomState.pendingRound
  if (!base) {
    broadcast(code, { type: 'continuous:countdown-cancel', reason: 'no-round-config' })
    return
  }

  const nextRoundNumber = (roomState.currentRound?.roundNumber ?? base.roundNumber) + 1
  const config: RoundConfig = {
    playlistId: base.playlistId,
    clipDuration: base.clipDuration,
    titleRevealDelay: base.titleRevealDelay,
    audioPreset: base.audioPreset,
    allowCasualMode: base.allowCasualMode,
    roundNumber: nextRoundNumber,
  }

  const result = await startRound(code, roomState, room, freshHost, config)
  if (!result.ok) {
    broadcast(code, { type: 'continuous:countdown-cancel', reason: result.message })
  }
}

roomsRouter.post('/rooms/:code/round', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const body = await ctx.req.json().catch(() => null)
  if (!body) return ctx.json({ message: 'Invalid request body' }, 400)

  const { playlistId, clipDuration, titleRevealDelay, hostName } = body
  const audioPreset: AudioPreset = body.audioPreset ?? 'minimal'
  const allowCasualMode: boolean = typeof body.allowCasualMode === 'boolean' ? body.allowCasualMode : false

  if (!playlistId || typeof playlistId !== 'string' || !playlistId.trim())
    return ctx.json({ message: 'playlistId is required' }, 400)
  if (!VALID_CLIP_DURATIONS.includes(clipDuration))
    return ctx.json({ message: 'Invalid clipDuration' }, 400)
  if (!VALID_TITLE_REVEAL_DELAYS.includes(titleRevealDelay))
    return ctx.json({ message: 'Invalid titleRevealDelay' }, 400)
  if (!VALID_AUDIO_PRESETS.includes(audioPreset))
    return ctx.json({ message: 'Invalid audioPreset' }, 400)

  // hostName: capture-once per room, optional.
  // If room.host_name is already set, ignore the field entirely (no validation, no overwrite).
  // On first round (room.host_name IS NULL), hostName is persisted if provided and valid.
  if (room.host_name === null) {
    let resolvedName = 'Host'
    if (hostName !== undefined) {
      if (typeof hostName !== 'string') return ctx.json({ message: 'hostName must be a string' }, 400)
      const trimmed = hostName.trim()
      if (trimmed.length > 30)
        return ctx.json({ message: 'hostName must be 30 characters or fewer' }, 400)
      if (trimmed.length > 0) resolvedName = trimmed
    }
    setRoomHostName(code, resolvedName)
  }

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  const roundNumber = roomState.currentRound
    ? roomState.currentRound.roundNumber + 1
    : roomState.pendingRound
      ? roomState.pendingRound.roundNumber + 1
      : 1

  const roundConfig: RoundConfig = { playlistId, clipDuration, titleRevealDelay, roundNumber, audioPreset, allowCasualMode }

  const freshHost = await withFreshToken(host)
  if (!freshHost) return ctx.json({ message: 'Spotify authentication degraded — please re-authenticate' }, 503)

  const result = await startRound(code, roomState, room, freshHost, roundConfig)
  if (!result.ok) return ctx.json({ message: result.message }, result.status as 422 | 502)

  return ctx.json(roundConfig)
})

// POST /continuous-mode — host toggles Continuous Mode (Story 8-3).
roomsRouter.post('/rooms/:code/continuous-mode', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  const body = await ctx.req.json().catch(() => null)
  if (!body || typeof body.enabled !== 'boolean') {
    return ctx.json({ message: 'Invalid continuousMode' }, 400)
  }

  roomState.continuousMode = body.enabled
  broadcast(code, { type: 'continuous-mode:changed', enabled: body.enabled })

  // Disable mid-countdown → cancel the pending auto-start.
  if (!body.enabled && roomState.continuousCountdown) {
    clearTimeout(roomState.continuousCountdown.timer)
    roomState.continuousCountdown = undefined
    broadcast(code, { type: 'continuous:countdown-cancel' })
  }

  return ctx.json({})
})

// POST /round/dismiss-win — host-authoritative win overlay dismiss (Story 8-3).
// Broadcasts round:dismissed to all clients; if continuous mode is on, schedules
// the 10 s auto-start timer.
roomsRouter.post('/rooms/:code/round/dismiss-win', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  if (!roomState.currentRound || roomState.currentRound.ended !== true) {
    return ctx.json({ message: 'No winning round to dismiss' }, 409)
  }

  broadcast(code, { type: 'round:dismissed' })

  if (roomState.continuousMode && !roomState.pendingRound) {
    broadcast(code, { type: 'continuous:countdown-cancel', reason: 'no-round-config' })
  } else if (roomState.continuousMode && roomState.pendingRound) {
    // Idempotent: clicking Dismiss twice must reuse the existing timer.
    if (!roomState.continuousCountdown) {
      const endsAt = Date.now() + CONTINUOUS_COUNTDOWN_MS
      const timer = setTimeout(() => {
        const rs = roomSockets.get(code)
        if (!rs) return
        startContinuousRound(code, rs).catch(err => console.error('[continuous]', err))
      }, CONTINUOUS_COUNTDOWN_MS)
      roomState.continuousCountdown = { timer, endsAt }
      broadcast(code, { type: 'continuous:countdown-start', durationMs: CONTINUOUS_COUNTDOWN_MS, endsAt })
    }
  }

  return ctx.json({})
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
  callSpotifyOnDevice(code, roomState!, 'pause', (deviceId, token) => ({
    url: `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`,
    init: {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    },
  })).catch(() => {})

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

  roomState!.sessionStats.lastRoundWinner = null

  // Defensive (Story 8-3): a manual End Round mid-countdown must prevent the
  // auto-start from firing, so cancel any in-flight continuous countdown first.
  if (roomState!.continuousCountdown) {
    clearTimeout(roomState!.continuousCountdown.timer)
    roomState!.continuousCountdown = undefined
    broadcast(code, { type: 'continuous:countdown-cancel' })
  }

  broadcast(code, { type: 'round:end' })
  broadcast(code, {
    type: 'stats:updated',
    winsByName: { ...roomState!.sessionStats.winsByName },
    lastRoundWinner: roomState!.sessionStats.lastRoundWinner,
  })

  deleteActiveRoom(code)

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

  const cardKey = playerName === room.host_name ? room.host_user_id : playerName
  const card = round.cards.get(cardKey)
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
  round.winnerName = playerName

  roomState.sessionStats.winsByName[playerName] = (roomState.sessionStats.winsByName[playerName] ?? 0) + 1
  roomState.sessionStats.lastRoundWinner = playerName

  broadcast(code, {
    type: 'round:win',
    winnerName: playerName,
    winningTileIds,
    songHistory: round.songHistory,
    winnerCard: card,
  })

  broadcast(code, {
    type: 'stats:updated',
    winsByName: { ...roomState.sessionStats.winsByName },
    lastRoundWinner: roomState.sessionStats.lastRoundWinner,
  })

  persistRoomState(code)
  deleteActiveRoom(code)

  return ctx.json({})
})

// POST /round/next-round — host or winning guest starts the next round (Story 9-1).
// Not behind requireAuth: the winning guest is guest-callable when continuousMode is on.
roomsRouter.post('/rooms/:code/round/next-round', async (ctx) => {
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  if (!roomState.currentRound || roomState.currentRound.ended !== true) {
    return ctx.json({ message: 'No completed round' }, 409)
  }
  if (!roomState.pendingRound) {
    return ctx.json({ message: 'No pending round config' }, 409)
  }

  const body = await ctx.req.json().catch(() => ({} as { playerName?: unknown }))
  const playerName = typeof (body as { playerName?: unknown }).playerName === 'string'
    ? (body as { playerName: string }).playerName
    : null

  const sessionCookie = getCookie(ctx, 'session')
  const sessionUserId = sessionCookie ? verifySession(sessionCookie) : null
  const isHost = sessionUserId !== null && sessionUserId === room.host_user_id

  let authorized = false
  if (isHost) {
    authorized = true
  } else if (playerName !== null && roomState.continuousMode === true
      && roomState.currentRound.winnerName === playerName) {
    authorized = true
  }

  if (!authorized) return ctx.json({ message: 'Not allowed to start next round' }, 403)

  await startContinuousRound(code, roomState)

  return ctx.json({})
})
