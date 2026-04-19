<script lang="ts">
  import BingoCard from './BingoCard.svelte'
  import GameHeader from './GameHeader.svelte'
  import type { AudioPreset } from '../lib/api.ts'
  import type { ClientTile, Tile } from '../lib/bingo.ts'
  import { initTiles, applyWinPath } from '../lib/bingo.ts'
  import type { WinData } from '../lib/gameState.svelte.ts'

  let {
    role,
    selfName,
    winData,
    audioPreset,
    continuousMode,
    ownTiles,
    playedTrackIds,
    playerCount,
    code,
    songIndex,
    historyOpen,
    playersOpen,
    onPlayersClick,
    onHistoryClick,
    onStartNextRound,
    onReconfigure,
    errorMessage = null,
  }: {
    role: 'host' | 'guest'
    selfName: string | null
    winData: WinData
    audioPreset: AudioPreset
    continuousMode: boolean
    ownTiles: ClientTile[]
    playedTrackIds: Set<string>
    playerCount: number
    code: string
    songIndex: number | null
    historyOpen: boolean
    playersOpen: boolean
    onPlayersClick: () => void
    onHistoryClick: () => void
    onStartNextRound: () => void
    onReconfigure: () => void
    errorMessage?: string | null
  } = $props()

  const isWinner = $derived(role === 'guest' && selfName !== null && selfName === winData.winnerName)

  const effectivePreset = $derived<AudioPreset>(
    audioPreset === 'hype' || audioPreset === 'deadpan' ? audioPreset : 'minimal'
  )

  let loserView = $state<'their' | 'your'>('their')

  const winnerTiles = $derived(applyWinPath(initTiles(winData.winnerCard), winData.winningTileIds))
  const winningSongs = $derived(
    winData.winningTileIds
      .map((id) => winData.songHistory.find((e) => e.trackId === id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
  )

  const showHostCta = $derived(role === 'host')
  const showWinnerCta = $derived(role === 'guest' && isWinner && continuousMode)
  const showWaitingStatus = $derived(
    (role === 'guest' && !isWinner) || (role === 'guest' && isWinner && !continuousMode)
  )
</script>

<div class="game-over">
  <GameHeader
    {playerCount}
    {code}
    {songIndex}
    {historyOpen}
    {playersOpen}
    {onPlayersClick}
    {onHistoryClick}
  />

  <div class="content">
    {#if isWinner}
      {#if effectivePreset === 'hype'}
        <p class="bingo-label">BINGO!</p>
        <p class="winner-name">{winData.winnerName}</p>
      {:else if effectivePreset === 'deadpan'}
        <p class="bingo-label bingo-label--deadpan">...bingo.</p>
        <p class="winner-name">...{winData.winnerName} wins.</p>
      {:else}
        <p class="winner-name winner-name--minimal">{winData.winnerName}</p>
        <p class="minimal-subtitle">Won this round</p>
      {/if}

      <BingoCard tiles={winnerTiles} mode="gameover-winner" />

      {#if winningSongs.length > 0}
        <ul class="winning-songs">
          {#each winningSongs as song}
            <li>{song.title} — {song.artist}</li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="loser-headline">{winData.winnerName} got BINGO</p>

      <div class="pill-group" role="tablist" aria-label="Card view">
        <button
          class="pill"
          class:active={loserView === 'their'}
          role="tab"
          aria-selected={loserView === 'their'}
          onclick={() => (loserView = 'their')}
        >Their card</button>
        <button
          class="pill"
          class:active={loserView === 'your'}
          role="tab"
          aria-selected={loserView === 'your'}
          onclick={() => (loserView = 'your')}
        >Your card</button>
      </div>

      {#if loserView === 'their'}
        <BingoCard tiles={winnerTiles} mode="gameover-loser-their" />
      {:else}
        <BingoCard tiles={ownTiles} mode="gameover-loser-your" {playedTrackIds} />
      {/if}

      {#if winningSongs.length > 0}
        <ul class="winning-songs">
          {#each winningSongs as song}
            <li>{song.title} — {song.artist}</li>
          {/each}
        </ul>
      {/if}
    {/if}

    <div class="cta-area">
      {#if showHostCta}
        {#if continuousMode}
          <button class="btn-primary" onclick={onStartNextRound}>Start Next Round</button>
        {:else}
          <button class="btn-primary" onclick={onReconfigure}>Change Settings &amp; Start</button>
        {/if}
      {:else if showWinnerCta}
        <button class="btn-primary" onclick={onStartNextRound}>Start Next Round</button>
      {:else if showWaitingStatus}
        <p class="status-line">Waiting for the host to start the next round.</p>
      {/if}

      {#if errorMessage}
        <p class="error-line" role="alert">{errorMessage}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .game-over {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
  }

  .bingo-label {
    font-family: var(--font-display);
    font-size: 48px;
    font-weight: 900;
    color: var(--accent);
    letter-spacing: 4px;
    text-transform: uppercase;
    margin: 0;
    text-align: center;
  }

  .bingo-label--deadpan {
    font-size: 32px;
    font-weight: 400;
    color: var(--fg-muted);
    letter-spacing: 0;
    text-transform: none;
  }

  .winner-name {
    font-size: 24px;
    font-weight: 700;
    margin: 0;
    text-align: center;
    color: var(--fg);
  }

  .winner-name--minimal {
    font-size: 20px;
    font-weight: 700;
    color: var(--fg);
    margin: 0;
    text-align: center;
  }

  .minimal-subtitle {
    font-size: 14px;
    color: var(--fg-muted);
    margin: 0;
    text-align: center;
  }

  .loser-headline {
    font-size: 18px;
    font-weight: 500;
    color: var(--fg);
    margin: 0;
    text-align: center;
  }

  .pill-group {
    display: inline-flex;
    border: var(--rule-thin) solid var(--rule);
    border-radius: 4px;
    overflow: hidden;
  }

  .pill {
    padding: 10px 16px;
    min-height: 44px;
    min-width: 44px;
    background: var(--bg);
    color: var(--fg);
    border: none;
    cursor: pointer;
    font-size: 14px;
  }

  .pill + .pill {
    border-left: var(--rule-thin) solid var(--rule);
  }

  .pill.active {
    background: var(--fg);
    color: var(--bg);
  }

  .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .winning-songs {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px;
    color: var(--fg-muted);
    text-align: center;
  }

  .winning-songs li {
    padding: 4px 0;
  }

  .cta-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-fg);
    border: var(--rule-thick) solid var(--accent);
    padding: 14px 36px;
    font-size: 16px;
    font-weight: 700;
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    cursor: pointer;
    min-height: 44px;
  }
  .btn-primary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .status-line {
    font-size: 14px;
    color: var(--fg-muted);
    margin: 0;
    text-align: center;
  }

  .error-line {
    font-size: 13px;
    color: var(--danger, var(--accent));
    margin: 0;
    text-align: center;
  }

  @media (min-width: 768px) {
    .content {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--space-5);
      gap: var(--space-4);
    }
  }
</style>
