<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
    as?: 'section' | 'div' | 'aside'
  }

  let { children, as = 'section' }: Props = $props()
</script>

<svelte:element this={as} class="panel">
  {@render children()}
</svelte:element>

<style>
  .panel {
    display: block;
    background: var(--bg);
    color: var(--fg);
    border: var(--rule-heavy) solid var(--rule);
    padding: var(--space-6);
  }
</style>
