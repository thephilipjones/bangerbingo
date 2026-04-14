import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import WebSocket from 'ws'
import { initDb, upsertHost, createRoom } from '../db.ts'
import type { RoundState, ClipDuration, TitleRevealDelay } from '../ws.ts'
import type { Track } from '../music/spotify.ts'
import type { Tile } from '../game/cards.ts'

// Must set env vars before importing config/auth/rooms
vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { generateRoomCode, createRoomWithRetry, roomsRouter } = await import('../rooms.ts')
const { roomSockets } = await import('../ws.ts')
const { signUserId } = await import('../auth.ts')

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

function sessionCookie(userId = 'host_1') {
  return `session=${signUserId(userId)}`
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
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { code: string; url: string; created_at: number }
    expect(body.code).toHaveLength(4)
    expect(/^[A-Z]+$/.test(body.code)).toBe(true)
    expect(/[OI]/.test(body.code)).toBe(false)
    expect(body.url).toBe(`/${body.code}`)
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
      headers: { Cookie: sessionCookie() },
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
      headers: { Cookie: sessionCookie() },
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
      headers: { Cookie: sessionCookie() },
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

  const validPayload = { playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }

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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    const res2 = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res2.status).toBe(200)
    const body = await res2.json() as { roundNumber: number }
    expect(body.roundNumber).toBe(2)
  })

  it('writes host_name to the rooms row on first-round POST with valid hostName', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: '  Sarah  ' }),
    })
    expect(res.status).toBe(200)
    const { getDb } = await import('../db.ts')
    const row = getDb().prepare('SELECT host_name FROM rooms WHERE code = ?').get('ABCD') as { host_name: string | null }
    expect(row.host_name).toBe('Sarah')
  })

  it('defaults host_name to "Host" when hostName is omitted on first-round POST', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5 }),
    })
    expect(res.status).toBe(200)
    const { getDb } = await import('../db.ts')
    const row = getDb().prepare('SELECT host_name FROM rooms WHERE code = ?').get('ABCD') as { host_name: string | null }
    expect(row.host_name).toBe('Host')
  })

  it('accepts second-round POST without hostName when host_name already set', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    // First round sets the host_name
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Sarah' }),
    })
    // Second round omits hostName — should still be 200, and roundNumber must be 2
    // (confirms the code path actually exercised the room.host_name !== null branch
    // rather than silently re-running round 1).
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { roundNumber: number }
    expect(body.roundNumber).toBe(2)
    // And the stored name is unchanged
    const { getDb } = await import('../db.ts')
    const row = getDb().prepare('SELECT host_name FROM rooms WHERE code = ?').get('ABCD') as { host_name: string | null }
    expect(row.host_name).toBe('Sarah')
  })

  it('defaults host_name to "Host" when hostName trims to empty', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: '   ' }),
    })
    expect(res.status).toBe(200)
    const { getDb } = await import('../db.ts')
    const row = getDb().prepare('SELECT host_name FROM rooms WHERE code = ?').get('ABCD') as { host_name: string | null }
    expect(row.host_name).toBe('Host')
  })

  it('returns 400 when hostName trimmed length exceeds 30', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'X'.repeat(31) }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('hostName must be 30 characters or fewer')
  })

  it('GET /api/rooms returns host_name on row after it is set', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Sarah' }),
    })
    const res = await app.request('/api/rooms', { headers: { Cookie: sessionCookie() } })
    expect(res.status).toBe(200)
    const rooms = await res.json() as Array<{ code: string; host_name: string | null }>
    const row = rooms.find(r => r.code === 'ABCD')
    expect(row?.host_name).toBe('Sarah')
  })

  it('accepts clipDuration "full"', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 'full', titleRevealDelay: null, hostName: 'Host' }),
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

