<script lang="ts">
  type Variant = 'full' | 'mark-only' | 'wordmark-only'
  interface Props {
    size?: number
    variant?: Variant
    title?: string
  }
  let { size = 32, variant = 'full', title = 'BangerBingo' }: Props = $props()

  // Placeholder BB monogram — interlocked Bs sharing a stem. Step 1.9 will
  // replace with final mark SVG. currentColor so it inherits --fg / --accent.
</script>

<span class="logo" style="--logo-size: {size}px" aria-label={title}>
  {#if variant !== 'wordmark-only'}
    <svg class="mark" viewBox="0 0 32 32" role="img" aria-hidden={variant === 'full'} focusable="false">
      <title>{title}</title>
      <!-- Left B -->
      <path
        fill="currentColor"
        d="M4 4h7a5 5 0 0 1 3.5 8.5A5 5 0 0 1 11 21H4V4Zm3 3v4h4a2 2 0 1 0 0-4H7Zm0 7v4h4a2 2 0 1 0 0-4H7Z"
      />
      <!-- Right B, mirrored + offset -->
      <path
        fill="currentColor"
        d="M28 11h-7a5 5 0 0 0-3.5 8.5A5 5 0 0 0 21 28h7V11Zm-3 3v4h-4a2 2 0 1 1 0-4h4Zm0 7v4h-4a2 2 0 1 1 0-4h4Z"
      />
    </svg>
  {/if}
  {#if variant !== 'mark-only'}
    <span class="wordmark">BANGER<span class="accent">B</span>INGO</span>
  {/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
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
  .wordmark {
    font-size: calc(var(--logo-size) * 0.85);
  }
  .accent {
    color: var(--accent);
  }
</style>
