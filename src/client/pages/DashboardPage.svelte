<script lang="ts">
  import { onMount } from 'svelte'
  import { getRooms, createRoom, type RoomSummary } from '../lib/api.ts'

  let { onEnterLobby }: { onEnterLobby: (code: string) => void } = $props()

  let rooms = $state<RoomSummary[]>([])
  let loading = $state(true)
  let creating = $state(false)
  let error = $state('')

  onMount(async () => {
    try {
      rooms = await getRooms()
    } catch {
      error = 'Failed to load rooms'
    } finally {
      loading = false
    }
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
</script>

<div class="dashboard">
  <h1>BangerBingo</h1>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <button class="create-btn" onclick={handleCreateRoom} disabled={creating}>
    {creating ? 'Creating…' : 'Create Room'}
  </button>

  {#if loading}
    <p class="muted">Loading rooms…</p>
  {:else if rooms.length > 0}
    <ul class="room-list">
      {#each rooms as room (room.code)}
        <li class="room-item">
          <span class="room-code">{room.code}</span>
          <button onclick={() => handleOpenRoom(room.code)}>Open</button>
        </li>
      {/each}
    </ul>
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

  .create-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .create-btn:hover:not(:disabled) {
    background: #1ed760;
  }

  .room-list {
    list-style: none;
    width: 100%;
    max-width: 28rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .room-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: #1a1a1a;
    border-radius: 0.5rem;
  }

  .room-item .room-code {
    font-family: monospace;
    font-weight: 700;
    font-size: 1.1rem;
    letter-spacing: 0.05em;
  }

  .room-item button {
    background: #333;
    color: #fff;
    border: none;
    padding: 0.4rem 1rem;
    border-radius: 1rem;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .room-item button:hover {
    background: #444;
  }

  .muted {
    color: #888;
    font-size: 0.875rem;
  }

  .error {
    color: #e74c3c;
    font-size: 0.875rem;
  }
</style>
