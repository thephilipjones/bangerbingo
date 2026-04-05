import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { initDb, upsertHost } from '../db.ts'

// Must set env vars before importing config/auth
vi.stubEnv('SPOTIFY_CLIENT_ID', 'test_client_id')
vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test_secret')
vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback')
vi.stubEnv('SESSION_SECRET', 'test_session_secret')
vi.stubEnv('PORT', '3000')
vi.stubEnv('NODE_ENV', 'test')

const { authRouter, requireAuth } = await import('../auth.ts')
const { authEvents } = await import('../refresh.ts')

describe('PKCE OAuth routes', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  describe('GET /auth/login', () => {
    it('redirects to Spotify authorize URL', async () => {
      const app = new Hono()
      app.route('/auth', authRouter)

      const res = await app.request('/auth/login')
      expect(res.status).toBe(302)

      const location = res.headers.get('location') ?? ''
      expect(location).toContain('https://accounts.spotify.com/authorize')
      expect(location).toContain('client_id=test_client_id')
      expect(location).toContain('code_challenge_method=S256')
      expect(location).toContain('response_type=code')
      expect(location).toContain('scope=')
      expect(location).toContain('code_challenge=')
    })

    it('sets pkce_verifier httpOnly cookie', async () => {
      const app = new Hono()
      app.route('/auth', authRouter)

      const res = await app.request('/auth/login')
      const setCookieHeader = res.headers.get('set-cookie') ?? ''
      expect(setCookieHeader).toContain('pkce_verifier=')
      expect(setCookieHeader).toContain('HttpOnly')
    })

    it('redirect URI uses 127.0.0.1 not localhost (AC 6)', async () => {
      const app = new Hono()
      app.route('/auth', authRouter)

      const res = await app.request('/auth/login')
      const location = res.headers.get('location') ?? ''
      // The redirect_uri param must not contain localhost
      const url = new URL(location)
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      expect(redirectUri).toContain('127.0.0.1')
      expect(redirectUri).not.toContain('localhost')
    })
  })

  describe('GET /auth/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('redirects to /login?error=spotify_denied when Spotify returns error', async () => {
      const app = new Hono()
      app.route('/auth', authRouter)

      const res = await app.request('/auth/callback?error=access_denied')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?error=spotify_denied')
    })

    it('redirects to /login?error=missing_verifier when no pkce_verifier cookie', async () => {
      const app = new Hono()
      app.route('/auth', authRouter)

      const res = await app.request('/auth/callback?code=authcode123')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?error=missing_verifier')
    })

    it('on successful exchange: upserts host, sets session cookie, redirects to /', async () => {
      const app = new Hono()
      app.route('/auth', authRouter)

      // Mock fetch for token exchange and /me
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'acc_tok',
            refresh_token: 'ref_tok',
            expires_in: 3600,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'spotify_user_1',
            display_name: 'DJ Philip',
            email: 'philip@example.com',
          }),
        } as Response)

      const res = await app.request('/auth/callback?code=authcode', {
        headers: {
          Cookie: 'pkce_verifier=test_verifier_value',
        },
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/')

      const setCookieHeader = res.headers.get('set-cookie') ?? ''
      expect(setCookieHeader).toContain('session=spotify_user_1')
      expect(setCookieHeader).toContain('HttpOnly')

      // Host should be persisted in DB
      const { getHostById } = await import('../db.ts')
      const host = getHostById('spotify_user_1')
      expect(host).toBeDefined()
      expect(host!.display_name).toBe('DJ Philip')
      expect(host!.access_token).toBe('acc_tok')
    })
  })
})

