import { Hono, type Context } from 'hono'
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { createRoom, getRoomsByHost, getRoomByCode, getHostById, getPlayedSongs, recordPlayedSongs, clearPlayedSongs, deleteRoom, setRoomHostName, deleteActiveRoom, clearHostTokens, type Room, type Host } from './db.ts'
import { requireAuth, withFreshToken, type AuthEnv } from './auth.ts'
import { roomSockets, broadcast, destroyRoom, persistRoomState, type RoundConfig, type ClipDuration, type TitleRevealDelay, type AudioPreset, type RoundState, type RoomState, type SongHistoryEntry } from './ws.ts'
import { getPlaylistTracks, SpotifyApiError } from './music/spotify.ts'
import { refreshWithRetry } from './refresh.ts'
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

// Story 13-8: unicast transient info toast to the host socket only.
// Mirrors the broken-socket guards used by runCasualModeSweep.
function sendHostInfo(roomState: RoomState, message: string, autoDismissMs = 6000): void {
  const host = roomState.host
  if (!host || host.readyState !== WebSocket.OPEN) return
  try {
    host.send(JSON.stringify({ type: 'host:info', message, autoDismissMs }))
  } catch { /* ignore broken socket */ }
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
  retryBuildRequest?: (deviceId: string, accessToken: string) => { url: string; init: RequestInit },
): Promise<void> {
  const activeDevice = roomState.activeDeviceId
  if (!activeDevice) return
  const sdkHost = getHostById(roomState.hostUserId)
  if (!sdkHost?.access_token) {
    console.warn(`[spotify:${label}] no access_token for host`, roomState.hostUserId)
    return
  }
  const accessToken = sdkHost.access_token

  const attempt = (builder = buildRequest): Promise<Response> => {
    const { url, init } = builder(activeDevice, accessToken)
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
        body: JSON.stringify({ device_ids: [activeDevice], play: false }),
      })
      if (!transferRes.ok) {
        const transferBody = await transferRes.text().catch(() => '')
        console.error(`[spotify:${label}] transfer failed ${transferRes.status}`, transferBody)
        if (transferRes.status === 404) {
          roomState.activeDeviceId = undefined
          broadcast(roomCode, { type: 'host:sdk-stale' })
        }
        return
      }
      res = await attempt(retryBuildRequest ?? buildRequest)
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
  options: { playerName?: string; isCatchUp?: boolean; includeCurrent?: boolean; suppressEmit?: boolean } = {},
): void {
  void roomCode
  const round = roomState.currentRound
  if (!round || !round.active || round.ended) return

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
    if (options.suppressEmit === true) continue
    try {
      ws.send(JSON.stringify({
        type: 'square:auto-marked',
        tileIndices: newIndices,
        catchUp: options.isCatchUp === true,
      }))
    } catch { /* ignore broken socket */ }
  }
}

