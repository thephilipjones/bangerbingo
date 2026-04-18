<script lang="ts">
  import type { Snippet } from 'svelte'

  type Variant = 'paper' | 'ink'

  interface Props {
    variant?: Variant
    header?: Snippet
    footer?: Snippet
    children: Snippet
  }

  let { variant = 'paper', header, footer, children }: Props = $props()
</script>

<section class="card card--{variant}">
  {#if header}
    <header class="card__header">{@render header()}</header>
  {/if}
  <div class="card__body">{@render children()}</div>
  {#if footer}
    <footer class="card__footer">{@render footer()}</footer>
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    border: var(--rule-thin) solid var(--rule);
    border-radius: var(--radius-0);
  }
  .card--paper {
    background: var(--bg-2);
    color: var(--fg);
  }
  .card--ink {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }
  .card__header,
  .card__footer {
    padding: var(--space-4) var(--space-5);
  }
  .card__header {
    border-bottom: var(--rule-thin) solid currentColor;
  }
  .card__footer {
    border-top: var(--rule-thin) solid currentColor;
  }
  .card__body {
    padding: var(--space-5);
  }
</style>
