<script lang="ts">
  import { onMount } from 'svelte'
  import { getTheme, toggleTheme, type ThemeMode } from '../theme.ts'

  let mode: ThemeMode = $state('light')

  onMount(() => {
    mode = getTheme()
  })

  function handleClick() {
    mode = toggleTheme()
  }
</script>

<button
  class="toggle"
  type="button"
  aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
  aria-pressed={mode === 'dark'}
  onclick={handleClick}
>
  {#if mode === 'dark'}
    <!-- Sun: currently dark → offer light -->
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="12" y1="2"  x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2"  y1="12" x2="5"  y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.5"  y1="4.5"  x2="6.6"  y2="6.6" />
        <line x1="17.4" y1="17.4" x2="19.5" y2="19.5" />
        <line x1="4.5"  y1="19.5" x2="6.6"  y2="17.4" />
        <line x1="17.4" y1="6.6"  x2="19.5" y2="4.5" />
      </g>
    </svg>
  {:else}
    <!-- Moon: currently light → offer dark -->
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  {/if}
</button>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    color: var(--fg);
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .toggle svg {
    width: 20px;
    height: 20px;
  }
</style>
