import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAdaptorServer } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { initDb, upsertHost, createRoom, getDb, getRoomByCode, getPlayedSongs, recordPlayedSongs, setRoomHostName } from '../db.ts'

vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { app } = await import('../index.ts')
const { setupWebSocketServer, roomSockets, getPlayerList } = await import('../ws.ts')
const { authEvents } = await import('../refresh.ts')
const { signUserId } = await import('../auth.ts')

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

function sessionCookie(userId = 'host_1') {
  return `session=${signUserId(userId)}`
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

    const c = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    const msg = await c.next()

    expect(msg).toEqual({ type: 'session:connect', role: 'host', players: [], hostName: null })
    c.close()
  })

  it("room not found → WS closes with 4004 'room not found'", async () => {
    seedHost('host_1')

    const ws = rawConnect('/ws?code=ZZZZ', { cookie: sessionCookie() })
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
    expect(msg.hostName).toBeNull()
    c.close()
  })

  it('guest joining broadcasts player:joined to host and other guests', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
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

// ── session:connect with hostName (AC: 12) ────────────────────────────────────

describe('session:connect with hostName set', () => {
  it('host connects with hostName set → session:connect includes hostName', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')
    setRoomHostName('AAAA', 'Sarah')

    const c = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    const msg = await c.next()

    expect(msg).toEqual({ type: 'session:connect', role: 'host', players: [], hostName: 'Sarah' })
    c.close()
  })

  it('guest connects with hostName set → session:connect includes hostName', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')
    setRoomHostName('AAAA', 'Sarah')

    const c = await connect('/ws?code=AAAA&name=Philip')
    const msg = await c.next()

    expect(msg.type).toBe('session:connect')
    expect(msg.role).toBe('guest')
    expect(msg.players).toEqual(['Philip'])
    expect(msg.hostName).toBe('Sarah')
    c.close()
  })
})

// ── Guest disconnect (AC: 3) ───────────────────────────────────────────────

describe('Guest disconnect', () => {
  it('remaining clients receive player:left within 200ms', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
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

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
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

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
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
    const host1 = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
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
    const host2 = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
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

    const ws = rawConnect('/ws?code=AAAA', { cookie: sessionCookie('host_2') })
    const closed = await waitClose(ws)

    expect(closed.code).toBe(4003)
    expect(closed.reason).toBe('not your room')
  })

  it('room with active host: second host connection attempt → 4003', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host1 = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host1.next('session:connect')

    // Same owner tries to open a second connection while first is active
    const ws2 = rawConnect('/ws?code=AAAA', { cookie: sessionCookie() })
    const closed = await waitClose(ws2)

    expect(closed.code).toBe(4003)

    host1.close()
  })
})

// ── Late-join round:start (Story 4-3, AC: 7) ─────────────────────────────

describe('Late-join after round:start', () => {
  it('guest connecting after round:start receives round:start with lateJoin:true and blank card', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    // Mock getPlaylistTracks so the HTTP round endpoint works
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )

    // Import the app for HTTP requests
    const { app: honoApp } = await import('../index.ts')

    // Connect host via WS
    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    // Start a round via HTTP
    const roundRes = await honoApp.request('/api/rooms/AAAA/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
    })
    expect(roundRes.status).toBe(200)

    // Consume the round:start the host receives over WS
    await host.next('round:start')

    // Now a late-joining guest connects
    const lateGuest = await connect('/ws?code=AAAA&name=LateAlice')

    // They should get session:connect first, then round:start (or vice versa depending on buffering)
    const sessionMsg = await lateGuest.next('session:connect')
    expect(sessionMsg.role).toBe('guest')

    const roundMsg = await lateGuest.next('round:start')
    expect(roundMsg.type).toBe('round:start')
    expect(roundMsg.lateJoin).toBe(true)

    // Card should be an array of 25 tiles, all blank (trackId = '')
    const card = roundMsg.card as Array<{ trackId: string; free?: boolean }>
    expect(card).toHaveLength(25)
    expect(card.every(t => t.trackId === '')).toBe(true)
    expect(card[12].free).toBe(true)

    vi.restoreAllMocks()
    host.close()
    lateGuest.close()
  })
})

// ── Late-join songHistory (Story 5-6) ────────────────────────────────────

