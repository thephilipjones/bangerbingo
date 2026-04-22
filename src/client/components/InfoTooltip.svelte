<script lang="ts">
  import { tick } from 'svelte'
  import { Info } from 'phosphor-svelte'

  let { label, text }: { label: string; text: string } = $props()

  const popoverId = `info-${Math.random().toString(36).slice(2, 9)}`

  let open = $state(false)
  let triggerEl = $state<HTMLButtonElement | null>(null)
  let popoverEl = $state<HTMLSpanElement | null>(null)
  let popTop = $state(0)
  let popLeft = $state(0)
  let positioned = $state(false)
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
      if (!popoverEl || !popoverEl.contains(e.target)) open = false
    }
  }

  let rafHandle: number | null = null

  function reposition() {
    if (!triggerEl || !popoverEl) return
    const trigger = triggerEl.getBoundingClientRect()
    const pop = popoverEl.getBoundingClientRect()
    const margin = 8
    const vv = window.visualViewport
    const vw = vv?.width ?? document.documentElement.clientWidth
    const vh = vv?.height ?? document.documentElement.clientHeight
    const offsetLeft = vv?.offsetLeft ?? 0
    const offsetTop = vv?.offsetTop ?? 0

    let left = trigger.left
    if (left + pop.width > offsetLeft + vw - margin) left = offsetLeft + vw - margin - pop.width
    if (left < offsetLeft + margin) left = offsetLeft + margin

    let top = trigger.bottom + 6
    if (top + pop.height > offsetTop + vh - margin) {
      const above = trigger.top - 6 - pop.height
      if (above >= offsetTop + margin) top = above
      else top = Math.max(offsetTop + margin, offsetTop + vh - margin - pop.height)
    }

    popLeft = left
    popTop = top
    positioned = true
  }

  function scheduleReposition() {
    if (rafHandle !== null) return
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null
      reposition()
    })
  }

  $effect(() => {
    if (!open) {
      positioned = false
      return
    }

    document.addEventListener('pointerdown', onOutsidePointer, true)
    window.addEventListener('scroll', scheduleReposition, true)
    window.addEventListener('resize', scheduleReposition)
    window.visualViewport?.addEventListener('resize', scheduleReposition)
    window.visualViewport?.addEventListener('scroll', scheduleReposition)

    tick().then(reposition)

    return () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle)
        rafHandle = null
      }
      document.removeEventListener('pointerdown', onOutsidePointer, true)
      window.removeEventListener('scroll', scheduleReposition, true)
      window.removeEventListener('resize', scheduleReposition)
      window.visualViewport?.removeEventListener('resize', scheduleReposition)
      window.visualViewport?.removeEventListener('scroll', scheduleReposition)
    }
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
    <span
      bind:this={popoverEl}
      class="popover"
      class:positioned
      id={popoverId}
      role="tooltip"
      style="top: {popTop}px; left: {popLeft}px;"
    >{text}</span>
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
    position: fixed;
    z-index: 200;
    background: var(--bg-2);
    color: var(--fg);
    border: var(--rule-thin) solid var(--rule);
    padding: 0.5rem 0.6rem;
    font-size: 0.8rem;
    line-height: 1.3;
    width: max-content;
    max-width: min(260px, calc(100vw - 16px));
    white-space: normal;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    visibility: hidden;
  }
  .popover.positioned { visibility: visible; }
</style>
