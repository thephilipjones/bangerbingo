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

const { generateRoomCode, createRoomWithRetry, roomsRouter, runCasualModeSweep } = await import('../rooms.ts')
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
  roomSockets.set(code, { host: null, hostUserId, hostHasEverConnected: false, guests: new Map(), sessionStats: { winsByName: {}, lastRoundWinner: null }, continuousMode: false, playerCasualModes: new Map() })
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

  it('returns 400 when audioPreset is invalid', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validPayload, audioPreset: 'blasting' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('Invalid audioPreset')
  })

  it('round:start broadcast includes audioPreset when valid preset provided', async () => {
    seedHost()
    await seedRoom()

    const sent: string[] = []
    const mockWs = { readyState: WebSocket.OPEN, send: (d: string) => { sent.push(d) } }
    roomSockets.get('ABCD')!.host = mockWs as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validPayload, audioPreset: 'deadpan' }),
    })
    expect(res.status).toBe(200)

    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0]) as Record<string, unknown>
    expect(msg.type).toBe('round:start')
    expect(msg.audioPreset).toBe('deadpan')
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
    config: { playlistId: 'test_playlist', clipDuration, titleRevealDelay, roundNumber: 1, audioPreset: 'minimal', allowCasualMode: false },
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
    autoMarkedTileIndices: new Map(),
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

// ── Spotify Web API device recovery (via /round/play + /round/pause) ──────

describe('Spotify Web API device recovery', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
    vi.restoreAllMocks()
    // Real timers so vi.waitFor can poll for the fire-and-forget Spotify fetch.
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function collectSent(ws: { send: unknown }): Record<string, unknown>[] {
    const mock = ws.send as unknown as { mock: { calls: unknown[][] } }
    return mock.mock.calls.map((c) => JSON.parse(c[0] as string))
  }

  it('happy path — single play call, no transfer or stale broadcast', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.sdkDeviceId = 'device_xyz'
    seedActiveRound()
    const hostWs = { readyState: 1, send: vi.fn() }
    roomState.host = hostWs as unknown as WebSocket

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }) as unknown as Response,
    )

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('/me/player/play')
    expect(url).toContain('device_id=device_xyz')

    const sent = collectSent(hostWs)
    expect(sent.find((m) => m.type === 'song:start')).toBeDefined()
    expect(sent.find((m) => m.type === 'host:sdk-stale')).toBeUndefined()
    expect(roomState.sdkDeviceId).toBe('device_xyz')
  })

  it('404 recovery — transfers playback, retries once, keeps device', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.sdkDeviceId = 'device_xyz'
    seedActiveRound()
    const hostWs = { readyState: 1, send: vi.fn() }
    roomState.host = hostWs as unknown as WebSocket

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Device not found', { status: 404 }) as unknown as Response)
      .mockResolvedValueOnce(new Response(null, { status: 204 }) as unknown as Response)
      .mockResolvedValueOnce(new Response(null, { status: 200 }) as unknown as Response)

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    expect(String(fetchSpy.mock.calls[0][0])).toContain('/me/player/play')
    const transferUrl = String(fetchSpy.mock.calls[1][0])
    expect(transferUrl).toBe('https://api.spotify.com/v1/me/player')
    const transferInit = fetchSpy.mock.calls[1][1] as RequestInit
    expect(transferInit.method).toBe('PUT')
    expect(transferInit.body).toBe(JSON.stringify({ device_ids: ['device_xyz'], play: false }))
    expect(String(fetchSpy.mock.calls[2][0])).toContain('/me/player/play')

    const sent = collectSent(hostWs)
    expect(sent.find((m) => m.type === 'song:start')).toBeDefined()
    expect(sent.find((m) => m.type === 'host:sdk-stale')).toBeUndefined()
    expect(roomState.sdkDeviceId).toBe('device_xyz')
  })

  it('terminal failure — transfer also 404 clears device and broadcasts host:sdk-stale', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.sdkDeviceId = 'device_xyz'
    seedActiveRound()
    const hostWs = { readyState: 1, send: vi.fn() }
    roomState.host = hostWs as unknown as WebSocket

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Device not found', { status: 404 }) as unknown as Response)
      .mockResolvedValueOnce(new Response('Device not found', { status: 404 }) as unknown as Response)

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)

    await vi.waitFor(() => {
      expect(roomState.sdkDeviceId).toBeUndefined()
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    const sent = collectSent(hostWs)
    expect(sent.find((m) => m.type === 'host:sdk-stale')).toBeDefined()
  })

  it('401 — triggers refreshWithRetry and does not attempt transfer or retry', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.sdkDeviceId = 'device_xyz'
    seedActiveRound()
    roomState.host = { readyState: 1, send: vi.fn() } as unknown as WebSocket

    const refreshModule = await import('../refresh.ts')
    const refreshSpy = vi.spyOn(refreshModule, 'refreshWithRetry').mockResolvedValue(undefined)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }) as unknown as Response,
    )

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })

    await vi.waitFor(() => {
      expect(refreshSpy).toHaveBeenCalledWith('host_1')
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
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
    expect(sent).toHaveLength(2)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('round:end')
  })

  it('clears lastRoundWinner and broadcasts stats:updated after round:end', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    // Pre-seed stats from a prior winning round
    roomState.sessionStats.winsByName['Alice'] = 1
    roomState.sessionStats.lastRoundWinner = 'Alice'
    seedActiveRound()

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/end', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(2)
    const first = JSON.parse(sent[0])
    const second = JSON.parse(sent[1])
    expect(first.type).toBe('round:end')
    expect(second.type).toBe('stats:updated')
    expect(second.winsByName).toEqual({ Alice: 1 })
    expect(second.lastRoundWinner).toBeNull()
    expect(roomState.sessionStats.lastRoundWinner).toBeNull()
    expect(roomState.sessionStats.winsByName).toEqual({ Alice: 1 })
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

  it('cancels an in-flight continuous countdown and broadcasts cancel (Story 8-3)', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    seedActiveRound()
    const fakeTimer = setTimeout(() => {}, 10_000)
    roomState.continuousCountdown = { timer: fakeTimer, endsAt: Date.now() + 10_000 }

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/end', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    expect(roomState.continuousCountdown).toBeUndefined()
    const types = sent.map(m => JSON.parse(m).type)
    expect(types).toContain('continuous:countdown-cancel')
  })
})