function makeMockWs(readyState: number = WebSocket.OPEN) {
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

  const validPayload = { playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }

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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
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
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    const res2 = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res2.status).toBe(200)
    const body = await res2.json() as { roundNumber: number }
    expect(body.roundNumber).toBe(2)
  })

  it('initialises new RoundState fields on round start', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))

    seedHost()
    await seedRoom()

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })

    const roomState = roomSockets.get('ABCD')!
    expect(roomState.currentRound?.currentSongIndex).toBe(-1)
    expect(roomState.currentRound?.songHistory).toEqual([])
    expect(roomState.currentRound?.paused).toBe(false)
    expect(roomState.currentRound?.timers).toEqual({})
  })
})

// ── Song scheduling helpers ────────────────────────────────────────────────

function makeTracksLocal(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `track_${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    albumArtUrl: `https://img/${i}`,
  }))
}

function seedActiveRound(code = 'ABCD', clipDuration: ClipDuration = 30, titleRevealDelay: TitleRevealDelay = 5): RoundState {
  const roomState = roomSockets.get(code)!
  const round: RoundState = {
    roundNumber: 1,
    config: { playlistId: 'test_playlist', clipDuration, titleRevealDelay, roundNumber: 1 },
    playlist: makeTracksLocal(10),
    cards: new Map(),
    roundStartPayload: {},
    sessionPlayedIds: [],
    active: true,
    currentSongIndex: -1,
    songHistory: [],
    paused: false,
    currentSongRevealed: false,
    timers: {},
  }
  roomState.currentRound = round
  return round
}

// ── POST /api/rooms/:code/round/play ──────────────────────────────────────

describe('POST /api/rooms/:code/round/play', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('broadcasts song:start for first track when currentSongIndex is -1', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()

    const sent: string[] = []
    const mockWs = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket
    roomState.host = mockWs

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('song:start')
    expect(msg.songIndex).toBe(0)
    expect(msg.seekPositionMs).toBe(60_000)
    expect(msg.trackId).toBe('track_0')
    expect(msg.title).toBe('Song 0')
    expect(msg.artist).toBe('Artist 0')
    expect(msg.albumArtUrl).toBe('https://img/0')  // P5
    expect(msg.roundNumber).toBe(1)
    expect(msg.clipDuration).toBe(30)
    expect(msg.titleRevealDelay).toBe(5)
    expect(round.currentSongIndex).toBe(0)
    expect(round.paused).toBe(false)
  })

  it('re-broadcasts same song:start when round is paused', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()
    round.currentSongIndex = 2
    round.paused = true

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('song:start')
    expect(msg.songIndex).toBe(2)
    expect(round.paused).toBe(false)
    expect(round.songHistory).toHaveLength(0)  // P1: resume must not push to history (currentSongIndex already equals songIndex)
  })

  it('returns 400 when round is already playing', async () => {
    seedHost()
    await seedRoom()
    const round = seedActiveRound()
    round.currentSongIndex = 1
    round.paused = false

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(400)
  })

  it('returns 403 for non-owner host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')
    seedActiveRound()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when no active round', async () => {
    seedHost()
    await seedRoom()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(404)
  })

  it('appends entry to songHistory on play', async () => {
    seedHost()
    await seedRoom()
    const round = seedActiveRound()

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(round.songHistory).toHaveLength(1)
    expect(round.songHistory[0].trackId).toBe('track_0')
    expect(round.songHistory[0].songIndex).toBe(0)
  })

  it('auto-advance fires after clipDuration and broadcasts second song:start', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound('ABCD', 20, 0)

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).songIndex).toBe(0)

    vi.advanceTimersByTime(20_000)

    expect(sent).toHaveLength(2)
    const second = JSON.parse(sent[1])
    expect(second.type).toBe('song:start')
    expect(second.songIndex).toBe(1)
    expect(round.currentSongIndex).toBe(1)
  })

  it('song:reveal timer fires after titleRevealDelay and broadcasts song:reveal', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    seedActiveRound('ABCD', 'full', 10)

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).type).toBe('song:start')

    vi.advanceTimersByTime(10_000)

    expect(sent).toHaveLength(2)
    const reveal = JSON.parse(sent[1])
    expect(reveal.type).toBe('song:reveal')
    expect(reveal.trackId).toBe('track_0')
    expect(reveal.songIndex).toBe(0)
  })

  it('does not schedule song:reveal when titleRevealDelay is 0', async () => {
    // P7: titleRevealDelay=0 means no reveal; server must not fire song:reveal
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    seedActiveRound('ABCD', 'full', 0)

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    vi.advanceTimersByTime(60_000)

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).type).toBe('song:start')
  })
})