describe('Popup reauth (Story 5-6)', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET /auth/login?popup=1 sets pkce_popup cookie', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)

    const res = await app.request('/auth/login?popup=1')
    expect(res.status).toBe(302)

    const setCookieHeader = res.headers.get('set-cookie') ?? ''
    expect(setCookieHeader).toContain('pkce_popup=1')
    expect(setCookieHeader).toContain('HttpOnly')
  })

  it('GET /auth/login (no popup) does NOT set pkce_popup cookie', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)

    const res = await app.request('/auth/login')
    expect(res.status).toBe(302)

    const setCookieHeader = res.headers.get('set-cookie') ?? ''
    expect(setCookieHeader).not.toContain('pkce_popup')
  })

  it('GET /auth/callback in popup mode: emits auth:restored, returns close-popup HTML', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'acc_tok',
          refresh_token: 'ref_tok',
          expires_in: 3600,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'spotify_popup_user',
          display_name: 'Popup User',
          email: 'popup@example.com',
        }),
      } as Response)

    const restoredSpy = vi.fn()
    authEvents.once('restored', restoredSpy)

    const res = await app.request('/auth/callback?code=authcode', {
      headers: {
        Cookie: 'pkce_verifier=test_verifier; pkce_popup=1',
      },
    })

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('window.close()')
    expect(restoredSpy).toHaveBeenCalledWith('spotify_popup_user')
  })

  it('GET /auth/callback in normal mode still redirects to /', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'acc_tok2',
          refresh_token: 'ref_tok2',
          expires_in: 3600,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'spotify_normal_user',
          display_name: 'Normal User',
          email: 'normal@example.com',
        }),
      } as Response)

    const res = await app.request('/auth/callback?code=authcode', {
      headers: {
        Cookie: 'pkce_verifier=test_verifier',
      },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
  })
})

describe('requireAuth middleware', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('returns 401 when no session cookie', async () => {
    const app = new Hono()
    app.get('/protected', requireAuth, (ctx) => ctx.json({ ok: true }))

    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })

  it('returns 401 when session cookie references unknown user', async () => {
    const app = new Hono()
    app.get('/protected', requireAuth, (ctx) => ctx.json({ ok: true }))

    const res = await app.request('/protected', {
      headers: { Cookie: 'session=unknown_user' },
    })
    expect(res.status).toBe(401)
  })

  it('passes through and attaches host when valid session', async () => {
    upsertHost({
      user_id: 'real_user',
      display_name: 'Real User',
      email: 'real@example.com',
      access_token: 'tok',
      refresh_token: 'ref',
      token_expires_at: Date.now() + 3600_000,
    })

    const app = new Hono<{ Variables: { host: { user_id: string; display_name: string } } }>()
    app.get('/protected', requireAuth, (ctx) => ctx.json(ctx.var.host))

    const res = await app.request('/protected', {
      headers: { Cookie: 'session=real_user' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user_id).toBe('real_user')
    expect(body.display_name).toBe('Real User')
  })
})

describe('GET /auth/token', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('200 — returns accessToken for authenticated host', async () => {
    upsertHost({
      user_id: 'tok_user',
      display_name: 'Token User',
      email: 'tok@example.com',
      access_token: 'my_access_token',
      refresh_token: 'ref',
      token_expires_at: Date.now() + 3600_000,
    })

    const app = new Hono()
    app.route('/auth', authRouter)

    const res = await app.request('/auth/token', {
      headers: { Cookie: 'session=tok_user' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ accessToken: 'my_access_token' })
  })

  it('401 — returns 401 without session cookie', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)

    const res = await app.request('/auth/token')
    expect(res.status).toBe(401)
  })
})

describe('/api/me endpoint', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('returns 401 without session', async () => {
    const { app } = await import('../index.ts')
    const res = await app.request('/api/me')
    expect(res.status).toBe(401)
  })

  it('returns user_id and display_name with valid session', async () => {
    upsertHost({
      user_id: 'me_user',
      display_name: 'Me User',
      email: 'me@example.com',
      access_token: 'tok',
      refresh_token: 'ref',
      token_expires_at: Date.now() + 3600_000,
    })

    const { app } = await import('../index.ts')
    const res = await app.request('/api/me', {
      headers: { Cookie: 'session=me_user' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ user_id: 'me_user', display_name: 'Me User' })
  })
})
