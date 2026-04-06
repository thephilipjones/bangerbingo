import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatSessionTimestamp } from '../lib/formatSessionTimestamp.ts'

describe('formatSessionTimestamp', () => {
  afterEach(() => vi.useRealTimers())

  it('formats a past date as M/D H:MMa or H:MMp', () => {
    // Use a fixed local time: noon on Jan 1 2026
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0, 0)) // 2pm local
    // A timestamp from a different day
    const ts = new Date(2026, 5, 15, 18, 45, 0).getTime()
    const out = formatSessionTimestamp(ts)
    expect(out).toMatch(/^\d{1,2}\/\d{1,2} \d{1,2}:\d{2}[ap]$/)
    expect(out).toBe('6/15 6:45p')
  })

  it('shows "Today" when the date matches today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 5, 10, 30, 0)) // Apr 5 2026, 10:30am local
    const ts = new Date(2026, 3, 5, 10, 30, 0).getTime()
    const out = formatSessionTimestamp(ts)
    expect(out).toBe('Today 10:30a')
  })

  it('handles midnight (12:00a) and noon (12:00p) correctly', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 2, 0, 0, 0)) // different day so no "Today"
    const midnight = new Date(2026, 0, 1, 0, 0, 0).getTime()
    const noon = new Date(2026, 0, 1, 12, 0, 0).getTime()
    expect(formatSessionTimestamp(midnight)).toBe('1/1 12:00a')
    expect(formatSessionTimestamp(noon)).toBe('1/1 12:00p')
  })

  it('different inputs produce different outputs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 1, 0, 0, 0))
    const a = formatSessionTimestamp(new Date(2026, 0, 1, 9, 0, 0).getTime())
    const b = formatSessionTimestamp(new Date(2026, 5, 15, 18, 45, 0).getTime())
    expect(a).not.toBe(b)
  })
})
