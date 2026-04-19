// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import type { ClientTile, Tile } from '../lib/bingo.ts'
import { initTiles } from '../lib/bingo.ts'
import type { WinData } from '../lib/gameState.svelte.ts'

function makeCard(): Tile[] {
  return Array.from({ length: 25 }, (_, i) =>
    i === 12
      ? { trackId: '', title: '', artist: '', albumArtUrl: '', free: true as const }
      : { trackId: `t${i}`, title: `Song ${i}`, artist: `Artist ${i}`, albumArtUrl: '' },
  )
}

function makeWinData(overrides: Partial<WinData> = {}): WinData {
  const card = makeCard()
  const winningTileIds = ['t0', 't1', 't2', 't3', 't4']
  return {
    winnerName: 'Alice',
    winningTileIds,
    songHistory: winningTileIds.map((id, i) => ({
      trackId: id, title: `Song ${i}`, artist: `Artist ${i}`, albumArtUrl: '', songIndex: i,
    })),
    winnerCard: card,
    ...overrides,
  }
}

const baseProps = {
  selfName: 'Alice',
  winData: makeWinData(),
  audioPreset: 'minimal' as const,
  ownTiles: [] as ClientTile[],
  playedTrackIds: new Set<string>(),
  playerCount: 3,
  code: 'ABCD',
  songIndex: 4,
  historyOpen: false,
  playersOpen: false,
  onPlayersClick: vi.fn(),
  onHistoryClick: vi.fn(),
  onLetItRide: vi.fn(),
  onChangeItUp: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GameOverView', () => {
  it('winner variant — renders winner name and BINGO! label in hype preset', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { getByText } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Alice',
      winData: makeWinData({ winnerName: 'Alice' }),
      audioPreset: 'hype',
    })
    expect(getByText('BINGO!')).toBeTruthy()
    expect(getByText('Alice')).toBeTruthy()
  })

  it('winner variant — deadpan preset renders quiet headline', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { getByText } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Alice',
      audioPreset: 'deadpan',
    })
    expect(getByText('...bingo.')).toBeTruthy()
    expect(getByText('...Alice wins.')).toBeTruthy()
  })

  it('loser variant — renders "<winner> got BINGO" and Their/Your toggle', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { getByText, getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Bob',
      ownTiles: initTiles(makeCard()),
    })
    expect(getByText('Alice got BINGO')).toBeTruthy()
    expect(getByRole('tab', { name: /their card/i })).toBeTruthy()
    expect(getByRole('tab', { name: /your card/i })).toBeTruthy()
  })

  it('loser variant — clicking Your card flips to own tiles', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Bob',
      ownTiles: initTiles(makeCard()),
    })
    const theirTab = getByRole('tab', { name: /their card/i })
    const yourTab = getByRole('tab', { name: /your card/i })
    expect(theirTab.getAttribute('aria-selected')).toBe('true')
    await fireEvent.click(yourTab)
    expect(yourTab.getAttribute('aria-selected')).toBe('true')
    expect(theirTab.getAttribute('aria-selected')).toBe('false')
  })

  it('host CTA — shows both "Let It Ride" and "Change It Up" buttons', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const onLetItRide = vi.fn()
    const onChangeItUp = vi.fn()
    const { getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'host',
      selfName: null,
      onLetItRide,
      onChangeItUp,
    })
    const rideBtn = getByRole('button', { name: /let it ride/i })
    const changeBtn = getByRole('button', { name: /change it up/i })
    await fireEvent.click(rideBtn)
    expect(onLetItRide).toHaveBeenCalledOnce()
    expect(onChangeItUp).not.toHaveBeenCalled()
    await fireEvent.click(changeBtn)
    expect(onChangeItUp).toHaveBeenCalledOnce()
    expect(onLetItRide).toHaveBeenCalledOnce()
  })

  it('guest — always shows waiting status, no host CTAs', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { queryByRole, getByText } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Alice',
    })
    expect(queryByRole('button', { name: /let it ride/i })).toBeNull()
    expect(queryByRole('button', { name: /change it up/i })).toBeNull()
    expect(getByText(/waiting for the host/i)).toBeTruthy()
  })

  it('guest loser — shows waiting status, no host CTAs', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { queryByRole, getByText } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Bob',
      ownTiles: initTiles(makeCard()),
    })
    expect(queryByRole('button', { name: /let it ride/i })).toBeNull()
    expect(getByText(/waiting for the host/i)).toBeTruthy()
  })

  it('renders nextRoundError when provided', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'host',
      selfName: null,
      nextRoundError: "Couldn't start next round — try again.",
    })
    expect(getByRole('alert').textContent).toContain("Couldn't start next round")
  })
})
