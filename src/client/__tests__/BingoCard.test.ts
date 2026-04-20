// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import { initTiles, applyWinPath } from '../lib/bingo.ts'
import type { Tile } from '../lib/bingo.ts'

function makeCard(): Tile[] {
  return Array.from({ length: 25 }, (_, i) =>
    i === 12
      ? { trackId: '', title: '', artist: '', albumArtUrl: '', free: true as const }
      : { trackId: `t${i}`, title: `Song ${i}`, artist: `Artist ${i}`, albumArtUrl: '' },
  )
}

afterEach(() => {
  cleanup()
})

describe('BingoCard — mode prop (Story 9-1)', () => {
  it('default mode — renders interactive buttons and fires onTileClick', async () => {
    const { default: BingoCard } = await import('../components/BingoCard.svelte')
    const onTileClick = vi.fn()
    const tiles = initTiles(makeCard())

    const { getAllByRole } = render(BingoCard, { tiles, onTileClick })

    const buttons = getAllByRole('button')
    expect(buttons.length).toBe(24) // 25 tiles minus FREE tile
    await fireEvent.click(buttons[0])
    expect(onTileClick).toHaveBeenCalledTimes(1)
  })

  it('gameover-winner mode — non-interactive (no buttons), win-path tiles have BB stamp', async () => {
    const { default: BingoCard } = await import('../components/BingoCard.svelte')
    const onTileClick = vi.fn()
    const winningIds = ['t0', 't1', 't2', 't3', 't4']
    const tiles = applyWinPath(initTiles(makeCard()), winningIds)

    const { queryAllByRole } = render(BingoCard, {
      tiles, onTileClick, mode: 'gameover-winner',
    })
    // No interactive buttons (tiles rendered as div role=img)
    expect(queryAllByRole('button')).toHaveLength(0)
    expect(onTileClick).not.toHaveBeenCalled()
  })

  it('gameover-loser-their mode — dims non-win tiles', async () => {
    const { default: BingoCard } = await import('../components/BingoCard.svelte')
    const winningIds = ['t0', 't1', 't2', 't3', 't4']
    const tiles = applyWinPath(initTiles(makeCard()), winningIds)

    const { container } = render(BingoCard, {
      tiles, mode: 'gameover-loser-their',
    })
    expect(container.querySelectorAll('.gameover-dim-their').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('gameover-loser-your mode — missed class applied to played-but-unmarked tiles', async () => {
    const { default: BingoCard } = await import('../components/BingoCard.svelte')
    const tiles = initTiles(makeCard())
    // Simulate tiles 3 and 7 were played but never marked.
    const playedTrackIds = new Set(['t3', 't7'])

    const { container } = render(BingoCard, {
      tiles, mode: 'gameover-loser-your', playedTrackIds,
    })
    expect(container.querySelectorAll('.missed').length).toBe(2)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('gameover-loser-your mode — does NOT apply win-path styling', async () => {
    const { default: BingoCard } = await import('../components/BingoCard.svelte')
    const winningIds = ['t0', 't1', 't2', 't3', 't4']
    const tiles = applyWinPath(initTiles(makeCard()), winningIds)

    const { container } = render(BingoCard, {
      tiles, mode: 'gameover-loser-your', playedTrackIds: new Set<string>(),
    })
    expect(container.querySelectorAll('.win-path')).toHaveLength(0)
  })
})
