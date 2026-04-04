import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
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
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
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