// ── POST /api/rooms/:code/continuous-mode (Story 8-3) ────────────────────

describe('POST /api/rooms/:code/continuous-mode', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
  })

  it('returns 401 without session', async () => {
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/continuous-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 when room not found', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/rooms/ZZZZ/continuous-mode', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-owner host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/continuous-mode', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 503 when no live roomState', async () => {
    seedHost()
    // Insert room row without roomSockets entry
    const db = (await import('../db.ts')).getDb()
    db.prepare('INSERT INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run('ABCD', 'host_1', Date.now())
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/continuous-mode', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(503)
  })

  it('returns 400 when body.enabled is not boolean', async () => {
    seedHost()
    await seedRoom()
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/continuous-mode', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    })
    expect(res.status).toBe(400)
  })

  it('enable flips state and broadcasts continuous-mode:changed', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/continuous-mode', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    expect(roomState.continuousMode).toBe(true)
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0])).toEqual({ type: 'continuous-mode:changed', enabled: true })
  })

  it('disable while counting cancels timer and broadcasts cancel', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.continuousMode = true
    const fakeTimer = setTimeout(() => {}, 10_000)
    roomState.continuousCountdown = { timer: fakeTimer, endsAt: Date.now() + 10_000 }

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/continuous-mode', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    expect(roomState.continuousMode).toBe(false)
    expect(roomState.continuousCountdown).toBeUndefined()
    const types = sent.map(m => JSON.parse(m).type)
    expect(types).toEqual(['continuous-mode:changed', 'continuous:countdown-cancel'])
  })
})

// ── POST /api/rooms/:code/round/dismiss-win (Story 8-3) ──────────────────

