import { EventEmitter } from 'node:events'
import { config } from './config.ts'
import { getHostById, getAllHosts, updateHostTokens } from './db.ts'

// ── Degraded state ─────────────────────────────────────────────────────────

const degradedHosts = new Set<string>()

export function isHostDegraded(userId: string): boolean {
  return degradedHosts.has(userId)
}

export function clearDegradedState(userId: string): void {
  degradedHosts.delete(userId)
}

// ── EventEmitter for Epic 3 WS wiring ─────────────────────────────────────

export const authEvents = new EventEmitter()

// ── Core refresh logic ─────────────────────────────────────────────────────

export async function refreshTokenForHost(userId: string): Promise<void> {
  const host = getHostById(userId)
  if (!host) throw new Error(`Host not found: ${userId}`)

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: host.refresh_token,
      client_id: config.spotifyClientId,
    }),
  })

  if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`)

  const data = await res.json() as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  if (!data.access_token || !data.expires_in) {
    throw new Error(`Spotify returned malformed token response for ${userId}`)
  }

  const newRefreshToken = data.refresh_token ?? host.refresh_token
  updateHostTokens(userId, data.access_token, newRefreshToken, Date.now() + data.expires_in * 1000)
  clearDegradedState(userId)
}

// ── Retry with exponential backoff ─────────────────────────────────────────

async function retryWithBackoff(
  fn: () => Promise<void>,
  maxRetries: number,
  baseDelayMs: number
): Promise<void> {
  let delay = baseDelayMs
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fn()
      return
    } catch (err) {
      if (attempt === maxRetries) throw err
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay *= 2
    }
  }
}

export async function refreshWithRetry(userId: string): Promise<void> {
  try {
    await retryWithBackoff(() => refreshTokenForHost(userId), 3, 1000)
  } catch {
    degradedHosts.add(userId)
    authEvents.emit('degraded', userId)
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────

const REFRESH_THRESHOLD = 5 * 60 * 1000 // 5 minutes in ms

export function startRefreshScheduler(): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    (async () => {
      const hosts = getAllHosts()
      for (const host of hosts) {
        if (isHostDegraded(host.user_id)) continue
        if (host.token_expires_at - Date.now() < REFRESH_THRESHOLD) {
          await refreshWithRetry(host.user_id)
        }
      }
    })().catch((err) => {
      console.error('[refresh scheduler] unexpected error:', err)
    })
  }, 60_000)
  return interval
}
