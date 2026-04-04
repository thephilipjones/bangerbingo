import WebSocket, { WebSocketServer } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'
import { authEvents } from './refresh.ts'
import { getRoomByCode, getHostById } from './db.ts'

// ── Room state ─────────────────────────────────────────────────────────────

interface RoomState {
  host: WebSocket | null
  hostUserId: string
  guests: Map<string, WebSocket> // name → socket
}

export const roomSockets = new Map<string, RoomState>()

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

  const url = new URL(req.url ?? '/', 'http://localhost')
  const code = url.searchParams.get('code') ?? ''
  const guestName = url.searchParams.get('name')

  const cookies = parseCookies(req.headers.cookie)
  const sessionUserId = cookies['session']

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

    if (!roomSockets.has(code)) {
      roomSockets.set(code, { host: null, hostUserId: sessionUserId, guests: new Map() })
    }
    const roomState = roomSockets.get(code)!

    // Close any existing host socket before replacing
    if (roomState.host && roomState.host.readyState === WebSocket.OPEN) {
      roomState.host.close(4000, 'replaced by new connection')
    }
    roomState.host = ws
    roomState.hostUserId = sessionUserId

    ws.send(JSON.stringify({ type: 'session:connect', role: 'host', players: getPlayerList(code) }))

    ws.on('close', () => {
      const r = roomSockets.get(code)
      if (r) {
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
      roomSockets.set(code, { host: null, hostUserId: room.host_user_id, guests: new Map() })
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

    ws.send(JSON.stringify({ type: 'session:connect', role: 'guest', players: getPlayerList(code) }))

    broadcast(code, { type: 'player:joined', name }, ws)

    ws.on('close', () => {
      const r = roomSockets.get(code)
      // Only remove if this is still the registered socket (not a reconnect)
      if (r && r.guests.get(name) === ws) {
        r.guests.delete(name)
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

// ── WebSocket server setup ─────────────────────────────────────────────────

export function setupWebSocketServer(httpServer: Server): WebSocketServer {
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
