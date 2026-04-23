// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'

afterEach(() => {
  cleanup()
})

async function mountPlayerList(props: Record<string, unknown>) {
  const { default: PlayerList } = await import('../components/PlayerList.svelte')
  return render(PlayerList, props)
}

describe('PlayerList — self-at-top ordering', () => {
  it('renders guest self row before host when selfName matches a player', async () => {
    const { getAllByRole } = await mountPlayerList({
      players: ['Bob', 'Carol'],
      hostName: 'Alice',
      selfName: 'Bob',
    })
    const items = getAllByRole('listitem')
    // First item should contain "Bob" (self), second "Alice" (host)
    expect(items[0].textContent).toContain('Bob')
    expect(items[1].textContent).toContain('Alice')
  })

  it('renders "You" pill on self row when guest is listed first', async () => {
    const { getAllByRole } = await mountPlayerList({
      players: ['Bob', 'Carol'],
      hostName: 'Alice',
      selfName: 'Bob',
    })
    const items = getAllByRole('listitem')
    expect(items[0].textContent).toContain('You')
  })

  it('does not show "You" pill on host row when guest viewer', async () => {
    const { getAllByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
    })
    const items = getAllByRole('listitem')
    expect(items[1].textContent).toContain('Host')
    expect(items[1].textContent).not.toContain('You')
  })

  it('renders host row first when selfName is null (host viewer)', async () => {
    const { getAllByRole } = await mountPlayerList({
      players: ['Bob', 'Carol'],
      hostName: 'Alice',
      selfName: null,
    })
    const items = getAllByRole('listitem')
    expect(items[0].textContent).toContain('Alice')
    expect(items[0].textContent).toContain('Host')
  })
})

describe('PlayerList — editable self row', () => {
  it('renders an edit button on self row when onRename is provided', async () => {
    const onRename = vi.fn()
    const { getByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
    })
    const btn = getByRole('button', { name: 'Bob' })
    expect(btn).toBeTruthy()
  })

  it('opens input on click', async () => {
    const onRename = vi.fn()
    const { getByRole, queryByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
    })
    await fireEvent.click(getByRole('button', { name: 'Bob' }))
    expect(queryByRole('textbox')).toBeTruthy()
  })

  it('commits new name on blur and calls onRename', async () => {
    const onRename = vi.fn()
    const { getByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
    })
    await fireEvent.click(getByRole('button', { name: 'Bob' }))
    const input = getByRole('textbox')
    await fireEvent.input(input, { target: { value: 'Bobby' } })
    await fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('Bobby')
  })

  it('commits new name on Enter key', async () => {
    const onRename = vi.fn()
    const { getByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
    })
    await fireEvent.click(getByRole('button', { name: 'Bob' }))
    const input = getByRole('textbox')
    await fireEvent.input(input, { target: { value: 'Bobby' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('Bobby')
  })

  it('cancels on Escape — does not call onRename', async () => {
    const onRename = vi.fn()
    const { getByRole, queryByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
    })
    await fireEvent.click(getByRole('button', { name: 'Bob' }))
    const input = getByRole('textbox')
    await fireEvent.input(input, { target: { value: 'Bobby' } })
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(queryByRole('textbox')).toBeNull()
  })

  it('does not call onRename when input is empty after trim', async () => {
    const onRename = vi.fn()
    const { getByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
    })
    await fireEvent.click(getByRole('button', { name: 'Bob' }))
    const input = getByRole('textbox')
    await fireEvent.input(input, { target: { value: '   ' } })
    await fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('does not call onRename when name unchanged', async () => {
    const onRename = vi.fn()
    const { getByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
    })
    await fireEvent.click(getByRole('button', { name: 'Bob' }))
    const input = getByRole('textbox')
    // Value is already "Bob" (pre-filled) — blur without changing
    await fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
  })
})

describe('PlayerList — isClaiming blocks editing', () => {
  it('does not open edit input when isClaiming is true', async () => {
    const onRename = vi.fn()
    const { getByRole, queryByRole } = await mountPlayerList({
      players: ['Bob'],
      hostName: 'Alice',
      selfName: 'Bob',
      onRename,
      isClaiming: true,
    })
    const btn = getByRole('button', { name: 'Bob' })
    await fireEvent.click(btn)
    expect(queryByRole('textbox')).toBeNull()
  })
})