describe('POST /api/rooms/:code/round/dismiss-win', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns 401 without session', async () => {
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/dismiss-win', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 404 when room not found', async () => {
    seedHost()
    const app = makeApp()
    const res = await app.request('/api/rooms/ZZZZ/round/dismiss-win', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-owner host', async () => {
    seedHost('host_1')
    seedHost('host_2')
    await seedRoom('host_2', 'ABCD')
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/dismiss-win', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('returns 409 when no round exists at all', async () => {
    seedHost()
    await seedRoom()
    // no round seeded — currentRound is undefined

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/dismiss-win', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(409)
  })

  it('returns 409 when no ended round', async () => {
    seedHost()
    await seedRoom()
    seedActiveRound() // active, not ended

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/dismiss-win', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(409)
  })

  it('returns 503 when no live roomState', async () => {
    seedHost()
    const db = (await import('../db.ts')).getDb()
    db.prepare('INSERT INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run('ABCD', 'host_1', Date.now())
    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/dismiss-win', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(503)
  })

  it('broadcasts round:dismissed only when continuous is off', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()
    round.active = false
    round.ended = true

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/dismiss-win', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    expect(roomState.continuousCountdown).toBeUndefined()
    const types = sent.map(m => JSON.parse(m).type)
    expect(types).toEqual(['round:dismissed'])
  })

  it('broadcasts round:dismissed and starts countdown when continuous on', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.continuousMode = true
    roomState.pendingRound = { playlistId: 'pl', clipDuration: 30, titleRevealDelay: 5, roundNumber: 1, audioPreset: 'minimal', allowCasualMode: false }
    const round = seedActiveRound()
    round.active = false
    round.ended = true

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round/dismiss-win', {
      method: 'POST',
      headers: { Cookie: sessionCookie() },
    })
    expect(res.status).toBe(200)
    expect(roomState.continuousCountdown).toBeDefined()
    expect(roomState.continuousCountdown!.endsAt).toBeGreaterThan(Date.now())

    const parsed = sent.map(m => JSON.parse(m))
    expect(parsed.map(p => p.type)).toEqual(['round:dismissed', 'continuous:countdown-start'])
    expect(parsed[1].durationMs).toBe(10_000)
    expect(typeof parsed[1].endsAt).toBe('number')
  })

  it('is idempotent — second call reuses existing timer', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.continuousMode = true
    roomState.pendingRound = { playlistId: 'pl', clipDuration: 30, titleRevealDelay: 5, roundNumber: 1, audioPreset: 'minimal', allowCasualMode: false }
    const round = seedActiveRound()
    round.active = false
    round.ended = true

    const sent: string[] = []
    roomState.host = { readyState: 1, send: (msg: string) => sent.push(msg) } as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/dismiss-win', { method: 'POST', headers: { Cookie: sessionCookie() } })
    const firstTimer = roomState.continuousCountdown
    const firstEndsAt = firstTimer?.endsAt

    await app.request('/api/rooms/ABCD/round/dismiss-win', { method: 'POST', headers: { Cookie: sessionCookie() } })
    expect(roomState.continuousCountdown).toBe(firstTimer)
    expect(roomState.continuousCountdown!.endsAt).toBe(firstEndsAt)

    // Only one countdown-start broadcast, but two dismissed broadcasts
    const types = sent.map(m => JSON.parse(m).type)
    expect(types.filter(t => t === 'continuous:countdown-start')).toHaveLength(1)
    expect(types.filter(t => t === 'round:dismissed')).toHaveLength(2)
  })

  it('auto-starts a fresh round after countdown elapses', async () => {
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(makeTracks(30))

    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!
    roomState.continuousMode = true
    roomState.pendingRound = { playlistId: 'pl', clipDuration: 30, titleRevealDelay: 5, roundNumber: 3, audioPreset: 'hype', allowCasualMode: false }
    const round = seedActiveRound()
    round.roundNumber = 3
    round.active = false
    round.ended = true

    const hostWs = makeMockWs()
    roomState.host = hostWs as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/dismiss-win', { method: 'POST', headers: { Cookie: sessionCookie() } })

    // Drain dismissed + countdown-start
    hostWs.getSent()

    await vi.advanceTimersByTimeAsync(10_000)

    const afterElapse = hostWs.getSent().filter(m => m.type === 'round:start')
    expect(afterElapse).toHaveLength(1)
    expect(afterElapse[0].roundNumber).toBe(4)
    expect(afterElapse[0].audioPreset).toBe('hype')
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
    expect(sent).toHaveLength(2)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('round:win')
    expect(msg.winnerName).toBe('Alice')
    expect(msg.winningTileIds).toHaveLength(5)
  })

  it('200 — stats:updated broadcast follows round:win', async () => {
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
    expect(sent).toHaveLength(2)
    const first = JSON.parse(sent[0])
    const second = JSON.parse(sent[1])
    expect(first.type).toBe('round:win')
    expect(second.type).toBe('stats:updated')
    expect(second.winsByName).toEqual({ Alice: 1 })
    expect(second.lastRoundWinner).toBe('Alice')
    expect(roomState.sessionStats.winsByName).toEqual({ Alice: 1 })
    expect(roomState.sessionStats.lastRoundWinner).toBe('Alice')
  })

  it('200 — winsByName increments across multiple wins for the same player', async () => {
    seedHost()
    await seedRoom()
    const roomState = roomSockets.get('ABCD')!

    // Pre-seed a prior Alice win in sessionStats
    roomState.sessionStats.winsByName['Alice'] = 1
    roomState.sessionStats.lastRoundWinner = 'Alice'

    // Seed a fresh active round on the same roomState (second round)
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
    const stats = JSON.parse(sent[1])
    expect(stats.type).toBe('stats:updated')
    expect(stats.winsByName.Alice).toBe(2)
    expect(stats.lastRoundWinner).toBe('Alice')
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
    expect(sent).toHaveLength(2)
    const msg = JSON.parse(sent[0])
    expect(msg.type).toBe('round:win')
    expect(msg.winningTileIds).toContain('FREE')
    expect(msg.winningTileIds).toHaveLength(5)
    const stats = JSON.parse(sent[1])
    expect(stats.type).toBe('stats:updated')
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

// ── Casual Mode (Story 8-4) ───────────────────────────────────────────────

describe('Casual Mode — round:start includes allowCasualMode', () => {
  beforeEach(async () => {
    initDb(':memory:')
    roomSockets.clear()
    vi.restoreAllMocks()
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )
  })

  const validPayload = { playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5, hostName: 'Host' }

  it('round:start broadcast includes allowCasualMode: true when set', async () => {
    seedHost()
    await seedRoom()
    const hostWs = makeMockWs()
    roomSockets.get('ABCD')!.host = hostWs as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validPayload, allowCasualMode: true }),
    })
    expect(res.status).toBe(200)
    const msg = hostWs.getSent()[0]
    expect(msg.type).toBe('round:start')
    expect(msg.allowCasualMode).toBe(true)
  })

  it('round:start defaults allowCasualMode to false when omitted', async () => {
    seedHost()
    await seedRoom()
    const hostWs = makeMockWs()
    roomSockets.get('ABCD')!.host = hostWs as unknown as WebSocket

    const app = makeApp()
    const res = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    expect(res.status).toBe(200)
    const msg = hostWs.getSent()[0]
    expect(msg.type).toBe('round:start')
    expect(msg.allowCasualMode).toBe(false)
  })

  it('new round resets playerCasualModes', async () => {
    seedHost()
    await seedRoom()

    const roomState = roomSockets.get('ABCD')!
    roomState.playerCasualModes.set('Alice', true)
    expect(roomState.playerCasualModes.size).toBe(1)

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })

    expect(roomState.playerCasualModes.size).toBe(0)
  })
})

