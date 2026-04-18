<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getRooms,
    createRoom,
    deleteRoom,
    getMe,
    getAuthStatus,
    logout,
    disconnectSpotify,
    type RoomSummary,
    type MeResponse,
    type AuthStatusResponse,
  } from '../lib/api.ts'
  import { formatSessionTimestamp } from '../lib/formatSessionTimestamp.ts'
  import Logo from '../lib/components/Logo.svelte'
  import Button from '../lib/components/Button.svelte'
  import Card from '../lib/components/Card.svelte'
  import ThemeToggle from '../lib/components/ThemeToggle.svelte'

  // Status pill states:
  //   connected → ink outline + ink text (neutral, stable)
  //   disconnected → signal outline + signal text (needs user action)
  let { onEnterLobby }: { onEnterLobby: (code: string) => void } = $props()

  let rooms = $state<RoomSummary[]>([])
  let me = $state<MeResponse | null>(null)
  let authStatus = $state<AuthStatusResponse | null>(null)
  let loading = $state(true)
  let creating = $state(false)
  let disconnecting = $state(false)
  let error = $state('')

  onMount(async () => {
    // Fetch all three in parallel; one failure shouldn't blank the page.
    const [meRes, statusRes, roomsRes] = await Promise.allSettled([
      getMe(),
      getAuthStatus(),
      getRooms(),
    ])
    if (meRes.status === 'fulfilled') me = meRes.value
    if (statusRes.status === 'fulfilled') authStatus = statusRes.value
    if (roomsRes.status === 'fulfilled') {
      rooms = roomsRes.value
    }
    // Surface an error banner for any failed fetch so a degraded/broken
    // auth state isn't silently rendered as a healthy "Connected" pill.
    const failed: string[] = []
    if (roomsRes.status === 'rejected') failed.push('sessions')
    if (meRes.status === 'rejected') failed.push('account')
    if (statusRes.status === 'rejected') failed.push('Spotify status')
    if (failed.length > 0) {
      error = `Failed to load ${failed.join(', ')} — reload to retry`
    }
    loading = false
  })

  async function handleCreateRoom() {
    creating = true
    error = ''
    try {
      const room = await createRoom()
      creating = false
      onEnterLobby(room.code)
    } catch {
      error = 'Failed to create room'
      creating = false
    }
  }

  function handleOpenRoom(code: string) {
    onEnterLobby(code)
  }

  function handleRowKeydown(event: KeyboardEvent, code: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleOpenRoom(code)
    }
  }

  async function handleDeleteRoom(event: MouseEvent, code: string) {
    event.stopPropagation()
    const ok = window.confirm(
      `Delete session ${code}?\n\nAny connected players will be disconnected. This can't be undone.`,
    )
    if (!ok) return
    try {
      await deleteRoom(code)
      rooms = rooms.filter((r) => r.code !== code)
    } catch {
      error = `Failed to delete session ${code}`
      // Resync with server — the delete may have partially succeeded, or the
      // row may already be gone. Either way, refetch keeps the list truthful.
      try {
        rooms = await getRooms()
      } catch {
        // leave the list as-is; the error banner already tells the user
      }
    }
  }

  async function handleClearAllSessions() {
    if (rooms.length === 0) return
    const ok = window.confirm(
      `Delete all ${rooms.length} session${rooms.length === 1 ? '' : 's'}?\n\nAll connected players will be disconnected. This can't be undone.`,
    )
    if (!ok) return
    error = ''
    const results = await Promise.allSettled(rooms.map((r) => deleteRoom(r.code)))
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) {
      error = `${failed} session${failed === 1 ? '' : 's'} could not be deleted`
    }
    try {
      rooms = await getRooms()
    } catch {
      // leave rooms as-is so the stale list stays visible alongside the error
    }
  }

  async function handleDisconnectSpotify() {
    const ok = window.confirm('This will stop music playback in any active rooms. Continue?')
    if (!ok) return
    disconnecting = true
    error = ''
    try {
      await disconnectSpotify()
      authStatus = { ...authStatus!, spotifyConnected: false, degraded: true }
    } catch {
      error = 'Failed to disconnect Spotify'
    }
    disconnecting = false
  }

  async function handleResetHost() {
    const ok = window.confirm('This will clear your host session on this device. Continue?')
    if (!ok) return
    try {
      await logout()
      window.location.href = '/'
    } catch {
      error = 'Failed to reset host session'
    }
  }

  const spotifyConnected = $derived(authStatus?.spotifyConnected ?? false)
</script>

