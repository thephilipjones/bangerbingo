import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import WebSocket from 'ws'
import { initDb, upsertHost, createRoom } from '../db.ts'

// Must set env vars before importing config/auth/rooms
vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { generateRoomCode, createRoomWithRetry, roomsRouter } = await import('../rooms.ts')
const { roomSockets } = await import('../ws.ts')

// ── Helpers ────────────────────────────────────────────────────────────────

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

function makeApp() {
  const app = new Hono()
  app.route('/api', roomsRouter)
  return app
}

async function seedRoom(hostUserId = 'host_1', code = 'ABCD') {
  const { getDb } = await import('../db.ts')
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run(code, hostUserId, Date.now())
  roomSockets.set(code, { host: null, hostUserId, hostHasEverConnected: false, guests: new Map() })
}

// ── Code generation ────────────────────────────────────────────────────────

describe('generateRoomCode', () => {
  it('returns a string of length 4', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRoomCode()).toHaveLength(4)
    }
  })

  it('contains only uppercase letters A-Z excluding O and I', () => {
    const FORBIDDEN = /[OI]/
    const VALID = /^[A-Z]+$/
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode()
      expect(VALID.test(code)).toBe(true)
      expect(FORBIDDEN.test(code)).toBe(false)
    }
  })
})

// ── Collision retry ────────────────────────────────────────────────────────

describe('createRoomWithRetry', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('creates and returns a room on first attempt', () => {
    seedHost('host_retry')
    const room = createRoomWithRetry('host_retry')
    expect(room.code).toHaveLength(4)
    expect(room.host_user_id).toBe('host_retry')
    expect(typeof room.created_at).toBe('number')
  })

  it('retries when first code collides and succeeds on second attempt', () => {
    seedHost('host_collision')

    // Pre-seed a room with a fixed code to force a collision
    const collisionCode = 'AAAA'
    createRoom(collisionCode, 'host_collision')

    // Provide a codeGen that returns the collision code first, then a unique code
    let callCount = 0
    const codeGen = () => {
      callCount++
      return callCount === 1 ? collisionCode : 'BBBB'
    }

    const room = createRoomWithRetry('host_collision', codeGen)
    expect(room.code).toBe('BBBB')
    expect(callCount).toBe(2)
  })
})

// ── POST /api/rooms ────────────────────────────────────────────────────────

describe('POST /api/rooms', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('returns 401 without a session cookie', async () => {
    const app = makeApp()
    const res = await app.request('/api/rooms', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 200 with valid session and room code in response', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/rooms', {
      method: 'POST',
      headers: { Cookie: 'session=host_1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { code: string; url: string; created_at: number }
    expect(body.code).toHaveLength(4)
    expect(/^[A-Z]+$/.test(body.code)).toBe(true)
    expect(/[OI]/.test(body.code)).toBe(false)
    expect(body.url).toBe(`/room/${body.code}`)
    expect(typeof body.created_at).toBe('number')
  })
})

// ── GET /api/rooms ─────────────────────────────────────────────────────────

describe('GET /api/rooms', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('returns 401 without session', async () => {
    const app = makeApp()
    const res = await app.request('/api/rooms')
    expect(res.status).toBe(401)
  })

  it('returns empty array for host with no rooms', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/rooms', {
      headers: { Cookie: 'session=host_1' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns rooms ordered by created_at descending', async () => {
    seedHost()
    // Insert rooms with explicit timestamps
    const db = (await import('../db.ts')).getDb()
    db.prepare('INSERT INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run('AAAB', 'host_1', 1000)
    db.prepare('INSERT INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run('BBBC', 'host_1', 3000)
    db.prepare('INSERT INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run('CCCD', 'host_1', 2000)

    const app = makeApp()
    const res = await app.request('/api/rooms', {
      headers: { Cookie: 'session=host_1' },
    })
    expect(res.status).toBe(200)
    const rooms = await res.json() as Array<{ code: string; created_at: number }>
    expect(rooms).toHaveLength(3)
    expect(rooms[0].code).toBe('BBBC') // created_at 3000
    expect(rooms[1].code).toBe('CCCD') // created_at 2000
    expect(rooms[2].code).toBe('AAAB') // created_at 1000
  })

  it('only returns rooms belonging to the authenticated host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    createRoom('XXXX', 'host_2')

    const app = makeApp()
    const res = await app.request('/api/rooms', {
      headers: { Cookie: 'session=host_1' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// ── POST /api/rooms/:code/round ────────────────────────────────────────────

describe('POST /api/rooms/:code/round', () => {
  beforeEach(async () => {
    initDb(':memory:')
    roomSockets.clear()
    vi.restoreAllMocks()
    // Mock Spotify so validation tests don't hit the real API
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )
  })

  const validPayload = { playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5 }

  it('returns 401 without a session cookie', async () => {
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 when room does not exist', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/rooms/ZZZZ/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(404)
  })

  it('returns 403 when room belongs to a different host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when playlistId is missing', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ clipDuration: 30, titleRevealDelay: 5 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when clipDuration is invalid', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 99, titleRevealDelay: 5 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when titleRevealDelay is invalid', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 99 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 200 with round config on valid payload', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { roundNumber: number; playlistId: string; clipDuration: number; titleRevealDelay: number }
    expect(body.roundNumber).toBe(1)
    expect(body.playlistId).toBe('pl_abc')
    expect(body.clipDuration).toBe(30)
    expect(body.titleRevealDelay).toBe(5)
  })

  it('increments roundNumber on second call', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    const res2 = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res2.status).toBe(200)
    const body = await res2.json() as { roundNumber: number }
    expect(body.roundNumber).toBe(2)
  })

  it('accepts clipDuration "full"', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 'full', titleRevealDelay: null }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { clipDuration: string; titleRevealDelay: null }
    expect(body.clipDuration).toBe('full')
    expect(body.titleRevealDelay).toBeNull()
  })
})

// ── POST /api/rooms/:code/round — card generation (Story 4-3) ──────────────

function makeTracks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `track_${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    albumArtUrl: `https://img/${i}`,
  }))
}

