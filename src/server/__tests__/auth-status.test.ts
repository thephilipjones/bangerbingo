import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, upsertHost } from '../db.ts'

// Must set env vars before importing config/auth/refresh
vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { app } = await import('../index.ts')
const { clearDegradedState, refreshWithRetry } = await import('../refresh.ts')

const EXPIRES_AT = Date.now() + 3600_000

function seedHost() {
  upsertHost({
    user_id: 'status_test_user',
    display_name: 'Status User',
    email: 'status@example.com',
    access_token: 'tok',
    refresh_token: 'ref',
    token_expires_at: EXPIRES_AT,
  })
}

describe('GET /api/auth/status', () => {
  beforeEach(() => {
    initDb(':memory:')
    clearDegradedState('status_test_user')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns 401 without session', async () => {
    const res = await app.request('/api/auth/status')
    expect(res.status).toBe(401)
  })

  it('returns { degraded: false, tokenExpiresAt } for non-degraded host', async () => {
    seedHost()

    const res = await app.request('/api/auth/status', {
      headers: { Cookie: 'session=status_test_user' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { degraded: boolean; tokenExpiresAt: number }
    expect(body.degraded).toBe(false)
    expect(body.tokenExpiresAt).toBe(EXPIRES_AT)
  })

  it('returns { degraded: true, ... } after host is marked degraded', async () => {
    seedHost()

    // Mark host degraded via refreshWithRetry exhausting all retries
    global.fetch = vi.fn()
      .mockResolvedValue({ ok: false, status: 500 } as Response)

    const promise = refreshWithRetry('status_test_user')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    await promise

    const res = await app.request('/api/auth/status', {
      headers: { Cookie: 'session=status_test_user' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { degraded: boolean; tokenExpiresAt: number }
    expect(body.degraded).toBe(true)
    expect(body.tokenExpiresAt).toBe(EXPIRES_AT)
  })
})