<div class="dashboard">
  <header class="dashboard__top">
    <Logo size={36} variant="full" />
    <ThemeToggle />
  </header>

  <section class="spotify-panel">
    <Card variant="paper">
      <div class="spotify-row">
        <div class="spotify-info">
          <svg class="spotify-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 01-.277-1.216c3.809-.87 7.077-.496 9.712 1.115a.623.623 0 01.207.858zm1.224-2.722a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 01-.973-.519.781.781 0 01.519-.973c3.632-1.102 8.147-.568 11.234 1.329a.78.78 0 01.257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.937.937 0 11-.543-1.794c3.532-1.072 9.404-.865 13.115 1.338a.937.937 0 01-.954 1.613z"/>
          </svg>
          <span class="display-name">{me?.display_name ?? '—'}</span>
          <div class="pill-row">
            <span class="pill" class:pill-bad={!spotifyConnected}>
              {spotifyConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        {#if spotifyConnected}
          <Button variant="ghost" size="sm" onclick={handleDisconnectSpotify} disabled={disconnecting}>
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        {:else}
          <Button variant="primary" size="sm" onclick={() => (window.location.href = '/auth/login')}>
            Reconnect
          </Button>
        {/if}
      </div>
    </Card>
  </section>

  {#if error}
    <p class="error u-small">{error}</p>
  {/if}

  <Button variant="primary" size="lg" onclick={handleCreateRoom} disabled={creating}>
    {creating ? 'Creating…' : 'Start New Session'}
  </Button>

  {#if loading}
    <p class="muted u-small">Loading sessions…</p>
  {:else if rooms.length > 0}
    <ul class="room-list">
      {#each rooms as room (room.code)}
        <li>
          <div
            class="room-item"
            role="button"
            tabindex="0"
            onclick={() => handleOpenRoom(room.code)}
            onkeydown={(e) => handleRowKeydown(e, room.code)}
          >
            <span class="room-code">{room.code}</span>
            <span class="room-time u-small">{formatSessionTimestamp(room.created_at)}</span>
            <button
              class="trash-btn"
              aria-label={`Delete session ${room.code}`}
              onclick={(e) => handleDeleteRoom(e, room.code)}
            >🗑</button>
          </div>
        </li>
      {/each}
    </ul>
    {#if rooms.length > 1}
      <div class="danger-row">
        <Button variant="danger" size="sm" onclick={handleClearAllSessions}>Clear All Sessions</Button>
        <Button variant="danger" size="sm" onclick={handleResetHost}>Reset Host</Button>
      </div>
    {:else}
      <div class="danger-row">
        <Button variant="danger" size="sm" onclick={handleResetHost}>Reset Host</Button>
      </div>
    {/if}
  {:else}
    <p class="muted u-small">No sessions yet — start one above.</p>
    <div class="danger-row">
      <Button variant="danger" size="sm" onclick={handleResetHost}>Reset Host</Button>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    min-height: 100dvh;
    padding: var(--space-5) var(--space-5) var(--space-7);
    background: var(--bg);
    color: var(--fg);
  }

  .dashboard__top {
    width: 100%;
    max-width: 28rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-4);
    border-bottom: var(--rule-thick) solid var(--rule);
  }

  .spotify-panel {
    width: 100%;
    max-width: 28rem;
  }

  .spotify-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .spotify-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .spotify-icon {
    width: 1.25rem;
    height: 1.25rem;
    fill: var(--fg);
    flex-shrink: 0;
  }

  .display-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pill {
    font-size: var(--fs-small);
    font-weight: 600;
    padding: var(--space-1) var(--space-3);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pill-bad {
    color: var(--accent);
    border-color: var(--accent);
  }

  .room-list {
    list-style: none;
    width: 100%;
    max-width: 28rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
  }

  .room-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    min-height: 44px;
    cursor: pointer;
    color: var(--fg);
  }

  .room-item:hover { background: var(--fg); color: var(--bg); }
  .room-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .room-code {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 1.1rem;
    letter-spacing: 0.08em;
  }

  .room-time {
    flex: 1;
    color: var(--fg-muted);
    text-align: right;
    margin-right: var(--space-1);
  }
  .room-item:hover .room-time { color: var(--bg); }

  .trash-btn {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 1.1rem;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
  }

  .trash-btn:hover { color: var(--accent); }
  .trash-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .danger-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .muted { color: var(--fg-muted); }
  .error { color: var(--danger); margin: 0; }

  @media (min-width: 768px) {
    .dashboard {
      gap: var(--space-6);
      padding: var(--space-7) var(--space-6) var(--space-8);
    }
    .dashboard__top,
    .spotify-panel,
    .room-list {
      max-width: 36rem;
    }
    .dashboard__top { padding-bottom: var(--space-5); }
    .spotify-row { gap: var(--space-4); }
    .room-item { padding: var(--space-4) var(--space-5); }
  }
</style>
