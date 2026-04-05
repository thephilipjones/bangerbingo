import { describe, it, expect } from 'vitest'
import { computePlayerCount, isSelfRow } from '../lib/waitingRoom.ts'

describe('computePlayerCount', () => {
  it('returns 0 when no guests and no host', () => {
    expect(computePlayerCount([], null)).toBe(0)
  })

  it('returns 1 when no guests but host is present', () => {
    expect(computePlayerCount([], 'Sarah')).toBe(1)
  })

  it('returns guest count when no host', () => {
    expect(computePlayerCount(['Alice', 'Bob', 'Carol'], null)).toBe(3)
  })

  it('returns guest count + 1 when host is present', () => {
    expect(computePlayerCount(['Alice', 'Bob'], 'Sarah')).toBe(3)
  })

  it('includes host in count for single guest', () => {
    expect(computePlayerCount(['Philip'], 'Sarah')).toBe(2)
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