// Story 12-3: unicast replay of previously-swept auto-mark indices to a
// reconnecting socket. runCasualModeSweep's idempotency guard prevents
// re-emitting existing indices to the room, but a reconnected client has
// lost those marks from memory — this helper fills that gap by sending
// the current set once to the returning socket only. Pure read: does not
// mutate autoMarkedTileIndices.
export function replayAutoMarksToSocket(
  roomState: RoomState,
  socket: WebSocket,
  playerName: string,
): void {
  const round = roomState.currentRound
  if (!round || !round.active) return
  const indices = round.autoMarkedTileIndices.get(playerName)
  if (!indices || indices.size === 0) return
  if (socket.readyState !== WebSocket.OPEN) return
  try {
    socket.send(JSON.stringify({
      type: 'square:auto-marked',
      tileIndices: Array.from(indices),
      catchUp: true,
    }))
  } catch { /* ignore broken socket */ }
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
    // Story 13-8: played_songs is now the single source of exclusion truth —
    // record on actual play (not round-start) so dealt-but-not-played tracks
    // stay eligible for future rounds.
    recordPlayedSongs(roomCode, [track.id])
  }
  // Story 12-4 Track B: on first song of a fresh round, defensively pause the
  // active device before the play call so Spotify's prior context (e.g. a track
  // the user manually paused to activate the app) can't bleed through the
  // round's first-track transition. Pausing an already-paused device is a 403/404
  // which callSpotifyOnDevice's handlers swallow. Must be evaluated here because
  // round.currentSongIndex is about to be mutated.
  const needsDefensivePause = isTrackChange && round.currentSongIndex === -1
  round.currentSongIndex = songIndex
  if (isTrackChange) {
    round.currentSongRevealed = round.config.titleRevealDelay === 0
  }
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
    currentSongRevealed: round.currentSongRevealed,
  })

  persistRoomState(roomCode)

  // Casual Mode (Story 8-5) — sweep all casual-enabled players on real track changes.
  // Not on resume-from-pause. First song (prev -1 → 0) is a track change, but the
  // sweep excludes the new current song so no event is emitted. Correct.
  if (isTrackChange) runCasualModeSweep(roomCode, roomState)

  // Fire-and-forget Spotify play via Web API (AC 5)
  // Resume-from-pause omits `uris` so Spotify resumes at the current position rather than restarting.
  // The retryBuildRequest fallback (used after 404 device-reactivation) always includes uris+position_ms
  // because a dormant device loses its playback context and needs a full restart to produce audio.
  const startBuildRequest = (deviceId: string, token: string) => ({
    url: `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
    init: {
      method: 'PUT' as const,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [`spotify:track:${track.id}`], position_ms: SEEK_POSITION_MS }),
    },
  })

  console.log('[spotify:play]', {
    code: roomCode,
    songIndex,
    isTrackChange,
    trackId: track.id,
    activeDeviceId: roomState.activeDeviceId,
  })

  if (needsDefensivePause) {
    callSpotifyOnDevice(roomCode, roomState, 'pause', (deviceId, token) => ({
      url: `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`,
      init: {
        method: 'PUT' as const,
        headers: { Authorization: `Bearer ${token}` },
      },
    })).catch(() => {})
  }

  callSpotifyOnDevice(roomCode, roomState, 'play',
    isTrackChange
      ? startBuildRequest
      : (deviceId, token) => ({
          url: `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
          init: {
            method: 'PUT' as const,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        }),
    startBuildRequest,
  ).catch(() => {})

  // P4: capture roundNumber so stale timers from a previous round don't fire against a new one
  const capturedRoundNumber = round.roundNumber

  if (!round.currentSongRevealed && round.config.titleRevealDelay && round.config.titleRevealDelay > 0) {
    round.timers.reveal = setTimeout(() => {
      if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
      roomState.currentRound.currentSongRevealed = true
      broadcast(roomCode, { type: 'song:reveal', trackId: track.id, songIndex })
    }, round.config.titleRevealDelay * 1000)
  }

  if (round.config.clipDuration !== 'full') {
    round.clipStartedAt = Date.now()
    round.timers.autoAdvance = setTimeout(() => {
      if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
      advanceToNext(roomCode, roomState)
    }, (round.config.clipDuration as number) * 1000)
  } else {
    round.clipStartedAt = undefined
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

function isValidClipDuration(v: unknown): v is ClipDuration {
  return (VALID_CLIP_DURATIONS as unknown[]).includes(v)
}
function isValidTitleRevealDelay(v: unknown): v is TitleRevealDelay {
  return (VALID_TITLE_REVEAL_DELAYS as unknown[]).includes(v)
}
function isValidAudioPreset(v: unknown): v is AudioPreset {
  return typeof v === 'string' && (VALID_AUDIO_PRESETS as string[]).includes(v)
}

// Core round creation — fetches playlist, builds pool, deals cards, writes roomState,
// broadcasts round:start, persists. Invoked from both the HTTP handler and continuous
// auto-start (Story 8-3).
async function startRound(
  code: string,
  roomState: RoomState,
  host: Host,
  config: RoundConfig,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  let tracks
  try {
    tracks = await getPlaylistTracks(config.playlistId, host.access_token)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InsufficientTracksError') {
      return { ok: false, status: 422, message: err.message }
    }
    if (err instanceof SpotifyApiError) {
      return { ok: false, status: 502, message: 'Failed to fetch playlist from Spotify' }
    }
    throw err
  }

  // Story 13-8: exclude previously-played songs (hard filter, not downrank).
  // If that leaves <25 unique tracks, auto-reset the room's played history
  // and notify the host inline. A playlist with <25 unique tracks at all
  // still errors out — reset cannot manufacture tracks.
  let excluded = new Set(getPlayedSongs(code))
  let pool = buildPool(tracks, excluded)
  let didReset = false
  if (pool.length < 25) {
    clearPlayedSongs(code)
    excluded = new Set()
    pool = buildPool(tracks, excluded)
    didReset = true
  }

  const hostKey = host.user_id
  const guestKeys = Array.from(roomState.guests.keys())
  const playerIds = [hostKey, ...guestKeys]
  const cards = generateCards(pool, playerIds)

  // Story 9-2: playerCasualModes persists across rounds — it only changes on
  // explicit player toggle or host revoke/restore. (Was previously reset per
  // round under Story 8-4; superseded.)

  const roundStartPayload = {
    type: 'round:start',
    roundNumber: config.roundNumber,
    playlist: pool,
    clipDuration: config.clipDuration,
    titleRevealDelay: config.titleRevealDelay,
    audioPreset: config.audioPreset,
    allowCasualMode: config.allowCasualMode,
  }

  roomState.currentRound = {
    roundNumber: config.roundNumber,
    config,
    playlist: pool,
    cards,
    roundStartPayload,
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

  if (didReset) sendHostInfo(roomState, 'Played history reset — playlist fully cycled.')

  return { ok: true }
}

// Build next-round config from pendingRound and delegate to startRound.
// Sole caller: /round/next-round ("Let It Ride"). Failures surface via the
// HTTP response — the host stays on the Game Over screen with a transient error.
async function startContinuousRound(
  code: string,
  roomState: RoomState,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const host = getHostById(roomState.hostUserId)
  if (!host) return { ok: false, status: 500, message: 'Host account not found' }

  const freshHost = await withFreshToken(host)
  if (!freshHost) return { ok: false, status: 503, message: 'Spotify auth degraded' }

  const room = getRoomByCode(code)
  if (!room) return { ok: false, status: 404, message: 'Room not found' }

  const base = roomState.pendingRound
  if (!base) return { ok: false, status: 409, message: 'No pending round config' }

  const nextRoundNumber = (roomState.currentRound?.roundNumber ?? base.roundNumber) + 1
  const config: RoundConfig = {
    playlistId: base.playlistId,
    clipDuration: base.clipDuration,
    titleRevealDelay: base.titleRevealDelay,
    audioPreset: base.audioPreset,
    allowCasualMode: base.allowCasualMode,
    roundNumber: nextRoundNumber,
  }

  return await startRound(code, roomState, freshHost, config)
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
  if (!/^[A-Za-z0-9]{20,30}$/.test(playlistId))
    return ctx.json({ message: 'Invalid playlist ID' }, 400)
  if (!isValidClipDuration(clipDuration))
    return ctx.json({ message: 'Invalid clipDuration' }, 400)
  if (!isValidTitleRevealDelay(titleRevealDelay))
    return ctx.json({ message: 'Invalid titleRevealDelay' }, 400)
  if (!isValidAudioPreset(audioPreset))
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

  const result = await startRound(code, roomState, freshHost, roundConfig)
  if (!result.ok) return ctx.json({ message: result.message }, result.status as 422 | 502)

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
  callSpotifyOnDevice(code, roomState!, 'pause', (deviceId, token) => ({
    url: `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`,
    init: {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    },
  })).catch(() => {})

  return ctx.json({})
})

