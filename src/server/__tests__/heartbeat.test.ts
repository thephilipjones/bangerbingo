import { describe, it, expect } from 'vitest'
import {
  startHeartbeat,
  stopHeartbeat,
  recordPong,
  _peekLastPongAt,
  HEARTBEAT_INTERVAL_MS,
  PONG_TIMEOUT_MS,
} from '../heartbeat.ts'

// Fake WebSocket matching just the bits heartbeat.ts uses.
class FakeWs {
  readyState = 1 // OPEN
  sent: string[] = []
  terminated = false
  send(data: string) { this.sent.push(data) }
  terminate() { this.terminated = true; this.readyState = 3 }
}

describe('heartbeat', () => {
  it('sends ping on tick while lastPongAt is fresh', () => {
    const ws = new FakeWs()
    let fake = 1_000_000
    const now = () => fake
    const intervals: Array<{ fn: () => void; ms: number }> = []
    const setIntervalFn = ((fn: () => void, ms: number) => {
      intervals.push({ fn, ms })
      return intervals.length as unknown as NodeJS.Timeout
    }) as typeof setInterval
    const clearIntervalFn = (() => { /* no-op */ }) as typeof clearInterval

    startHeartbeat(ws as unknown as import('ws').WebSocket, { now, setIntervalFn, clearIntervalFn })

    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(HEARTBEAT_INTERVAL_MS)

    // Tick 1: 20s later, within 45s budget → send ping
    fake += HEARTBEAT_INTERVAL_MS
    intervals[0].fn()
    expect(ws.sent).toHaveLength(1)
    const parsed = JSON.parse(ws.sent[0]) as { type: string; t: number }
    expect(parsed.type).toBe('ping')
    expect(parsed.t).toBe(fake)
    expect(ws.terminated).toBe(false)

    stopHeartbeat(ws as unknown as import('ws').WebSocket, { clearIntervalFn })
  })

  it('terminates the socket when lastPongAt is older than PONG_TIMEOUT_MS', () => {
    const ws = new FakeWs()
    let fake = 1_000_000
    const now = () => fake
    const intervals: Array<{ fn: () => void }> = []
    const setIntervalFn = ((fn: () => void) => {
      intervals.push({ fn })
      return 1 as unknown as NodeJS.Timeout
    }) as typeof setInterval
    const clearIntervalFn = (() => {}) as typeof clearInterval

    startHeartbeat(ws as unknown as import('ws').WebSocket, { now, setIntervalFn, clearIntervalFn })

    // Jump past timeout without any pong.
    fake += PONG_TIMEOUT_MS + 1
    intervals[0].fn()
    expect(ws.terminated).toBe(true)
    expect(ws.sent).toHaveLength(0)

    stopHeartbeat(ws as unknown as import('ws').WebSocket, { clearIntervalFn })
  })

  it('recordPong refreshes lastPongAt so the socket is not terminated', () => {
    const ws = new FakeWs()
    let fake = 1_000_000
    const now = () => fake
    const intervals: Array<{ fn: () => void }> = []
    const setIntervalFn = ((fn: () => void) => {
      intervals.push({ fn })
      return 1 as unknown as NodeJS.Timeout
    }) as typeof setInterval
    const clearIntervalFn = (() => {}) as typeof clearInterval

    startHeartbeat(ws as unknown as import('ws').WebSocket, { now, setIntervalFn, clearIntervalFn })

    // Advance 40s, receive a pong.
    fake += 40_000
    recordPong(ws as unknown as import('ws').WebSocket, { now })
    expect(_peekLastPongAt(ws as unknown as import('ws').WebSocket)).toBe(fake)

    // Advance another 40s (80s total) but since pong landed at 40s,
    // it's only been 40s since last pong — ping, don't terminate.
    fake += 40_000
    intervals[0].fn()
    expect(ws.terminated).toBe(false)
    expect(ws.sent).toHaveLength(1)

    stopHeartbeat(ws as unknown as import('ws').WebSocket, { clearIntervalFn })
  })

  it('stopHeartbeat clears the registered interval', () => {
    const ws = new FakeWs()
    const cleared: unknown[] = []
    const setIntervalFn = (() => 42 as unknown as NodeJS.Timeout) as unknown as typeof setInterval
    const clearIntervalFn = ((id: unknown) => { cleared.push(id) }) as unknown as typeof clearInterval

    startHeartbeat(ws as unknown as import('ws').WebSocket, { setIntervalFn, clearIntervalFn })
    stopHeartbeat(ws as unknown as import('ws').WebSocket, { clearIntervalFn })
    expect(cleared).toEqual([42])
  })
})
