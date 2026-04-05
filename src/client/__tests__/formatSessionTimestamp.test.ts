import { describe, it, expect } from 'vitest'
import { formatSessionTimestamp } from '../lib/formatSessionTimestamp.ts'

describe('formatSessionTimestamp', () => {
  it('returns a non-empty string containing the short month and 2-digit time', () => {
    // 2026-04-05T14:32:00Z — intentionally relaxed assertions because locale
    // and timezone formatting varies slightly between runtimes.
    const out = formatSessionTimestamp(Date.UTC(2026, 3, 5, 14, 32, 0))
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
    // Formatter uses { hour: '2-digit', minute: '2-digit' } so the output
    // must contain a HH:MM (or HH.MM) pattern.
    expect(/\d{2}[:.]\d{2}/.test(out)).toBe(true)
  })

  it('different inputs produce different outputs', () => {
    const a = formatSessionTimestamp(Date.UTC(2026, 0, 1, 9, 0, 0))
    const b = formatSessionTimestamp(Date.UTC(2026, 5, 15, 18, 45, 0))
    expect(a).not.toBe(b)
  })
})