// Unified handler: POST /rooms/:code/player/device (canonical) +
// POST /rooms/:code/sdk/device (legacy alias — SDK `ready` callback).
// When round is active-playing and the id changes, transfer Spotify
// playback to the new device; otherwise just store the selection.
const handleSetPlayerDevice = async (ctx: Context<AuthEnv>) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')
  if (!code) return ctx.json({ message: 'Room not found' }, 404)

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const body = await ctx.req.json().catch(() => null)
  if (!body || typeof body.deviceId !== 'string' || body.deviceId.length === 0) return ctx.json({ message: 'Invalid request body' }, 400)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  const newId: string = body.deviceId
  const round = roomState.currentRound
  const isActivePlaying = !!round && round.active && !round.paused

  // Same-device no-op during active playback (AC #17)
  if (isActivePlaying && roomState.activeDeviceId === newId) {
    return ctx.json({})
  }

  if (isActivePlaying && roomState.activeDeviceId !== newId) {
    const freshHost = await withFreshToken(host)
    if (!freshHost) return ctx.json({ message: 'Spotify auth degraded' }, 503)

    const expectedTrack = round!.currentSongIndex >= 0 ? round!.playlist[round!.currentSongIndex] : null
    if (expectedTrack) {
      // Temporarily adopt the new device so reissueExpectedTrack targets it, then
      // re-issue the current BB track. A plain PUT /me/player { play: true } would
      // resume whatever was last playing on the new device instead of the BB song
      // (the "test song" activation problem on mobile).
      const prevDeviceId = roomState.activeDeviceId
      roomState.activeDeviceId = newId
      const ok = await reissueExpectedTrack(code, roomState, expectedTrack.id, SEEK_POSITION_MS, freshHost.access_token)
      if (!ok) {
        console.error('[spotify:transfer] reissue failed', { code, deviceId: newId })
        roomState.activeDeviceId = prevDeviceId
        return ctx.json({ message: 'Device unavailable — pick another' }, 502)
      }
    }
    // index = -1: no song yet — skip; the upcoming startSong call will target the new activeDeviceId.
  }

  roomState.activeDeviceId = newId
  persistRoomState(code)
  return ctx.json({})
}

