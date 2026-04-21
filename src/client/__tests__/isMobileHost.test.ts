// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isMobileHost } from '../lib/isMobileHost.ts'

// Each test mutates window + navigator globals; reset in afterEach so other
// tests don't inherit the mock state.

const origUA = navigator.userAgent
const origMaxTouch = (navigator as { maxTouchPoints?: number }).maxTouchPoints
const origWidth = window.innerWidth

function stubNavigator(ua: string, maxTouchPoints = 0): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

function stubInnerWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
}

describe('isMobileHost', () => {
  beforeEach(() => {
    stubNavigator('', 0)
    stubInnerWidth(1200)
  })

  afterEach(() => {
    stubNavigator(origUA, origMaxTouch ?? 0)
    stubInnerWidth(origWidth)
  })

  it('returns true for iPhone UA', () => {
    stubNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15')
    expect(isMobileHost()).toBe(true)
  })

  it('returns true for iPad UA', () => {
    stubNavigator('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')
    expect(isMobileHost()).toBe(true)
  })

  it('returns true for Android UA', () => {
    stubNavigator('Mozilla/5.0 (Linux; Android 14; Pixel 8)')
    expect(isMobileHost()).toBe(true)
  })

  it('returns false for desktop Chrome UA', () => {
    stubNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0')
    expect(isMobileHost()).toBe(false)
  })

  it('returns true for touch device with narrow viewport', () => {
    stubNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)
    stubInnerWidth(800)
    expect(isMobileHost()).toBe(true)
  })

  it('returns false for touch device with wide viewport', () => {
    stubNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)
    stubInnerWidth(1200)
    expect(isMobileHost()).toBe(false)
  })

  it('returns false when only one touch point (non-mobile trackpad)', () => {
    stubNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 1)
    stubInnerWidth(800)
    expect(isMobileHost()).toBe(false)
  })

  it('returns true for iPadOS 13+ (MacIntel platform + multi-touch)', () => {
    // Modern iPads report a desktop-like UA; the platform+touch heuristic catches them.
    stubNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5)
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    stubInnerWidth(1366) // landscape iPad
    expect(isMobileHost()).toBe(true)
    Object.defineProperty(navigator, 'platform', { value: '', configurable: true })
  })
})
