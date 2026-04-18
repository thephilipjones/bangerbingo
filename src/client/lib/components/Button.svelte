<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Variant = 'primary' | 'ghost' | 'danger' | 'link'
  type Size = 'sm' | 'md' | 'lg'

  interface Props extends HTMLButtonAttributes {
    variant?: Variant
    size?: Size
    children: Snippet
  }

  let {
    variant = 'primary',
    size = 'md',
    type = 'button',
    children,
    ...rest
  }: Props = $props()
</script>

<button class="btn btn--{variant} btn--{size}" {type} {...rest}>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    line-height: 1;
    border: var(--rule-thick) solid transparent;
    border-radius: var(--radius-0);
    transition: transform var(--dur-fast) var(--ease-snap),
                background-color var(--dur-fast) var(--ease-snap),
                color var(--dur-fast) var(--ease-snap);
  }

  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn--sm { padding: var(--space-2) var(--space-3); font-size: 14px; }
  .btn--md { padding: var(--space-3) var(--space-5); font-size: 16px; }
  .btn--lg { padding: var(--space-4) var(--space-6); font-size: 20px; }

  .btn--primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .btn--primary:hover:not(:disabled) { transform: translateY(-1px); }

  .btn--ghost {
    background: transparent;
    color: var(--fg);
    border-color: var(--rule);
  }
  .btn--ghost:hover:not(:disabled) {
    background: var(--fg);
    color: var(--bg);
  }

  .btn--danger {
    background: transparent;
    color: var(--danger);
    border-color: var(--danger);
  }
  .btn--danger:hover:not(:disabled) {
    background: var(--danger);
    color: var(--accent-fg);
  }

  .btn--link {
    background: transparent;
    color: var(--fg);
    border-color: transparent;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-transform: none;
    letter-spacing: 0;
    font-family: var(--font-body);
  }
  .btn--link:hover:not(:disabled) { color: var(--accent); }

  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
    .btn--primary:hover:not(:disabled) { transform: none; }
  }
</style>
