<script lang="ts">
  import { useOverlay } from '../../lib/useOverlay.svelte.ts'

  let {
    onClose,
    initialFocusId = null,
  }: {
    onClose: () => void
    initialFocusId?: string | null
  } = $props()

  let rootEl = $state<HTMLElement | null>(null)

  useOverlay({
    onClose: () => onClose(),
    root: () => rootEl,
    initialFocus: () =>
      initialFocusId ? (rootEl?.querySelector<HTMLElement>(`#${initialFocusId}`) ?? null) : null,
  })
</script>

<div bind:this={rootEl} id="overlay-root">
  <button id="first-btn">First</button>
  <button id="second-btn">Second</button>
</div>
