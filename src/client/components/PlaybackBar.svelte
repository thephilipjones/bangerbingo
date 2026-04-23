<script lang="ts">
  let { startedAt, durationMs }: { startedAt: number; durationMs: number } = $props()

  let now = $state(Date.now())

  $effect(() => {
    if (startedAt <= 0 || durationMs <= 0) return
    now = Date.now()
    let raf: number
    const tick = () => {
      now = Date.now()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  let progress = $derived(
    startedAt > 0 && durationMs > 0
      ? Math.min(1, Math.max(0, (now - startedAt) / durationMs))
      : 0
  )
</script>

<div class="pb-track" aria-hidden="true">
  {#if startedAt > 0 && durationMs > 0}
    <div class="pb-fill" style:width="{progress * 100}%"></div>
    <div class="pb-marker" style:left="{progress * 100}%"></div>
  {/if}
</div>

<style>
  .pb-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--rule-thick);
    background: var(--rule);
  }
  .pb-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--accent);
  }
  .pb-marker {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: var(--fg);
    transform: translateX(-50%);
  }
</style>
