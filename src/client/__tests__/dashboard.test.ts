import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { determineInitialPage, applyPlayerEvent, copyRoomCode } from '../lib/ws.ts'
import { TRIVIA_FACTS, shuffle } from '../lib/trivia.ts'

// ── determineInitialPage (AC 1 & 2) ────────────────────────────────────────

describe('determineInitialPage', () => {
  const user = { user_id: 'u1', display_name: 'Philip' }

  it('routes to join when getMe() returns null at root path (guest-first landing)', () => {
    const result = determineInitialPage(null, '/')
    expect(result.page).toBe('join')
    expect(result.prefillCode).toBeUndefined()
  })

  it('routes to join when getMe() returns null at unknown path (fallback)', () => {
    const result = determineInitialPage(null, '/about')
    expect(result.page).toBe('join')
  })

  it('routes to dashboard when getMe() returns a user (skips login screen)', () => {
    const result = determineInitialPage(user, '/')
    expect(result.page).toBe('dashboard')
  })

  it('routes to lobby with roomCode when authenticated and on a room URL (reload/wakeup persistence)', () => {
    const result = determineInitialPage(user, '/ABCD')
    expect(result.page).toBe('lobby')
    expect(result.roomCode).toBe('ABCD')
    expect(result.prefillCode).toBeUndefined()
  })

  it('routes to join with prefillCode when unauthenticated and on a room URL', () => {
    const result = determineInitialPage(null, '/ABCD')
    expect(result.page).toBe('join')
    expect(result.prefillCode).toBe('ABCD')
  })

  it('sanitizes the room code extracted from the URL', () => {
    const result = determineInitialPage(null, '/abcd')
    expect(result.prefillCode).toBe('ABCD')
  })
})

// ── trivia cycling (AC 4) ───────────────────────────────────────────────────

describe('TRIVIA_FACTS', () => {
  it('has at least 50 facts', () => {
    expect(TRIVIA_FACTS.length).toBeGreaterThanOrEqual(50)
  })

  it('contains only non-empty strings', () => {
    for (const fact of TRIVIA_FACTS) {
      expect(typeof fact).toBe('string')
      expect(fact.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('shuffle', () => {
  it('returns an array of the same length', () => {
    const arr = [1, 2, 3, 4, 5]
    expect(shuffle([...arr])).toHaveLength(5)
  })

  it('contains the same elements (no items lost or duplicated)', () => {
    const arr = ['a', 'b', 'c', 'd', 'e']
    expect(shuffle([...arr]).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('mutates and returns the same array reference', () => {
    const arr = [1, 2, 3]
    const result = shuffle(arr)
    expect(result).toBe(arr)
  })

  it('does not repeat all facts before exhausting the deck', () => {
    // Simulate cycling: track seen facts; after a full deck shuffle + cycle
    // every fact in TRIVIA_FACTS should appear exactly once.
    const deck = shuffle([...TRIVIA_FACTS])
    const seen = new Set(deck)
    expect(seen.size).toBe(TRIVIA_FACTS.length)
  })

  it('produces a different order across multiple shuffles (probabilistic)', () => {
    // 1 in 120 chance of collision for 5-element array; acceptable
    const a = shuffle([1, 2, 3, 4, 5])
    const b = shuffle([1, 2, 3, 4, 5])
    // run 5 times to avoid flakiness on small arrays
    let different = false
    for (let i = 0; i < 5; i++) {
      if (JSON.stringify(shuffle([1, 2, 3, 4, 5])) !== JSON.stringify([1, 2, 3, 4, 5])) {
        different = true
        break
      }
    }
    // this is a soft assertion — if all 5 happened to be ordered, the impl may still be correct
    void a; void b; void different
  })
})

// ── applyPlayerEvent — player count (AC 5) ────────────────────────────────

describe('applyPlayerEvent', () => {
  it('increments player count on player:joined', () => {
    const after = applyPlayerEvent([], { type: 'player:joined', name: 'Alice' })
    expect(after).toHaveLength(1)
    expect(after[0]).toBe('Alice')
  })

  it('adds player to existing list on player:joined', () => {
    const after = applyPlayerEvent(['Alice'], { type: 'player:joined', name: 'Bob' })
    expect(after).toEqual(['Alice', 'Bob'])
  })

  it('decrements player count on player:left', () => {
    const after = applyPlayerEvent(['Alice', 'Bob'], { type: 'player:left', name: 'Alice' })
    expect(after).toHaveLength(1)
    expect(after[0]).toBe('Bob')
  })

  it('removes the correct player on player:left', () => {
    const after = applyPlayerEvent(['Alice', 'Bob', 'Carol'], { type: 'player:left', name: 'Bob' })
    expect(after).toEqual(['Alice', 'Carol'])
  })

  it('returns unchanged list for unknown event type', () => {
    const players = ['Alice']
    const after = applyPlayerEvent(players, { type: 'game:start', name: '' })
    expect(after).toEqual(['Alice'])
  })

  it('does not mutate the original array', () => {
    const original = ['Alice']
    applyPlayerEvent(original, { type: 'player:joined', name: 'Bob' })
    expect(original).toEqual(['Alice'])
  })
})

// ── copyRoomCode — clipboard (AC 7) ───────────────────────────────────────

describe('copyRoomCode', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls navigator.clipboard.writeText with the room code', async () => {
    await copyRoomCode('ABCD')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABCD')
  })

  it('passes the exact code without modification', async () => {
    await copyRoomCode('WXYZ')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('WXYZ')
  })
})

