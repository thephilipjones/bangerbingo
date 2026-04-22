// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { playWinAudio, _resetAudioContextForTesting } from '../lib/winAudio.ts'

function makeAudioContextMock() {
  const stop = vi.fn()
  const start = vi.fn()
  const connect = vi.fn()
  const setValueAtTime = vi.fn()
  const exponentialRampToValueAtTime = vi.fn()

  const createOscillator = vi.fn(() => ({
    connect,
    frequency: { value: 0 },
    type: 'sine' as OscillatorType,
    start,
    stop,
  }))

  const createGain = vi.fn(() => ({
    connect,
    gain: { setValueAtTime, exponentialRampToValueAtTime },
  }))

  return {
    currentTime: 0,
    destination: {},
    createOscillator,
    createGain,
    _mocks: { stop, start, connect, setValueAtTime, exponentialRampToValueAtTime, createOscillator, createGain },
  }
}

beforeEach(() => {
  _resetAudioContextForTesting()
  vi.stubGlobal('AudioContext', vi.fn(() => makeAudioContextMock()))
})

describe('playWinAudio', () => {
  it('hype — creates 4 oscillators for the C major arpeggio', () => {
    playWinAudio('hype')
    const ctx = (AudioContext as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(ctx.createOscillator).toHaveBeenCalledTimes(4)
  })

  it('hype — uses triangle wave', () => {
    playWinAudio('hype')
    const ctx = (AudioContext as ReturnType<typeof vi.fn>).mock.results[0].value
    const oscCalls = ctx.createOscillator.mock.results
    for (const r of oscCalls) {
      expect(r.value.type).toBe('triangle')
    }
  })

  it('deadpan — creates 1 oscillator at 440Hz', () => {
    playWinAudio('deadpan')
    const ctx = (AudioContext as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1)
    expect(ctx.createOscillator.mock.results[0].value.frequency.value).toBe(440)
  })

  it('deadpan — uses sine wave', () => {
    playWinAudio('deadpan')
    const ctx = (AudioContext as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(ctx.createOscillator.mock.results[0].value.type).toBe('sine')
  })

  it('minimal — creates 1 oscillator at 880Hz', () => {
    playWinAudio('minimal')
    const ctx = (AudioContext as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1)
    expect(ctx.createOscillator.mock.results[0].value.frequency.value).toBe(880)
  })

  it('minimal — uses sine wave', () => {
    playWinAudio('minimal')
    const ctx = (AudioContext as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(ctx.createOscillator.mock.results[0].value.type).toBe('sine')
  })

  it('unknown preset falls through to minimal (880Hz sine)', () => {
    playWinAudio('unknown' as AudioPreset)
    const ctx = (AudioContext as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1)
    expect(ctx.createOscillator.mock.results[0].value.frequency.value).toBe(880)
  })

  it('reuses the singleton AudioContext across calls', () => {
    playWinAudio('hype')
    playWinAudio('deadpan')
    expect(AudioContext as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })
})
