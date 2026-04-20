<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Info } from 'phosphor-svelte'

  let { label, text }: { label: string; text: string } = $props()

  const idBase = `info-${Math.random().toString(36).slice(2, 9)}`
  const popoverId = `${idBase}-pop`

  let open = $state(false)
  let triggerEl = $state<HTMLButtonElement | null>(null)
  // Suppress mouseenter/mouseleave on touch devices: iOS Safari synthesizes
  // mouse events after tap, racing the click toggle and making the tooltip
  // flicker open/closed. Any pointerdown with pointerType==='touch' locks
  // the component into touch mode for the session.
  let touchMode = $state(false)

  function show() { if (!touchMode) open = true }
  function hide() { if (!touchMode) open = false }
  function toggle() { open = !open }
  function onPointerDown(e: PointerEvent) { if (e.pointerType === 'touch') touchMode = true }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false
      e.stopPropagation()
    }
  }

  function onOutsidePointer(e: PointerEvent) {
    if (!open) return
    if (triggerEl && e.target instanceof Node && !triggerEl.contains(e.target)) {
      // If click lands outside both trigger and popover, close.
      const popover = document.getElementById(popoverId)
      if (!popover || !popover.contains(e.target)) open = false
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('pointerdown', onOutsidePointer, true)
      return () => document.removeEventListener('pointerdown', onOutsidePointer, true)
    }
  })

  onDestroy(() => {
    document.removeEventListener('pointerdown', onOutsidePointer, true)
  })
</script>

<span class="wrap">
  <button
    bind:this={triggerEl}
    class="trigger"
    type="button"
    aria-label={`What is ${label}?`}
    aria-describedby={open ? popoverId : undefined}
    aria-expanded={open}
    onpointerdown={onPointerDown}
    onmouseenter={show}
    onmouseleave={hide}
    onfocus={show}
    onblur={hide}
    onclick={toggle}
    onkeydown={onKeydown}
  ><Info size={16} aria-hidden="true" /></button>

  {#if open}
    <span class="popover" id={popoverId} role="tooltip">{text}</span>
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .trigger {
    background: none;
    border: none;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0;
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
    line-height: 1;
  }
  .trigger:hover { color: var(--fg); }
  .trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 200;
    background: var(--bg-2);
    color: var(--fg);
    border: var(--rule-thin) solid var(--rule);
    padding: 0.5rem 0.6rem;
    font-size: 0.8rem;
    line-height: 1.3;
    width: max-content;
    max-width: min(260px, calc(100vw - 32px));
    white-space: normal;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  }

  /* Keep the popover from clipping off the right edge on mobile overlays. */
  @media (max-width: 480px) {
    .popover {
      left: auto;
      right: 0;
    }
  }
</style>
