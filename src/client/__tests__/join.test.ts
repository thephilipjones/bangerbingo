import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sanitizeCode, validateJoin, closeCodeToMessage, connectAsGuest } from '../lib/ws.ts'

// ── sanitizeCode ───────────────────────────────────────────────────────────

describe('sanitizeCode', () => {
  it('uppercases lowercase letters', () => {
    expect(sanitizeCode('abcd')).toBe('ABCD')
  })

  it('strips O', () => {
    expect(sanitizeCode('O')).toBe('')
    expect(sanitizeCode('ABCO')).toBe('ABC')
  })

  it('strips I', () => {
    expect(sanitizeCode('I')).toBe('')
    expect(sanitizeCode('ABIC')).toBe('ABC')
  })

  it('strips spaces', () => {
    expect(sanitizeCode('A B C')).toBe('ABC')
  })

  it('strips numbers', () => {
    expect(sanitizeCode('A1B2C')).toBe('ABC')
  })

  it('strips symbols', () => {
    expect(sanitizeCode('A-B.C')).toBe('ABC')
  })

  it('enforces max 4 chars', () => {
    expect(sanitizeCode('ABCDEFGH')).toBe('ABCD')
  })

  it('returns empty string for all-stripped input', () => {
    expect(sanitizeCode('OI123 ')).toBe('')
  })
})

// ── validateJoin ───────────────────────────────────────────────────────────

