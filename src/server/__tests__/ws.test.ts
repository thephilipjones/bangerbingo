import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAdaptorServer } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { initDb, upsertHost, createRoom, getDb, getRoomByCode, getPlayedSongs, recordPlayedSongs, setRoomHostName, upsertActiveRoom, getAllActiveRooms } from '../db.ts'

vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { app } = await import('../index.ts')
const { setupWebSocketServer, roomSockets, getPlayerList, rehydrateRooms, joinRateLimit } = await import('../ws.ts')
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
  // Load-bearing: every guest test connects from 127.0.0.1; without this clear,
  // 10 connects per file would exhaust the per-IP budget and following tests
  // would close 4429 instead of their expected codes.
  joinRateLimit.clear()
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

    expect(msg).toEqual({ type: 'session:connect', role: 'host', players: [], hostName: null, winsByName: {}, lastRoundWinner: null, casualModeNames: [] })
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

    expect(msg).toEqual({ type: 'session:connect', role: 'host', players: [], hostName: 'Sarah', winsByName: {}, lastRoundWinner: null, casualModeNames: [] })
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
  it('guests receive host:disconnected and server clears host slot when host WS closes', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=AAAA&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    host.close()

    const msg = await alice.next('host:disconnected')
    expect(msg).toEqual({ type: 'host:disconnected' })
    expect(roomSockets.get('AAAA')?.host).toBeNull()

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
  it('guest connecting after round:start receives round:start with lateJoin:true and a real card', async () => {
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
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
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

    // Card should be an array of 25 tiles with real track data
    const card = roundMsg.card as Array<{ trackId: string; free?: boolean }>
    expect(card).toHaveLength(25)
    expect(card[12].free).toBe(true)
    expect(card.filter(t => !t.free).every(t => t.trackId !== '')).toBe(true)

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
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
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
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
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

  // Story 12-4 Track A: the reconnect unicast must also carry currentSongIndex
  // and paused so the client can rehydrate the mini-player without waiting for
  // the next song:start.
  it('host reconnect mid-round round:start includes currentSongIndex and paused', async () => {
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
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
    })
    expect(roundRes.status).toBe(200)
    await host1.next('round:start')

    const playRes = await honoApp.request('/api/rooms/AAAA/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(playRes.status).toBe(200)
    await host1.next('song:start')

    await new Promise<void>((resolve) => {
      host1.ws.once('close', () => resolve())
      host1.close()
    })

    const host2 = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host2.next('session:connect')
    const roundMsg = await host2.next('round:start')

    expect(roundMsg.currentSongIndex).toBe(0)
    expect(roundMsg.paused).toBe(false)

    vi.restoreAllMocks()
    host2.close()
  })
})

// ── host:info (Story 13-8) ────────────────────────────────────────────────