// session:connect integration coverage (casualModeNames seeding, player:casual-mode-changed
// broadcast, non-boolean rejection) lives in ws.test.ts — that suite has a live WS server.

// ── Casual Mode — Auto-Mark Engine (Story 8-5) ────────────────────────────

describe('Casual Mode — Auto-Mark Engine', () => {
  beforeEach(() => {
    initDb(':memory:')
    roomSockets.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Seeds an active round with Alice as a guest, hand-plants a card for Alice whose
  // first 12 tiles are playlist tracks 0..11 (and free space at 12), so tile-index 0
  // is track_0, tile-index 1 is track_1, etc. Deterministic for index assertions.
  function seedCasualRound(aliceCasualOn = true) {
    const roomState = roomSockets.get('ABCD')!
    const round = seedActiveRound()
    const tracks = round.playlist
    const card: Tile[] = tracks.slice(0, 10).map(t => ({
      trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: t.albumArtUrl,
    }))
    // fill out remaining tiles to reach 25 — use repeats of track_0 won't hurt because
    // we only assert on known indices; use placeholder ids that won't match playlist.
    while (card.length < 25) {
      card.push({ trackId: `pad_${card.length}`, title: '', artist: '', albumArtUrl: '' })
    }
    card[12] = { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
    round.cards.set('Alice', card)

    const aliceWs = makeMockWs()
    roomState.guests.set('Alice', aliceWs as unknown as WebSocket)
    if (aliceCasualOn) roomState.playerCasualModes.set('Alice', true)
    return { roomState, round, aliceWs }
  }

  it('sweep emits square:auto-marked on track change for enabled player', async () => {
    seedHost()
    await seedRoom()
    const { roomState, aliceWs } = seedCasualRound()
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    // Play song 0 — songHistory=[t0], currentTrackId=t0 → sweep emits nothing
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    // Advance to song 1 — songHistory=[t0,t1], currentTrackId=t1 → should auto-mark tile at index 0 (t0)
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    expect(autoMarks).toHaveLength(1)
    expect(autoMarks[0].tileIndices).toEqual([0])
    expect(autoMarks[0].catchUp).toBe(false)
    const alreadySwept = roomState.currentRound!.autoMarkedTileIndices.get('Alice')!
    expect(Array.from(alreadySwept)).toEqual([0])
  })

  it('sweep excludes current song — no emit on first song', async () => {
    seedHost()
    await seedRoom()
    const { roomState, aliceWs } = seedCasualRound()
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    expect(autoMarks).toHaveLength(0)
  })

  it('sweep does not emit for players with casual mode off', async () => {
    seedHost()
    await seedRoom()
    const { roomState, aliceWs } = seedCasualRound(false)
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    expect(autoMarks).toHaveLength(0)
  })

  it('sweep is idempotent — second sweep with no song change emits nothing', async () => {
    seedHost()
    await seedRoom()
    const { roomState, aliceWs } = seedCasualRound()
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })
    const afterFirst = aliceWs.getSent().filter(m => m.type === 'square:auto-marked').length

    // Manually invoke sweep a second time — should be a no-op
    runCasualModeSweep('ABCD', roomState)
    const afterSecond = aliceWs.getSent().filter(m => m.type === 'square:auto-marked').length
    expect(afterSecond).toBe(afterFirst)
  })

  it('host skip (/round/next) triggers identical sweep', async () => {
    seedHost()
    await seedRoom()
    const { roomState, aliceWs } = seedCasualRound()
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    // First next → sweep t0 (tile 0); second next → sweep t1 (tile 1)
    expect(autoMarks).toHaveLength(2)
    expect(autoMarks[0].tileIndices).toEqual([0])
    expect(autoMarks[1].tileIndices).toEqual([1])
  })

  it('newly marked indices exclude previously-swept indices', async () => {
    seedHost()
    await seedRoom()
    const { roomState, aliceWs } = seedCasualRound()
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } }) // sweeps [0]
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } }) // sweeps [1] only, not [0]

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    expect(autoMarks.map(m => m.tileIndices)).toEqual([[0], [1]])
  })

  it('FREE space (index 12) is never in tileIndices — defensive', async () => {
    seedHost()
    await seedRoom()
    const { roomState, round, aliceWs } = seedCasualRound()
    // Force-match: overwrite index 12 to look like a played track (still marked free)
    // and push that trackId into songHistory via two /next calls. But because our
    // helper always sets index 12 to free:true, and runCasualModeSweep skips index 12
    // explicitly, even a matching trackId would be ignored.
    round.cards.get('Alice')![12] = { trackId: 'track_0', title: '', artist: '', albumArtUrl: '', free: true }
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    for (const m of autoMarks) {
      expect(m.tileIndices).not.toContain(12)
    }
  })

  it('sweep on new round resets autoMarkedTileIndices', async () => {
    seedHost()
    await seedRoom()
    const { roomState, aliceWs } = seedCasualRound()
    roomState.host = makeMockWs() as unknown as WebSocket

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })
    // After first round: Alice's swept set contains tile 0.
    expect(Array.from(roomState.currentRound!.autoMarkedTileIndices.get('Alice')!)).toEqual([0])

    // Start a new round via the real POST /round endpoint — Spotify must be mocked
    // so the endpoint can build a playlist without hitting the network.
    const spotifyModule = await import('../music/spotify.ts')
    vi.spyOn(spotifyModule, 'getPlaylistTracks').mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, albumArtUrl: '' }))
    )
    const startRes = await app.request('/api/rooms/ABCD/round', {
      method: 'POST',
      headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: 'pl_abc', clipDuration: 30, titleRevealDelay: 5 }),
    })
    expect(startRes.status).toBe(200)

    // New round: startRound reset playerCasualModes AND autoMarkedTileIndices to empty.
    expect(roomState.currentRound!.autoMarkedTileIndices.has('Alice')).toBe(false)
    expect(roomState.playerCasualModes.get('Alice')).toBeUndefined()

    // Re-enable casual mode and seed history, then sweep — Alice starts from a fresh set.
    roomState.playerCasualModes.set('Alice', true)
    const newRound = roomState.currentRound!
    // Plant a card on Alice for the new round so indices are deterministic.
    const card: Tile[] = newRound.playlist.slice(0, 10).map(t => ({
      trackId: t.id, title: t.title, artist: t.artist, albumArtUrl: t.albumArtUrl,
    }))
    while (card.length < 25) card.push({ trackId: `pad_${card.length}`, title: '', artist: '', albumArtUrl: '' })
    card[12] = { trackId: '', title: '', artist: '', albumArtUrl: '', free: true }
    newRound.cards.set('Alice', card)
    newRound.songHistory.push(
      { trackId: newRound.playlist[0].id, title: '', artist: '', albumArtUrl: '', songIndex: 0 },
      { trackId: newRound.playlist[1].id, title: '', artist: '', albumArtUrl: '', songIndex: 1 },
    )
    newRound.currentSongIndex = 1

    const beforeCount = aliceWs.getSent().filter(m => m.type === 'square:auto-marked').length
    runCasualModeSweep('ABCD', roomState, { playerName: 'Alice', isCatchUp: true })
    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    expect(autoMarks.length).toBe(beforeCount + 1)
    // Expect tile 0 to be newly-swept (not suppressed by the previous round's tracking).
    expect(autoMarks[autoMarks.length - 1].tileIndices).toEqual([0])
  })

  it('sweeps final song on playlist exhaustion (songs:exhausted path)', async () => {
    seedHost()
    await seedRoom()
    const { roomState, round, aliceWs } = seedCasualRound()
    roomState.host = makeMockWs() as unknown as WebSocket
    // Shrink the playlist so exhaustion is reachable in a single /next call.
    round.playlist = round.playlist.slice(0, 2)

    const app = makeApp()
    await app.request('/api/rooms/ABCD/round/play', { method: 'POST', headers: { Cookie: sessionCookie() } })
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } }) // to song 1 → sweeps tile 0
    // One more /next would normally exhaust; sweep must run with includeCurrent so tile 1 (the final song) is emitted.
    await app.request('/api/rooms/ABCD/round/next', { method: 'POST', headers: { Cookie: sessionCookie() } })

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    // Two sweeps: first on song 0→1 transition (tile 0), second on exhaustion (tile 1).
    expect(autoMarks.map(m => m.tileIndices)).toEqual([[0], [1]])
  })

  it('catch-up sweep emits catchUp: true when playerName + isCatchUp are provided', async () => {
    seedHost()
    await seedRoom()
    const { roomState, round, aliceWs } = seedCasualRound()
    // Seed songHistory with two plays (currentSongIndex=1 → t1 is current, t0 is history)
    round.songHistory.push(
      { trackId: 'track_0', title: 'Song 0', artist: 'Artist 0', albumArtUrl: '', songIndex: 0 },
      { trackId: 'track_1', title: 'Song 1', artist: 'Artist 1', albumArtUrl: '', songIndex: 1 },
    )
    round.currentSongIndex = 1

    runCasualModeSweep('ABCD', roomState, { playerName: 'Alice', isCatchUp: true })

    const autoMarks = aliceWs.getSent().filter(m => m.type === 'square:auto-marked')
    expect(autoMarks).toHaveLength(1)
    expect(autoMarks[0].catchUp).toBe(true)
    expect(autoMarks[0].tileIndices).toEqual([0])
  })
})