// ── POST /api/rooms/:code/round/next ──────────────────────────────────────

describe('POST /api/rooms/:code/round/next', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances to next song and broadcasts song:start', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()
    round.currentSongIndex = 0

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/next', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('song:start')
    expect(msg.songIndex).toBe(1)
    expect(round.currentSongIndex).toBe(1)
  })

  it('cancels previous auto-advance timer when /next is called', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound('ABCD', 30, 0)

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    // Start song (sets auto-advance timer for 30s)
    await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(round.currentSongIndex).toBe(0)

    // Manually advance before timer fires
    await app.request('/api/rooms/ABCD/round/next', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(round.currentSongIndex).toBe(1)

    const countBeforeTimer = sent.length

    // Advance time — old timer should NOT fire again
    vi.advanceTimersByTime(30_000)
    // A new auto-advance from song index 1 fires, so we get one more broadcast
    // but we should NOT get a duplicate from the cancelled timer
    expect(sent.length).toBe(countBeforeTimer + 1)
    expect(JSON.parse(sent[sent.length - 1]).songIndex).toBe(2)
  })

  it('broadcasts songs:exhausted on last track', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()
    round.currentSongIndex = 9  // last index in 10-track playlist

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/next', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).type).toBe('songs:exhausted')
  })

  it('returns 403 for non-owner host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')
    seedActiveRound()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/next', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when no active round', async () => {
    seedHost()
    await seedRoom()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/next', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(404)
  })
})

// ── POST /api/rooms/:code/round/pause ─────────────────────────────────────

describe('POST /api/rooms/:code/round/pause', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('broadcasts song:pause and sets paused = true', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()
    round.currentSongIndex = 3
    round.paused = false

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/pause', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    expect(round.paused).toBe(true)
    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('song:pause')
    expect(msg.songIndex).toBe(3)
  })

  it('cancels timers on pause', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound('ABCD', 30, 5)

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    // Start song — schedules both timers
    await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })

    // Pause — should cancel both timers
    await app.request('/api/rooms/ABCD/round/pause', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    const countAfterPause = sent.length

    // Advance time — no timers should fire
    vi.advanceTimersByTime(60_000)
    expect(sent.length).toBe(countAfterPause)

    expect(round.timers.autoAdvance).toBeUndefined()
    expect(round.timers.reveal).toBeUndefined()
  })

  it('returns 403 for non-owner host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')
    seedActiveRound()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/pause', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when no active round', async () => {
    seedHost()
    await seedRoom()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/pause', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when pausing before first song has started', async () => {
    // P6: currentSongIndex === -1 means no song is playing yet
    seedHost()
    await seedRoom()
    seedActiveRound()  // currentSongIndex starts at -1

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/pause', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(400)
  })
})

// ── POST /api/rooms/:code/round/end ──────────────────────────────────────

describe('POST /api/rooms/:code/round/end', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
  })

  it('clears currentRound and broadcasts round:end', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    seedActiveRound()

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/end', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    expect(roomState.currentRound).toBeUndefined()
    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('round:end')
  })

  it('returns 403 for non-owner host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')
    seedActiveRound()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/end', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when room not found', async () => {
    seedHost()

    const app = makeApp()
    const res = await app.request('/api/rooms/ZZZZ/round/end', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when no active round', async () => {
    seedHost()
    await seedRoom()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/end', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(404)
  })
})

