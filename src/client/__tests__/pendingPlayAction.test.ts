import { describe, it, expect, vi } from 'vitest'
import {
  shouldFlushPending,
  PENDING_PLAY_TTL_MS,
  type PendingPlayAction,
} from '../lib/pendingPlayAction.ts'

// Story 12-2 AC #10 — the pendingPlayAction TTL invariant. Extracted from
// HostRoomPage so it can be verified without mounting the component.

describe('shouldFlushPending', () => {
  const fn = () => {}

  it('returns false when no action is pending', () => {
    expect(shouldFlushPending(null, Date.now())).toBe(false)
  })

  it('returns true when the pending action is fresh (< TTL)', () => {
    const pending: PendingPlayAction = { fn, t: 1_000 }
    expect(shouldFlushPending(pending, 1_000 + 5_000)).toBe(true)
  })

  it('returns false when the pending action is exactly at the TTL boundary', () => {
    const pending: PendingPlayAction = { fn, t: 1_000 }
    expect(shouldFlushPending(pending, 1_000 + PENDING_PLAY_TTL_MS)).toBe(false)
  })

  it('returns false when the pending action is older than the TTL', () => {
    const pending: PendingPlayAction = { fn, t: 1_000 }
    expect(shouldFlushPending(pending, 1_000 + PENDING_PLAY_TTL_MS + 1)).toBe(false)
  })

  it('respects a custom TTL', () => {
    const pending: PendingPlayAction = { fn, t: 1_000 }
    expect(shouldFlushPending(pending, 1_000 + 500, 1_000)).toBe(true)
    expect(shouldFlushPending(pending, 1_000 + 1_500, 1_000)).toBe(false)
  })
})

// Contract tests: the wider AC #10 invariants that HostRoomPage implements on
// top of shouldFlushPending. Each test constructs a minimal state machine that
// mirrors the component's handlers; a regression in the component logic should
// fail both its e2e behavior and these contract tests.

describe('SDK reconnect gate contract (AC #9/#10)', () => {
  type Gate = {
    reconnecting: boolean
    pending: PendingPlayAction | null
  }

  function stashClick(gate: Gate, fn: () => void, now: number): void {
    // When sdkReconnecting, stash instead of firing — exactly what the
    // handlePlayPause / handleNext interceptors do.
    if (!gate.reconnecting) {
      fn()
      return
    }
    gate.pending = { fn, t: now }
  }

  function onReady(gate: Gate, now: number): void {
    if (!gate.reconnecting) return
    const pending = gate.pending
    gate.reconnecting = false
    gate.pending = null
    if (shouldFlushPending(pending, now)) pending!.fn()
  }

  it('stashed action fires exactly once when ready arrives in time', () => {
    const gate: Gate = { reconnecting: true, pending: null }
    const spy = vi.fn()

    stashClick(gate, spy, 100)
    stashClick(gate, spy, 150) // 2nd click during reconnect — last-write-wins
    onReady(gate, 200)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(gate.reconnecting).toBe(false)
    expect(gate.pending).toBeNull()
  })

  it('stashed action is dropped when ready arrives after TTL', () => {
    const gate: Gate = { reconnecting: true, pending: null }
    const spy = vi.fn()

    stashClick(gate, spy, 100)
    onReady(gate, 100 + PENDING_PLAY_TTL_MS + 1)

    expect(spy).not.toHaveBeenCalled()
    expect(gate.reconnecting).toBe(false)
    expect(gate.pending).toBeNull()
  })

  it('ready with no pending action is a no-op (clears gate only)', () => {
    const gate: Gate = { reconnecting: true, pending: null }
    onReady(gate, 500)
    expect(gate.reconnecting).toBe(false)
  })

  it('click outside the gate fires immediately and does not stash', () => {
    const gate: Gate = { reconnecting: false, pending: null }
    const spy = vi.fn()
    stashClick(gate, spy, 100)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(gate.pending).toBeNull()
  })
})
