<script lang="ts">
  type Variant = 'full' | 'mark-only' | 'wordmark-only'
  interface Props {
    size?: number
    variant?: Variant
    title?: string
  }
  let { size = 32, variant = 'full', title = 'BangerBingo' }: Props = $props()

  // BB monogram — two geometric Bs echoing the Space Grotesk wordmark:
  // flat-edged bumps, squared stem corners, slight terminal flares.
</script>

<span class="logo" style="--logo-size: {size}px" aria-label={title}>
  {#if variant !== 'wordmark-only'}
    <svg class="mark" viewBox="0 0 100 100" role="img" aria-hidden={variant === 'full'} focusable="false">
      <title>{title}</title>
      <!-- Forward B top-left + mirrored B bottom-right, rendered in a bold editorial serif. -->
      <text class="mark-b" x="25" y="62" text-anchor="middle">B</text>
      <text class="mark-b" x="75" y="96" text-anchor="middle" transform="matrix(-1 0 0 1 150 0)">B</text>
    </svg>
  {/if}
  {#if variant !== 'mark-only'}
    <span class="wordmark"
      ><span class="word"><span class="accent">B</span>ANGER</span
      ><span class="word"><span class="accent">B</span>INGO</span
      ></span>
  {/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    max-width: 100%;
    color: inherit;
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    line-height: 1;
  }
  .mark {
    width: var(--logo-size);
    height: var(--logo-size);
    flex: 0 0 auto;
  }
  .mark-b {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 82px;
    fill: currentColor;
  }
  .wordmark {
    font-size: calc(var(--logo-size) * 0.85);
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    max-width: 100%;
    line-height: 0.9;
  }
  .word {
    white-space: nowrap;
  }
  .accent {
    color: var(--accent);
  }
</style>
