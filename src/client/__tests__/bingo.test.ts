import { describe, it, expect } from 'vitest'
import {
  initTiles,
  applyMask,
  startReveal,
  finishReveal,
  toggleMark,
  applyWinPath,
  restoreMarks,
  cardFingerprint,
  isWinningLine,
} from '../lib/bingo.ts'
import type { Tile, ClientTile } from '../lib/bingo.ts'

function makeTiles(n = 25): Tile[] {
  return Array.from({ length: n }, (_, i) =>
    i === 12
      ? { trackId: '', title: '', artist: '', albumArtUrl: '', free: true as const }
      : { trackId: `track_${i}`, title: `Song ${i}`, artist: `Artist ${i}`, albumArtUrl: '' },
  )
}

describe('initTiles', () => {
  it('returns 25 ClientTiles with index 12 free and state=free', () => {
    const tiles = initTiles(makeTiles())
    expect(tiles).toHaveLength(25)
    expect(tiles[12].free).toBe(true)
    expect(tiles[12].state).toBe('free')
  })

  it('sets all non-free tiles to unmarked', () => {
    const tiles = initTiles(makeTiles())
    for (let i = 0; i < 25; i++) {
      if (i === 12) continue
      expect(tiles[i].state).toBe('unmarked')
    }
  })

  it('initialises masked=false and winPath=false for all tiles', () => {
    const tiles = initTiles(makeTiles())
    for (const tile of tiles) {
      expect(tile.masked).toBe(false)
      expect(tile.winPath).toBe(false)
    }
  })

  it('returns a new array (immutable)', () => {
    const raw = makeTiles()
    const tiles = initTiles(raw)
    expect(tiles).not.toBe(raw)
  })
})

describe('applyMask', () => {
  it('masks matching tile when titleRevealDelay > 0', () => {
    const tiles = initTiles(makeTiles())
    const result = applyMask(tiles, 'track_0', 5, 2)
    expect(result[0].masked).toBe(true)
    expect(result[0].songLabel).toBe('Song 3')
    expect(result[1].masked).toBe(false)
  })

  it('does NOT mask any tile when titleRevealDelay === 0', () => {
    const tiles = initTiles(makeTiles())
    const result = applyMask(tiles, 'track_0', 0, 0)
    expect(result.every((t) => !t.masked)).toBe(true)
  })

  it('masks matching tile when titleRevealDelay === null (never reveal)', () => {
    const tiles = initTiles(makeTiles())
    const result = applyMask(tiles, 'track_0', null, 0)
    expect(result[0].masked).toBe(true)
  })

  it('returns new array (immutable)', () => {
    const tiles = initTiles(makeTiles())
    const result = applyMask(tiles, 'track_0', 5, 0)
    expect(result).not.toBe(tiles)
    expect(tiles[0].masked).toBe(false) // original unchanged
  })
})

describe('startReveal', () => {
  it('sets revealing=true and keeps masked=true on matching tile (blur animates via CSS)', () => {
    const tiles = initTiles(makeTiles())
    const masked = applyMask(tiles, 'track_0', 5, 0)
    const result = startReveal(masked, 'track_0')
    expect(result[0].masked).toBe(true)
    expect(result[0].revealing).toBe(true)
  })

  it('returns new array (immutable)', () => {
    const tiles = initTiles(makeTiles())
    const result = startReveal(tiles, 'track_0')
    expect(result).not.toBe(tiles)
    expect(tiles[0].revealing).toBe(false)
  })
})

describe('finishReveal', () => {
  it('sets masked=false and revealing=false on matching tile', () => {
    const tiles = initTiles(makeTiles())
    const masked = applyMask(tiles, 'track_0', 5, 0)
    const started = startReveal(masked, 'track_0')
    const result = finishReveal(started, 'track_0')
    expect(result[0].masked).toBe(false)
    expect(result[0].revealing).toBe(false)
  })

  it('returns new array (immutable)', () => {
    const tiles = initTiles(makeTiles())
    const revealing = tiles.map((t, i) => (i === 0 ? { ...t, revealing: true } : t))
    const result = finishReveal(revealing, 'track_0')
    expect(result).not.toBe(revealing)
    expect(revealing[0].revealing).toBe(true) // original unchanged
  })
})

describe('toggleMark', () => {
  it('toggles unmarked → marked', () => {
    const tiles = initTiles(makeTiles())
    const result = toggleMark(tiles, 0)
    expect(result[0].state).toBe('marked')
  })

  it('toggles marked → unmarked', () => {
    const tiles = initTiles(makeTiles())
    const marked = toggleMark(tiles, 0)
    const result = toggleMark(marked, 0)
    expect(result[0].state).toBe('unmarked')
  })

  it('is a noop for the free tile (index 12)', () => {
    const tiles = initTiles(makeTiles())
    const result = toggleMark(tiles, 12)
    expect(result[12].state).toBe('free')
    expect(result[12].free).toBe(true)
  })

  it('returns new array (immutable)', () => {
    const tiles = initTiles(makeTiles())
    const result = toggleMark(tiles, 0)
    expect(result).not.toBe(tiles)
    expect(tiles[0].state).toBe('unmarked') // original unchanged
  })
})

