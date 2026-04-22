import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import crypto from 'node:crypto'
import { config } from './config.ts'
import { upsertHost, getHostById, clearHostTokens, type Host } from './db.ts'
import { authEvents, clearDegradedState, refreshWithRetry, isHostDegraded } from './refresh.ts'

// ── Types ──────────────────────────────────────────────────────────────────

export type AuthEnv = {
  Variables: {
    host: Host
  }
}

// ── Session signing ────────────────────────────────────────────────────────

// Signature is full 64-char SHA-256 HMAC hex (spec gave us 16-char or full —
// full is simpler with no measurable downside on a cookie this small).
export function signUserId(id: string): string {
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(id).digest('hex')
  return `${id}.${sig}`
}

export function verifySession(cookie: string): string | null {
  const lastDot = cookie.lastIndexOf('.')
  // Reject cookies with no dot (lastDot === -1) and cookies with empty userId
  // (lastDot === 0, e.g. ".<sig of empty string>") as defense-in-depth.
  if (lastDot <= 0) return null
  const userId = cookie.slice(0, lastDot)
  const sig = cookie.slice(lastDot + 1)
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(userId).digest('hex')
  if (sig.length !== expected.length || !/^[0-9a-f]+$/.test(sig)) return null
  const sigBuf = Buffer.from(sig, 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null
  return userId
}

// ── Token refresh helper ───────────────────────────────────────────────────

export async function withFreshToken(host: Host): Promise<Host | null> {
  if (!host.access_token) return null
  if (host.token_expires_at - Date.now() >= 60_000) return host
  await refreshWithRetry(host.user_id)
  if (isHostDegraded(host.user_id)) return null
  return getHostById(host.user_id) ?? null
}

// ── PKCE helpers ───────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return Buffer.from(
    crypto.createHash('sha256').update(verifier).digest()
  ).toString('base64url')
}

// ── Session middleware ─────────────────────────────────────────────────────

export const requireAuth = createMiddleware<AuthEnv>(async (ctx, next) => {
  const cookie = getCookie(ctx, 'session')
  const userId = cookie ? verifySession(cookie) : null
  if (!userId) return ctx.json({ error: 'Unauthorized' }, 401)

  const host = getHostById(userId)
  if (!host) return ctx.json({ error: 'Unauthorized' }, 401)

  ctx.set('host', host)
  await next()
})

// ── Auth router ────────────────────────────────────────────────────────────

export const authRouter = new Hono()

// GET /auth/login
authRouter.get('/login', (ctx) => {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  // Store verifier in short-lived httpOnly cookie
  setCookie(ctx, 'pkce_verifier', codeVerifier, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/auth/callback',
    maxAge: 300, // 5 minutes
    secure: config.isProduction,
  })

  if (ctx.req.query('popup') === '1') {
    setCookie(ctx, 'pkce_popup', '1', {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/auth/callback',
      maxAge: 300,
      secure: config.isProduction,
    })
  }

  const params = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: config.spotifyRedirectUri,
    scope: 'streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return ctx.redirect(`https://accounts.spotify.com/authorize?${params}`)
})

// GET /auth/callback
authRouter.get('/callback', async (ctx) => {
  const { code, error } = ctx.req.query()

  if (error) {
    return ctx.redirect('/login?error=spotify_denied')
  }

  const codeVerifier = getCookie(ctx, 'pkce_verifier')
  if (!codeVerifier || !code) {
    return ctx.redirect('/login?error=missing_verifier')
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.spotifyRedirectUri,
      client_id: config.spotifyClientId,
      code_verifier: codeVerifier,
    }),
  })

  if (!tokenRes.ok) {
    return ctx.redirect('/login?error=token_exchange_failed')
  }

  let tokens: { access_token: string; refresh_token: string; expires_in: number }
  try {
    tokens = await tokenRes.json() as typeof tokens
  } catch {
    return ctx.redirect('/login?error=token_exchange_failed')
  }

  // Fetch user identity
  const meRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  if (!meRes.ok) {
    return ctx.redirect('/login?error=me_fetch_failed')
  }

  let me: { id: string; display_name: string; email: string }
  try {
    me = await meRes.json() as typeof me
  } catch {
    return ctx.redirect('/login?error=me_fetch_failed')
  }

  // Persist host
  try {
    upsertHost({
      user_id: me.id,
      display_name: me.display_name ?? me.id,
      email: me.email ?? '',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: Date.now() + tokens.expires_in * 1000,
    })
  } catch {
    return ctx.redirect('/login?error=server_error')
  }

  // Clean up verifier cookie, set session cookie
  deleteCookie(ctx, 'pkce_verifier', { path: '/auth/callback' })
  setCookie(ctx, 'session', signUserId(me.id), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secure: config.isProduction,
  })

  const isPopup = getCookie(ctx, 'pkce_popup') === '1'
  if (isPopup) {
    deleteCookie(ctx, 'pkce_popup', { path: '/auth/callback' })
    clearDegradedState(me.id)
    authEvents.emit('restored', me.id)
    return ctx.html('<html><body><script>window.close()</script></body></html>')
  }

  return ctx.redirect('/host')
})

// POST /auth/logout — clears session cookie + Spotify tokens server-side
authRouter.post('/logout', (ctx) => {
  const cookie = getCookie(ctx, 'session')
  const userId = cookie ? verifySession(cookie) : null
  if (userId) {
    try { clearHostTokens(userId) } catch { /* no-op: cookie cleared regardless */ }
  }
  deleteCookie(ctx, 'session', { path: '/' })
  return ctx.body(null, 204)
})

// GET /auth/token
authRouter.get('/token', requireAuth, (ctx) => {
  if (!ctx.var.host.access_token) return ctx.json({ error: 'Spotify not connected' }, 403)
  return ctx.json({ accessToken: ctx.var.host.access_token })
})