function makeMockWs(readyState = WebSocket.OPEN) {
  const sent: string[] = []
  return {
    readyState,
    send: (data: string) => { sent.push(data) },
    getSent: () => sent.map(s => JSON.parse(s) as Record<string, unknown>),
  }
}

describe('POST /api/rooms/:code/round — card generation', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
    vi.restoreAllMocks()
  })

  const validPayload = { playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5 }

  it('returns 422 when playlist has fewer than 25 tracks', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockRejectedValue(
      Object.assign(new Error("This playlist doesn't have enough tracks — need at least 25"), { name: 'InsufficientTracksError' })
    )

    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(422)
  })

  it('broadcasts round:start to host and guests with unique cards', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))

    seedHost()
    await seedRoom()

    // Seed mock WebSocket connections
    const hostWs = makeMockWs()
    const aliceWs = makeMockWs()
    const bobWs = makeMockWs()
    const roomState = roomSockets.get('ABCD')!
    roomState.host = hostWs as unknown as WebSocket
    roomState.guests.set('Alice', aliceWs as unknown as WebSocket)
    roomState.guests.set('Bob', bobWs as unknown as WebSocket)

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(200)

    // Each WS should have received exactly one message
    const hostMsg = hostWs.getSent()
    const aliceMsg = aliceWs.getSent()
    const bobMsg = bobWs.getSent()
    expect(hostMsg).toHaveLength(1)
    expect(aliceMsg).toHaveLength(1)
    expect(bobMsg).toHaveLength(1)

    // All messages are round:start
    expect(hostMsg[0].type).toBe('round:start')
    expect(aliceMsg[0].type).toBe('round:start')
    expect(bobMsg[0].type).toBe('round:start')

    // Each has a card array of 25 tiles
    expect(Array.isArray(hostMsg[0].card)).toBe(true)
    expect((hostMsg[0].card as unknown[]).length).toBe(25)
    expect((aliceMsg[0].card as unknown[]).length).toBe(25)
    expect((bobMsg[0].card as unknown[]).length).toBe(25)

    // Cards are different between players (at least one tile differs)
    const hostCardKey = (hostMsg[0].card as Array<{ trackId: string; free?: boolean }>)
      .filter(t => !t.free).map(t => t.trackId).join(',')
    const aliceCardKey = (aliceMsg[0].card as Array<{ trackId: string; free?: boolean }>)
      .filter(t => !t.free).map(t => t.trackId).join(',')
    const bobCardKey = (bobMsg[0].card as Array<{ trackId: string; free?: boolean }>)
      .filter(t => !t.free).map(t => t.trackId).join(',')
    expect(hostCardKey).not.toBe(aliceCardKey)
    expect(hostCardKey).not.toBe(bobCardKey)
    expect(aliceCardKey).not.toBe(bobCardKey)

    // round:start includes playlist, clipDuration, titleRevealDelay
    expect(hostMsg[0].roundNumber).toBe(1)
    expect(hostMsg[0].clipDuration).toBe(30)
    expect(hostMsg[0].titleRevealDelay).toBe(5)
    expect(Array.isArray(hostMsg[0].playlist)).toBe(true)
  })

  it('centre tile (index 12) is FREE on every card', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))

    seedHost()
    await seedRoom()

    const hostWs = makeMockWs()
    const aliceWs = makeMockWs()
    const roomState = roomSockets.get('ABCD')!
    roomState.host = hostWs as unknown as WebSocket
    roomState.guests.set('Alice', aliceWs as unknown as WebSocket)

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })

    const hostCard = hostWs.getSent()[0].card as Array<{ free?: boolean }>
    const aliceCard = aliceWs.getSent()[0].card as Array<{ free?: boolean }>
    expect(hostCard[12].free).toBe(true)
    expect(aliceCard[12].free).toBe(true)
  })

  it('records played_songs in SQLite after round:start', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))

    seedHost()
    await seedRoom()

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })

    const { getPlayedSongs } = await import('../db.ts')
    const played = getPlayedSongs('ABCD')
    expect(played.length).toBeGreaterThanOrEqual(25)
  })

  it('does not broadcast to closed WebSocket connections', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))

    seedHost()
    await seedRoom()

    const closedWs = makeMockWs(WebSocket.CLOSED)
    const roomState = roomSockets.get('ABCD')!
    roomState.host = closedWs as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(200)
    expect(closedWs.getSent()).toHaveLength(0)
  })

  it('increments roundNumber based on currentRound on second call', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))

    seedHost()
    await seedRoom()

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    const res2 = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: 'session=host_1', 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res2.status).toBe(200)
    const body = await res2.json() as { roundNumber: number }
    expect(body.roundNumber).toBe(2)
  })
})