describe('host:info delivery', () => {
  it('host receives host:info message with message text when round-start auto-resets played history', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    // 30 total tracks; seed 10 as already played so only 20 fresh remain —
    // below the 25 threshold, which triggers clearPlayedSongs + host:info.
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )
    recordPlayedSongs('AAAA', Array.from({ length: 10 }, (_, i) => `t${i}`))

    const { app: honoApp } = await import('../index.ts')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const roundRes = await honoApp.request('/api/rooms/AAAA/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
    })
    expect(roundRes.status).toBe(200)

    const infoMsg = await host.next('host:info')
    expect(infoMsg.type).toBe('host:info')
    expect(typeof infoMsg.message).toBe('string')
    expect((infoMsg.message as string).length).toBeGreaterThan(0)

    vi.restoreAllMocks()
    host.close()
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

// ── rehydrateRooms (Story 6-4) ──────────────────────────────────────────

describe('rehydrateRooms', () => {
  it('reconstructs RoomState from active_rooms with correct defaults', () => {
    const snapshot = {
      hostUserId: 'host_1',
      hostHasEverConnected: true,
      pendingRound: { playlistId: 'pl_1', clipDuration: 30, titleRevealDelay: 5, roundNumber: 1 },
      activeDeviceId: 'dev_123',
      currentRound: {
        roundNumber: 1,
        config: { playlistId: 'pl_1', clipDuration: 30, titleRevealDelay: 5, roundNumber: 1 },
        playlist: [{ id: 't0', title: 'S0', artist: 'A0', albumArtUrl: '' }],
        cards: { host_1: [{ trackId: 't0', title: 'S0', artist: 'A0', albumArtUrl: '', free: false }] },
        roundStartPayload: { type: 'round:start', roundNumber: 1 },
        active: true,
        currentSongIndex: 0,
        currentSongRevealed: false,
        songHistory: [{ trackId: 't0', title: 'S0', artist: 'A0', albumArtUrl: '', songIndex: 0 }],
        paused: false,
        ended: false,
      },
    }

    seedHost('host_1')
    createRoom('ABCD', 'host_1')
    upsertActiveRoom('ABCD', JSON.stringify(snapshot))
    rehydrateRooms()

    const room = roomSockets.get('ABCD')
    expect(room).toBeDefined()
    expect(room!.host).toBeNull()
    expect(room!.hostUserId).toBe('host_1')
    expect(room!.hostHasEverConnected).toBe(true)
    expect(room!.guests.size).toBe(0)
    expect(room!.activeDeviceId).toBe('dev_123')
    expect(room!.currentRound).toBeDefined()
    expect(room!.currentRound!.paused).toBe(true) // force-paused
    expect(room!.currentRound!.timers).toEqual({}) // timers cleared
    expect(room!.currentRound!.cards).toBeInstanceOf(Map)
    expect(room!.currentRound!.cards.get('host_1')).toHaveLength(1)
    expect(room!.currentRound!.songHistory).toHaveLength(1)
  })

  // Story 13-2: Casual Mode state survives server restart.
  it('persists allowCasualMode + playerCasualModes and restores them via DB round-trip', async () => {
    const { persistRoomState } = await import('../ws.ts')

    seedHost('host_1')
    createRoom('CSPR', 'host_1')

    // Seed in-memory state with an active round that has allowCasualMode=true and
    // two opted-in players. persistRoomState serializes to active_rooms; clearing
    // roomSockets + rehydrateRooms reads back from SQLite.
    roomSockets.set('CSPR', {
      host: null,
      hostUserId: 'host_1',
      hostHasEverConnected: true,
      guests: new Map(),
      sessionStats: { winsByName: {}, lastRoundWinner: null },
      playerCasualModes: new Map<string, boolean>([['Alice', true], ['Bob', true], ['Carol', false]]),
      pendingClaims: new Set<string>(),
      currentRound: {
        roundNumber: 1,
        config: { playlistId: 'pl_1', clipDuration: 30, titleRevealDelay: 5, roundNumber: 1, audioPreset: 'minimal', allowCasualMode: true },
        playlist: [{ id: 't0', title: 'S0', artist: 'A0', albumArtUrl: '' }],
        cards: new Map(),
        roundStartPayload: { type: 'round:start', roundNumber: 1 },
        active: true,
        currentSongIndex: -1,
        currentSongRevealed: false,
        songHistory: [],
        paused: false,
        timers: {},
        autoMarkedTileIndices: new Map(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })

    persistRoomState('CSPR')
    roomSockets.clear()
    rehydrateRooms()

    const room = roomSockets.get('CSPR')
    expect(room).toBeDefined()
    expect(room!.currentRound!.config.allowCasualMode).toBe(true)
    // Only names with casual=true are restored (Carol was false, so dropped).
    expect(room!.playerCasualModes.get('Alice')).toBe(true)
    expect(room!.playerCasualModes.get('Bob')).toBe(true)
    expect(room!.playerCasualModes.has('Carol')).toBe(false)
  })

  it('rehydrates cleanly when snapshot has no casual-mode fields (legacy format)', () => {
    // AC-5: old snapshot without allowCasualMode / playerCasualModes should not throw.
    const snapshot = {
      hostUserId: 'host_1',
      hostHasEverConnected: true,
      pendingRound: undefined,
      activeDeviceId: undefined,
      currentRound: undefined,
    }

    seedHost('host_1')
    createRoom('OLDF', 'host_1')
    upsertActiveRoom('OLDF', JSON.stringify(snapshot))
    rehydrateRooms()

    const room = roomSockets.get('OLDF')
    expect(room).toBeDefined()
    expect(room!.playerCasualModes.size).toBe(0)
  })

  it('rehydrates room without currentRound', () => {
    const snapshot = {
      hostUserId: 'host_1',
      hostHasEverConnected: true,
      pendingRound: undefined,
      activeDeviceId: undefined,
      currentRound: undefined,
    }

    seedHost('host_1')
    createRoom('WXYZ', 'host_1')
    upsertActiveRoom('WXYZ', JSON.stringify(snapshot))
    rehydrateRooms()

    const room = roomSockets.get('WXYZ')
    expect(room).toBeDefined()
    expect(room!.currentRound).toBeUndefined()
    expect(room!.host).toBeNull()
    expect(room!.guests.size).toBe(0)
  })
})

// ── persistRoomState triggers (Story 6-4) ───────────────────────────────

describe('persistRoomState triggers', () => {
  it('round:start persists state to active_rooms', async () => {
    seedHost('host_1')
    createRoom('PERS', 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )

    const host = await connect('/ws?code=PERS', { cookie: sessionCookie() })
    await host.next('session:connect')

    const roundRes = await app.request('/api/rooms/PERS/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
    })
    expect(roundRes.status).toBe(200)
    await host.next('round:start')

    const rows = getAllActiveRooms()
    expect(rows.some(r => r.room_code === 'PERS')).toBe(true)

    vi.restoreAllMocks()
    host.close()
  })

  it('round:end deletes active_rooms row', async () => {
    seedHost('host_1')
    createRoom('ENDR', 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )

    const host = await connect('/ws?code=ENDR', { cookie: sessionCookie() })
    await host.next('session:connect')

    await app.request('/api/rooms/ENDR/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }),
    })
    await host.next('round:start')

    // Verify row exists after round:start
    expect(getAllActiveRooms().some(r => r.room_code === 'ENDR')).toBe(true)

    // End the round
    const endRes = await app.request('/api/rooms/ENDR/round/end', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(endRes.status).toBe(200)
    await host.next('round:end')

    // Row should be deleted
    expect(getAllActiveRooms().some(r => r.room_code === 'ENDR')).toBe(false)

    vi.restoreAllMocks()
    host.close()
  })
})

// ── Reconnect after win — round:win replay (Story 13-1) ───────────────────

describe('Reconnect after win', () => {
  it('host reconnects into ended round → receives round:start then round:win', async () => {
    seedHost('host_1')
    createRoom('WINR', 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )

    const { app: honoApp } = await import('../index.ts')

    const host = await connect('/ws?code=WINR', { cookie: sessionCookie() })
    await host.next('session:connect')

    await honoApp.request('/api/rooms/WINR/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 0, hostName: 'Host' }),
    })
    await host.next('round:start')

    // Directly set ended state + winData (mirrors what /round/claim does)
    const rs = roomSockets.get('WINR')!
    const round = rs.currentRound!
    round.active = false
    round.ended = true
    ;(round as any).winData = {
      winnerName: 'Alice',
      winningTileIds: ['t0', 'FREE'],
      songHistory: [],
      winnerCard: [],
    }

    // Host disconnects
    await new Promise<void>((resolve) => { host.ws.once('close', () => resolve()); host.close() })

    // Host reconnects — should get round:start then round:win
    const host2 = await connect('/ws?code=WINR', { cookie: sessionCookie() })
    await host2.next('session:connect')
    const roundStartMsg = await host2.next('round:start')
    expect(roundStartMsg.type).toBe('round:start')
    const winMsg = await host2.next('round:win')
    expect(winMsg.type).toBe('round:win')
    expect(winMsg.winnerName).toBe('Alice')
    expect(winMsg.winningTileIds).toEqual(['t0', 'FREE'])

    vi.restoreAllMocks()
    host2.close()
  })

  it('guest reconnects into ended round → receives round:start then round:win', async () => {
    seedHost('host_1')
    createRoom('WING', 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )

    const { app: honoApp } = await import('../index.ts')

    const host = await connect('/ws?code=WING', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=WING&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    await honoApp.request('/api/rooms/WING/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 30, titleRevealDelay: 0, hostName: 'Host' }),
    })
    await host.next('round:start')
    await alice.next('round:start')

    // Simulate win
    const rs = roomSockets.get('WING')!
    const round = rs.currentRound!
    round.active = false
    round.ended = true
    ;(round as any).winData = {
      winnerName: 'Alice',
      winningTileIds: ['t0', 'FREE'],
      songHistory: [],
      winnerCard: [],
    }

    // Alice disconnects
    await new Promise<void>((resolve) => { alice.ws.once('close', () => resolve()); alice.close() })

    // Alice reconnects — should get round:start then round:win
    const alice2 = await connect('/ws?code=WING&name=Alice')
    await alice2.next('session:connect')
    const roundStartMsg = await alice2.next('round:start')
    expect(roundStartMsg.type).toBe('round:start')
    const winMsg = await alice2.next('round:win')
    expect(winMsg.type).toBe('round:win')
    expect(winMsg.winnerName).toBe('Alice')

    vi.restoreAllMocks()
    host.close()
    alice2.close()
  })
})

// ── Casual Mode (Story 8-4) ────────────────────────────────────────────────

describe('player:casual-mode-changed', () => {
  it('guest toggle sets roomState map and broadcasts to host and guests', async () => {
    seedHost('host_1')
    createRoom('CASL', 'host_1')

    const host = await connect('/ws?code=CASL', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=CASL&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    const bob = await connect('/ws?code=CASL&name=Bob')
    await bob.next('session:connect')
    await host.next('player:joined')
    await alice.next('player:joined')

    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))

    const hostMsg = await host.next('player:casual-mode-changed')
    expect(hostMsg).toEqual({ type: 'player:casual-mode-changed', name: 'Alice', enabled: true })

    const bobMsg = await bob.next('player:casual-mode-changed')
    expect(bobMsg).toEqual({ type: 'player:casual-mode-changed', name: 'Alice', enabled: true })

    expect(roomSockets.get('CASL')!.playerCasualModes.get('Alice')).toBe(true)

    host.close()
    alice.close()
    bob.close()
  })

  it('ignores non-boolean enabled — map unchanged, subsequent valid toggle still works', async () => {
    seedHost('host_1')
    createRoom('CASL', 'host_1')

    const host = await connect('/ws?code=CASL', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=CASL&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    // Send non-boolean — should be silently ignored
    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: 'yes' }))
    // Follow with a valid message — if the invalid one was broadcast, it would arrive first
    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))

    const hostMsg = await host.next('player:casual-mode-changed')
    expect(hostMsg).toEqual({ type: 'player:casual-mode-changed', name: 'Alice', enabled: true })

    // Map reflects only the valid update
    expect(roomSockets.get('CASL')!.playerCasualModes.get('Alice')).toBe(true)

    host.close()
    alice.close()
  })

  it('late-joining guest session:connect includes casualModeNames for opted-in players', async () => {
    seedHost('host_1')
    createRoom('CASL', 'host_1')

    const host = await connect('/ws?code=CASL', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=CASL&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))
    await host.next('player:casual-mode-changed')

    const bob = await connect('/ws?code=CASL&name=Bob')
    const bobConnect = await bob.next('session:connect')

    expect(bobConnect.casualModeNames).toEqual(['Alice'])

    host.close()
    alice.close()
    bob.close()
  })

  it('host toggle broadcasts name=host_name and sets roomState map', async () => {
    seedHost('host_1')
    createRoom('CASL', 'host_1')
    setRoomHostName('CASL', 'Pat')

    const host = await connect('/ws?code=CASL', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=CASL&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    host.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))

    const aliceMsg = await alice.next('player:casual-mode-changed')
    expect(aliceMsg).toEqual({ type: 'player:casual-mode-changed', name: 'Pat', enabled: true })

    const hostEcho = await host.next('player:casual-mode-changed')
    expect(hostEcho).toEqual({ type: 'player:casual-mode-changed', name: 'Pat', enabled: true })

    expect(roomSockets.get('CASL')!.playerCasualModes.get('Pat')).toBe(true)

    host.close()
    alice.close()
  })

  it('host toggle is ignored when host_name is null (no broadcast, no state change)', async () => {
    seedHost('host_1')
    createRoom('CASL', 'host_1') // host_name intentionally not set

    const host = await connect('/ws?code=CASL', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=CASL&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    // Invalid host toggle (host_name === null) — should be silently dropped
    host.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))
    // Follow with a guest toggle — if the invalid one was broadcast, it would arrive first
    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))

    const aliceFirst = await host.next('player:casual-mode-changed')
    expect(aliceFirst).toEqual({ type: 'player:casual-mode-changed', name: 'Alice', enabled: true })

    const map = roomSockets.get('CASL')!.playerCasualModes
    expect(map.size).toBe(1)
    expect(map.get('Alice')).toBe(true)

    host.close()
    alice.close()
  })

  it('rejects new enables when currentRound.config.allowCasualMode is false (Story 9-2)', async () => {
    seedHost('host_1')
    createRoom('CASL', 'host_1')

    const host = await connect('/ws?code=CASL', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=CASL&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    // Mount a minimal currentRound with allowCasualMode=false so the guard fires.
    const rs = roomSockets.get('CASL')!
    rs.currentRound = {
      active: true,
      paused: true,
      config: { clipDuration: 30, titleRevealDelay: 5, audioPreset: 'minimal', allowCasualMode: false, roundNumber: 1 },
      playlist: [], currentSongIndex: -1, songHistory: [], cards: new Map(),
      autoMarkedTileIndices: new Map(), timers: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))
    // Follow with a disable — which IS allowed (enabled: false never blocked).
    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: false }))

    const msg = await host.next('player:casual-mode-changed')
    // The enable was rejected; the first message host sees is the disable.
    expect(msg).toEqual({ type: 'player:casual-mode-changed', name: 'Alice', enabled: false })
    expect(rs.playerCasualModes.get('Alice')).toBe(false)

    host.close()
    alice.close()
  })
})

