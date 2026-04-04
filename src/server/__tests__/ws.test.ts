import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAdaptorServer } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { initDb, upsertHost, createRoom } from '../db.ts'

vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { app } = await import('../index.ts')
const { setupWebSocketServer, roomSockets, getPlayerList } = await import('../ws.ts')
const { authEvents } = await import('../refresh.ts')

// ── Types ──────────────────────────────────────────────────────────────────

type Msg = Record<string, unknown>

interface WsClient {
  ws: WebSocket
  next(type?: string): Promise<Msg>
  close(): void
}

// ── Test helpers ───────────────────────────────────────────────────────────

function seedHost(userId = 'host_1') {
  upsertHost({
    user_id: userId,
    display_name: 'Test Host',
    email: 'test@example.com',
    access_token: 'tok',
    refresh_token: 'ref',
    token_expires_at: Date.now() + 3_600_000,
  })
}

/**
 * Connect a WebSocket client with a message buffer.
 * Messages are buffered from the moment the socket is created,
 * so callers never miss messages that arrive before a listener is attached.
 */
function connect(path: string, options: { cookie?: string } = {}): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: options.cookie ? { Cookie: options.cookie } : {},
    })

    const buf: Msg[] = []
    const waiting: Array<{ type: string | undefined; res: (m: Msg) => void; rej: (e: Error) => void }> = []

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Msg
      const idx = waiting.findIndex((w) => w.type === undefined || w.type === msg.type)
      if (idx !== -1) {
        const w = waiting.splice(idx, 1)[0]
        w.res(msg)
      } else {
        buf.push(msg)
      }
    })

    function next(type?: string): Promise<Msg> {
      // Check buffer first
      const bufferedIdx = type
        ? buf.findIndex((m) => m.type === type)
        : buf.length > 0 ? 0 : -1
      if (bufferedIdx !== -1) {
        return Promise.resolve(buf.splice(bufferedIdx, 1)[0])
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const i = waiting.findIndex((w) => w.res === res)
          if (i !== -1) waiting.splice(i, 1)
          rej(new Error(`next(${type ?? 'any'}) timed out`))
        }, 2000)
        waiting.push({
          type,
          res: (m) => { clearTimeout(timer); res(m) },
          rej,
        })
      })
    }

    ws.once('open', () => {
      // Remove the pre-open close listener now that the connection is established
      ws.off('close', onPreOpenClose)
      resolve({ ws, next, close: () => ws.close() })
    })
    ws.once('error', reject)
    function onPreOpenClose(code: number, reason: Buffer) {
      reject(new Error(`WS closed ${code}: ${reason.toString()}`))
    }
    ws.once('close', onPreOpenClose)
  })
}

function rawConnect(path: string, options: { cookie?: string } = {}): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: options.cookie ? { Cookie: options.cookie } : {},
  })
}

function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: 0, reason: '' })
      return
    }
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Server lifecycle ───────────────────────────────────────────────────────

let server: ReturnType<typeof createAdaptorServer>
let port: number

beforeEach(async () => {
  initDb(':memory:')
  roomSockets.clear()
  server = createAdaptorServer({ fetch: app.fetch })
  setupWebSocketServer(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
}, 10000)

afterEach(async () => {
  // Close all open connections then stop server
  for (const [, room] of roomSockets) {
    room.host?.terminate()
    for (const [, sock] of room.guests) sock.terminate()
  }
  roomSockets.clear()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}, 10000)

// ── Host connect (AC: 1) ───────────────────────────────────────────────────

describe('Host connect', () => {
  it('valid session + owned room → session:connect with role:host and empty player list', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const c = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    const msg = await c.next()

    expect(msg).toEqual({ type: 'session:connect', role: 'host', players: [] })
    c.close()
  })

  it("room not found → WS closes with 4004 'room not found'", async () => {
    seedHost('host_1')

    const ws = rawConnect('/ws?code=ZZZZ', { cookie: 'session=host_1' })
    const closed = await waitClose(ws)

    expect(closed.code).toBe(4004)
    expect(closed.reason).toBe('room not found')
  })
})

// ── Guest connect (AC: 2) ──────────────────────────────────────────────────

describe('Guest connect', () => {
  it('valid name + code → session:connect with role:guest', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const c = await connect('/ws?code=AAAA&name=Alice')
    const msg = await c.next()

    expect(msg.type).toBe('session:connect')
    expect(msg.role).toBe('guest')
    expect(msg.players).toEqual(['Alice'])
    c.close()
  })

  it('guest joining broadcasts player:joined to host and other guests', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    await host.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')

    const joined = await host.next('player:joined')
    expect(joined).toEqual({ type: 'player:joined', name: 'Alice' })

    host.close()
    alice.close()
  })

  it('second guest sees first guest in player list', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    const bobMsg = await bob.next('session:connect')

    expect((bobMsg.players as string[]).sort()).toEqual(['Alice', 'Bob'])

    alice.close()
    bob.close()
  })

  it("room not found for guest → WS closes with 4004 'room not found'", async () => {
    const ws = rawConnect('/ws?code=ZZZZ&name=Alice')
    const closed = await waitClose(ws)

    expect(closed.code).toBe(4004)
    expect(closed.reason).toBe('room not found')
  })
})

