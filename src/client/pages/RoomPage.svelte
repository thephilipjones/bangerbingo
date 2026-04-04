<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import BingoCard from '../components/BingoCard.svelte'
  import WinOverlay from '../components/WinOverlay.svelte'
  import {
    initTiles,
    applyMask,
    startReveal,
    finishReveal,
    toggleMark,
    applyWinPath,
  } from '../lib/bingo.ts'
  import type { ClientTile, TitleRevealDelay } from '../lib/bingo.ts'

  let { name, code, ws }: { name: string; code: string; ws: WebSocket } = $props()

  type WinData = {
    winnerName: string
    winningTileIds: string[]
    songHistory: Array<{ trackId: string; title: string; artist: string; albumArtUrl: string; songIndex: number }>
  }

  const WIN_LINES: number[][] = [
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    [0,6,12,18,24], [4,8,12,16,20],
  ]

  let hostDisconnected = $state(false)
  let tiles = $state<ClientTile[]>([])
  let statusLine = $state('Waiting for the host to start a round...')
  let roundConfig = $state<{ titleRevealDelay: TitleRevealDelay } | null>(null)
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let isClaiming = $state(false)
  let winData = $state<WinData | null>(null)
  let roundEnded = $state(false)

  const hasBingo = $derived(
    tiles.length > 0 &&
    !roundEnded &&
    WIN_LINES.some(line => line.every(i => tiles[i]?.state === 'marked' || tiles[i]?.state === 'free'))
  )

  function handleTileClick(index: number) {
    tiles = toggleMark(tiles, index)
  }

  async function handleBingoClick() {
    isClaiming = true
    const claimedTileIds = tiles
      .filter(t => t.state === 'marked' || t.state === 'free')
      .map(t => t.free ? 'FREE' : t.trackId)

    try {
      const res = await fetch(`/api/rooms/${code}/round/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, claimedTileIds }),
      })
      if (res.status === 200) {
        // wait for round:win WS event; isClaiming cleared there
      } else {
        isClaiming = false // re-enable for retry (422) or silent reset (409, 4xx, 5xx)
      }
    } catch {
      isClaiming = false
    }
  }

  onMount(() => {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'host:disconnected') {
          hostDisconnected = true
        } else if (data.type === 'host:reconnected') {
          hostDisconnected = false
        } else if (data.type === 'round:start') {
          tiles = initTiles(data.card)
          roundConfig = { titleRevealDelay: data.titleRevealDelay }
          statusLine = 'Waiting for next song…'
          roundEnded = false
          winData = null
        } else if (data.type === 'song:start') {
          if (roundConfig) {
            tiles = applyMask(tiles, data.trackId, roundConfig.titleRevealDelay, data.songIndex)
          }
          statusLine = `Song ${data.songIndex + 1} of this round`
        } else if (data.type === 'song:reveal') {
          tiles = startReveal(tiles, data.trackId)
          clearTimeout(revealTimer)
          revealTimer = setTimeout(() => {
            tiles = finishReveal(tiles, data.trackId)
          }, 300)
        } else if (data.type === 'song:pause' || data.type === 'songs:exhausted') {
          statusLine = 'Waiting for next song…'
        } else if (data.type === 'round:win') {
          tiles = applyWinPath(tiles, data.winningTileIds)
          roundEnded = true
          isClaiming = false
          winData = { winnerName: data.winnerName, winningTileIds: data.winningTileIds, songHistory: data.songHistory }
        } else if (data.type === 'round:end') {
          tiles = []
          statusLine = 'Waiting for the host to start a round...'
          roundConfig = null
        }
      } catch {
        // ignore unparseable messages
      }
    }
  })

  onDestroy(() => {
    clearTimeout(revealTimer)
    ws.close()
  })

  function getWinningSongs(data: WinData) {
    return data.songHistory.filter(e => data.winningTileIds.includes(e.trackId))
  }
</script>

{#if hostDisconnected}
  <div class="host-disconnected-banner" role="status">
    Host disconnected — waiting for them to reconnect…
  </div>
{/if}

{#if winData !== null}
  <WinOverlay
    winnerName={winData.winnerName}
    winningSongs={getWinningSongs(winData)}
    isHost={false}
    onStartNextRound={() => {}}
    onDismiss={() => { winData = null }}
  />
{/if}

<main class="room-page">
  {#if tiles.length > 0}
    <BingoCard {tiles} onTileClick={handleTileClick} />
    {#if hasBingo && !isClaiming}
      <button class="bingo-btn" onclick={handleBingoClick}>Bingo!</button>
    {:else if isClaiming}
      <button class="bingo-btn bingo-btn--disabled" disabled>Claiming…</button>
    {/if}
    <p class="status-line" role="status">{statusLine}</p>
  {:else}
    <p role="status">{statusLine}</p>
  {/if}
</main>

<style>
  .host-disconnected-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #ff6b35;
    color: #fff;
    padding: 8px 16px;
    text-align: center;
    z-index: 100;
    font-size: 14px;
    font-family: sans-serif;
  }

  .room-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: sans-serif;
    padding: 16px;
    box-sizing: border-box;
  }

  .status-line {
    margin-top: 12px;
    font-size: 14px;
    color: #aaa;
    text-align: center;
  }

  .bingo-btn {
    margin-top: 16px;
    background: #1db954;
    color: #000;
    border: none;
    border-radius: 24px;
    padding: 14px 36px;
    font-size: 20px;
    font-weight: 900;
    font-family: sans-serif;
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
    letter-spacing: 1px;
  }

  .bingo-btn--disabled {
    background: #555;
    color: #999;
    cursor: default;
  }
</style>