// ── Casual Mode — square:auto-marked (Story 8-5) ──────────────────────────

describe('square:auto-marked', () => {
  // Helper: start a round for a single guest (Alice) so we have a deterministic
  // socket to reason about. Returns the host, alice clients and the guest card.
  async function startCasualRound(code = 'CAS1') {
    seedHost('host_1')
    createRoom(code, 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' })),
    )

    const { app: honoApp } = await import('../index.ts')

    const host = await connect(`/ws?code=${code}`, { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect(`/ws?code=${code}&name=Alice`)
    await alice.next('session:connect')
    await host.next('player:joined')

    const roundRes = await honoApp.request(`/api/rooms/${code}/round`, {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 'full', titleRevealDelay: 0, hostName: 'Host', allowCasualMode: true }),
    })
    expect(roundRes.status).toBe(200)

    const aliceRoundStart = await alice.next('round:start')
    await host.next('round:start')
    const aliceCard = aliceRoundStart.card as Array<{ trackId: string; free?: boolean }>

    return { host, alice, aliceCard, honoApp, code }
  }

  it('enabling Casual Mode mid-round triggers catch-up sweep with catchUp:true', async () => {
    const { host, alice, aliceCard, honoApp, code } = await startCasualRound('CAS1')

    // Playlist is shuffled inside startRound, so capture actual played trackIds from song:start.
    await honoApp.request(`/api/rooms/${code}/round/play`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    const s1h = await host.next('song:start')
    await alice.next('song:start')
    await honoApp.request(`/api/rooms/${code}/round/next`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    const s2h = await host.next('song:start')
    await alice.next('song:start')
    await honoApp.request(`/api/rooms/${code}/round/next`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    await host.next('song:start')
    await alice.next('song:start')

    // Played history (excluding current) = first two songs.
    const playedIds = new Set<string>([s1h.trackId as string, s2h.trackId as string])
    const expectedIndices: number[] = []
    for (let i = 0; i < aliceCard.length; i++) {
      if (i === 12) continue
      if (playedIds.has(aliceCard[i].trackId)) expectedIndices.push(i)
    }

    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))
    await host.next('player:casual-mode-changed')

    if (expectedIndices.length > 0) {
      const msg = await alice.next('square:auto-marked')
      expect(msg.catchUp).toBe(true)
      expect(new Set(msg.tileIndices as number[])).toEqual(new Set(expectedIndices))
    }

    vi.restoreAllMocks()
    host.close()
    alice.close()
  })

  it('reconnecting with Casual Mode on triggers catch-up sweep', async () => {
    const { host, alice, aliceCard, honoApp, code } = await startCasualRound('CAS2')

    // Enable casual mode first so it persists through reconnect.
    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))
    await host.next('player:casual-mode-changed')

    // Play and advance a couple songs.
    await honoApp.request(`/api/rooms/${code}/round/play`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    const s1h = await host.next('song:start')
    await alice.next('song:start')
    await honoApp.request(`/api/rooms/${code}/round/next`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    const s2h = await host.next('song:start')
    await alice.next('song:start')
    await honoApp.request(`/api/rooms/${code}/round/next`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    await host.next('song:start')
    await alice.next('song:start')

    // Disconnect Alice and wait for close to propagate.
    alice.close()
    await delay(50)
    // playerCasualModes still has Alice=true; autoMarkedTileIndices for Alice was cleared.
    expect(roomSockets.get(code)!.currentRound!.autoMarkedTileIndices.has('Alice')).toBe(false)
    expect(roomSockets.get(code)!.playerCasualModes.get('Alice')).toBe(true)

    // Reconnect Alice — server should catch-up sweep after round:start.
    const alice2 = await connect(`/ws?code=${code}&name=Alice`)
    await alice2.next('session:connect')
    await alice2.next('round:start')

    const playedIds = new Set<string>([s1h.trackId as string, s2h.trackId as string])
    const expectedIndices: number[] = []
    for (let i = 0; i < aliceCard.length; i++) {
      if (i === 12) continue
      if (playedIds.has(aliceCard[i].trackId)) expectedIndices.push(i)
    }

    if (expectedIndices.length > 0) {
      const msg = await alice2.next('square:auto-marked')
      expect(msg.catchUp).toBe(true)
      expect(new Set(msg.tileIndices as number[])).toEqual(new Set(expectedIndices))
    }

    vi.restoreAllMocks()
    host.close()
    alice2.close()
  })

  it('disabling Casual Mode clears autoMarkedTileIndices entry for that player', async () => {
    const { host, alice, honoApp, code } = await startCasualRound('CAS3')

    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))
    await host.next('player:casual-mode-changed')

    await honoApp.request(`/api/rooms/${code}/round/play`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    await host.next('song:start')
    await alice.next('song:start')
    await honoApp.request(`/api/rooms/${code}/round/next`, { method: 'POST', headers: { Cookie: sessionCookie() } })
    await host.next('song:start')
    await alice.next('song:start')
    // Allow sweep to process
    await delay(20)

    // Now disable — should clear the entry.
    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: false }))
    await host.next('player:casual-mode-changed')
    await delay(20)

    expect(roomSockets.get(code)!.currentRound!.autoMarkedTileIndices.has('Alice')).toBe(false)

    vi.restoreAllMocks()
    host.close()
    alice.close()
  })

  it('square:auto-marked is NOT sent to other players', async () => {
    seedHost('host_1')
    createRoom('CAS4', 'host_1')

    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' })),
    )
    const { app: honoApp } = await import('../index.ts')

    const host = await connect('/ws?code=CAS4', { cookie: sessionCookie() })
    await host.next('session:connect')

    const alice = await connect('/ws?code=CAS4&name=Alice')
    await alice.next('session:connect')
    await host.next('player:joined')

    const bob = await connect('/ws?code=CAS4&name=Bob')
    await bob.next('session:connect')
    await host.next('player:joined')
    await alice.next('player:joined')

    const roundRes = await honoApp.request('/api/rooms/CAS4/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'aaaaaaaaaaaaaaaaaaaaaa', clipDuration: 'full', titleRevealDelay: 0, hostName: 'Host', allowCasualMode: true }),
    })
    expect(roundRes.status).toBe(200)

    const aliceRoundStart = await alice.next('round:start')
    await host.next('round:start')
    await bob.next('round:start')
    const aliceCard = aliceRoundStart.card as Array<{ trackId: string; free?: boolean }>

    // Attach raw listeners BEFORE the sweep to detect any leaked auto-marks.
    const bobAll: Msg[] = []
    const hostAll: Msg[] = []
    bob.ws.on('message', (raw) => { bobAll.push(JSON.parse(raw.toString())) })
    host.ws.on('message', (raw) => { hostAll.push(JSON.parse(raw.toString())) })

    // Only Alice enables casual mode
    alice.ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: true }))
    await host.next('player:casual-mode-changed')
    await alice.next('player:casual-mode-changed')
    await bob.next('player:casual-mode-changed')

    // Advance songs — capture actual trackIds since the playlist is shuffled server-side.
    // Play 3 songs so 2 complete ones (s1, s2) are in songHistory when sweep runs;
    // the sweep excludes the CURRENT song, so we need a current (s3) + history (s1, s2).
    await honoApp.request('/api/rooms/CAS4/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    const s1 = await host.next('song:start'); await alice.next('song:start'); await bob.next('song:start')
    await honoApp.request('/api/rooms/CAS4/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })
    const s2 = await host.next('song:start'); await alice.next('song:start'); await bob.next('song:start')
    await honoApp.request('/api/rooms/CAS4/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await host.next('song:start'); await alice.next('song:start'); await bob.next('song:start')

    // Only wait for Alice's auto-mark if her card contains one of the two completed songs.
    const playedIds = new Set<string>([s1.trackId as string, s2.trackId as string])
    const aliceHasMatch = aliceCard.some((t, i) => i !== 12 && playedIds.has(t.trackId))
    if (aliceHasMatch) {
      await alice.next('square:auto-marked')
    }
    // Small delay in case bob/host would have gotten one in the same tick.
    await delay(30)

    expect(bobAll.some(m => m.type === 'square:auto-marked')).toBe(false)
    expect(hostAll.some(m => m.type === 'square:auto-marked')).toBe(false)

    vi.restoreAllMocks()
    host.close()
    alice.close()
    bob.close()
  })
})

