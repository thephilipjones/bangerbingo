import { describe, it, expect } from 'vitest'
import { computePlayerCount, isSelfRow } from '../lib/waitingRoom.ts'

describe('computePlayerCount', () => {
  it('returns 1 (host only) when no guests', () => {
    expect(computePlayerCount([])).toBe(1)
  })

  it('returns guest count + 1 for multiple guests', () => {
    expect(computePlayerCount(['Alice', 'Bob', 'Carol'])).toBe(4)
  })

  it('returns guest count + 1 for two guests', () => {
    expect(computePlayerCount(['Alice', 'Bob'])).toBe(3)
  })

  it('includes host in count for single guest', () => {
    expect(computePlayerCount(['Philip'])).toBe(2)
  })
})

describe('isSelfRow', () => {
  it('returns true for exact string match', () => {
    expect(isSelfRow('Philip', 'Philip')).toBe(true)
  })

  it('returns false for different names', () => {
    expect(isSelfRow('Alice', 'Philip')).toBe(false)
  })

  it('is case-sensitive (lowercase mismatch)', () => {
    expect(isSelfRow('philip', 'Philip')).toBe(false)
  })

  it('is case-sensitive (uppercase mismatch)', () => {
    expect(isSelfRow('PHILIP', 'Philip')).toBe(false)
  })

  it('returns false for partial match', () => {
    expect(isSelfRow('Phil', 'Philip')).toBe(false)
  })

  it('returns false for whitespace differences', () => {
    expect(isSelfRow('Philip ', 'Philip')).toBe(false)
  })
})
