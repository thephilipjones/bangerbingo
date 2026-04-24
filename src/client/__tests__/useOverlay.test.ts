// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import OverlayHarness from './helpers/OverlayHarness.svelte'

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useOverlay — Escape key', () => {
  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(OverlayHarness, { props: { onClose } })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose for other keys', async () => {
    const onClose = vi.fn()
    render(OverlayHarness, { props: { onClose } })

    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('removes keydown listener after unmount', async () => {
    const onClose = vi.fn()
    const { unmount } = render(OverlayHarness, { props: { onClose } })

    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('useOverlay — focus management', () => {
  it('moves focus to first focusable element on mount', async () => {
    const onClose = vi.fn()
    render(OverlayHarness, { props: { onClose } })

    const firstBtn = document.getElementById('first-btn')
    expect(document.activeElement).toBe(firstBtn)
  })

  it('moves focus to specified initialFocus element on mount', async () => {
    const onClose = vi.fn()
    render(OverlayHarness, { props: { onClose, initialFocusId: 'second-btn' } })

    const secondBtn = document.getElementById('second-btn')
    expect(document.activeElement).toBe(secondBtn)
  })

  it('returns focus to the element that was focused before mount', async () => {
    const trigger = document.createElement('button')
    trigger.id = 'trigger'
    document.body.appendChild(trigger)
    trigger.focus()

    const onClose = vi.fn()
    const { unmount } = render(OverlayHarness, { props: { onClose } })

    // Focus should be on the overlay's first element while mounted
    expect(document.activeElement).not.toBe(trigger)

    unmount()

    // After unmount, focus should return to the trigger
    expect(document.activeElement).toBe(trigger)
    document.body.removeChild(trigger)
  })

  it('falls back to body if the return target is no longer in the DOM', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const onClose = vi.fn()
    const { unmount } = render(OverlayHarness, { props: { onClose } })

    // Remove trigger before unmount to simulate detached element
    document.body.removeChild(trigger)
    unmount()

    // Focus should fall back to body (explicit document.body.focus() in cleanup)
    expect(document.activeElement).toBe(document.body)
  })
})