// ── POST /api/rooms/:code/sdk/device ─────────────────────────────────────

describe('POST /api/rooms/:code/sdk/device', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
  })

  it('200 — stores deviceId in roomState.sdkDeviceId', async () => {
    seedHost()
    await seedRoom()

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/sdk/device', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'abc123' }),
    })
    expect(res.status).toBe(200)

    const roomState = roomSockets.get('ABCD')!
    expect(roomState.sdkDeviceId).toBe('abc123')
  })

  it('200 — overwrites on subsequent call (reconnect)', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.sdkDeviceId = 'old-device'

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/sdk/device', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'new-device' }),
    })
    expect(res.status).toBe(200)
    expect(roomState.sdkDeviceId).toBe('new-device')
  })

  it('403 — wrong host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/sdk/device', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'abc123' }),
    })
    expect(res.status).toBe(403)
  })

  it('404 — room not found', async () => {
    seedHost()

    const app = makeApp()
    const res = await app.request('/api/rooms/ZZZZ/sdk/device', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'abc123' }),
    })
    expect(res.status).toBe(404)
  })

  it('503 — room exists but no active WS session', async () => {
    seedHost()
    await seedRoom()
    roomSockets.clear() // simulate no WS connection yet

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/sdk/device', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'abc123' }),
    })
    expect(res.status).toBe(503)
  })
})

// ── POST /api/rooms/:code/round/claim ─────────────────────────────────────

