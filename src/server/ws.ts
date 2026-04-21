import WebSocket, { WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { ServerType } from '@hono/node-server'
import { authEvents } from './refresh.ts'
import { verifySession } from './auth.ts'
import { getRoomByCode, getHostById, upsertActiveRoom, deleteActiveRoom, getAllActiveRooms } from './db.ts'
import { runCasualModeSweep, replayAutoMarksToSocket } from './rooms.ts'
import type { Track } from './music/spotify.ts'
import { generateCard, type Tile } from './game/cards.ts'
import { startHeartbeat, stopHeartbeat, recordPong } from './heartbeat.ts'

// ── Round config types ─────────────────────────────────────────────────────

export type ClipDuration = 20 | 30 | 45 | 60 | 'full'
export type TitleRevealDelay = 0 | 5 | 10 | 15 | null // null = never
export type AudioPreset = 'hype' | 'deadpan' | 'minimal'

export interface RoundConfig {
  playlistId: string
  clipDuration: ClipDuration
  titleRevealDelay: TitleRevealDelay
  roundNumber: number
  audioPreset: AudioPreset
  allowCasualMode: boolean
}

export interface SongHistoryEntry {
  trackId: string
  title: string
  artist: string
  albumArtUrl: string
  songIndex: number
}

export interface RoundState {
  roundNumber: number
  config: RoundConfig
  playlist: Track[]
  cards: Map<string, Tile[]>   // playerKey → card (host: userId, guests: name)
  roundStartPayload: object     // cached for late joiners
  sessionPlayedIds: string[]    // tracks played this session (grows across rounds)
  active: boolean
  // ── NEW in Story 5-1 ──────────────────────────────────────────
  currentSongIndex: number        // -1 = round not yet started
  currentSongRevealed: boolean    // true once song:reveal has fired (or titleRevealDelay===0)
  songHistory: SongHistoryEntry[] // append-only; used by 5-5 win validation + 5-6 drawer
  paused: boolean                 // true after /pause; cleared on /play
  ended?: boolean                 // true after a valid win claim
  timers: {
    autoAdvance?: ReturnType<typeof setTimeout>
    reveal?: ReturnType<typeof setTimeout>
  }
  // Wall-clock ms (Date.now()) when the current clip's autoAdvance timer was
  // armed. Used by /host/resume (Story 12-2) to compute Spotify drift vs.
  // server-expected elapsed. Not persisted.
  clipStartedAt?: number
  // Casual Mode (Story 8-5): per-player set of already-swept tile indices.
  // Not persisted — reset to empty Map() on rehydrate. Note: `playerCasualModes`
  // is also not persisted, so after a server restart no sweep targets exist and
  // players must re-toggle Casual Mode to resume auto-marking.
  autoMarkedTileIndices: Map<string, Set<number>>
}

// ── Session stats (Story 8-2) ─────────────────────────────────────────────

export interface SessionStats {
  winsByName: Record<string, number>
  lastRoundWinner: string | null
}

export function emptySessionStats(): SessionStats {
  return { winsByName: {}, lastRoundWinner: null }
}

// ── Room state ─────────────────────────────────────────────────────────────

export interface RoomState {
  host: WebSocket | null
  hostUserId: string
  hostHasEverConnected: boolean
  guests: Map<string, WebSocket> // name → socket
  pendingRound?: RoundConfig
  currentRound?: RoundState
  activeDeviceId?: string
  sessionStats: SessionStats
  // Casual Mode (Story 8-4; Story 9-2 persists across rounds): not persisted —
  // resets between sessions. Only changes via explicit player or host action.
  playerCasualModes: Map<string, boolean> // name → casual mode on
  // Snapshot of names who had casual mode ON before the host revoked it mid-session
  // (allowCasualMode: true → false). Consumed on restore (false → true). Story 9-2.
  priorCasualModes?: Set<string>
}

export const roomSockets = new Map<string, RoomState>()

// ── State persistence ─────────────────────────────────────────────────────

export function persistRoomState(code: string): void {
  const room = roomSockets.get(code)
  if (!room) return
  const round = room.currentRound
  const snapshot = {
    hostUserId: room.hostUserId,
    hostHasEverConnected: room.hostHasEverConnected,
    pendingRound: room.pendingRound,
    activeDeviceId: room.activeDeviceId,
    currentRound: round ? {
      roundNumber: round.roundNumber,
      config: round.config,
      playlist: round.playlist,
      cards: Object.fromEntries(round.cards),
      roundStartPayload: round.roundStartPayload,
      sessionPlayedIds: round.sessionPlayedIds,
      active: round.active,
      currentSongIndex: round.currentSongIndex,
      currentSongRevealed: round.currentSongRevealed,
      songHistory: round.songHistory,
      paused: round.paused,
      ended: round.ended,
    } : undefined,
  }
  upsertActiveRoom(code, JSON.stringify(snapshot))
}

export function rehydrateRooms(): void {
  const rows = getAllActiveRooms()
  for (const row of rows) {
    // Skip orphaned rows whose room was deleted from the DB
    if (!getRoomByCode(row.room_code)) {
      console.warn(`[rehydrate] room ${row.room_code} no longer exists in DB — deleting stale active_rooms row`)
      deleteActiveRoom(row.room_code)
      continue
    }

    let snap: any
    try {
      snap = JSON.parse(row.state_json)
    } catch {
      console.warn(`[rehydrate] corrupt state_json for room ${row.room_code} — deleting row`)
      deleteActiveRoom(row.room_code)
      continue
    }

    const roomState: RoomState = {
      host: null,
      hostUserId: snap.hostUserId,
      hostHasEverConnected: true,
      guests: new Map(),
      pendingRound: snap.pendingRound,
      activeDeviceId: snap.activeDeviceId ?? snap.sdkDeviceId,
      sessionStats: emptySessionStats(),
      playerCasualModes: new Map(),
      currentRound: snap.currentRound ? (() => {
        // Drop pre-9-3 winnerName from persisted snapshots — field removed from RoundState.
        const { winnerName: _winnerName, ...snapRound } = snap.currentRound
        return {
          ...snapRound,
          config: {
            ...snapRound.config,
            audioPreset: snapRound.config?.audioPreset ?? 'minimal',
          },
          roundStartPayload: {
            ...snapRound.roundStartPayload,
            audioPreset: snapRound.roundStartPayload?.audioPreset ?? 'minimal',
          },
          cards: new Map(Object.entries(snapRound.cards)),
          paused: true,
          timers: {},
          autoMarkedTileIndices: new Map(),
        }
      })() : undefined,
    }
    roomSockets.set(row.room_code, roomState)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function broadcast(roomCode: string, payload: object, exclude?: WebSocket): void {
  const room = roomSockets.get(roomCode)
  if (!room) return
  const data = JSON.stringify(payload)
  if (room.host && room.host.readyState === WebSocket.OPEN && room.host !== exclude) {
    try { room.host.send(data) } catch { /* ignore broken socket */ }
  }
  for (const [, socket] of room.guests) {
    if (socket.readyState === WebSocket.OPEN && socket !== exclude) {
      try { socket.send(data) } catch { /* ignore broken socket */ }
    }
  }
}

/**
 * Tear down a live room session: clear round timers, broadcast session:end
 * to all connected clients, force-close every socket with code 1000, and
 * drop the roomSockets entry. Safe no-op if the room has no live state.
 *
 * Broadcast BEFORE socket close so clients receive the payload, and BEFORE
 * the DB delete (the DB call happens in the router) so any race reading
 * the room during teardown still sees a valid row.
 *
 * WS event contract: { type: 'session:end', reason: 'host_deleted' }
 * (Story 7-2; future reason values e.g. 'host_timeout' out of scope.)
 */
export function destroyRoom(roomCode: string): void {
  const room = roomSockets.get(roomCode)
  if (!room) return

  // 1. clear any active round timers
  const round = room.currentRound
  if (round) {
    clearTimeout(round.timers.autoAdvance)
    clearTimeout(round.timers.reveal)
    round.timers.autoAdvance = undefined
    round.timers.reveal = undefined
  }

  // 2. broadcast session:end
  broadcast(roomCode, { type: 'session:end', reason: 'host_deleted' })

  // 3. close all sockets (host + guests) with clean 1000.
  // Close OPEN and CONNECTING sockets alike — a still-connecting socket must
  // not be allowed to finish attaching to a room that's being torn down.
  // CLOSING/CLOSED sockets throw from .close() (caught and ignored).
  if (room.host && room.host.readyState !== WebSocket.CLOSING && room.host.readyState !== WebSocket.CLOSED) {
    try { room.host.close(1000, 'session_ended') } catch { /* ignore */ }
  }
  for (const [, sock] of room.guests) {
    if (sock.readyState !== WebSocket.CLOSING && sock.readyState !== WebSocket.CLOSED) {
      try { sock.close(1000, 'session_ended') } catch { /* ignore */ }
    }
  }

  // 4. drop the entry
  roomSockets.delete(roomCode)

  // 5. clear any persisted state for this room
  deleteActiveRoom(roomCode)
}

export function getPlayerList(roomCode: string): string[] {
  const room = roomSockets.get(roomCode)
  if (!room) return []
  return Array.from(room.guests.keys())
}

export function getHostRoom(userId: string): string | undefined {
  for (const [code, room] of roomSockets) {
    if (room.hostUserId === userId) return code
  }
  return undefined
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map((cookie) => {
      const eq = cookie.indexOf('=')
      return eq === -1
        ? [cookie.trim(), '']
        : [cookie.slice(0, eq).trim(), cookie.slice(eq + 1).trim()]
    })
  )
}

// ── Connection handler ─────────────────────────────────────────────────────

function handleConnection(ws: WebSocket, req: IncomingMessage): void {
  ws.on('error', () => { /* prevent unhandled error crash */ })

  // Heartbeat: every HEARTBEAT_INTERVAL_MS send ping; terminate if no pong in
  // PONG_TIMEOUT_MS. The close handler below stops the interval.
  startHeartbeat(ws)
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg?.type === 'pong') recordPong(ws)
    } catch { /* ignore malformed */ }
  })
  ws.on('close', () => { stopHeartbeat(ws) })

  const url = new URL(req.url ?? '/', 'http://localhost')
  const code = url.searchParams.get('code') ?? ''
  const guestName = url.searchParams.get('name')

  const cookies = parseCookies(req.headers.cookie)
  const sessionUserId = cookies['session'] ? verifySession(cookies['session']) : null

  // A request with a session cookie is always the host path, regardless of ?name=
  if (sessionUserId) {
    // ── Host path ──────────────────────────────────────────────────────────
    const host = getHostById(sessionUserId)
    if (!host) {
      ws.close(4001, 'unauthorized')
      return
    }

    const room = getRoomByCode(code)
    if (!room) {
      ws.close(4004, 'room not found')
      return
    }

    if (room.host_user_id !== sessionUserId) {
      ws.close(4003, 'not your room')
      return
    }

    const wasInMap = roomSockets.has(code)
    if (!wasInMap) {
      roomSockets.set(code, { host: null, hostUserId: sessionUserId, hostHasEverConnected: false, guests: new Map(), sessionStats: emptySessionStats(), playerCasualModes: new Map() })
    }
    const roomState = roomSockets.get(code)!

    // If there is already an active host connection, reject the new one
    if (roomState.host && roomState.host.readyState === WebSocket.OPEN) {
      ws.close(4003, 'not your room')
      return
    }

    const isReconnect = wasInMap && roomState.host === null && roomState.hostHasEverConnected
    roomState.host = ws
    roomState.hostUserId = sessionUserId
    roomState.hostHasEverConnected = true

    ws.send(JSON.stringify({
      type: 'session:connect',
      role: 'host',
      players: getPlayerList(code),
      hostName: room.host_name,
      winsByName: { ...roomState.sessionStats.winsByName },
      lastRoundWinner: roomState.sessionStats.lastRoundWinner,
      casualModeNames: Array.from(roomState.playerCasualModes.entries()).filter(([, v]) => v).map(([k]) => k),
    }))

    // Send round:start if there is an active round (needed for HostRoomPage initial load)
    const activeRound = roomState.currentRound
    if (activeRound?.active) {
      const hostCard = activeRound.cards.get(sessionUserId) ?? []
      ws.send(JSON.stringify({ ...activeRound.roundStartPayload, card: hostCard, songHistory: activeRound.songHistory }))

      // Story 12-3: on host reconnect, fold any songs played during the disconnect
      // window into autoMarkedTileIndices (suppressEmit — we don't want the sweep
      // to fire its own catchUp event), then unicast the full set to the returning
      // socket in a single square:auto-marked event. One event = one catch-up toast.
      // playerCasualModes/autoMarkedTileIndices are keyed by host_name.
      const hostName = room.host_name
      if (hostName && roomState.playerCasualModes.get(hostName) === true) {
        runCasualModeSweep(code, roomState, { playerName: hostName, suppressEmit: true })
        replayAutoMarksToSocket(roomState, ws, hostName)
      }
    }

    if (isReconnect) {
      broadcast(code, { type: 'host:reconnected' }, ws)
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'player:casual-mode-changed') {
          if (typeof msg.enabled !== 'boolean') return
          const r = roomSockets.get(code)
          if (!r) return
          // Story 9-2: reject new opt-ins while the host has the permission off.
          if (msg.enabled === true && r.currentRound?.config.allowCasualMode === false) return
          // Host uses host_name as the casual-mode key so the existing PlayerList
          // ☕ indicator (keyed on hostName) lights up without extra client wiring.
          const currentHostName = getRoomByCode(code)?.host_name
          if (!currentHostName) return
          r.playerCasualModes.set(currentHostName, msg.enabled)
          broadcast(code, { type: 'player:casual-mode-changed', name: currentHostName, enabled: msg.enabled })
          if (msg.enabled === true) {
            runCasualModeSweep(code, r, { playerName: currentHostName, isCatchUp: true })
          } else {
            r.currentRound?.autoMarkedTileIndices.delete(currentHostName)
          }
        }
      } catch { /* ignore malformed */ }
    })

    ws.on('close', () => {
      const r = roomSockets.get(code)
      if (r && r.host === ws) {
        r.host = null
        broadcast(code, { type: 'host:disconnected' })
      }
    })
  } else {
    // ── Guest path ─────────────────────────────────────────────────────────
    const name = guestName?.trim() ?? ''
    if (!name) {
      ws.close(4000, 'missing name')
      return
    }

    const room = getRoomByCode(code)
    if (!room) {
      ws.close(4004, 'room not found')
      return
    }

    if (!roomSockets.has(code)) {
      roomSockets.set(code, { host: null, hostUserId: room.host_user_id, hostHasEverConnected: false, guests: new Map(), sessionStats: emptySessionStats(), playerCasualModes: new Map() })
    }
    const roomState = roomSockets.get(code)!

    // Reject if name is taken by a currently-connected guest
    const existing = roomState.guests.get(name)
    if (existing && existing.readyState === WebSocket.OPEN) {
      ws.close(4009, 'name taken')
      return
    }

    // Add/overwrite slot (handles reconnect)
    roomState.guests.set(name, ws)

    ws.send(JSON.stringify({
      type: 'session:connect',
      role: 'guest',
      players: getPlayerList(code),
      hostName: room.host_name,
      winsByName: { ...roomState.sessionStats.winsByName },
      lastRoundWinner: roomState.sessionStats.lastRoundWinner,
      casualModeNames: Array.from(roomState.playerCasualModes.entries()).filter(([, v]) => v).map(([k]) => k),
    }))

    // If a round is in progress, resend round:start — reuse existing card if reconnecting
    const round = roomState.currentRound
    if (round?.active) {
      const existingCard = round.cards.get(name)
      const card = existingCard ?? generateCard(round.playlist)
      if (!existingCard) round.cards.set(name, card)
      ws.send(JSON.stringify({
        ...round.roundStartPayload,
        card,
        lateJoin: !existingCard,
        songHistory: round.songHistory,
        currentSongRevealed: round.currentSongRevealed,
      }))

      // Casual Mode (Story 8-5) — catch-up sweep on reconnect. AC #5. Must be AFTER
      // ws.send(round:start) so the client has the card before the auto-mark event.
      // Story 12-3: fold any new songs played during the disconnect window into
      // autoMarkedTileIndices (suppressEmit), then unicast the full set to the
      // returning socket in a single square:auto-marked event. One event = one
      // catch-up toast.
      if (roomState.playerCasualModes.get(name) === true) {
        runCasualModeSweep(code, roomState, { playerName: name, suppressEmit: true })
        replayAutoMarksToSocket(roomState, ws, name)
      }
    }

    broadcast(code, { type: 'player:joined', name }, ws)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'guest:leave') {
          const r = roomSockets.get(code)
          if (r && r.guests.get(name) === ws) {
            r.guests.delete(name)
            broadcast(code, { type: 'player:left', name })
          }
        } else if (msg.type === 'player:casual-mode-changed') {
          if (typeof msg.enabled !== 'boolean') return
          const r = roomSockets.get(code)
          if (!r) return
          // Story 9-2: reject new opt-ins while the host has the permission off.
          if (msg.enabled === true && r.currentRound?.config.allowCasualMode === false) return
          r.playerCasualModes.set(name, msg.enabled)
          broadcast(code, { type: 'player:casual-mode-changed', name, enabled: msg.enabled })
          // Casual Mode (Story 8-5) — AC #4. On enable, run a catch-up sweep for this
          // player so they pick up any tiles matching already-played songs. On disable,
          // clear the per-player swept set so a later re-enable re-sweeps everything.
          if (msg.enabled === true) {
            runCasualModeSweep(code, r, { playerName: name, isCatchUp: true })
          } else {
            r.currentRound?.autoMarkedTileIndices.delete(name)
          }
        }
      } catch { /* ignore malformed */ }
    })

    ws.on('close', () => {
      const r = roomSockets.get(code)
      // Only remove if this is still the registered socket (not a reconnect)
      if (r && r.guests.get(name) === ws) {
        r.guests.delete(name)
        // Casual Mode (Story 8-5) — AC #6. Clear the per-player swept set so the next
        // reconnect's catch-up sweep re-emits every eligible tile (fresh-device safe).
        // Do NOT clear r.playerCasualModes — the ☕ indicator persists across reconnects.
        r.currentRound?.autoMarkedTileIndices.delete(name)
        broadcast(code, { type: 'player:left', name })
      }
    })
  }
}

// ── auth:degraded wiring ───────────────────────────────────────────────────

authEvents.on('degraded', (userId: string) => {
  const code = getHostRoom(userId)
  if (code) {
    broadcast(code, { type: 'auth:degraded' })
  }
})

// ── auth:restored wiring ───────────────────────────────────────────────────

authEvents.on('restored', (userId: string) => {
  const code = getHostRoom(userId)
  if (code) {
    const room = roomSockets.get(code)
    if (room?.host?.readyState === WebSocket.OPEN) {
      room.host.send(JSON.stringify({ type: 'auth:restored' }))
    }
  }
})

// ── WebSocket server setup ─────────────────────────────────────────────────

export function setupWebSocketServer(httpServer: ServerType): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', handleConnection)

  return wss
}
