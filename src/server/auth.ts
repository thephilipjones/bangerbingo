import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import crypto from 'node:crypto'
import { config } from './config.ts'
import { upsertHost, getHostById, type Host } from './db.ts'

// ── Types ──────────────────────────────────────────────────────────────────

export type AuthEnv = {
  Variables: {
    host: Host
  }
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
  const userId = getCookie(ctx, 'session')
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

  const params = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: config.spotifyRedirectUri,
    scope: 'streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative',
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
  setCookie(ctx, 'session', me.id, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secure: config.isProduction,
  })

  return ctx.redirect('/')
})

// GET /auth/token
authRouter.get('/token', requireAuth, (ctx) => {
  return ctx.json({ accessToken: ctx.var.host.access_token })
})
