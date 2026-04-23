import WebSocket, { WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { ServerType } from '@hono/node-server'
import { authEvents } from './refresh.ts'
import { verifySession } from './auth.ts'
import { getRoomByCode, getHostById, upsertActiveRoom, deleteActiveRoom, getAllActiveRooms, setRoomHostName } from './db.ts'
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

export interface WinData {
  winnerName: string
  winningTileIds: string[]
  songHistory: SongHistoryEntry[]
  winnerCard: Tile[]
}

export interface RoundState {
  roundNumber: number
  config: RoundConfig
  playlist: Track[]
  cards: Map<string, Tile[]>   // playerKey → card (host: userId, guests: name)
  roundStartPayload: object     // cached for late joiners
  active: boolean
  // ── NEW in Story 5-1 ──────────────────────────────────────────
  currentSongIndex: number        // -1 = round not yet started
  currentSongRevealed: boolean    // true once song:reveal has fired (or titleRevealDelay===0)
  songHistory: SongHistoryEntry[] // append-only; used by 5-5 win validation + 5-6 drawer
  paused: boolean                 // true after /pause; cleared on /play
  ended?: boolean                 // true after a valid win claim
  winData?: WinData               // set alongside ended; used to replay round:win on reconnect
  timers: {
    autoAdvance?: ReturnType<typeof setTimeout>
    reveal?: ReturnType<typeof setTimeout>
  }
  // Wall-clock ms (Date.now()) when the current clip's autoAdvance timer was
  // armed. Used by /host/resume (Story 12-2) to compute Spotify drift vs.
  // server-expected elapsed. Not persisted.
  clipStartedAt?: number
  // Casual Mode (Story 8-5): per-player set of already-swept tile indices.
  // Not persisted — reset to empty Map() on rehydrate. `playerCasualModes` IS
  // persisted across restart (Story 13-2), so the catch-up sweep picks up
  // the already-played songs on the next song:start.
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
  // Names of guests whose bingo claim is currently in-flight. player:rename rejects
  // if the claimer's name is in this set to prevent identity change during claim RPC.
  // CLAIM_PENDING_SENTINEL is added synchronously at /round/claim entry (before the
  // async body parse) so a rename arriving during the await can't slip past the guard.
  pendingClaims: Set<string>
}

// Sentinel entry added to pendingClaims at claim-handler entry, before the body
// is read. Rename handlers reject whenever pendingClaims is non-empty, so the
// sentinel keeps the rename guard live across the body-parse await window.
export const CLAIM_PENDING_SENTINEL = '__claim_pending__'

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
    // Story 13-2: persist Casual Mode so opt-ins survive server restart.
    // allowCasualMode is also inside currentRound.config; top-level copy
    // keeps AC-2's rehydrate contract explicit.
    allowCasualMode: round?.config.allowCasualMode ?? false,
    playerCasualModes: Object.fromEntries(
      Array.from(room.playerCasualModes.entries()).filter(([, v]) => v).map(([k]) => [k, true]),
    ),
    currentRound: round ? {
      roundNumber: round.roundNumber,
      config: round.config,
      playlist: round.playlist,
      cards: Object.fromEntries(round.cards),
      roundStartPayload: round.roundStartPayload,
      active: round.active,
      currentSongIndex: round.currentSongIndex,
      currentSongRevealed: round.currentSongRevealed,
      songHistory: round.songHistory,
      paused: round.paused,
      ended: round.ended,
      winData: round.winData,
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

    const restoredCasualModes = (snap.playerCasualModes && typeof snap.playerCasualModes === 'object')
      ? new Map<string, boolean>(Object.keys(snap.playerCasualModes).map((k) => [k, true]))
      : new Map<string, boolean>()

    const roomState: RoomState = {
      host: null,
      hostUserId: snap.hostUserId,
      hostHasEverConnected: true,
      guests: new Map(),
      pendingRound: snap.pendingRound,
      activeDeviceId: snap.activeDeviceId ?? snap.sdkDeviceId,
      sessionStats: emptySessionStats(),
      playerCasualModes: restoredCasualModes,
      pendingClaims: new Set(),
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

    // Story 13-2 AC-2: apply top-level allowCasualMode to currentRound.config
    // if present in the snapshot (no-op when there is no active round).
    if (typeof snap.allowCasualMode === 'boolean' && roomState.currentRound) {
      roomState.currentRound.config.allowCasualMode = snap.allowCasualMode
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

// ── Guest join rate limit ──────────────────────────────────────────────────

export const joinRateLimit = new Map<string, { count: number; resetAt: number }>()

function checkJoinRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = joinRateLimit.get(ip)
  if (!entry || entry.resetAt <= now) {
    joinRateLimit.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 10) return false
  entry.count++
  return true
}

// Periodic sweep: per-IP entries are only refreshed when that same IP returns
// after its window expires, so without a sweep, IPs that connect once would
// stay in the map forever. .unref() so this timer doesn't keep the process alive.
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of joinRateLimit) {
    if (entry.resetAt <= now) joinRateLimit.delete(ip)
  }
}, 60_000).unref()

