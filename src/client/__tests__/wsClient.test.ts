import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createWsClient, computeBackoffDelay, type WsClient, type WsState } from '../lib/wsClient.ts'

// ── Fake WebSocket ─────────────────────────────────────────────────────────

class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeSocket[] = []

  url: string
  readyState = FakeSocket.CONNECTING
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(cb)
  }

  send(data: string) {
    if (this.readyState !== FakeSocket.OPEN) return
    this.sent.push(data)
  }

  close(code = 1005, reason = '') {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.dispatch('close', { code, reason })
  }

  // Test-only API
  simulateOpen() {
    this.readyState = FakeSocket.OPEN
    this.dispatch('open', {})
  }
  simulateMessage(data: unknown) {
    this.dispatch('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  simulateDrop(code = 1006) {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.dispatch('close', { code })
  }

  private dispatch(type: string, ev: unknown) {
    (this.listeners[type] ?? []).slice().forEach((cb) => cb(ev))
  }
}

function latest(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1]
}

function makeHarness() {
  const messages: unknown[] = []
  const states: WsState[] = []
  const client = createWsClient({
    url: 'ws://test.local/ws',
    onMessage: (m) => messages.push(m),
    onStateChange: (s) => states.push(s),
    WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
  })
  return { client, messages, states }
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('computeBackoffDelay', () => {
  it('returns 1s / 2s / 4s / 8s / 16s for attempts 0..4', () => {
    expect(computeBackoffDelay(0)).toBe(1000)
    expect(computeBackoffDelay(1)).toBe(2000)
    expect(computeBackoffDelay(2)).toBe(4000)
    expect(computeBackoffDelay(3)).toBe(8000)
    expect(computeBackoffDelay(4)).toBe(16000)
  })

  it('caps at 16s for attempts >= 5', () => {
    expect(computeBackoffDelay(5)).toBe(16000)
    expect(computeBackoffDelay(12)).toBe(16000)
  })

  it('clamps negative attempt to 1s', () => {
    expect(computeBackoffDelay(-1)).toBe(1000)
  })
})

describe('createWsClient — pong reply', () => {
  it('replies {type:"pong", t:X} when server sends {type:"ping", t:X}', () => {
    const { client } = makeHarness()
    latest().simulateOpen()
    latest().simulateMessage({ type: 'ping', t: 12345 })
    expect(latest().sent).toContain(JSON.stringify({ type: 'pong', t: 12345 }))
    // Ping is handled internally — it should not bubble up to onMessage
    client.send({ noop: true }) // ensures no throw
  })

  it('does not forward ping messages to onMessage', () => {
    const { messages } = makeHarness()
    latest().simulateOpen()
    latest().simulateMessage({ type: 'ping', t: 1 })
    expect(messages).toEqual([])
  })

  it('forwards non-ping messages to onMessage', () => {
    const { messages } = makeHarness()
    latest().simulateOpen()
    latest().simulateMessage({ type: 'song:start', title: 'x' })
    expect(messages).toEqual([{ type: 'song:start', title: 'x' }])
  })
})

describe('createWsClient — onResume', () => {
  it('does NOT fire on the first successful open', () => {
    const { client } = makeHarness()
    const resume = vi.fn()
    client.onResume(resume)
    latest().simulateOpen()
    expect(resume).not.toHaveBeenCalled()
  })

  it('fires on reconnect (open → reconnecting → open)', () => {
    const { client } = makeHarness()
    const resume = vi.fn()
    client.onResume(resume)
    latest().simulateOpen()
    latest().simulateDrop(1006)
    vi.advanceTimersByTime(1000) // backoff delay 0 = 1s
    expect(FakeSocket.instances.length).toBe(2)
    latest().simulateOpen()
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('returns an unsubscribe function', () => {
    const { client } = makeHarness()
    const resume = vi.fn()
    const unsub = client.onResume(resume)
    latest().simulateOpen()
    unsub()
    latest().simulateDrop(1006)
    vi.advanceTimersByTime(1000)
    latest().simulateOpen()
    expect(resume).not.toHaveBeenCalled()
  })
})

describe('createWsClient — dead after max failures', () => {
  it('transitions to dead after 5 consecutive failures', () => {
    const { client, states } = makeHarness()
    // Initial attempt + 4 retries, then the 5th failure → dead.
    // fail 1 (initial, never opened)
    latest().simulateDrop(1006)
    expect(client.getState()).toBe('reconnecting')
    // fail 2
    vi.advanceTimersByTime(1000)
    latest().simulateDrop(1006)
    // fail 3
    vi.advanceTimersByTime(2000)
    latest().simulateDrop(1006)
    // fail 4
    vi.advanceTimersByTime(4000)
    latest().simulateDrop(1006)
    // fail 5 — should hit dead
    vi.advanceTimersByTime(8000)
    latest().simulateDrop(1006)
    expect(client.getState()).toBe('dead')
    expect(states.at(-1)).toBe('dead')
  })

  it('successful open resets the failure counter', () => {
    const { client } = makeHarness()
    latest().simulateDrop(1006) // fail 1
    vi.advanceTimersByTime(1000)
    latest().simulateDrop(1006) // fail 2
    vi.advanceTimersByTime(2000)
    latest().simulateOpen()     // reset
    latest().simulateDrop(1006) // now "failure 1" of a new streak
    expect(client.getState()).toBe('reconnecting')
  })
})

describe('createWsClient — nudge', () => {
  it('is a no-op when state === open', () => {
    const { client } = makeHarness()
    latest().simulateOpen()
    const before = FakeSocket.instances.length
    client.nudge()
    expect(FakeSocket.instances.length).toBe(before)
    expect(client.getState()).toBe('open')
  })

  it('forces an immediate reconnect when reconnecting', () => {
    const { client } = makeHarness()
    latest().simulateDrop(1006)
    expect(client.getState()).toBe('reconnecting')
    const before = FakeSocket.instances.length
    client.nudge()
    expect(FakeSocket.instances.length).toBe(before + 1)
  })

  it('resets failure counter so a nudge-triggered resume does not inherit prior attempts', () => {
    const { client } = makeHarness()
    // Burn 3 failures
    latest().simulateDrop(1006)
    vi.advanceTimersByTime(1000)
    latest().simulateDrop(1006)
    vi.advanceTimersByTime(2000)
    latest().simulateDrop(1006)
    // Nudge — next attempt should be "fresh" (would require 5 more fails to hit dead)
    client.nudge()
    latest().simulateDrop(1006)  // fail 1 after nudge
    expect(client.getState()).toBe('reconnecting')
    vi.advanceTimersByTime(1000)
    latest().simulateDrop(1006)  // fail 2
    expect(client.getState()).toBe('reconnecting')
    vi.advanceTimersByTime(2000)
    latest().simulateDrop(1006)  // fail 3
    expect(client.getState()).toBe('reconnecting')
    vi.advanceTimersByTime(4000)
    latest().simulateDrop(1006)  // fail 4
    expect(client.getState()).toBe('reconnecting')
    vi.advanceTimersByTime(8000)
    latest().simulateDrop(1006)  // fail 5 → dead
    expect(client.getState()).toBe('dead')
  })
})

describe('createWsClient — close code 1000', () => {
  it('enters dead without reconnect on normal closure (1000)', () => {
    const { client } = makeHarness()
    latest().simulateOpen()
    latest().close(1000)
    expect(client.getState()).toBe('dead')
    // No retry scheduled
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances.length).toBe(1)
  })
})

describe('createWsClient — send', () => {
  it('drops silently when not open', () => {
    const { client } = makeHarness()
    // state=connecting; drop
    expect(() => client.send({ type: 'x' })).not.toThrow()
    expect(latest().sent).toEqual([])
    latest().simulateOpen()
    client.send({ type: 'x' })
    expect(latest().sent).toEqual([JSON.stringify({ type: 'x' })])
  })
})

describe('createWsClient — close()', () => {
  it('transitions to dead and does not reconnect', () => {
    const { client } = makeHarness()
    latest().simulateOpen()
    client.close()
    expect(client.getState()).toBe('dead')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances.length).toBe(1)
  })
})

describe('createWsClient — fatal application close codes', () => {
  it.each([4000, 4001, 4003, 4004, 4009])(
    'treats close code %i as terminal (no retry, state=dead)',
    (code) => {
      const { client } = makeHarness()
      latest().simulateDrop(code)
      expect(client.getState()).toBe('dead')
      vi.advanceTimersByTime(60_000)
      expect(FakeSocket.instances.length).toBe(1)
    },
  )
})

describe('createWsClient — ping watchdog', () => {
  function makeWatchdogHarness() {
    let currentTime = 1_000_000
    const messages: unknown[] = []
    const states: WsState[] = []
    const client: WsClient = createWsClient({
      url: 'ws://test.local/ws',
      onMessage: (m) => messages.push(m),
      onStateChange: (s) => states.push(s),
      WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
      now: () => currentTime,
    })
    return {
      client,
      messages,
      states,
      advance(ms: number) {
        currentTime += ms
        vi.advanceTimersByTime(ms)
      },
    }
  }

  it('closes the socket when >45s elapse with no inbound traffic', () => {
    const h = makeWatchdogHarness()
    const firstSock = latest()
    firstSock.simulateOpen()
    expect(h.client.getState()).toBe('open')
    // 40s — still under the 45s timeout
    h.advance(40_000)
    expect(h.client.getState()).toBe('open')
    expect(firstSock.readyState).toBe(FakeSocket.OPEN)
    // Cross the 45s threshold — next watchdog tick (every 5s) should close.
    // Advance just past the threshold so the retry hasn't fired yet.
    h.advance(6_000)
    expect(firstSock.readyState).toBe(FakeSocket.CLOSED)
    expect(h.client.getState()).toBe('reconnecting')
  })

  it('inbound messages refresh lastPingAt and prevent the watchdog from firing', () => {
    const h = makeWatchdogHarness()
    latest().simulateOpen()
    h.advance(30_000)
    latest().simulateMessage({ type: 'song:start' })
    h.advance(30_000) // Now 60s since open but only 30s since last message
    expect(latest().readyState).toBe(FakeSocket.OPEN)
    expect(h.client.getState()).toBe('open')
  })
})

describe('createWsClient — nudge on stale-but-open socket', () => {
  function makeClockHarness() {
    let currentTime = 1_000_000
    const client = createWsClient({
      url: 'ws://test.local/ws',
      onMessage: () => {},
      WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
      now: () => currentTime,
    })
    return {
      client,
      advance(ms: number) {
        currentTime += ms
        vi.advanceTimersByTime(ms)
      },
    }
  }

  it('force-closes the socket when lastPingAt is stale (iOS visibility-resume path)', () => {
    const h = makeClockHarness()
    latest().simulateOpen()
    // Simulate background suspend: socket still reports OPEN but no pings
    // have arrived in >20s (one server heartbeat interval).
    h.advance(25_000)
    const beforeCount = FakeSocket.instances.length
    h.client.nudge()
    expect(latest().readyState).toBe(FakeSocket.CLOSED)
    expect(h.client.getState()).toBe('reconnecting')
    // Reconnect attempt scheduled via backoff.
    h.advance(1_000)
    expect(FakeSocket.instances.length).toBe(beforeCount + 1)
  })

  it('remains a no-op on a healthy open socket (last message recent)', () => {
    const h = makeClockHarness()
    latest().simulateOpen()
    h.advance(5_000)
    latest().simulateMessage({ type: 'ping', t: 1 })
    h.advance(10_000) // only 10s since last message
    const before = FakeSocket.instances.length
    h.client.nudge()
    expect(latest().readyState).toBe(FakeSocket.OPEN)
    expect(h.client.getState()).toBe('open')
    expect(FakeSocket.instances.length).toBe(before)
  })
})
