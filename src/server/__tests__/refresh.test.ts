import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, upsertHost, getHostById } from '../db.ts'

// Stub env vars before importing config/refresh
vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const {
  refreshTokenForHost,
  refreshWithRetry,
  isHostDegraded,
  clearDegradedState,
  authEvents,
  startRefreshScheduler,
} = await import('../refresh.ts')

const TEST_USER = 'user_refresh_test'

function seedHost(overrides: Partial<Parameters<typeof upsertHost>[0]> = {}) {
  upsertHost({
    user_id: TEST_USER,
    display_name: 'Test Host',
    email: 'test@example.com',
    access_token: 'old_access_token',
    refresh_token: 'old_refresh_token',
    token_expires_at: Date.now() + 60_000,
    ...overrides,
  })
}

function mockSpotifyRefreshSuccess(overrides: { refresh_token?: string } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: 'new_access_token',
      expires_in: 3600,
      ...overrides,
    }),
  } as Response)
}

function mockSpotifyRefreshFailure(times = 1) {
  const mock = vi.fn()
  for (let i = 0; i < times; i++) {
    mock.mockResolvedValueOnce({ ok: false, status: 400 } as Response)
  }
  global.fetch = mock
}

describe('refresh module', () => {
  beforeEach(() => {
    initDb(':memory:')
    clearDegradedState(TEST_USER)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('refreshTokenForHost', () => {
    it('successful refresh: saves new access token and expiry, host not degraded', async () => {
      seedHost()
      mockSpotifyRefreshSuccess()

      await refreshTokenForHost(TEST_USER)

      const host = getHostById(TEST_USER)!
      expect(host.access_token).toBe('new_access_token')
      expect(host.token_expires_at).toBeGreaterThan(Date.now())
      expect(isHostDegraded(TEST_USER)).toBe(false)
    })

    it('rotating refresh token: Spotify response includes new refresh_token → saved to DB', async () => {
      seedHost()
      mockSpotifyRefreshSuccess({ refresh_token: 'rotated_refresh_token' })

      await refreshTokenForHost(TEST_USER)

      const host = getHostById(TEST_USER)!
      expect(host.refresh_token).toBe('rotated_refresh_token')
    })

    it('no rotation: Spotify response omits refresh_token → old token preserved', async () => {
      seedHost()
      mockSpotifyRefreshSuccess() // no refresh_token in response

      await refreshTokenForHost(TEST_USER)

      const host = getHostById(TEST_USER)!
      expect(host.refresh_token).toBe('old_refresh_token')
    })

    it('throws on non-OK response', async () => {
      seedHost()
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response)

      await expect(refreshTokenForHost(TEST_USER)).rejects.toThrow()
    })

    it('throws if host not found in DB', async () => {
      await expect(refreshTokenForHost('nonexistent_user')).rejects.toThrow('Host not found')
    })
  })

  describe('refreshWithRetry', () => {
    it('retry success on 3rd attempt: fetch fails twice, succeeds third → no degraded state', async () => {
      seedHost()

      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
        .mockResolvedValue({
          ok: true,
          json: async () => ({ access_token: 'new_access_token', expires_in: 3600 }),
        } as Response)

      const promise = refreshWithRetry(TEST_USER)
      // advance past first delay (1000ms)
      await vi.advanceTimersByTimeAsync(1000)
      // advance past second delay (2000ms)
      await vi.advanceTimersByTimeAsync(2000)
      await promise

      expect(isHostDegraded(TEST_USER)).toBe(false)
      const host = getHostById(TEST_USER)!
      expect(host.access_token).toBe('new_access_token')
    })

    it('all retries fail → host marked degraded → authEvents emits degraded', async () => {
      seedHost()
      mockSpotifyRefreshFailure(4) // 1 attempt + 3 retries

      const degradedSpy = vi.fn()
      authEvents.on('degraded', degradedSpy)

      const promise = refreshWithRetry(TEST_USER)
      // advance through all backoff delays: 1s + 2s + 4s
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      await vi.advanceTimersByTimeAsync(4000)
      await promise

      expect(isHostDegraded(TEST_USER)).toBe(true)
      expect(degradedSpy).toHaveBeenCalledWith(TEST_USER)

      authEvents.off('degraded', degradedSpy)
    })
  })

  describe('clearDegradedState', () => {
    it('removes host from degraded set', async () => {
      seedHost()
      mockSpotifyRefreshFailure(4)

      const promise = refreshWithRetry(TEST_USER)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      await vi.advanceTimersByTimeAsync(4000)
      await promise

      expect(isHostDegraded(TEST_USER)).toBe(true)
      clearDegradedState(TEST_USER)
      expect(isHostDegraded(TEST_USER)).toBe(false)
    })
  })

  describe('startRefreshScheduler', () => {
    it('scheduler skips host with plenty of time left (not near expiry)', async () => {
      seedHost({ token_expires_at: Date.now() + 60 * 60 * 1000 }) // 1 hour left
      global.fetch = vi.fn()

      const interval = startRefreshScheduler()
      await vi.advanceTimersByTimeAsync(60_000) // trigger one tick
      clearInterval(interval)

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('scheduler refreshes host near expiry (within 5 minutes)', async () => {
      seedHost({ token_expires_at: Date.now() + 4 * 60 * 1000 }) // 4 min left
      mockSpotifyRefreshSuccess()

      const interval = startRefreshScheduler()
      await vi.advanceTimersByTimeAsync(60_000)
      clearInterval(interval)

      expect(global.fetch).toHaveBeenCalled()
    })

    it('scheduler skips already-degraded host', async () => {
      seedHost({ token_expires_at: Date.now() + 4 * 60 * 1000 }) // near expiry
      // First manually mark degraded
      mockSpotifyRefreshFailure(4)
      const degradePromise = refreshWithRetry(TEST_USER)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      await vi.advanceTimersByTimeAsync(4000)
      await degradePromise
      expect(isHostDegraded(TEST_USER)).toBe(true)

      // Reset fetch mock and start scheduler
      global.fetch = vi.fn()
      const interval = startRefreshScheduler()
      await vi.advanceTimersByTimeAsync(60_000)
      clearInterval(interval)

      expect(global.fetch).not.toHaveBeenCalled()
    })
  })
})
