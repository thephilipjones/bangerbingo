import { describe, it, expect } from 'vitest'
import { extractPlaylistId } from '../lib/playlistUrl.ts'

const VALID_ID = '37i9dQZF1DXcBWIGoYBM5M' // exactly 22 Base62 chars

describe('extractPlaylistId', () => {
  // ── Valid inputs ─────────────────────────────────────────────────────────

  it('extracts ID from plain open.spotify.com/playlist URL', () => {
    expect(extractPlaylistId(`https://open.spotify.com/playlist/${VALID_ID}`)).toBe(VALID_ID)
  })

  it('extracts ID from URL with query string', () => {
    expect(
      extractPlaylistId(`https://open.spotify.com/playlist/${VALID_ID}?si=abc123`),
    ).toBe(VALID_ID)
  })

  it('extracts ID from URL with locale prefix (intl-de)', () => {
    expect(
      extractPlaylistId(`https://open.spotify.com/intl-de/playlist/${VALID_ID}`),
    ).toBe(VALID_ID)
  })

  it('extracts ID from embed URL', () => {
    expect(
      extractPlaylistId(`https://open.spotify.com/embed/playlist/${VALID_ID}`),
    ).toBe(VALID_ID)
  })

  it('extracts ID from spotify:playlist URI', () => {
    expect(extractPlaylistId(`spotify:playlist:${VALID_ID}`)).toBe(VALID_ID)
  })

  it('extracts bare 22-char Base62 ID', () => {
    expect(extractPlaylistId(VALID_ID)).toBe(VALID_ID)
  })

  it('trims surrounding whitespace from a pasted URL', () => {
    expect(
      extractPlaylistId(`  https://open.spotify.com/playlist/${VALID_ID}  `),
    ).toBe(VALID_ID)
  })

  // ── Invalid inputs ───────────────────────────────────────────────────────

  it('returns null for a plain keyword query', () => {
    expect(extractPlaylistId('80s pop hits')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractPlaylistId('')).toBeNull()
  })

  it('returns null for a Spotify track URL', () => {
    expect(
      extractPlaylistId(`https://open.spotify.com/track/${VALID_ID}`),
    ).toBeNull()
  })

  it('returns null for a malformed URL missing playlist segment', () => {
    expect(extractPlaylistId('https://open.spotify.com/playlist/')).toBeNull()
  })

  it('returns null for an ID that is too short (21 chars)', () => {
    expect(extractPlaylistId(VALID_ID.slice(0, 21))).toBeNull()
  })

  it('returns null for an ID that is too long (23 chars)', () => {
    expect(extractPlaylistId(VALID_ID + 'X')).toBeNull()
  })

  it('returns null for a spotify: URI with wrong type', () => {
    expect(extractPlaylistId(`spotify:track:${VALID_ID}`)).toBeNull()
  })

  it('returns null for a non-spotify URL', () => {
    expect(
      extractPlaylistId(`https://www.spotify.com/playlist/${VALID_ID}`),
    ).toBeNull()
  })

  it('returns null for a spoofed hostname (open.spotify.com.evil.com)', () => {
    expect(
      extractPlaylistId(`https://open.spotify.com.evil.com/playlist/${VALID_ID}`),
    ).toBeNull()
  })
})
