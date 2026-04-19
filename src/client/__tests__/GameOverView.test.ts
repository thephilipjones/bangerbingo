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
  continuousMode: true,
  ownTiles: [] as ClientTile[],
  playedTrackIds: new Set<string>(),
  playerCount: 3,
  code: 'ABCD',
  songIndex: 4,
  historyOpen: false,
  playersOpen: false,
  onPlayersClick: vi.fn(),
  onHistoryClick: vi.fn(),
  onStartNextRound: vi.fn(),
  onReconfigure: vi.fn(),
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

  it('host CTA — shows "Start Next Round" when continuous mode is on', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const onStartNextRound = vi.fn()
    const { getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'host',
      selfName: null,
      continuousMode: true,
      onStartNextRound,
    })
    const btn = getByRole('button', { name: /start next round/i })
    await fireEvent.click(btn)
    expect(onStartNextRound).toHaveBeenCalledOnce()
  })

  it('host CTA — shows "Change Settings & Start" when continuous mode is off', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const onReconfigure = vi.fn()
    const { getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'host',
      selfName: null,
      continuousMode: false,
      onReconfigure,
    })
    const btn = getByRole('button', { name: /change settings & start/i })
    await fireEvent.click(btn)
    expect(onReconfigure).toHaveBeenCalledOnce()
  })

  it('guest winner + continuous on — shows "Start Next Round" CTA', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Alice',
      continuousMode: true,
    })
    expect(getByRole('button', { name: /start next round/i })).toBeTruthy()
  })

  it('guest winner + continuous off — shows waiting status, no CTA', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { queryByRole, getByText } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Alice',
      continuousMode: false,
    })
    expect(queryByRole('button', { name: /start next round/i })).toBeNull()
    expect(getByText(/waiting for the host/i)).toBeTruthy()
  })

  it('guest loser — always shows waiting status, no CTA', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { queryByRole, getByText } = render(GameOverView, {
      ...baseProps,
      role: 'guest',
      selfName: 'Bob',
      continuousMode: true,
      ownTiles: initTiles(makeCard()),
    })
    expect(queryByRole('button', { name: /start next round/i })).toBeNull()
    expect(getByText(/waiting for the host/i)).toBeTruthy()
  })

  it('renders errorMessage when provided', async () => {
    const { default: GameOverView } = await import('../components/GameOverView.svelte')
    const { getByRole } = render(GameOverView, {
      ...baseProps,
      role: 'host',
      selfName: null,
      continuousMode: true,
      errorMessage: "Couldn't start next round — try again.",
    })
    expect(getByRole('alert').textContent).toContain("Couldn't start next round")
  })
})
