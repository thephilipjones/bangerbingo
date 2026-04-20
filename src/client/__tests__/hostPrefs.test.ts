import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readHostPrefs, writeHostPrefs } from '../lib/hostPrefs.ts'

describe('hostPrefs', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { for (const k of Object.keys(store)) delete store[k] },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when nothing is stored', () => {
    expect(readHostPrefs()).toBeNull()
  })

  it('round-trips a write under the bb:host-prefs:v1 key', () => {
    writeHostPrefs({ clipDuration: 45, titleRevealDelay: 15, audioPreset: 'hype', allowCasualMode: true })
    expect(store['bb:host-prefs:v1']).toBeTruthy()
    const parsed = JSON.parse(store['bb:host-prefs:v1']!)
    expect(parsed.schemaVersion).toBe(1)
    expect(readHostPrefs()).toEqual({
      clipDuration: 45,
      titleRevealDelay: 15,
      audioPreset: 'hype',
      allowCasualMode: true,
    })
  })

  it('merges partial writes onto existing prefs', () => {
    writeHostPrefs({ clipDuration: 45, titleRevealDelay: 15, audioPreset: 'hype', allowCasualMode: true })
    writeHostPrefs({ clipDuration: 60 })
    expect(readHostPrefs()).toEqual({
      clipDuration: 60,
      titleRevealDelay: 15,
      audioPreset: 'hype',
      allowCasualMode: true,
    })
  })

  it('merges partial writes onto defaults when no stored prefs exist', () => {
    writeHostPrefs({ audioPreset: 'deadpan' })
    expect(readHostPrefs()).toEqual({
      clipDuration: 30,
      titleRevealDelay: 10,
      audioPreset: 'deadpan',
      allowCasualMode: false,
    })
  })

  it('returns null on schema mismatch', () => {
    store['bb:host-prefs:v1'] = JSON.stringify({
      schemaVersion: 2,
      clipDuration: 30,
      titleRevealDelay: 10,
      audioPreset: 'minimal',
      allowCasualMode: false,
    })
    expect(readHostPrefs()).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    store['bb:host-prefs:v1'] = '{not json'
    expect(readHostPrefs()).toBeNull()
  })

  it('returns null on invalid clipDuration value', () => {
    store['bb:host-prefs:v1'] = JSON.stringify({
      schemaVersion: 1,
      clipDuration: 99,
      titleRevealDelay: 10,
      audioPreset: 'minimal',
      allowCasualMode: false,
    })
    expect(readHostPrefs()).toBeNull()
  })

  it('returns null on invalid titleRevealDelay value', () => {
    store['bb:host-prefs:v1'] = JSON.stringify({
      schemaVersion: 1,
      clipDuration: 30,
      titleRevealDelay: 7,
      audioPreset: 'minimal',
      allowCasualMode: false,
    })
    expect(readHostPrefs()).toBeNull()
  })

  it('returns null on missing allowCasualMode', () => {
    store['bb:host-prefs:v1'] = JSON.stringify({
      schemaVersion: 1,
      clipDuration: 30,
      titleRevealDelay: 10,
      audioPreset: 'minimal',
    })
    expect(readHostPrefs()).toBeNull()
  })

  it('round-trips preferredDeviceId and preserves other fields', () => {
    writeHostPrefs({ clipDuration: 45, titleRevealDelay: 15, audioPreset: 'hype', allowCasualMode: true })
    writeHostPrefs({ preferredDeviceId: 'abc123' })
    expect(readHostPrefs()).toEqual({
      clipDuration: 45,
      titleRevealDelay: 15,
      audioPreset: 'hype',
      allowCasualMode: true,
      preferredDeviceId: 'abc123',
    })
  })

  it('accepts stored blobs without preferredDeviceId and returns it as undefined', () => {
    store['bb:host-prefs:v1'] = JSON.stringify({
      schemaVersion: 1,
      clipDuration: 30,
      titleRevealDelay: 10,
      audioPreset: 'minimal',
      allowCasualMode: false,
    })
    const prefs = readHostPrefs()
    expect(prefs).not.toBeNull()
    expect(prefs!.preferredDeviceId).toBeUndefined()
  })

  it('returns null on invalid preferredDeviceId type', () => {
    store['bb:host-prefs:v1'] = JSON.stringify({
      schemaVersion: 1,
      clipDuration: 30,
      titleRevealDelay: 10,
      audioPreset: 'minimal',
      allowCasualMode: false,
      preferredDeviceId: 42,
    })
    expect(readHostPrefs()).toBeNull()
  })
})
