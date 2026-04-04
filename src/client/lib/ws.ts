export interface GuestHandlers {
  onConnect(role: string, players: string[]): void
  onError(message: string): void
  onMessage(event: { data: string }): void
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
        handlers.onConnect(data.role, data.players ?? [])
      } else {
        handlers.onMessage(event)
      }
    } catch {
      handlers.onMessage(event)
    }
  }

  return ws
}
