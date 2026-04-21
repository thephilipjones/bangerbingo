import type WebSocket from 'ws'

export const HEARTBEAT_INTERVAL_MS = 20_000
export const PONG_TIMEOUT_MS = 45_000

interface HeartbeatState {
  lastPongAt: number
  interval: ReturnType<typeof setInterval>
}

const heartbeats = new WeakMap<WebSocket, HeartbeatState>()

export interface HeartbeatDeps {
  now?: () => number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

/**
 * Start the heartbeat ping loop for a newly-opened socket. Every
 * HEARTBEAT_INTERVAL_MS the socket either receives a ping or is terminated
 * if we haven't seen a pong in >PONG_TIMEOUT_MS.
 */
export function startHeartbeat(ws: WebSocket, deps: HeartbeatDeps = {}): void {
  const now = deps.now ?? (() => Date.now())
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const state: HeartbeatState = {
    lastPongAt: now(),
    // Assigned synchronously below.
    interval: undefined as unknown as ReturnType<typeof setInterval>,
  }
  state.interval = setIntervalFn(() => {
    // readyState 1 === OPEN in the ws library
    if (ws.readyState !== 1) return
    if (now() - state.lastPongAt > PONG_TIMEOUT_MS) {
      // terminate() produces an abnormal (1006) close for the peer. The 'ws'
      // library rejects user-supplied 1006 on close(); terminate is the
      // sanctioned path.
      try { ws.terminate() } catch { /* ignore */ }
      return
    }
    try { ws.send(JSON.stringify({ type: 'ping', t: now() })) } catch { /* ignore */ }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeats.set(ws, state)
}

export function stopHeartbeat(ws: WebSocket, deps: HeartbeatDeps = {}): void {
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const s = heartbeats.get(ws)
  if (s) {
    clearIntervalFn(s.interval)
    heartbeats.delete(ws)
  }
}

export function recordPong(ws: WebSocket, deps: HeartbeatDeps = {}): void {
  const now = deps.now ?? (() => Date.now())
  const s = heartbeats.get(ws)
  if (s) s.lastPongAt = now()
}

// Exposed for tests.
export function _peekLastPongAt(ws: WebSocket): number | undefined {
  return heartbeats.get(ws)?.lastPongAt
}
