import pkg from '../../package.json'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config } from './config.ts'
import { initDb } from './db.ts'
import { authRouter, requireAuth, type AuthEnv } from './auth.ts'
import { startRefreshScheduler, isHostDegraded } from './refresh.ts'
import { roomsRouter } from './rooms.ts'
import { musicRouter } from './music/router.ts'
import { setupWebSocketServer, rehydrateRooms } from './ws.ts'

// Init DB at startup (crash fast if it fails)
initDb(process.env['DB_PATH'] || undefined)

const app = new Hono<AuthEnv>()

// Auth routes
app.route('/auth', authRouter)

// Room routes
app.route('/api', roomsRouter)

// Music routes
app.route('/api', musicRouter)

// Protected API routes
app.get('/api/me', requireAuth, (ctx) => {
  const host = ctx.var.host
  return ctx.json({ user_id: host.user_id, display_name: host.display_name })
})

app.get('/api/auth/status', requireAuth, (ctx) => {
  const host = ctx.var.host
  return ctx.json({ degraded: isHostDegraded(host.user_id), tokenExpiresAt: host.token_expires_at })
})

// Health check — must be registered before the serveStatic wildcard
app.get('/healthz', (ctx) => ctx.json({ ok: true, version: pkg.version }))

// Serve static client build in production
if (config.isProduction) {
  app.use('/*', serveStatic({ root: './dist/client' }))
}

if (config.nodeEnv !== 'test') {
  startRefreshScheduler()
  const httpServer = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, () => {
    console.log(
      `bangerbingo server listening on port ${config.port} (reachable on all LAN/tailnet interfaces)`,
    )
  })
  rehydrateRooms()
  setupWebSocketServer(httpServer)
}

export { app }
