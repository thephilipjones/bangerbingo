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
  <h1>BangerBingo</h1>

  <section class="spotify-panel">
    <div class="spotify-row">
      <div class="spotify-info">
        <span class="display-name">{me?.display_name ?? '—'}</span>
        <div class="pill-row">
          <span class="pill" class:pill-good={spotifyConnected} class:pill-bad={!spotifyConnected}>
            {spotifyConnected ? 'Connected' : 'Disconnected'}
          </span>
          <svg class="spotify-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 01-.277-1.216c3.809-.87 7.077-.496 9.712 1.115a.623.623 0 01.207.858zm1.224-2.722a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 01-.973-.519.781.781 0 01.519-.973c3.632-1.102 8.147-.568 11.234 1.329a.78.78 0 01.257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.937.937 0 11-.543-1.794c3.532-1.072 9.404-.865 13.115 1.338a.937.937 0 01-.954 1.613z"/>
          </svg>
        </div>
      </div>
      {#if spotifyConnected}
        <button class="ghost-btn" onclick={handleDisconnectSpotify} disabled={disconnecting}>
          {disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </button>
      {:else}
        <a class="reconnect-btn" href="/auth/login">Reconnect Spotify</a>
      {/if}
    </div>
  </section>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <button class="create-btn" onclick={handleCreateRoom} disabled={creating}>
    {creating ? 'Creating…' : 'Start New Session'}
  </button>

  {#if loading}
    <p class="muted">Loading sessions…</p>
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
            <span class="room-time">{formatSessionTimestamp(room.created_at)}</span>
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
        <button class="danger-btn" onclick={handleClearAllSessions}>Clear All Sessions</button>
        <button class="danger-btn" onclick={handleResetHost}>Reset Host</button>
      </div>
    {:else}
      <div class="danger-row">
        <button class="danger-btn" onclick={handleResetHost}>Reset Host</button>
      </div>
    {/if}
  {:else}
    <p class="muted">No sessions yet — start one above.</p>
    <div class="danger-row">
      <button class="danger-btn" onclick={handleResetHost}>Reset Host</button>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    min-height: 100dvh;
    padding: 3rem 1.5rem;
    font-family: sans-serif;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .spotify-panel {
    width: 100%;
    max-width: 28rem;
    background: #1a1a1a;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .spotify-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .spotify-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .display-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.15rem 0.6rem;
    border-radius: 1rem;
    white-space: nowrap;
  }

  .pill-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .pill-good { background: #1db954; color: #000; }
  .pill-bad  { background: #e0a64a; color: #000; }

  .ghost-btn {
    background: transparent;
    color: #888;
    border: 1px solid #333;
    padding: 0.35rem 0.75rem;
    border-radius: 1rem;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .ghost-btn:hover:not(:disabled) { color: #fff; border-color: #555; }
  .ghost-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .reconnect-btn {
    color: #1db954;
    font-size: 0.8rem;
    font-weight: 600;
    text-decoration: none;
    border: 1px solid #1db954;
    padding: 0.35rem 0.75rem;
    border-radius: 1rem;
  }

  .reconnect-btn:hover { background: #1db95420; }

  .create-btn {
    background: #1db954;
    color: #000;
    border: none;
    padding: 0.75rem 2rem;
    border-radius: 2rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }

  .create-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .create-btn:hover:not(:disabled) { background: #1ed760; }

  .room-list {
    list-style: none;
    width: 100%;
    max-width: 28rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0;
    margin: 0;
  }

  .room-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: #1a1a1a;
    border-radius: 0.5rem;
    min-height: 44px;
    cursor: pointer;
  }

  .room-item:hover { background: #222; }
  .room-item:focus-visible { outline: 2px solid #1db954; outline-offset: 2px; }

  .room-code {
    font-family: monospace;
    font-weight: 700;
    font-size: 1.1rem;
    letter-spacing: 0.05em;
  }

  .room-time {
    flex: 1;
    color: #888;
    font-size: 0.85rem;
    text-align: right;
    margin-right: 0.25rem;
  }

  .trash-btn {
    background: transparent;
    border: none;
    color: #888;
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .trash-btn:hover { color: #e74c3c; background: #2a1a1a; }
  .trash-btn:focus-visible { outline: 2px solid #1db954; outline-offset: 2px; }

  .spotify-icon {
    width: 1.1rem;
    height: 1.1rem;
    fill: #1db954;
    flex-shrink: 0;
  }

  .danger-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .danger-btn {
    background: transparent;
    border: 1px solid #c0392b;
    color: #e74c3c;
    padding: 0.5rem 1.25rem;
    border-radius: 1rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .danger-btn:hover { background: #2a1a1a; }

  .muted { color: #888; font-size: 0.875rem; }
  .error { color: #e74c3c; font-size: 0.875rem; }
</style>