describe('cardFingerprint', () => {
  it('returns the same value for the same card', () => {
    const card = makeTiles()
    expect(cardFingerprint(card)).toBe(cardFingerprint(card))
  })

  it('returns different values for different cards', () => {
    const card1 = makeTiles()
    const card2 = makeTiles().map((t, i) => i === 0 ? { ...t, trackId: 'different' } : t)
    expect(cardFingerprint(card1)).not.toBe(cardFingerprint(card2))
  })
})

describe('restoreMarks', () => {
  it('marks tiles whose trackId is in the set', () => {
    const tiles = initTiles(makeTiles())
    const result = restoreMarks(tiles, new Set(['track_0', 'track_1']))
    expect(result[0].state).toBe('marked')
    expect(result[1].state).toBe('marked')
    expect(result[2].state).toBe('unmarked')
  })

  it('never marks the free tile', () => {
    const tiles = initTiles(makeTiles())
    const result = restoreMarks(tiles, new Set(['track_0', '']))
    expect(result[12].state).toBe('free')
  })

  it('returns tiles unchanged when the set is empty', () => {
    const tiles = initTiles(makeTiles())
    const result = restoreMarks(tiles, new Set())
    expect(result).toBe(tiles)
  })

  it('returns new array (immutable) when marks are applied', () => {
    const tiles = initTiles(makeTiles())
    const result = restoreMarks(tiles, new Set(['track_0']))
    expect(result).not.toBe(tiles)
    expect(tiles[0].state).toBe('unmarked')
  })
})

describe('restoreMarks with playedIds', () => {
  it('restores a marked tile when its trackId is in the played set', () => {
    const tiles = initTiles(makeTiles())
    const result = restoreMarks(
      tiles,
      new Set(['track_0']),
      new Set(['track_0', 'track_99']),
    )
    expect(result[0].state).toBe('marked')
  })

  it('drops a marked tile when its trackId is NOT in the played set', () => {
    const tiles = initTiles(makeTiles())
    const result = restoreMarks(
      tiles,
      new Set(['track_0', 'track_1']),
      new Set(['track_1']),
    )
    expect(result[0].state).toBe('unmarked')
    expect(result[1].state).toBe('marked')
  })

  it('behaves like the un-filtered version when playedIds is omitted', () => {
    const tiles = initTiles(makeTiles())
    const result = restoreMarks(tiles, new Set(['track_0', 'track_1']))
    expect(result[0].state).toBe('marked')
    expect(result[1].state).toBe('marked')
  })
})

describe('isWinningLine', () => {
  function markTiles(tiles: ClientTile[], indices: number[]): ClientTile[] {
    let out = tiles
    for (const i of indices) out = toggleMark(out, i)
    return out
  }

  it('returns false when all 5 tiles are marked but none are played', () => {
    const tiles = markTiles(initTiles(makeTiles()), [0, 1, 2, 3, 4])
    expect(isWinningLine(tiles, [0, 1, 2, 3, 4], new Set())).toBe(false)
  })

  it('returns true for a middle-row line with FREE + 4 played-and-marked', () => {
    const tiles = markTiles(initTiles(makeTiles()), [10, 11, 13, 14])
    const played = new Set(['track_10', 'track_11', 'track_13', 'track_14'])
    expect(isWinningLine(tiles, [10, 11, 12, 13, 14], played)).toBe(true)
  })

  it('returns false when one marked tile in the line has not been played', () => {
    const tiles = markTiles(initTiles(makeTiles()), [0, 1, 2, 3, 4])
    const played = new Set(['track_0', 'track_1', 'track_2', 'track_3']) // no track_4
    expect(isWinningLine(tiles, [0, 1, 2, 3, 4], played)).toBe(false)
  })

  it('returns true for the TL-BR diagonal with FREE + 4 played-and-marked', () => {
    const tiles = markTiles(initTiles(makeTiles()), [0, 6, 18, 24])
    const played = new Set(['track_0', 'track_6', 'track_18', 'track_24'])
    expect(isWinningLine(tiles, [0, 6, 12, 18, 24], played)).toBe(true)
  })

  it('returns false when a tile in the line is played but not marked', () => {
    const tiles = markTiles(initTiles(makeTiles()), [0, 1, 2, 3]) // index 4 unmarked
    const played = new Set(['track_0', 'track_1', 'track_2', 'track_3', 'track_4'])
    expect(isWinningLine(tiles, [0, 1, 2, 3, 4], played)).toBe(false)
  })
})

describe('applyWinPath', () => {
  it('sets winPath=true on tiles whose trackId is in winningTileIds', () => {
    const tiles = initTiles(makeTiles())
    const result = applyWinPath(tiles, ['track_0', 'track_1'])
    expect(result[0].winPath).toBe(true)
    expect(result[1].winPath).toBe(true)
    expect(result[2].winPath).toBe(false)
  })

  it('sets winPath=true on the free tile when "FREE" is in winningTileIds', () => {
    const tiles = initTiles(makeTiles())
    const result = applyWinPath(tiles, ['FREE'])
    expect(result[12].winPath).toBe(true)
  })

  it('does not set winPath on free tile when "FREE" is not in list', () => {
    const tiles = initTiles(makeTiles())
    const result = applyWinPath(tiles, ['track_0'])
    expect(result[12].winPath).toBe(false)
  })

  it('returns new array (immutable)', () => {
    const tiles = initTiles(makeTiles())
    const result = applyWinPath(tiles, ['track_0'])
    expect(result).not.toBe(tiles)
    expect(tiles[0].winPath).toBe(false) // original unchanged
  })
})
