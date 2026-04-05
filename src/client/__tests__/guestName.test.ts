import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getStoredGuestName, setStoredGuestName } from '../lib/guestName.ts'

describe('guestName localStorage helper', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { for (const k of Object.keys(store)) delete store[k] },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns empty string when no name is stored', () => {
    expect(getStoredGuestName()).toBe('')
  })

  it('round-trips a name under the bangerbingo.guestName key', () => {
    setStoredGuestName('Philip')
    expect(store['bangerbingo.guestName']).toBe('Philip')
    expect(getStoredGuestName()).toBe('Philip')
  })

  it('overwrites previous value on repeat write', () => {
    setStoredGuestName('Alice')
    setStoredGuestName('Bob')
    expect(getStoredGuestName()).toBe('Bob')
  })

  it('trims whitespace on write and read', () => {
    setStoredGuestName('  Philip  ')
    expect(store['bangerbingo.guestName']).toBe('Philip')
    expect(getStoredGuestName()).toBe('Philip')
  })

  it('trims legacy whitespace-padded values on read', () => {
    store['bangerbingo.guestName'] = '  Old  '
    expect(getStoredGuestName()).toBe('Old')
  })

  it('swallows setItem throws silently (Safari private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => {},
      clear: () => {},
    })
    expect(() => setStoredGuestName('Philip')).not.toThrow()
  })

  it('swallows getItem throws silently and returns empty string', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    })
    expect(getStoredGuestName()).toBe('')
  })

  it('returns empty string when localStorage itself is undefined', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(getStoredGuestName()).toBe('')
    expect(() => setStoredGuestName('Philip')).not.toThrow()
  })
})
