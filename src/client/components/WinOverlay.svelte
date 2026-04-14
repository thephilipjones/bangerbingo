<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { AudioPreset } from '../lib/api.ts'

  let {
    winnerName,
    winningSongs,
    isHost,
    onStartNextRound,
    onDismiss,
    selfName = null,
    audioPreset = 'minimal',
  }: {
    winnerName: string
    winningSongs: Array<{ title: string; artist: string }>
    isHost: boolean
    onStartNextRound: () => void
    onDismiss: () => void
    selfName?: string | null
    audioPreset?: AudioPreset
  } = $props()

  let showCtas = $state(false)
  let showGuestDismiss = $state(false)
  let ctaTimer: ReturnType<typeof setTimeout> | undefined
  let guestTimer: ReturnType<typeof setTimeout> | undefined

  // Normalize any stray/unknown value to 'minimal' so a missing union member
  // can't render an empty overlay.
  const effectivePreset = $derived<AudioPreset>(
    audioPreset === 'hype' || audioPreset === 'deadpan' ? audioPreset : 'minimal'
  )
  const isWinner = $derived(!isHost && selfName !== null && selfName === winnerName)
  const isOtherGuest = $derived(!isHost && !isWinner)

  onMount(() => {
    if (isHost) {
      ctaTimer = setTimeout(() => { showCtas = true }, 1500)
    } else if (isWinner) {
      showGuestDismiss = true
    } else {
      guestTimer = setTimeout(() => { showGuestDismiss = true }, 2000)
    }
  })

  onDestroy(() => {
    clearTimeout(ctaTimer)
    clearTimeout(guestTimer)
  })
</script>

<div
  class="win-overlay"
  class:preset-minimal={effectivePreset === 'minimal'}
  role="dialog"
  aria-modal="true"
  aria-label="Bingo winner"
>
  {#if effectivePreset === 'hype'}
    <div class="confetti-container" aria-hidden="true">
      {#each [0,1,2,3,4,5,6,7,8,9,10,11] as i}
        <span class="confetti-piece" style="--delay: {i * 0.15}s; --hue: {(i * 30) % 360}deg; --left: {8 + (i * 7.5) % 84}%; --top: {-10 + (i % 3) * 5}%"></span>
      {/each}
    </div>
  {/if}

  <div class="content">
    {#if effectivePreset === 'hype'}
      <p class="bingo-label">BINGO!</p>
      <p class="winner-name">{winnerName} wins!</p>
    {:else if effectivePreset === 'deadpan'}
      <p class="bingo-label bingo-label--deadpan">...bingo.</p>
      <p class="winner-name">{winnerName} wins.</p>
    {:else}
      <p class="winner-name winner-name--minimal">{winnerName}</p>
      <p class="minimal-subtitle">Won this round</p>
    {/if}

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
    {:else if !isHost && showGuestDismiss}
      <div class="ctas">
        <button class="btn-secondary" onclick={onDismiss}>{isWinner ? '🎉 Dismiss' : 'Dismiss'}</button>
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

  .win-overlay.preset-minimal {
    background: rgba(0, 0, 0, 0.85);
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

  .bingo-label--deadpan {
    font-size: 32px;
    font-weight: 400;
    color: #aaa;
    letter-spacing: 0;
  }

  .winner-name {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .winner-name--minimal {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
  }

  .minimal-subtitle {
    font-size: 14px;
    color: #666;
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