// ── Guest join rate limit (Story 13-5) ───────────────────────────────────

describe('Guest join rate limit', () => {
  it('11th guest join attempt from same IP within 60s receives close code 4429', async () => {
    // First 10 attempts go to a non-existent room — rate limit counts them, room lookup fails with 4004
    for (let i = 0; i < 10; i++) {
      const ws = rawConnect(`/ws?code=ZZZZ&name=Attempt${i}`)
      const closed = await waitClose(ws)
      expect(closed.code).toBe(4004)
    }
    // 11th attempt — rate limit exceeded
    const ws = rawConnect('/ws?code=ZZZZ&name=Attempt11')
    const closed = await waitClose(ws)
    expect(closed.code).toBe(4429)
    expect(closed.reason).toBe('Too many requests')
  })
})

// ── player:rename (Self-rename story) ────────────────────────────────────────

describe('player:rename — guest happy path', () => {
  it('guest renames: server migrates guests map and broadcasts player:renamed to all', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')
    await host.next('player:joined')

    const carol = await connect('/ws?code=AAAA&name=Carol')
    await carol.next('session:connect')
    await host.next('player:joined')

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Bobby' }))

    const hostMsg = await host.next('player:renamed')
    expect(hostMsg).toEqual({ type: 'player:renamed', oldName: 'Bob', newName: 'Bobby' })

    const bobMsg = await bob.next('player:renamed')
    expect(bobMsg.oldName).toBe('Bob')
    expect(bobMsg.newName).toBe('Bobby')

    const carolMsg = await carol.next('player:renamed')
    expect(carolMsg.oldName).toBe('Bob')
    expect(carolMsg.newName).toBe('Bobby')

    // guests map should now have Bobby, not Bob
    const room = roomSockets.get('AAAA')!
    expect(room.guests.has('Bobby')).toBe(true)
    expect(room.guests.has('Bob')).toBe(false)

    host.close(); bob.close(); carol.close()
  })

  it('guest rename migrates winsByName key', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')

    // Manually seed a win under "Bob"
    const room = roomSockets.get('AAAA')!
    room.sessionStats.winsByName['Bob'] = 2
    room.sessionStats.lastRoundWinner = 'Bob'

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Bobby' }))
    await bob.next('player:renamed')

    expect(room.sessionStats.winsByName['Bobby']).toBe(2)
    expect(room.sessionStats.winsByName['Bob']).toBeUndefined()
    expect(room.sessionStats.lastRoundWinner).toBe('Bobby')

    bob.close()
  })

  it('rename after disconnect / left uses new name in close handler', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')
    await host.next('player:joined')

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Bobby' }))
    await bob.next('player:renamed')
    await host.next('player:renamed')

    // Now Bob (now Bobby) disconnects — should broadcast player:left with newName
    bob.close()
    const leftMsg = await host.next('player:left')
    expect(leftMsg).toEqual({ type: 'player:left', name: 'Bobby' })

    host.close()
  })
})

