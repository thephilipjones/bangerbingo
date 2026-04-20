// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte'

vi.mock('../lib/api.ts', () => ({
  patchRoundConfig: vi.fn(),
}))

vi.mock('../lib/hostPrefs.ts', () => ({
  writeHostPrefs: vi.fn(),
}))

beforeEach(() => {
  // Provide a noop localStorage so nothing weird happens under jsdom.
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('AdvancedSettings — live mode', () => {
  it('pre-round mode: pill click calls onChange without hitting patchRoundConfig', async () => {
    const { default: AdvancedSettings } = await import('../components/AdvancedSettings.svelte')
    const api = await import('../lib/api.ts')
    const onClip = vi.fn()

    const { getByRole } = render(AdvancedSettings, {
      mode: 'pre-round',
      clipDuration: 30,
      titleRevealDelay: 5,
      audioPreset: 'minimal',
      allowCasualMode: false,
      onClipDurationChange: onClip,
    })

    await fireEvent.click(getByRole('button', { name: '45s' }))
    expect(onClip).toHaveBeenCalledWith(45)
    expect(api.patchRoundConfig).not.toHaveBeenCalled()
  })

  it('live mode: pill click applies optimistically, PATCHes, shows Saved on success, persists prefs', async () => {
    const { default: AdvancedSettings } = await import('../components/AdvancedSettings.svelte')
    const api = await import('../lib/api.ts')
    const hostPrefs = await import('../lib/hostPrefs.ts')

    const patchMock = vi.mocked(api.patchRoundConfig)
    patchMock.mockResolvedValue({ ok: true } as Response)

    const onClip = vi.fn()
    const { getByRole, findByText } = render(AdvancedSettings, {
      mode: 'live',
      code: 'ABCD',
      clipDuration: 30,
      titleRevealDelay: 5,
      audioPreset: 'minimal',
      allowCasualMode: false,
      onClipDurationChange: onClip,
    })

    await fireEvent.click(getByRole('button', { name: '45s' }))

    // Optimistic callback fires before network settles
    expect(onClip).toHaveBeenCalledWith(45)
    expect(patchMock).toHaveBeenCalledWith('ABCD', { clipDuration: 45 })

    // Saved pill appears
    await findByText(/Saved/)
    expect(hostPrefs.writeHostPrefs).toHaveBeenCalledWith({ clipDuration: 45 })
  })

  it('live mode: failure reverts optimistic update and shows error pill', async () => {
    const { default: AdvancedSettings } = await import('../components/AdvancedSettings.svelte')
    const api = await import('../lib/api.ts')
    const hostPrefs = await import('../lib/hostPrefs.ts')

    const patchMock = vi.mocked(api.patchRoundConfig)
    patchMock.mockResolvedValue({ ok: false, status: 500 } as Response)

    const onPreset = vi.fn()
    const { getByRole, findByRole } = render(AdvancedSettings, {
      mode: 'live',
      code: 'ABCD',
      clipDuration: 30,
      titleRevealDelay: 5,
      audioPreset: 'minimal',
      allowCasualMode: false,
      onAudioPresetChange: onPreset,
    })

    await fireEvent.click(getByRole('button', { name: 'Hype' }))

    // Optimistic apply, then revert on failure
    await waitFor(() => {
      expect(onPreset).toHaveBeenCalledTimes(2)
    })
    expect(onPreset.mock.calls[0][0]).toBe('hype')
    expect(onPreset.mock.calls[1][0]).toBe('minimal')

    await findByRole('alert')
    expect(hostPrefs.writeHostPrefs).not.toHaveBeenCalled()
  })

  it('live mode: casual-mode toggle sends allowCasualMode partial', async () => {
    const { default: AdvancedSettings } = await import('../components/AdvancedSettings.svelte')
    const api = await import('../lib/api.ts')
    const patchMock = vi.mocked(api.patchRoundConfig)
    patchMock.mockResolvedValue({ ok: true } as Response)

    const onCasual = vi.fn()
    const { getByRole } = render(AdvancedSettings, {
      mode: 'live',
      code: 'ABCD',
      clipDuration: 30,
      titleRevealDelay: 5,
      audioPreset: 'minimal',
      allowCasualMode: false,
      onAllowCasualModeChange: onCasual,
    })

    await fireEvent.click(getByRole('button', { name: 'Allow' }))
    expect(onCasual).toHaveBeenCalledWith(true)
    expect(patchMock).toHaveBeenCalledWith('ABCD', { allowCasualMode: true })
  })

  it('live mode: no-op click (same value) does not hit network', async () => {
    const { default: AdvancedSettings } = await import('../components/AdvancedSettings.svelte')
    const api = await import('../lib/api.ts')
    const patchMock = vi.mocked(api.patchRoundConfig)

    const { getByRole } = render(AdvancedSettings, {
      mode: 'live',
      code: 'ABCD',
      clipDuration: 30,
      titleRevealDelay: 5,
      audioPreset: 'minimal',
      allowCasualMode: false,
      onClipDurationChange: vi.fn(),
    })

    await fireEvent.click(getByRole('button', { name: '30s' }))
    expect(patchMock).not.toHaveBeenCalled()
  })
})
