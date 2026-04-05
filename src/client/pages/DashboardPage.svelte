<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getRooms,
    createRoom,
    deleteRoom,
    getMe,
    getAuthStatus,
    logout,
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

  async function handleDisconnect() {
    try {
      await logout()
    } catch {
      // Even if logout fails, force a cold reload so the app re-reads auth state.
    }
    window.location.href = '/'
  }

  const degraded = $derived(authStatus?.degraded === true)
</script>

<div class="dashboard">
  <h1>BangerBingo</h1>

  <section class="spotify-panel">
    <div class="spotify-row">
      <div class="spotify-info">
        <span class="display-name">{me?.display_name ?? '—'}</span>
        <span class="pill" class:pill-good={!degraded} class:pill-bad={degraded}>
          {degraded ? 'Reconnect needed' : 'Connected'}
        </span>
      </div>
      <button class="ghost-btn" onclick={handleDisconnect}>Disconnect</button>
    </div>
    {#if degraded}
      <a class="reconnect-link" href="/auth/login">Reconnect Spotify</a>
    {/if}
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
  {:else}
    <p class="muted">No sessions yet — start one above.</p>
  {/if}
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    min-height: 100vh;
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

  .ghost-btn:hover { color: #fff; border-color: #555; }

  .reconnect-link {
    color: #1db954;
    font-size: 0.85rem;
    text-decoration: underline;
  }

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

  .muted { color: #888; font-size: 0.875rem; }
  .error { color: #e74c3c; font-size: 0.875rem; }
</style>