roomsRouter.post('/rooms/:code/player/device', requireAuth, handleSetPlayerDevice)
roomsRouter.post('/rooms/:code/sdk/device', requireAuth, handleSetPlayerDevice)

// Lists Spotify Connect devices available to the host. Client (Story 10-2)
// renders the picker from this response; fields match Spotify's own shape.
roomsRouter.get('/rooms/:code/player/devices', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const freshHost = await withFreshToken(host)
  if (!freshHost) return ctx.json({ message: 'Spotify auth degraded' }, 503)

  let res: Response
  try {
    res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${freshHost.access_token}` },
    })
  } catch (err) {
    console.error('[spotify:devices]', err)
    return ctx.json({ message: 'Spotify devices fetch failed' }, 502)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[spotify:devices] ${res.status}`, text)
    return ctx.json({ message: 'Spotify devices fetch failed' }, 502)
  }

  const json = await res.json().catch(() => null) as { devices?: Array<Record<string, unknown>> } | null
  const raw = Array.isArray(json?.devices) ? json!.devices! : []
  const devices = raw.map(d => ({
    id: d.id,
    name: d.name,
    type: d.type,
    is_active: d.is_active,
    is_restricted: d.is_restricted,
    volume_percent: d.volume_percent,
  }))

  return ctx.json({ devices })
})

// Story 12-2: reconcile room state with Spotify's /me/player truth. Called by
// the host client on initial session:connect and on every wsClient.onResume.
// Handles device drift (adopt new active device), track drift (re-issue play),
// position drift (realign next-song timer), and paused state. See AC #5/#6.
const POSITION_DRIFT_TOLERANCE_MS = 2_000

function clipDurationMs(cd: ClipDuration): number | null {
  return cd === 'full' ? null : cd * 1000
}