describe('validateJoin', () => {
  it('returns nameError for empty name', () => {
    const { nameError } = validateJoin('', 'ABCD')
    expect(nameError).toBe('Please enter your name')
  })

  it('returns nameError for whitespace-only name', () => {
    const { nameError } = validateJoin('   ', 'ABCD')
    expect(nameError).toBe('Please enter your name')
  })

  it('returns codeError for code shorter than 4 chars', () => {
    const { codeError } = validateJoin('Philip', 'ABC')
    expect(codeError).toBe('Room code must be 4 letters')
  })

  it('returns codeError for code longer than 4 chars', () => {
    const { codeError } = validateJoin('Philip', 'ABCDE')
    expect(codeError).toBe('Room code must be 4 letters')
  })

  it('returns codeError for code containing numbers', () => {
    const { codeError } = validateJoin('Philip', 'AB12')
    expect(codeError).toBe('Room code must be 4 letters')
  })

  it('returns codeError for code containing O', () => {
    const { codeError } = validateJoin('Philip', 'ABCO')
    expect(codeError).toBe('Room code must be 4 letters')
  })

  it('returns codeError for code containing I', () => {
    const { codeError } = validateJoin('Philip', 'ABIC')
    expect(codeError).toBe('Room code must be 4 letters')
  })

  it('returns no errors for valid inputs', () => {
    const result = validateJoin('Philip', 'ABCD')
    expect(result.nameError).toBeUndefined()
    expect(result.codeError).toBeUndefined()
  })

  it('does not make a network call (no fetch/WS called)', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response())
    validateJoin('', 'ABCD')
    validateJoin('Philip', 'ABC')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

// ── closeCodeToMessage ─────────────────────────────────────────────────────

describe('closeCodeToMessage', () => {
  it('maps 4004 to Room not found', () => {
    expect(closeCodeToMessage(4004)).toBe('Room not found')
  })

  it('maps 4009 to name taken', () => {
    expect(closeCodeToMessage(4009)).toBe('That name is already taken')
  })

  it('maps 4410 to no active session', () => {
    expect(closeCodeToMessage(4410)).toBe('No active session in this room')
  })

  it('returns null for normal closure (1000)', () => {
    expect(closeCodeToMessage(1000)).toBeNull()
  })

  it('returns null for unknown close codes', () => {
    expect(closeCodeToMessage(1006)).toBeNull()
  })
})

// ── connectAsGuest ─────────────────────────────────────────────────────────

describe('connectAsGuest', () => {
  let MockWebSocket: ReturnType<typeof vi.fn>
  let mockInstance: { onclose: ((e: { code: number }) => void) | null; onmessage: ((e: { data: string }) => void) | null }

  beforeEach(() => {
    mockInstance = { onclose: null, onmessage: null }
    MockWebSocket = vi.fn(() => mockInstance)
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:3000' } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('constructs WS URL with name and code', () => {
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage: vi.fn() })
    expect(MockWebSocket).toHaveBeenCalledWith('ws://localhost:3000/ws?name=Philip&code=ABCD')
  })

  it('encodes name with special characters', () => {
    connectAsGuest('Ph l p', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage: vi.fn() })
    expect(MockWebSocket).toHaveBeenCalledWith('ws://localhost:3000/ws?name=Ph%20l%20p&code=ABCD')
  })

  it('calls onError with "Room not found" on close code 4004', () => {
    const onError = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError, onMessage: vi.fn() })
    mockInstance.onclose!({ code: 4004 })
    expect(onError).toHaveBeenCalledWith('Room not found')
  })

  it('calls onError with "That name is already taken" on close code 4009', () => {
    const onError = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError, onMessage: vi.fn() })
    mockInstance.onclose!({ code: 4009 })
    expect(onError).toHaveBeenCalledWith('That name is already taken')
  })

  it('calls onError with generic message on unmapped close code before connect', () => {
    const onError = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError, onMessage: vi.fn() })
    mockInstance.onclose!({ code: 1006 })
    expect(onError).toHaveBeenCalledWith('Connection failed — please try again')
  })

  it('does not call onError on clean close after session:connect', () => {
    const onError = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError, onMessage: vi.fn() })
    mockInstance.onmessage!({ data: JSON.stringify({ type: 'session:connect', role: 'guest', players: [] }) })
    mockInstance.onclose!({ code: 1000 })
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not call onError on clean close (1000) before connect', () => {
    const onError = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError, onMessage: vi.fn() })
    mockInstance.onclose!({ code: 1000 })
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onConnect with role and players on session:connect message', () => {
    const onConnect = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect, onError: vi.fn(), onMessage: vi.fn() })
    mockInstance.onmessage!({ data: JSON.stringify({ type: 'session:connect', role: 'guest', players: ['Philip', 'Alice'] }) })
    expect(onConnect).toHaveBeenCalledWith('guest', ['Philip', 'Alice'])
  })

  it('calls onConnect with empty players array if players missing', () => {
    const onConnect = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect, onError: vi.fn(), onMessage: vi.fn() })
    mockInstance.onmessage!({ data: JSON.stringify({ type: 'session:connect', role: 'guest' }) })
    expect(onConnect).toHaveBeenCalledWith('guest', [])
  })

  it('calls onMessage for non-session:connect messages', () => {
    const onMessage = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage })
    const event = { data: JSON.stringify({ type: 'ping' }) }
    mockInstance.onmessage!(event)
    expect(onMessage).toHaveBeenCalledWith(event)
  })

  it('returns the WebSocket instance', () => {
    const ws = connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage: vi.fn() })
    expect(ws).toBe(mockInstance)
  })

  it('calls onHostDisconnected on host:disconnected message', () => {
    const onHostDisconnected = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage: vi.fn(), onHostDisconnected })
    mockInstance.onmessage!({ data: JSON.stringify({ type: 'host:disconnected' }) })
    expect(onHostDisconnected).toHaveBeenCalled()
  })

  it('calls onHostReconnected on host:reconnected message', () => {
    const onHostReconnected = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage: vi.fn(), onHostReconnected })
    mockInstance.onmessage!({ data: JSON.stringify({ type: 'host:reconnected' }) })
    expect(onHostReconnected).toHaveBeenCalled()
  })

  it('does not call onMessage for host:disconnected (consumed by dedicated handler)', () => {
    const onMessage = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage, onHostDisconnected: vi.fn() })
    mockInstance.onmessage!({ data: JSON.stringify({ type: 'host:disconnected' }) })
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('does not call onMessage for host:reconnected (consumed by dedicated handler)', () => {
    const onMessage = vi.fn()
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage, onHostReconnected: vi.fn() })
    mockInstance.onmessage!({ data: JSON.stringify({ type: 'host:reconnected' }) })
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('host:disconnected without handler does not throw', () => {
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage: vi.fn() })
    expect(() => mockInstance.onmessage!({ data: JSON.stringify({ type: 'host:disconnected' }) })).not.toThrow()
  })

  it('host:reconnected without handler does not throw', () => {
    connectAsGuest('Philip', 'ABCD', { onConnect: vi.fn(), onError: vi.fn(), onMessage: vi.fn() })
    expect(() => mockInstance.onmessage!({ data: JSON.stringify({ type: 'host:reconnected' }) })).not.toThrow()
  })
})