// ── Connection handler ─────────────────────────────────────────────────────

function handleConnection(ws: WebSocket, req: IncomingMessage): void {
  ws.on('error', () => { /* prevent unhandled error crash */ })

  const url = new URL(req.url ?? '/', 'http://localhost')
  const code = url.searchParams.get('code') ?? ''
  const guestName = url.searchParams.get('name')

  const cookies = parseCookies(req.headers.cookie)
  const sessionUserId = cookies['session'] ? verifySession(cookies['session']) : null

  // Rate-limit guest joins (no valid session cookie) before allocating heartbeat
  // resources, so blocked attempts don't leak ping intervals. IP comes from
  // req.socket.remoteAddress and assumes no reverse proxy in front of Node — if
  // one is reintroduced, switch to a trusted X-Forwarded-For parse.
  if (!sessionUserId) {
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (!checkJoinRateLimit(ip)) {
      ws.close(4429, 'Too many requests')
      return
    }
  }

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
      roomSockets.set(code, { host: null, hostUserId: sessionUserId, hostHasEverConnected: false, guests: new Map(), sessionStats: emptySessionStats(), playerCasualModes: new Map(), pendingClaims: new Set() })
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

    // Send round:start if there is an active or just-ended round (needed for HostRoomPage
    // initial load and for Game Over screen replay on reconnect — Story 13-1).
    const activeRound = roomState.currentRound
    if (activeRound?.active || activeRound?.ended) {
      const hostCard = activeRound.cards.get(sessionUserId) ?? []
      ws.send(JSON.stringify({
        ...activeRound.roundStartPayload,
        card: hostCard,
        songHistory: activeRound.songHistory,
        currentSongIndex: activeRound.currentSongIndex,
        paused: activeRound.paused === true,
        currentSongRevealed: activeRound.currentSongRevealed,
      }))

      // Story 13-1: replay round:win when reconnecting into an ended round so the
      // host lands on the Game Over screen rather than an empty active-round shell.
      if (activeRound.ended && activeRound.winData) {
        ws.send(JSON.stringify({ type: 'round:win', ...activeRound.winData }))
      }

      // Story 12-3: on host reconnect, fold any songs played during the disconnect
      // window into autoMarkedTileIndices (suppressEmit — we don't want the sweep
      // to fire its own catchUp event), then unicast the full set to the returning
      // socket in a single square:auto-marked event. One event = one catch-up toast.
      // playerCasualModes/autoMarkedTileIndices are keyed by host_name.
      // runCasualModeSweep/replayAutoMarksToSocket guard !round.active — no-op for ended rounds.
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
        } else if (msg.type === 'player:rename') {
          const r = roomSockets.get(code)
          if (!r) return
          const currentRoom = getRoomByCode(code)
          if (!currentRoom?.host_name) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'no-host-name' }))
            return
          }
          const oldName = currentRoom.host_name
          const newName = typeof msg.newName === 'string' ? msg.newName.trim() : ''
          if (!newName || newName.length > 30 || newName === oldName) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'invalid' }))
            return
          }
          // Reject if colliding with a connected guest
          const conflictGuest = r.guests.get(newName)
          if (conflictGuest && conflictGuest.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'taken' }))
            return
          }
          // Reject if any claim is in-flight — the sentinel guards the narrow
          // window between /round/claim entry and body-parse completion.
          if (r.pendingClaims.size > 0) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'claiming' }))
            return
          }
          // Update host name in DB
          setRoomHostName(code, newName)
          // Atomic migration of name-keyed structures — no await between writes
          // Host cards key is hostUserId (stable) — do NOT migrate cards
          const casualMode = r.playerCasualModes.get(oldName)
          r.playerCasualModes.delete(oldName)
          if (casualMode !== undefined) r.playerCasualModes.set(newName, casualMode)
          if (r.priorCasualModes?.has(oldName)) {
            r.priorCasualModes.delete(oldName)
            r.priorCasualModes.add(newName)
          }
          if (r.currentRound) {
            const autoMarked = r.currentRound.autoMarkedTileIndices.get(oldName)
            if (autoMarked !== undefined) {
              r.currentRound.autoMarkedTileIndices.delete(oldName)
              r.currentRound.autoMarkedTileIndices.set(newName, autoMarked)
            }
            if (r.currentRound.winData?.winnerName === oldName) {
              r.currentRound.winData.winnerName = newName
            }
          }
          const wins = r.sessionStats.winsByName[oldName]
          if (wins !== undefined) {
            delete r.sessionStats.winsByName[oldName]
            r.sessionStats.winsByName[newName] = wins
          }
          if (r.sessionStats.lastRoundWinner === oldName) {
            r.sessionStats.lastRoundWinner = newName
          }
          broadcast(code, { type: 'player:renamed', oldName, newName, isHost: true })
          persistRoomState(code)
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
    // Rate-limit already enforced at the top of handleConnection.
    // Mutable ref so close/leave/casual-mode handlers always use the current
    // name after a successful rename (nameRef.current updated atomically).
    const nameRef = { current: guestName?.trim() ?? '' }
    if (!nameRef.current) {
      ws.close(4000, 'missing name')
      return
    }

    const room = getRoomByCode(code)
    if (!room) {
      ws.close(4004, 'room not found')
      return
    }

    if (!roomSockets.has(code)) {
      roomSockets.set(code, { host: null, hostUserId: room.host_user_id, hostHasEverConnected: false, guests: new Map(), sessionStats: emptySessionStats(), playerCasualModes: new Map(), pendingClaims: new Set() })
    }
    const roomState = roomSockets.get(code)!

    // Reject if name is taken by a currently-connected guest
    const existing = roomState.guests.get(nameRef.current)
    if (existing && existing.readyState === WebSocket.OPEN) {
      ws.close(4009, 'name taken')
      return
    }

    // Add/overwrite slot (handles reconnect)
    roomState.guests.set(nameRef.current, ws)

    ws.send(JSON.stringify({
      type: 'session:connect',
      role: 'guest',
      players: getPlayerList(code),
      hostName: room.host_name,
      winsByName: { ...roomState.sessionStats.winsByName },
      lastRoundWinner: roomState.sessionStats.lastRoundWinner,
      casualModeNames: Array.from(roomState.playerCasualModes.entries()).filter(([, v]) => v).map(([k]) => k),
    }))

    // If a round is active or just ended, resend round:start — reuse existing card if reconnecting.
    // Story 13-1: also replay for ended rounds so the Game Over screen is restored — but
    // only for returning guests (existingCard). A brand-new name joining an ended round
    // should not mint a new card against a dead round nor receive a round:win replay with
    // another player's winningTileIds.
    const round = roomState.currentRound
    if (round?.active || (round?.ended && round.cards.has(nameRef.current))) {
      const existingCard = round.cards.get(nameRef.current)
      const card = existingCard ?? generateCard(round.playlist)
      if (!existingCard) round.cards.set(nameRef.current, card)
      ws.send(JSON.stringify({
        ...round.roundStartPayload,
        card,
        lateJoin: !existingCard,
        songHistory: round.songHistory,
        currentSongRevealed: round.currentSongRevealed,
      }))

      // Story 13-1: replay round:win so the guest lands on the Game Over screen.
      if (round.ended && round.winData) {
        ws.send(JSON.stringify({ type: 'round:win', ...round.winData }))
      }

      // Casual Mode (Story 8-5) — catch-up sweep on reconnect. AC #5. Must be AFTER
      // ws.send(round:start) so the client has the card before the auto-mark event.
      // Story 12-3: fold any new songs played during the disconnect window into
      // autoMarkedTileIndices (suppressEmit), then unicast the full set to the
      // returning socket in a single square:auto-marked event. One event = one
      // catch-up toast.
      // runCasualModeSweep/replayAutoMarksToSocket guard !round.active — no-op for ended rounds.
      if (roomState.playerCasualModes.get(nameRef.current) === true) {
        runCasualModeSweep(code, roomState, { playerName: nameRef.current, suppressEmit: true })
        replayAutoMarksToSocket(roomState, ws, nameRef.current)
      }
    }

    broadcast(code, { type: 'player:joined', name: nameRef.current }, ws)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'guest:leave') {
          const r = roomSockets.get(code)
          if (r && r.guests.get(nameRef.current) === ws) {
            r.guests.delete(nameRef.current)
            broadcast(code, { type: 'player:left', name: nameRef.current })
          }
        } else if (msg.type === 'player:casual-mode-changed') {
          if (typeof msg.enabled !== 'boolean') return
          const r = roomSockets.get(code)
          if (!r) return
          // Story 9-2: reject new opt-ins while the host has the permission off.
          if (msg.enabled === true && r.currentRound?.config.allowCasualMode === false) return
          r.playerCasualModes.set(nameRef.current, msg.enabled)
          broadcast(code, { type: 'player:casual-mode-changed', name: nameRef.current, enabled: msg.enabled })
          // Casual Mode (Story 8-5) — AC #4. On enable, run a catch-up sweep for this
          // player so they pick up any tiles matching already-played songs. On disable,
          // clear the per-player swept set so a later re-enable re-sweeps everything.
          if (msg.enabled === true) {
            runCasualModeSweep(code, r, { playerName: nameRef.current, isCatchUp: true })
          } else {
            r.currentRound?.autoMarkedTileIndices.delete(nameRef.current)
          }
        } else if (msg.type === 'player:rename') {
          const r = roomSockets.get(code)
          if (!r) return
          const newName = typeof msg.newName === 'string' ? msg.newName.trim() : ''
          const oldName = nameRef.current
          // Client-side should prevent empty/unchanged, but validate on server too
          if (!newName || newName.length > 30 || newName === oldName) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'invalid' }))
            return
          }
          // Reject if rename would collide with host name
          const currentRoom = getRoomByCode(code)
          if (!currentRoom) return
          if (newName === currentRoom.host_name) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'taken' }))
            return
          }
          // Reject if colliding with a connected guest (other than self)
          const conflictSocket = r.guests.get(newName)
          if (conflictSocket && conflictSocket.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'taken' }))
            return
          }
          // Reject if any claim is in-flight — the sentinel guards the narrow
          // window between /round/claim entry and body-parse completion.
          if (r.pendingClaims.size > 0) {
            ws.send(JSON.stringify({ type: 'player:rename-rejected', reason: 'claiming' }))
            return
          }
          // Atomic migration — no await between map writes
          r.guests.delete(oldName)
          r.guests.set(newName, ws)
          const activeRound = r.currentRound
          if (activeRound) {
            const card = activeRound.cards.get(oldName)
            if (card !== undefined) {
              activeRound.cards.delete(oldName)
              activeRound.cards.set(newName, card)
            }
            const autoMarked = activeRound.autoMarkedTileIndices.get(oldName)
            if (autoMarked !== undefined) {
              activeRound.autoMarkedTileIndices.delete(oldName)
              activeRound.autoMarkedTileIndices.set(newName, autoMarked)
            }
            if (activeRound.winData?.winnerName === oldName) {
              activeRound.winData.winnerName = newName
            }
          }
          const casualMode = r.playerCasualModes.get(oldName)
          r.playerCasualModes.delete(oldName)
          if (casualMode !== undefined) r.playerCasualModes.set(newName, casualMode)
          if (r.priorCasualModes?.has(oldName)) {
            r.priorCasualModes.delete(oldName)
            r.priorCasualModes.add(newName)
          }
          const wins = r.sessionStats.winsByName[oldName]
          if (wins !== undefined) {
            delete r.sessionStats.winsByName[oldName]
            r.sessionStats.winsByName[newName] = wins
          }
          if (r.sessionStats.lastRoundWinner === oldName) {
            r.sessionStats.lastRoundWinner = newName
          }
          nameRef.current = newName
          broadcast(code, { type: 'player:renamed', oldName, newName })
          persistRoomState(code)
        }
      } catch { /* ignore malformed */ }
    })

    ws.on('close', () => {
      const r = roomSockets.get(code)
      // Only remove if this is still the registered socket (not a reconnect)
      if (r && r.guests.get(nameRef.current) === ws) {
        r.guests.delete(nameRef.current)
        // Casual Mode (Story 8-5) — AC #6. Clear the per-player swept set so the next
        // reconnect's catch-up sweep re-emits every eligible tile (fresh-device safe).
        // Do NOT clear r.playerCasualModes — the ☕ indicator persists across reconnects.
        r.currentRound?.autoMarkedTileIndices.delete(nameRef.current)
        broadcast(code, { type: 'player:left', name: nameRef.current })
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

// ── WebSocket origin allowlist (Story 14-4 — CSWSH hardening) ─────────────

export interface OriginCheckConfig {
  allowlist: Set<string>
  devMode: boolean
}

export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

export function isOriginAllowed(origin: string, cfg: OriginCheckConfig): boolean {
  if (!origin) return false
  if (cfg.allowlist.has(origin)) return true
  if (!cfg.devMode) return false
  let u: URL
  try { u = new URL(origin) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true
  if (u.hostname.endsWith('.ts.net')) return true
  return false
}

// ── WebSocket server setup ─────────────────────────────────────────────────

export function setupWebSocketServer(httpServer: ServerType): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  const rawAllowed = process.env.WS_ALLOWED_ORIGINS
  const isProd = process.env.NODE_ENV === 'production'
  const cfg: OriginCheckConfig = {
    allowlist: parseAllowedOrigins(rawAllowed),
    devMode: !isProd,
  }
  const prodMisconfig = isProd && cfg.allowlist.size === 0
  if (prodMisconfig) {
    console.warn('[ws] NODE_ENV=production but WS_ALLOWED_ORIGINS is unset — rejecting ALL WebSocket upgrades. Set WS_ALLOWED_ORIGINS on deploy.')
  }

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    const allowed = !prodMisconfig && isOriginAllowed(origin, cfg)
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', handleConnection)

  return wss
}