roomsRouter.post('/rooms/:code/host/resume', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  const freshHost = await withFreshToken(host)
  if (!freshHost) return ctx.json({ message: 'Spotify auth degraded' }, 503)

  let res: Response
  try {
    res = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${freshHost.access_token}` },
    })
  } catch (err) {
    console.error('[host:resume] fetch failed', err)
    return ctx.json({ state: 'no-device' })
  }

  // 204 = no active player/device
  if (res.status === 204 || res.status === 404) {
    console.log(`[host:resume] code=${code} state=no-device device=${roomState.activeDeviceId ?? 'none'}`)
    return ctx.json({ state: 'no-device' })
  }
  if (res.status === 401) {
    refreshWithRetry(host.user_id).catch(() => {})
    return ctx.json({ message: 'Spotify auth degraded' }, 503)
  }
  if (!res.ok) {
    console.error(`[host:resume] spotify ${res.status}`)
    return ctx.json({ state: 'no-device' })
  }

  const body = await res.json().catch(() => null) as {
    device?: { id: string | null; name: string; type: string; is_active?: boolean } | null
    item?: { uri?: string; id?: string } | null
    progress_ms?: number | null
    is_playing?: boolean
  } | null

  const device = body?.device
  if (!device || !device.id) {
    console.log(`[host:resume] code=${code} state=no-device device=none`)
    return ctx.json({ state: 'no-device' })
  }

  // Spotify is the source of truth for device shape but strings may rarely be
  // absent on partial responses — guard downstream clients from `undefined`.
  const spotifyDevice = {
    id: device.id,
    name: typeof device.name === 'string' ? device.name : 'Spotify device',
    type: typeof device.type === 'string' ? device.type : 'Unknown',
  }
  const spotifyTrackUri: string | null = body?.item?.uri ?? null
  const spotifyPositionMs: number = typeof body?.progress_ms === 'number' ? body.progress_ms : 0
  const spotifyIsPlaying: boolean = body?.is_playing === true

  const round = roomState.currentRound
  const roundActive = !!round && round.active

  // Adopt a new active device whenever the server's view differs. This covers
  // the case where the user transferred playback from Spotify directly.
  if (roomState.activeDeviceId !== device.id) {
    roomState.activeDeviceId = device.id
    persistRoomState(code)
    broadcast(code, { type: 'host:device-changed', device: spotifyDevice })
  }

  // Round not active: just adopt and return ok.
  if (!roundActive) {
    console.log(`[host:resume] code=${code} state=ok device=${device.id}`)
    return ctx.json({
      state: 'ok',
      device: spotifyDevice,
      track: spotifyTrackUri,
      position: spotifyPositionMs,
      isPlaying: spotifyIsPlaying,
    })
  }

  // Round is active. Consult expected track.
  const expectedTrack = round.currentSongIndex >= 0 ? round.playlist[round.currentSongIndex] : null
  if (!expectedTrack) {
    // Round active but no current song yet (index -1). Nothing to reconcile.
    console.log(`[host:resume] code=${code} state=ok device=${device.id}`)
    return ctx.json({ state: 'ok', device: spotifyDevice, track: spotifyTrackUri, position: spotifyPositionMs, isPlaying: spotifyIsPlaying })
  }
  const expectedUri = `spotify:track:${expectedTrack.id}`

  // Paused: surface "Tap to resume" to the client — do not auto-resume.
  if (!spotifyIsPlaying) {
    console.log(`[host:resume] code=${code} state=spotify-paused device=${device.id}`)
    return ctx.json({
      state: 'spotify-paused',
      device: spotifyDevice,
      track: spotifyTrackUri,
      position: spotifyPositionMs,
    })
  }

  // Playing a different track than expected → drift-correct via re-issue play.
  if (spotifyTrackUri !== expectedUri) {
    // Re-check the round hasn't ended/advanced while awaiting Spotify — without
    // this guard we could PUT play for a stale track over a game-over screen.
    const roundStillMatches = roomState.currentRound?.active
      && roomState.currentRound.roundNumber === round.roundNumber
      && roomState.currentRound.currentSongIndex === round.currentSongIndex
    if (!roundStillMatches) {
      console.log(`[host:resume] code=${code} state=ok device=${device.id} (round advanced mid-resume)`)
      return ctx.json({ state: 'ok', device: spotifyDevice, track: spotifyTrackUri, position: spotifyPositionMs, isPlaying: spotifyIsPlaying })
    }
    const reissueOk = await reissueExpectedTrack(code, roomState, expectedTrack.id, SEEK_POSITION_MS, freshHost.access_token)
    if (!reissueOk) {
      console.log(`[host:resume] code=${code} state=drift-unresolvable device=${device.id}`)
      return ctx.json({ state: 'drift-unresolvable' })
    }
    console.log(`[host:resume] code=${code} state=drift-corrected device=${device.id}`)
    return ctx.json({
      state: 'drift-corrected',
      device: spotifyDevice,
      track: expectedUri,
      position: SEEK_POSITION_MS,
    })
  }

  // Same track, playing. Check position drift against server's expected elapsed.
  // Skip when round.paused — the server is in a pause window where clipStartedAt
  // is stale relative to the playback clock; falsely "correcting" would re-arm
  // the autoAdvance timer against a phantom elapsed time.
  const clipMs = clipDurationMs(round.config.clipDuration)
  if (clipMs !== null && round.clipStartedAt !== undefined && !round.paused) {
    const spotifyElapsedMs = Math.max(0, spotifyPositionMs - SEEK_POSITION_MS)

    if (spotifyElapsedMs >= clipMs) {
      void advanceToNext(code, roomState)
      return ctx.json({ state: 'advanced' })
    }

    const expectedElapsedMs = Date.now() - round.clipStartedAt
    const driftMs = Math.abs(spotifyElapsedMs - expectedElapsedMs)
    if (driftMs > POSITION_DRIFT_TOLERANCE_MS) {
      const newRemaining = Math.max(0, clipMs - spotifyElapsedMs)
      const capturedRoundNumber = round.roundNumber
      clearTimeout(round.timers.autoAdvance)
      round.clipStartedAt = Date.now() - spotifyElapsedMs
      round.timers.autoAdvance = setTimeout(() => {
        if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
        advanceToNext(code, roomState)
      }, newRemaining)
      console.log(`[host:resume] code=${code} state=drift-corrected device=${device.id} (timer realigned drift=${driftMs}ms remaining=${newRemaining}ms)`)
      return ctx.json({
        state: 'drift-corrected',
        device: spotifyDevice,
        track: spotifyTrackUri,
        position: spotifyPositionMs,
      })
    }
  }

  console.log(`[host:resume] code=${code} state=ok device=${device.id}`)
  return ctx.json({
    state: 'ok',
    device: spotifyDevice,
    track: spotifyTrackUri,
    position: spotifyPositionMs,
    isPlaying: spotifyIsPlaying,
  })
})

// Helper: re-issue `PUT /me/player/play` for the expected track on the current device.
// 404 → device went away → drift-unresolvable. Returns true on success.
async function reissueExpectedTrack(
  code: string,
  roomState: RoomState,
  trackId: string,
  positionMs: number,
  accessToken: string,
): Promise<boolean> {
  const deviceId = roomState.activeDeviceId
  if (!deviceId) return false
  try {
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: positionMs }),
    })
    if (res.status === 404) {
      // Device vanished between /me/player and our play re-issue.
      return false
    }
    if (!res.ok) {
      console.error(`[host:resume] reissue ${res.status} code=${code}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[host:resume] reissue fetch failed', err)
    return false
  }
}

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

  // Story 13-1: persist win details so reconnecting clients can receive a round:win replay.
  // Snapshot songHistory and winnerCard (not live refs) so post-win mutations can't leak into the replay payload.
  round.winData = {
    winnerName: playerName,
    winningTileIds,
    songHistory: round.songHistory.slice(),
    winnerCard: card.map(t => ({ ...t })),
  }

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