describe('player:rename — guest rejection cases', () => {
  it('empty name → player:rename-rejected', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: '   ' }))
    const rej = await bob.next('player:rename-rejected')
    expect(rej.type).toBe('player:rename-rejected')

    bob.close()
  })

  it('name over 30 chars → player:rename-rejected', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'A'.repeat(31) }))
    const rej = await bob.next('player:rename-rejected')
    expect(rej.type).toBe('player:rename-rejected')

    bob.close()
  })

  it('unchanged name → player:rename-rejected', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Bob' }))
    const rej = await bob.next('player:rename-rejected')
    expect(rej.type).toBe('player:rename-rejected')

    bob.close()
  })

  it('collision with connected guest → player:rename-rejected', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')

    const carol = await connect('/ws?code=AAAA&name=Carol')
    await carol.next('session:connect')

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Carol' }))
    const rej = await bob.next('player:rename-rejected')
    expect(rej.reason).toBe('taken')

    bob.close(); carol.close()
  })

  it('collision with host_name → player:rename-rejected', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')
    setRoomHostName('AAAA', 'Alice')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')

    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Alice' }))
    const rej = await bob.next('player:rename-rejected')
    expect(rej.reason).toBe('taken')

    bob.close()
  })
})

describe('player:rename — host happy path', () => {
  it('host renames: DB updated, player:renamed broadcast with isHost:true', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')
    setRoomHostName('AAAA', 'Alice')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')
    await host.next('player:joined')

    host.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Ali' }))

    const hostMsg = await host.next('player:renamed')
    expect(hostMsg).toEqual({ type: 'player:renamed', oldName: 'Alice', newName: 'Ali', isHost: true })

    const bobMsg = await bob.next('player:renamed')
    expect(bobMsg.isHost).toBe(true)
    expect(bobMsg.newName).toBe('Ali')

    // DB should reflect new host name
    const room = getRoomByCode('AAAA')
    expect(room?.host_name).toBe('Ali')

    host.close(); bob.close()
  })

  it('host rename migrates winsByName and lastRoundWinner', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')
    setRoomHostName('AAAA', 'Alice')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    const r = roomSockets.get('AAAA')!
    r.sessionStats.winsByName['Alice'] = 3
    r.sessionStats.lastRoundWinner = 'Alice'

    host.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Ali' }))
    await host.next('player:renamed')

    expect(r.sessionStats.winsByName['Ali']).toBe(3)
    expect(r.sessionStats.winsByName['Alice']).toBeUndefined()
    expect(r.sessionStats.lastRoundWinner).toBe('Ali')

    host.close()
  })

  it('host rename rejected when host_name is null (not yet set)', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const host = await connect('/ws?code=AAAA', { cookie: sessionCookie() })
    await host.next('session:connect')

    host.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Alice' }))
    const rejected = await host.next('player:rename-rejected')
    expect(rejected.reason).toBe('no-host-name')

    host.close()
  })
})

describe('player:rename — concurrent rename guard', () => {
  it('second rename to same new name by different guest is rejected as taken', async () => {
    seedHost('host_1')
    createRoom('AAAA', 'host_1')

    const bob = await connect('/ws?code=AAAA&name=Bob')
    await bob.next('session:connect')

    const carol = await connect('/ws?code=AAAA&name=Carol')
    await carol.next('session:connect')

    // Bob renames to "Newname" successfully
    bob.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Newname' }))
    await bob.next('player:renamed')
    await carol.next('player:renamed')

    // Carol now tries to rename to "Newname" — should be rejected
    carol.ws.send(JSON.stringify({ type: 'player:rename', newName: 'Newname' }))
    const rej = await carol.next('player:rename-rejected')
    expect(rej.reason).toBe('taken')

    bob.close(); carol.close()
  })
})
