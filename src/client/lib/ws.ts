import type { MeResponse } from './api.ts'

export type Page = 'loading' | 'login' | 'join' | 'dashboard' | 'lobby' | 'room' | 'hostroom'

/** Pure routing function — determines which page to show on app load. */
export function determineInitialPage(
  me: MeResponse | null,
  pathname: string
): { page: Page; prefillCode?: string; roomCode?: string } {
  const roomMatch = pathname.match(/^\/([A-HJ-NP-Za-hj-np-z]{4})$/)
  if (roomMatch) {
    const code = sanitizeCode(roomMatch[1])
    if (me) return { page: 'lobby', roomCode: code }
    return { page: 'join', prefillCode: code }
  }
  if (me) return { page: 'dashboard' }
  return { page: 'join' }
}

/** Applies a player:joined / player:left WS event to an existing player list. */
export function applyPlayerEvent(
  players: string[],
  event: { type: string; name: string }
): string[] {
  if (event.type === 'player:joined') return [...players, event.name]
  if (event.type === 'player:left') return players.filter((p) => p !== event.name)
  return players
}

/** Writes the room code to the clipboard. */
export async function copyRoomCode(code: string): Promise<void> {
  await navigator.clipboard.writeText(code)
}

export interface HostHandlers {
  onConnect(players: string[], hostName: string | null): void
  onPlayerJoined(name: string): void
  onPlayerLeft(name: string): void
  onAuthDegraded(): void
  onDisconnected(): void
  onRoundActive?(): void
}

export function connectAsHost(code: string, handlers: HostHandlers): WebSocket {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?code=${encodeURIComponent(code)}`
  const ws = new WebSocket(wsUrl)

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'session:connect') {
        handlers.onConnect(data.players ?? [], data.hostName ?? null)
      } else if (data.type === 'round:start') {
        handlers.onRoundActive?.()
      } else if (data.type === 'player:joined') {
        handlers.onPlayerJoined(data.name)
      } else if (data.type === 'player:left') {
        handlers.onPlayerLeft(data.name)
      } else if (data.type === 'auth:degraded') {
        handlers.onAuthDegraded()
      } else if (data.type === 'session:end') {
        // Recognised in 7-2; full UX (banner, redirect) lives in Story 7-5.
        // The server force-closes the socket immediately after broadcasting,
        // so the existing onclose path still fires for disconnect handling.
      }
    } catch {
      // ignore unparseable messages
    }
  }

  ws.onerror = () => handlers.onDisconnected()
  ws.onclose = (event) => {
    if (event.code !== 1000) handlers.onDisconnected()
  }

  return ws
}

export interface GuestHandlers {
  onConnect(role: string, players: string[], hostName: string | null): void
  onError(message: string): void
  onMessage(event: { data: string }): void
  onHostDisconnected?(): void
  onHostReconnected?(): void
}

export function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').replace(/[OI]/g, '').slice(0, 4)
}

export function validateJoin(name: string, code: string): { nameError?: string; codeError?: string } {
  const errors: { nameError?: string; codeError?: string } = {}
  if (!name.trim()) errors.nameError = 'Please enter your name'
  if (!/^[A-HJ-NP-Z]{4}$/.test(code)) errors.codeError = 'Room code must be 4 letters'
  return errors
}

export function closeCodeToMessage(code: number): string | null {
  switch (code) {
    case 4004: return 'Room not found'
    case 4009: return 'That name is already taken'
    case 4410: return 'No active session in this room'
    default: return null
  }
}

export function connectAsGuest(name: string, code: string, handlers: GuestHandlers): WebSocket {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?name=${encodeURIComponent(name)}&code=${encodeURIComponent(code)}`

  const ws = new WebSocket(wsUrl)
  let sessionConnected = false

  ws.onclose = (event) => {
    const message = closeCodeToMessage(event.code)
    if (message) {
      handlers.onError(message)
    } else if (!sessionConnected && event.code !== 1000) {
      handlers.onError('Connection failed — please try again')
    }
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'session:connect') {
        sessionConnected = true
        handlers.onConnect(data.role, data.players ?? [], data.hostName ?? null)
      } else if (data.type === 'host:disconnected') {
        handlers.onHostDisconnected?.()
      } else if (data.type === 'host:reconnected') {
        handlers.onHostReconnected?.()
      } else if (data.type === 'session:end') {
        // Recognised in 7-2; full guest UX (banner, redirect) lives in Story 7-5.
        // Server force-closes the socket next — existing onclose path fires.
      } else {
        handlers.onMessage(event)
      }
    } catch {
      handlers.onMessage(event)
    }
  }

  return ws
}
