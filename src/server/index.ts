import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config } from './config.ts'
import { initDb } from './db.ts'
import { authRouter, requireAuth, type AuthEnv } from './auth.ts'

// Init DB at startup (crash fast if it fails)
initDb()

const app = new Hono<AuthEnv>()

// Auth routes
app.route('/auth', authRouter)

// Protected API routes
app.get('/api/me', requireAuth, (ctx) => {
  const host = ctx.var.host
  return ctx.json({ user_id: host.user_id, display_name: host.display_name })
})

// Serve static client build in production
if (config.isProduction) {
  app.use('/*', serveStatic({ root: './dist/client' }))
}

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`bangerbingo server running on http://127.0.0.1:${config.port}`)
})

export { app }
