import { describe, it, expect } from 'vitest'
import { formatSongOrdinal } from '../lib/gameHeader.ts'

describe('formatSongOrdinal', () => {
  it('returns "1st Song" for index 0', () => {
    expect(formatSongOrdinal(0)).toBe('1st Song')
  })

  it('returns "2nd Song" for index 1', () => {
    expect(formatSongOrdinal(1)).toBe('2nd Song')
  })

  it('returns "3rd Song" for index 2', () => {
    expect(formatSongOrdinal(2)).toBe('3rd Song')
  })

  it('returns "4th Song" for index 3', () => {
    expect(formatSongOrdinal(3)).toBe('4th Song')
  })

  it('returns "11th Song" for index 10 (special teen case)', () => {
    expect(formatSongOrdinal(10)).toBe('11th Song')
  })

  it('returns "12th Song" for index 11 (special teen case)', () => {
    expect(formatSongOrdinal(11)).toBe('12th Song')
  })

  it('returns "13th Song" for index 12 (special teen case)', () => {
    expect(formatSongOrdinal(12)).toBe('13th Song')
  })

  it('returns "21st Song" for index 20', () => {
    expect(formatSongOrdinal(20)).toBe('21st Song')
  })

  it('returns "101st Song" for index 100', () => {
    expect(formatSongOrdinal(100)).toBe('101st Song')
  })

  it('returns "112th Song" for index 111 (teen in hundreds)', () => {
    expect(formatSongOrdinal(111)).toBe('112th Song')
  })
})
