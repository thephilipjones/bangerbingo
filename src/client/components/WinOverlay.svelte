<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let {
    winnerName,
    winningSongs,
    isHost,
    onStartNextRound,
    onDismiss,
  }: {
    winnerName: string
    winningSongs: Array<{ title: string; artist: string }>
    isHost: boolean
    onStartNextRound: () => void
    onDismiss: () => void
  } = $props()

  let showCtas = $state(false)
  let ctaTimer: ReturnType<typeof setTimeout> | undefined
  let dismissTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    if (isHost) {
      ctaTimer = setTimeout(() => { showCtas = true }, 1500)
    } else {
      dismissTimer = setTimeout(() => { onDismiss() }, 5000)
    }
  })

  onDestroy(() => {
    clearTimeout(ctaTimer)
    clearTimeout(dismissTimer)
  })
</script>

<div class="win-overlay" role="dialog" aria-modal="true" aria-label="Bingo winner">
  <div class="confetti-container" aria-hidden="true">
    {#each [0,1,2,3,4,5,6,7,8,9,10,11] as i}
      <span class="confetti-piece" style="--delay: {i * 0.15}s; --hue: {(i * 30) % 360}deg; --left: {8 + (i * 7.5) % 84}%; --top: {-10 + (i % 3) * 5}%"></span>
    {/each}
  </div>

  <div class="content">
    <p class="bingo-label">BINGO!</p>
    <p class="winner-name">{winnerName} wins!</p>

    {#if winningSongs.length > 0}
      <ul class="winning-songs">
        {#each winningSongs as song}
          <li>{song.title} — {song.artist}</li>
        {/each}
      </ul>
    {/if}

    {#if isHost && showCtas}
      <div class="ctas">
        <button class="btn-primary" onclick={onStartNextRound}>Start Next Round</button>
        <button class="btn-secondary" onclick={onDismiss}>Dismiss</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .win-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0, 0, 0, 0.92);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
    color: #fff;
  }

  .confetti-container {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  @keyframes confetti-fall {
    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
    100% { transform: translateY(100vh) rotate(540deg); opacity: 0; }
  }

  .confetti-piece {
    position: absolute;
    top: var(--top);
    left: var(--left);
    width: 10px;
    height: 10px;
    background: hsl(var(--hue), 90%, 60%);
    border-radius: 2px;
    animation: confetti-fall 2s ease-in var(--delay) both;
  }

  .content {
    position: relative;
    text-align: center;
    padding: 32px 24px;
    max-width: 340px;
    width: 100%;
  }

  .bingo-label {
    font-size: 48px;
    font-weight: 900;
    color: #1db954;
    letter-spacing: 4px;
    margin-bottom: 8px;
  }

  .winner-name {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .winning-songs {
    list-style: none;
    margin: 0 0 28px;
    padding: 0;
    font-size: 14px;
    color: #ccc;
  }

  .winning-songs li {
    padding: 4px 0;
  }

  .ctas {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .btn-primary {
    background: #1db954;
    color: #000;
    border: none;
    border-radius: 24px;
    padding: 14px 24px;
    font-size: 16px;
    font-weight: 700;
    font-family: sans-serif;
    cursor: pointer;
    min-height: 44px;
  }

  .btn-secondary {
    background: transparent;
    color: #aaa;
    border: 1px solid #555;
    border-radius: 24px;
    padding: 12px 24px;
    font-size: 15px;
    font-family: sans-serif;
    cursor: pointer;
    min-height: 44px;
  }
</style>