// ── Guest disconnect (AC: 3) ───────────────────────────────────────────────

describe('Guest disconnect', () => {
  it('remaining clients receive player:left within 200ms', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    await host.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    const start = Date.now()
    alice.close()

    const leftMsg = await host.next('player:left')
    const elapsed = Date.now() - start

    expect(leftMsg).toEqual({ type: 'player:left', name: 'Alice' })
    expect(elapsed).toBeLessThan(200)

    host.close()
  })
})

// ── Guest reconnect (AC: 4) ────────────────────────────────────────────────

describe('Guest reconnect', () => {
  it('reconnect with same name after disconnect restores slot without duplicate', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')

    await new Promise<void>((resolve) => {
      alice.ws.once('close', () => resolve())
      alice.close()
    })

    const alice2 = await connect('/ws?code=AAAA&name=Alice')
    const msg = await alice2.next('session:connect')

    expect(msg.role).toBe('guest')
    expect(msg.players).toEqual(['Alice']) // exactly one

    alice2.close()
  })
})

// ── Name taken (AC: 7) ────────────────────────────────────────────────────

describe('Name taken', () => {
  it("name taken by connected guest → WS closes with 4009 'name taken'", async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')

    const alice2 = rawConnect('/ws?code=AAAA&name=Alice')
    const closed = await waitClose(alice2)

    expect(closed.code).toBe(4009)
    expect(closed.reason).toBe('name taken')

    alice.close()
  })
})

// ── Host player list accuracy (AC: 5) ─────────────────────────────────────

describe('Host player list accuracy', () => {
  it('player list reflects only currently-connected guests after one leaves', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    await host.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')
    await host.next('player:joined')

    alice.close()
    await host.next('player:left')

    expect(getPlayerList('AAAA')).toEqual(['Bob'])

    host.close()
    bob.close()
  })
})

// ── Host disconnect / reconnect (Story 3-5) ───────────────────────────────

describe('Host disconnect → host:disconnected broadcast', () => {
  it('guests receive host:disconnected within 200ms when host WS closes', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    await host.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    const start = Date.now()
    host.close()

    const msg = await alice.next('host:disconnected')
    const elapsed = Date.now() - start

    expect(msg).toEqual({ type: 'host:disconnected' })
    expect(elapsed).toBeLessThan(200)

    alice.close()
  })
})

describe('Host reconnect → host:reconnected broadcast', () => {
  it('host reconnecting via same session cookie restores slot and guests receive host:reconnected', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    // Initial connect
    const host1 = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    await host1.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')
    await host1.next('player:joined')

    // Host disconnects
    await new Promise<void>((resolve) => {
      host1.ws.once('close', () => resolve())
      host1.close()
    })
    await alice.next('host:disconnected')

    // Host reconnects
    const host2 = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    const reconnectAck = await host2.next('session:connect')

    expect(reconnectAck.role).toBe('host')
    expect(reconnectAck.players).toEqual(['Alice'])

    const reconnectMsg = await alice.next('host:reconnected')
    expect(reconnectMsg).toEqual({ type: 'host:reconnected' })

    host2.close()
    alice.close()
  })
})

describe('Host ownership enforcement (AC: 6)', () => {
  it('different user_id attempting to claim room → WS closed with 4003', async () => {
    seedHost('host_1')
    seedHost('host_2')
    createRoom('AAAA', 'host_1')

    const ws = rawConnect('/ws?code=AAAA', { cookie: 'session=host_2' })
    const closed = await waitClose(ws)

    expect(closed.code).toBe(4003)
    expect(closed.reason).toBe('not your room')
  })

  it('room with active host: second host connection attempt → 4003', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host1 = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    await host1.next('session:connect')

    // Same owner tries to open a second connection while first is active
    const ws2 = rawConnect('/ws?code=AAAA', { cookie: 'session=host_1' })
    const closed = await waitClose(ws2)

    expect(closed.code).toBe(4003)

    host1.close()
  })
})

// ── auth:degraded broadcast (AC: 8) ───────────────────────────────────────

describe('auth:degraded broadcast', () => {
  it('authEvents degraded broadcasts auth:degraded to all clients in room', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: 'session=host_1' })
    await host.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    const hostDegraded = host.next('auth:degraded')
    const aliceDegraded = alice.next('auth:degraded')

    authEvents.emit('degraded', 'host_1')

    const [h, a] = await Promise.all([hostDegraded, aliceDegraded])
    expect(h).toEqual({ type: 'auth:degraded' })
    expect(a).toEqual({ type: 'auth:degraded' })

    host.close()
    alice.close()
  })
})