describe('Late-join includes songHistory', () => {
  it('guest late-join round:start includes songHistory from active round', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: `Artist ${i}`, albumArtUrl: `https://art/${i}.jpg` }))
    )

    const { app: honoApp } = await import('../index.ts')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const roundRes = await honoApp.request('/api/rooms/AAAA/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
    })
    expect(roundRes.status).toBe(200)
    await host.next('round:start')

    // Play a song so songHistory is non-empty
    const playRes = await honoApp.request('/api/rooms/AAAA/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(playRes.status).toBe(200)
    await host.next('song:start')

    // Late-joining guest
    const lateGuest = await connect('/ws?code=AAAA&name=LateAlice')
    await lateGuest.next('session:connect')
    const roundMsg = await lateGuest.next('round:start')

    expect(roundMsg.lateJoin).toBe(true)
    expect(Array.isArray(roundMsg.songHistory)).toBe(true)
    expect((roundMsg.songHistory as unknown[]).length).toBe(1)

    vi.restoreAllMocks()
    host.close()
    lateGuest.close()
  })

  it('host reconnect mid-round round:start includes songHistory', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: `Artist ${i}`, albumArtUrl: `https://art/${i}.jpg` }))
    )

    const { app: honoApp } = await import('../index.ts')

    const host1 = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host1.next('session:connect')

    const roundRes = await honoApp.request('/api/rooms/AAAA/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
    })
    expect(roundRes.status).toBe(200)
    await host1.next('round:start')

    // Play a song so songHistory is non-empty
    const playRes = await honoApp.request('/api/rooms/AAAA/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(playRes.status).toBe(200)
    await host1.next('song:start')

    // Host disconnects
    await new Promise<void>((resolve) => {
      host1.ws.once('close', () => resolve())
      host1.close()
    })

    // Host reconnects
    const host2 = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host2.next('session:connect')
    const roundMsg = await host2.next('round:start')

    expect(Array.isArray(roundMsg.songHistory)).toBe(true)
    expect((roundMsg.songHistory as unknown[]).length).toBe(1)

    vi.restoreAllMocks()
    host2.close()
  })
})

// ── auth:restored (Story 5-6) ─────────────────────────────────────────────

describe('auth:restored direct send', () => {
  it('authEvents restored sends auth:restored only to host (not guests)', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    const hostRestored = host.next('auth:restored')

    authEvents.emit('restored', 'host_1')

    const msg = await hostRestored
    expect(msg).toEqual({ type: 'auth:restored' })

    // Alice should NOT receive auth:restored
    let aliceReceived = false
    const alicePromise = alice.next('auth:restored').then(() => { aliceReceived = true })
    await delay(100)
    expect(aliceReceived).toBe(false)
    void alicePromise

    host.close()
    alice.close()
  })
})

// ── auth:degraded broadcast (AC: 8) ───────────────────────────────────────

describe('auth:degraded broadcast', () => {
  it('authEvents degraded broadcasts auth:degraded to all clients in room', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
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

// ── DELETE /api/rooms/:code (Story 7-2) ───────────────────────────────────

describe('DELETE /api/rooms/:code', () => {
  it('broadcasts session:end, force-closes all sockets, clears state, returns 204', async () => {
    seedHost('host_1')
    createRoom('DLTA', 'host_1')
    recordPlayedSongs('DLTA', ['trk1', 'trk2'])

    const host = await connect('/ws?code=DLTA', { cookie: sessionCookie() })
    await host.next('session:connect')
    const alice = await connect('/ws?code=DLTA&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    // Arm listeners for session:end BEFORE the request
    const hostEnd = host.next('session:end')
    const aliceEnd = alice.next('session:end')
    const hostClosed = waitClose(host.ws)
    const aliceClosed = waitClose(alice.ws)

    const res = await fetch(`http://127.0.0.1:${port}/api/rooms/DLTA`, {
      method: 'DELETE',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(204)

    const [h, a] = await Promise.all([hostEnd, aliceEnd])
    expect(h).toEqual({ type: 'session:end', reason: 'host_deleted' })
    expect(a).toEqual({ type: 'session:end', reason: 'host_deleted' })

    const [hc, ac] = await Promise.all([hostClosed, aliceClosed])
    expect(hc.code).toBe(1000)
    expect(ac.code).toBe(1000)

    expect(roomSockets.get('DLTA')).toBeUndefined()
    expect(getRoomByCode('DLTA')).toBeUndefined()
    expect(getPlayedSongs('DLTA')).toEqual([])
  })

  it('returns 403 when the caller is not the room host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    createRoom('DLTB', 'host_1')

    const res = await fetch(`http://127.0.0.1:${port}/api/rooms/DLTB`, {
      method: 'DELETE',
      headers: { Cookie: sessionCookie('host_2') },
    })
    expect(res.status).toBe(403)
    expect(getRoomByCode('DLTB')).toBeDefined()
  })

  it('returns 404 when the room does not exist', async () => {
    seedHost('host_1')
    const res = await fetch(`http://127.0.0.1:${port}/api/rooms/ZZZZ`, {
      method: 'DELETE',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 without a session cookie', async () => {
    seedHost('host_1')
    createRoom('DLTC', 'host_1')
    const res = await fetch(`http://127.0.0.1:${port}/api/rooms/DLTC`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })

  it('succeeds even when no live room sockets exist (DB-only delete)', async () => {
    seedHost('host_1')
    createRoom('DLTD', 'host_1')
    // no WS connections — roomSockets.get(code) is undefined
    const res = await fetch(`http://127.0.0.1:${port}/api/rooms/DLTD`, {
      method: 'DELETE',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(204)
    expect(getRoomByCode('DLTD')).toBeUndefined()
  })
})

// ── POST /auth/logout (Story 7-2) ─────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('returns 204 and clears the session cookie', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/auth/logout`, {
      method: 'POST',
    })
    expect(res.status).toBe(204)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('session=')
    // Cleared cookie: Max-Age=0 or an Expires in the past
    const maxAgeZero = /Max-Age=0\b/.test(setCookie)
    const expiresMatch = setCookie.match(/Expires=([^;]+)/i)
    const expiresInPast = expiresMatch ? Date.parse(expiresMatch[1]) <= Date.now() : false
    expect(maxAgeZero || expiresInPast).toBe(true)
  })
})
