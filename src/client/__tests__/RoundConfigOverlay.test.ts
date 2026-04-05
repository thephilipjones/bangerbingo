// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import { validateHostName, buildStartRoundPayload } from '../lib/roundConfig.ts'

// ── Helper tests ────────────────────────────────────────────────────────────

describe('validateHostName', () => {
  it('returns trimmed: null with no error when field not required (initialHostName set)', () => {
    const result = validateHostName('Anything', false)
    expect(result).toEqual({ trimmed: null, error: null })
  })

  it('errors when required and input is empty', () => {
    const result = validateHostName('', true)
    expect(result.trimmed).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('errors when required and input is whitespace only', () => {
    const result = validateHostName('   ', true)
    expect(result.error).toBeTruthy()
  })

  it('errors when required and input trimmed length > 30', () => {
    const result = validateHostName('X'.repeat(31), true)
    expect(result.error).toBeTruthy()
  })

  it('accepts 1-char name', () => {
    const result = validateHostName('A', true)
    expect(result).toEqual({ trimmed: 'A', error: null })
  })

  it('accepts 30-char name', () => {
    const name = 'X'.repeat(30)
    const result = validateHostName(name, true)
    expect(result).toEqual({ trimmed: name, error: null })
  })

  it('trims surrounding whitespace', () => {
    const result = validateHostName('  Sarah  ', true)
    expect(result).toEqual({ trimmed: 'Sarah', error: null })
  })
})

describe('buildStartRoundPayload', () => {
  it('includes hostName when present (name field was visible on first round)', () => {
    const payload = buildStartRoundPayload('pl_abc', 30, 5, 'Sarah')
    expect(payload).toEqual({
      playlistId: 'pl_abc',
      clipDuration: 30,
      titleRevealDelay: 5,
      hostName: 'Sarah',
    })
  })

  it('omits hostName key entirely when null (name field was hidden)', () => {
    const payload = buildStartRoundPayload('pl_abc', 'full', null, null)
    expect(payload).toEqual({
      playlistId: 'pl_abc',
      clipDuration: 'full',
      titleRevealDelay: null,
    })
    expect('hostName' in payload).toBe(false)
  })
})

// ── DOM-render tests (AC #14c) ──────────────────────────────────────────────

// Mock the api module before importing the component under test.
vi.mock('../lib/api.ts', () => ({
  startRound: vi.fn().mockResolvedValue({ roundNumber: 1, playlistId: 'p', clipDuration: 30, titleRevealDelay: 5 }),
}))

// Stub /api/music/presets fetch so onMount doesn't swallow the component's setup.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{ name: '80s Pop', description: '', playlistId: 'pl_80s' }],
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('RoundConfigOverlay (DOM)', () => {
  it('(i) renders the name field when initialHostName is null, hides it when set', async () => {
    const { default: RoundConfigOverlay } = await import('../components/RoundConfigOverlay.svelte')

    const { getByLabelText, queryByLabelText, rerender } = render(RoundConfigOverlay, {
      code: 'ABCD',
      initialHostName: null,
      onClose: vi.fn(),
      onStarted: vi.fn(),
    })
    expect(getByLabelText('Your name')).toBeTruthy()

    cleanup()
    const { queryByLabelText: queryAfter } = render(RoundConfigOverlay, {
      code: 'ABCD',
      initialHostName: 'Sarah',
      onClose: vi.fn(),
      onStarted: vi.fn(),
    })
    expect(queryAfter('Your name')).toBeNull()

    // Silence unused-var lints
    void queryByLabelText
    void rerender
  })

  it('(ii) Start Round shows inline error on submit when name field is empty and visible', async () => {
    const { default: RoundConfigOverlay } = await import('../components/RoundConfigOverlay.svelte')
    const api = await import('../lib/api.ts')

    const { getByRole, findByText } = render(RoundConfigOverlay, {
      code: 'ABCD',
      initialHostName: null,
      onClose: vi.fn(),
      onStarted: vi.fn(),
    })

    const startBtn = getByRole('button', { name: /Start Round/i })
    await fireEvent.click(startBtn)

    // Error text shown (the validateHostName error); startRound NOT called.
    await findByText(/Please enter your name/i)
    expect(api.startRound).not.toHaveBeenCalled()
  })

  it('(iii) submits hostName in payload when visible, omits when hidden', async () => {
    const { default: RoundConfigOverlay } = await import('../components/RoundConfigOverlay.svelte')
    const api = await import('../lib/api.ts')
    const startRoundMock = vi.mocked(api.startRound)

    // Visible name field — should include hostName in payload.
    const onStarted1 = vi.fn()
    const { getByLabelText, findByText, getByRole } = render(RoundConfigOverlay, {
      code: 'ABCD',
      initialHostName: null,
      onClose: vi.fn(),
      onStarted: onStarted1,
    })
    // Wait for presets to load so we can select one.
    const presetBtn = await findByText('80s Pop')
    const nameInput = getByLabelText('Your name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: 'Sarah' } })
    await fireEvent.click(presetBtn)
    await fireEvent.click(getByRole('button', { name: /Start Round/i }))

    expect(startRoundMock).toHaveBeenCalledTimes(1)
    const payload1 = startRoundMock.mock.calls[0][1]
    expect(payload1).toMatchObject({ playlistId: 'pl_80s', hostName: 'Sarah' })

    // Hidden name field — should omit hostName.
    cleanup()
    startRoundMock.mockClear()
    const onStarted2 = vi.fn()
    const r2 = render(RoundConfigOverlay, {
      code: 'ABCD',
      initialHostName: 'Sarah',
      onClose: vi.fn(),
      onStarted: onStarted2,
    })
    const presetBtn2 = await r2.findByText('80s Pop')
    await fireEvent.click(presetBtn2)
    await fireEvent.click(r2.getByRole('button', { name: /Start Round/i }))

    expect(startRoundMock).toHaveBeenCalledTimes(1)
    const payload2 = startRoundMock.mock.calls[0][1]
    expect('hostName' in payload2).toBe(false)
  })

  it('(iv) close button and Esc both call onClose without calling startRound', async () => {
    const { default: RoundConfigOverlay } = await import('../components/RoundConfigOverlay.svelte')
    const api = await import('../lib/api.ts')

    // Close button
    const onClose1 = vi.fn()
    const { getByLabelText } = render(RoundConfigOverlay, {
      code: 'ABCD',
      initialHostName: 'Sarah',
      onClose: onClose1,
      onStarted: vi.fn(),
    })
    await fireEvent.click(getByLabelText('Close'))
    expect(onClose1).toHaveBeenCalledTimes(1)
    expect(api.startRound).not.toHaveBeenCalled()

    // Esc key
    cleanup()
    const onClose2 = vi.fn()
    render(RoundConfigOverlay, {
      code: 'ABCD',
      initialHostName: 'Sarah',
      onClose: onClose2,
      onStarted: vi.fn(),
    })
    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose2).toHaveBeenCalledTimes(1)
    expect(api.startRound).not.toHaveBeenCalled()
  })
})
