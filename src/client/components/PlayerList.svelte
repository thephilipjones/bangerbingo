<script lang="ts">
  import { Couch, Check, PencilSimple } from 'phosphor-svelte'
  import { isSelfRow } from '../lib/waitingRoom.ts'

  let {
    players,
    hostName,
    selfName,
    winsByName = {},
    lastRoundWinner = null,
    showStats = false,
    casualModeNames = new Set(),
    onRename,
    isClaiming = false,
  }: {
    players: string[]
    hostName: string | null
    selfName: string | null  // null = viewer is the host
    winsByName?: Record<string, number>
    lastRoundWinner?: string | null
    showStats?: boolean
    casualModeNames?: Set<string>
    onRename?: (newName: string) => void
    isClaiming?: boolean
  } = $props()

  let editing = $state(false)
  let editValue = $state('')

  function autofocus(el: HTMLElement) {
    el.focus()
    if (el instanceof HTMLInputElement) el.select()
  }

  // Close edit if a claim starts mid-edit
  $effect(() => {
    if (isClaiming && editing) {
      editing = false
      editValue = ''
    }
  })

  function openEdit() {
    if (isClaiming || !onRename) return
    editValue = selfName ?? hostName ?? ''
    editing = true
  }

  function commitEdit() {
    const trimmed = editValue.trim()
    editing = false
    editValue = ''
    const currentName = selfName ?? hostName ?? ''
    if (!trimmed || trimmed === currentName) return
    onRename?.(trimmed)
  }

  function cancelEdit() {
    editing = false
    editValue = ''
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  }

  const showYouOnHost = $derived(
    selfName === null || (hostName !== null && isSelfRow(hostName, selfName))
  )
  // True when the host row is the editable self-row (host viewing)
  const hostIsEditable = $derived(selfName === null && onRename !== undefined)
  // True when a guest viewer's own row should be rendered first
  const selfIsGuest = $derived(selfName !== null && players.includes(selfName))
  // Other guests excluding self (when self-first is active)
  const otherPlayers = $derived(selfIsGuest ? players.filter(p => p !== selfName) : players)

  function winCount(name: string | null): number {
    if (!showStats || !name) return 0
    return winsByName[name] ?? 0
  }

  function isLastRoundWinner(name: string | null): boolean {
    return showStats && name !== null && name === lastRoundWinner
  }
</script>