function makeCard(winTracks: Track[]): Tile[] {
  const card: Tile[] = winTracks.map(t => ({
    trackId: t.id,
    title: t.title,
    artist: t.artist,
    albumArtUrl: t.albumArtUrl,
  }))
  // Fill remaining 20 slots with non-win tiles
  for (let i = 5; i < 25; i++) {
    card.push({ trackId: `other${i}`, title: `Other${i}`, artist: 'A', albumArtUrl: '' })
  }
  // Override index 12 with free tile
  card[12] = { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
  return card
}

describe('POST /api/rooms/:code/round/claim', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
  })

  it('200 — valid claim broadcasts round:win and ends round', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()

    const winTracks = makeTracksLocal(5)
    const card = makeCard(winTracks)
    round.cards.set('Alice', card)
    winTracks.forEach((t, i) =>
      round.songHistory.push({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '', songIndex: i })
    )

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice', claimedTileIds: winTracks.map(t => t.id) }),
    })
    expect(res.status).toBe(200)
    expect(round.active).toBe(false)
    expect(round.ended).toBe(true)
    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('round:win')
    expect(msg.winnerName).toBe('Alice')
    expect(msg.winningTileIds).toHaveLength(5)
  })

  it('200 — valid claim with FREE in winning line (middle row)', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()

    // Build a card where the middle row is positions 10,11,12,13,14.
    // Put 4 winning tracks at 10,11,13,14 and keep index 12 as the FREE tile.
    const winTracks = makeTracksLocal(4)
    const card: Tile[] = []
    for (let i = 0; i < 25; i++) {
      card.push({ trackId: `filler_${i}`, title: `Filler ${i}`, artist: 'A', albumArtUrl: '' })
    }
    card[10] = { trackId: winTracks[0].id, title: winTracks[0].title, artist: winTracks[0].artist, albumArtUrl: winTracks[0].albumArtUrl }
    card[11] = { trackId: winTracks[1].id, title: winTracks[1].title, artist: winTracks[1].artist, albumArtUrl: winTracks[1].albumArtUrl }
    card[13] = { trackId: winTracks[2].id, title: winTracks[2].title, artist: winTracks[2].artist, albumArtUrl: winTracks[2].albumArtUrl }
    card[14] = { trackId: winTracks[3].id, title: winTracks[3].title, artist: winTracks[3].artist, albumArtUrl: winTracks[3].albumArtUrl }
    card[12] = { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
    round.cards.set('Alice', card)

    winTracks.forEach((t, i) =>
      round.songHistory.push({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '', songIndex: i }),
    )

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice', claimedTileIds: ['FREE', ...winTracks.map(t => t.id)] }),
    })
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('round:win')
    expect(msg.winningTileIds).toContain('FREE')
    expect(msg.winningTileIds).toHaveLength(5)
  })

  it('422 — claimed tile not on player card', async () => {
    seedHost()
    await seedRoom()
    const round = seedActiveRound()

    const winTracks = makeTracksLocal(5)
    const card = makeCard(winTracks)
    round.cards.set('Alice', card)
    winTracks.forEach((t, i) =>
      round.songHistory.push({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '', songIndex: i })
    )

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice', claimedTileIds: ['not_on_card_id', ...winTracks.slice(1).map(t => t.id)] }),
    })
    expect(res.status).toBe(422)
  })

  it('422 — claimed tile not in songHistory (not yet played)', async () => {
    seedHost()
    await seedRoom()
    const round = seedActiveRound()

    const winTracks = makeTracksLocal(5)
    const card = makeCard(winTracks)
    round.cards.set('Alice', card)
    // Only add 4 of the 5 tracks to history
    winTracks.slice(0, 4).forEach((t, i) =>
      round.songHistory.push({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '', songIndex: i })
    )

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice', claimedTileIds: winTracks.map(t => t.id) }),
    })
    expect(res.status).toBe(422)
  })

  it('422 — no complete winning line in claimed set', async () => {
    seedHost()
    await seedRoom()
    const round = seedActiveRound()

    // Build card with positions 0-4, but only claim 4 of them (no complete line)
    const winTracks = makeTracksLocal(5)
    const card = makeCard(winTracks)
    round.cards.set('Alice', card)
    winTracks.forEach((t, i) =>
      round.songHistory.push({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '', songIndex: i })
    )

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only 4 of the first row — no complete line
      body: JSON.stringify({ playerName: 'Alice', claimedTileIds: winTracks.slice(0, 4).map(t => t.id) }),
    })
    expect(res.status).toBe(422)
  })

  it('409 — second claim after round already won', async () => {
    seedHost()
    await seedRoom()
    const round = seedActiveRound()

    const winTracks = makeTracksLocal(5)
    const card = makeCard(winTracks)
    round.cards.set('Alice', card)
    winTracks.forEach((t, i) =>
      round.songHistory.push({ trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: '', songIndex: i })
    )

    const sent: string[] = []
    const roomState = roomSockets.get('ABCD')!
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const claimBody = JSON.stringify({ playerName: 'Alice', claimedTileIds: winTracks.map(t => t.id) })
    const headers = { 'Content-Type': 'application/json' }

    // First claim succeeds
    const res1 = await app.request('/api/rooms/ABCD/round/claim', { method: 'POST', headers, body: claimBody })
    expect(res1.status).toBe(200)

    // Second claim returns 409
    const res2 = await app.request('/api/rooms/ABCD/round/claim', { method: 'POST', headers, body: claimBody })
    expect(res2.status).toBe(409)

    // Only one round:win broadcast
    expect(sent.filter(m => JSON.parse(m).type === 'round:win')).toHaveLength(1)
  })
})

// ── POST /api/account/spotify/disconnect ──────────────────────────────────

describe('POST /api/account/spotify/disconnect', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('returns 401 without a session cookie', async () => {
    const app = makeApp()
    const res = await app.request('/api/account/spotify/disconnect', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 200 and clears tokens for authenticated host', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/account/spotify/disconnect', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    const { getHostById } = await import('../db.ts')
    const host = getHostById('host_1')
    expect(host).toBeDefined()
    expect(host!.access_token).toBe('')
    expect(host!.refresh_token).toBe('')
    expect(host!.token_expires_at).toBe(0)
  })
})