// PATCH /round-config — host edits the live round's config mid-round (Story 9-2).
// Mutates both currentRound.config (so startSong picks up new values on the next draw)
// and pendingRound (so Let It Ride inherits the newest values). Ephemeral: not persisted.
roomsRouter.patch('/rooms/:code/round-config', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  if (roomState.currentRound?.active !== true) {
    return ctx.json({ message: 'No active round' }, 409)
  }

  const body = await ctx.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return ctx.json({ message: 'Invalid request body' }, 400)

  // Re-check round state after the await — a concurrent end-round could have
  // nulled currentRound while we were parsing the JSON body.
  if (roomState.currentRound?.active !== true) {
    return ctx.json({ message: 'No active round' }, 409)
  }

  const b = body as Record<string, unknown>
  const hasClip = Object.prototype.hasOwnProperty.call(b, 'clipDuration')
  const hasReveal = Object.prototype.hasOwnProperty.call(b, 'titleRevealDelay')
  const hasPreset = Object.prototype.hasOwnProperty.call(b, 'audioPreset')
  const hasCasual = Object.prototype.hasOwnProperty.call(b, 'allowCasualMode')

  if (!hasClip && !hasReveal && !hasPreset && !hasCasual) {
    return ctx.json({ message: 'No valid fields' }, 400)
  }

  if (hasClip && !isValidClipDuration(b.clipDuration))
    return ctx.json({ message: 'Invalid clipDuration' }, 400)
  if (hasReveal && !isValidTitleRevealDelay(b.titleRevealDelay))
    return ctx.json({ message: 'Invalid titleRevealDelay' }, 400)
  if (hasPreset && !isValidAudioPreset(b.audioPreset))
    return ctx.json({ message: 'Invalid audioPreset' }, 400)
  if (hasCasual && typeof b.allowCasualMode !== 'boolean')
    return ctx.json({ message: 'Invalid allowCasualMode' }, 400)

  const current = roomState.currentRound.config
  const merged: RoundConfig = {
    ...current,
    ...(hasClip ? { clipDuration: b.clipDuration as ClipDuration } : {}),
    ...(hasReveal ? { titleRevealDelay: b.titleRevealDelay as TitleRevealDelay } : {}),
    ...(hasPreset ? { audioPreset: b.audioPreset as AudioPreset } : {}),
    ...(hasCasual ? { allowCasualMode: b.allowCasualMode as boolean } : {}),
  }

  roomState.currentRound.config = merged
  if (roomState.pendingRound) {
    roomState.pendingRound = {
      ...roomState.pendingRound,
      ...(hasClip ? { clipDuration: b.clipDuration as ClipDuration } : {}),
      ...(hasReveal ? { titleRevealDelay: b.titleRevealDelay as TitleRevealDelay } : {}),
      ...(hasPreset ? { audioPreset: b.audioPreset as AudioPreset } : {}),
      ...(hasCasual ? { allowCasualMode: b.allowCasualMode as boolean } : {}),
    }
  }

  // Story 9-2: when the host flips allowCasualMode, snapshot + revoke every
  // active player casual mode (true→false) or restore from the snapshot and
  // run catch-up sweeps (false→true). The snapshot persists across round
  // boundaries so toggling back on in a later round still restores.
  if (hasCasual) {
    const wasAllowed = current.allowCasualMode
    const nowAllowed = b.allowCasualMode as boolean
    if (wasAllowed && !nowAllowed) {
      roomState.priorCasualModes = new Set()
      for (const [name, on] of roomState.playerCasualModes.entries()) {
        if (on !== true) continue
        roomState.priorCasualModes.add(name)
        roomState.playerCasualModes.set(name, false)
        roomState.currentRound.autoMarkedTileIndices.delete(name)
        broadcast(code, { type: 'player:casual-mode-changed', name, enabled: false })
      }
    } else if (!wasAllowed && nowAllowed && roomState.priorCasualModes) {
      for (const name of roomState.priorCasualModes) {
        roomState.playerCasualModes.set(name, true)
        broadcast(code, { type: 'player:casual-mode-changed', name, enabled: true })
        runCasualModeSweep(code, roomState, { playerName: name, isCatchUp: true })
      }
      roomState.priorCasualModes = undefined
    }
  }

  // Narrow broadcast to only the fields that were actually patched, so a
  // client with an in-flight optimistic edit on a different row doesn't get
  // clobbered by an echo of the stale value for that row.
  const changedConfig: Partial<RoundConfig> = {
    ...(hasClip ? { clipDuration: merged.clipDuration } : {}),
    ...(hasReveal ? { titleRevealDelay: merged.titleRevealDelay } : {}),
    ...(hasPreset ? { audioPreset: merged.audioPreset } : {}),
    ...(hasCasual ? { allowCasualMode: merged.allowCasualMode } : {}),
  }
  broadcast(code, { type: 'round-config:changed', config: changedConfig })
  return ctx.json(merged)
})

// POST /round/next-round — host starts the next round with the same config ("Let It Ride").
roomsRouter.post('/rooms/:code/round/next-round', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const roomState = roomSockets.get(code)
  if (!roomState) return ctx.json({ message: 'Room session not active' }, 503)

  if (!roomState.currentRound || roomState.currentRound.ended !== true) {
    return ctx.json({ message: 'No completed round' }, 409)
  }
  if (!roomState.pendingRound) {
    return ctx.json({ message: 'No pending round config' }, 409)
  }

  const result = await startContinuousRound(code, roomState)
  if (!result.ok) {
    switch (result.status) {
      case 404: return ctx.json({ message: result.message }, 404)
      case 409: return ctx.json({ message: result.message }, 409)
      case 422: return ctx.json({ message: result.message }, 422)
      case 502: return ctx.json({ message: result.message }, 502)
      case 503: return ctx.json({ message: result.message }, 503)
      default:  return ctx.json({ message: result.message }, 500)
    }
  }

  return ctx.json({})
})