<ul class="players-list">
  {#if selfIsGuest}
    <!-- Self row first for guest viewers -->
    <li class="player-row self-row" class:editable={onRename !== undefined && !isClaiming}>
      {#if editing}
        <input
          class="rename-input"
          bind:value={editValue}
          onblur={commitEdit}
          onkeydown={handleKeydown}
          maxlength={30}
          autocomplete="off"
          aria-label="Edit your name"
          use:autofocus
        />
      {:else}
        <button class="player-name name-btn" onclick={openEdit} disabled={isClaiming || !onRename}>
          {selfName}
        </button>
        {#if onRename !== undefined && !isClaiming}
          <span class="edit-icon" aria-hidden="true"><PencilSimple size={12} /></span>
        {/if}
      {/if}
      {#if casualModeNames?.has(selfName!)}
        <span class="casual-icon" aria-label="Casual Mode on"><Couch size={14} aria-hidden="true" /></span>
      {/if}
      {#if winCount(selfName) > 0}
        <span class="win-count">×{winCount(selfName)}</span>
      {/if}
      {#if isLastRoundWinner(selfName)}
        <span class="last-round-pill"><Check size={13} weight="bold" aria-hidden="true" /> Last round</span>
      {/if}
      <span class="you-pill">You</span>
    </li>
    <!-- Host row second -->
    <li class="player-row">
      <span class="player-name">{hostName ?? 'Host'}</span>
      {#if hostName !== null && casualModeNames?.has(hostName)}
        <span class="casual-icon" aria-label="Casual Mode on"><Couch size={14} aria-hidden="true" /></span>
      {/if}
      {#if winCount(hostName) > 0}
        <span class="win-count">×{winCount(hostName)}</span>
      {/if}
      {#if isLastRoundWinner(hostName)}
        <span class="last-round-pill"><Check size={13} weight="bold" aria-hidden="true" /> Last round</span>
      {/if}
      <span class="host-pill">Host</span>
    </li>
    <!-- Other guests -->
    {#each otherPlayers as playerName (playerName)}
      <li class="player-row">
        <span class="player-name">{playerName}</span>
        {#if casualModeNames?.has(playerName)}
          <span class="casual-icon" aria-label="Casual Mode on"><Couch size={14} aria-hidden="true" /></span>
        {/if}
        {#if winCount(playerName) > 0}
          <span class="win-count">×{winCount(playerName)}</span>
        {/if}
        {#if isLastRoundWinner(playerName)}
          <span class="last-round-pill"><Check size={13} weight="bold" aria-hidden="true" /> Last round</span>
        {/if}
      </li>
    {/each}
  {:else}
    <!-- Host-viewer or no self: original order (host first) -->
    <li class="player-row" class:self-row={hostIsEditable} class:editable={hostIsEditable && !isClaiming}>
      {#if editing && hostIsEditable}
        <input
          class="rename-input"
          bind:value={editValue}
          onblur={commitEdit}
          onkeydown={handleKeydown}
          maxlength={30}
          autocomplete="off"
          aria-label="Edit your name"
          use:autofocus
        />
      {:else if hostIsEditable}
        <button class="player-name name-btn" onclick={openEdit} disabled={isClaiming}>
          {hostName ?? 'Host'}
        </button>
        {#if !isClaiming}
          <span class="edit-icon" aria-hidden="true"><PencilSimple size={12} /></span>
        {/if}
      {:else}
        <span class="player-name">{hostName ?? 'Host'}</span>
      {/if}
      {#if hostName !== null && casualModeNames?.has(hostName)}
        <span class="casual-icon" aria-label="Casual Mode on"><Couch size={14} aria-hidden="true" /></span>
      {/if}
      {#if winCount(hostName) > 0}
        <span class="win-count">×{winCount(hostName)}</span>
      {/if}
      {#if isLastRoundWinner(hostName)}
        <span class="last-round-pill"><Check size={13} weight="bold" aria-hidden="true" /> Last round</span>
      {/if}
      <span class="host-pill">Host</span>
      {#if showYouOnHost}
        <span class="you-pill">You</span>
      {/if}
    </li>
    {#each players as playerName (playerName)}
      <li class="player-row">
        <span class="player-name">{playerName}</span>
        {#if casualModeNames?.has(playerName)}
          <span class="casual-icon" aria-label="Casual Mode on"><Couch size={14} aria-hidden="true" /></span>
        {/if}
        {#if winCount(playerName) > 0}
          <span class="win-count">×{winCount(playerName)}</span>
        {/if}
        {#if isLastRoundWinner(playerName)}
          <span class="last-round-pill"><Check size={13} weight="bold" aria-hidden="true" /> Last round</span>
        {/if}
        {#if selfName !== null && isSelfRow(playerName, selfName)}
          <span class="you-pill">You</span>
        {/if}
      </li>
    {/each}
  {/if}
</ul>

<style>
  .players-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .player-row {
    display: flex;
    align-items: center;
    padding: 12px;
    background: var(--player-row-bg, var(--bg-2));
    border: var(--rule-thin) solid var(--rule);
    font-size: 0.95rem;
    gap: 8px;
  }

  .player-name {
    flex: 1;
    color: var(--fg);
  }

  .name-btn {
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .name-btn:disabled {
    cursor: default;
  }

  .editable .player-name {
    cursor: pointer;
  }

  .editable .name-btn:not(:disabled):hover {
    color: var(--accent);
  }

  .edit-icon {
    display: none;
    align-items: center;
    color: var(--fg-muted);
    flex-shrink: 0;
  }

  .editable:hover .edit-icon {
    display: inline-flex;
  }

  .rename-input {
    flex: 1;
    background: var(--bg);
    border: var(--rule-thin) solid var(--accent);
    color: var(--fg);
    font-size: 0.95rem;
    font-family: inherit;
    padding: 2px 6px;
    outline: none;
    min-width: 0;
  }

  .casual-icon {
    display: inline-flex;
    align-items: center;
  }

  .win-count {
    font-size: 0.75rem;
    color: var(--fg-muted);
    padding: 0 6px;
  }

  .last-round-pill {
    padding: 2px 8px;
    background: transparent;
    color: var(--accent);
    border: var(--rule-thin) solid var(--accent);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .host-pill {
    padding: 2px 8px;
    background: var(--accent);
    color: var(--accent-fg);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .you-pill {
    padding: 2px 8px;
    background: var(--fg);
    color: var(--bg);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
</style>
