<!--
  RoundConfigOverlay — modal overlay hosting the round-configuration surface.
  7-5 will add prop `variant: 'first-round' | 'mid-session'` and render a warning banner
  + confirmation dialog for the End Round entry point (when a round is live).
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { startRound } from '../lib/api.ts'
  import { validateHostName, buildStartRoundPayload } from '../lib/roundConfig.ts'

  let {
    code,
    initialHostName,
    onClose,
    onStarted,
    onHostNameMaybeSaved,
  }: {
    code: string
    initialHostName: string | null
    onClose: () => void
    onStarted: (submittedHostName: string | null) => void
    // Called when a hostName was submitted to the server but startRound itself failed.
    // The server persists host_name BEFORE the Spotify fetch, so on error the name is
    // likely already saved — parent should update its roomHostName so a retry doesn't
    // re-show the name field (and silently have the second value ignored).
    onHostNameMaybeSaved?: (name: string) => void
  } = $props()

  // ── Host name field ────────────────────────────────────────────────────────

  const needsHostName = $derived(initialHostName === null)
  let hostNameInput = $state('')
  let hostNameError = $state('')

  // ── Tab ────────────────────────────────────────────────────────────────────

  type Tab = 'genre' | 'search'
  let activeTab = $state<Tab>('genre')

  // ── Genre tab ──────────────────────────────────────────────────────────────

  interface Preset {
    name: string
    description: string
    playlistId: string
  }

  let presets = $state<Preset[]>([])
  let presetsLoading = $state(false)
  let presetsError = $state('')
  let selectedPresetId = $state<string | null>(null)

  async function loadPresets() {
    presetsLoading = true
    presetsError = ''
    try {
      const res = await fetch('/api/music/presets')
      if (!res.ok) throw new Error('Failed to load genres')
      presets = await res.json()
    } catch {
      presetsError = 'Failed to load genres. Please try again.'
    } finally {
      presetsLoading = false
    }
  }

  // ── Search tab ─────────────────────────────────────────────────────────────

  interface PlaylistResult {
    name: string
    owner: string
    trackCount: number
    playlistId: string
  }

  let searchQuery = $state('')
  let searchResults = $state<PlaylistResult[]>([])
  let searchLoading = $state(false)
  let searchError = $state('')
  let selectedPlaylistId = $state<string | null>(null)

  async function handleSearch(e: Event) {
    e.preventDefault()
    if (!searchQuery.trim()) return
    searchLoading = true
    searchError = ''
    searchResults = []
    selectedPlaylistId = null
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(searchQuery.trim())}`)
      if (!res.ok) throw new Error('Search failed')
      searchResults = await res.json()
    } catch {
      searchError = 'Search failed. Please try again.'
    } finally {
      searchLoading = false
    }
  }

  const selectedSource = $derived(
    activeTab === 'genre' ? selectedPresetId : selectedPlaylistId
  )

  // ── Clip duration ──────────────────────────────────────────────────────────

  const CLIP_OPTIONS: { value: number | 'full'; label: string }[] = [
    { value: 20, label: '20s' },
    { value: 30, label: '30s' },
    { value: 45, label: '45s' },
    { value: 60, label: '60s' },
    { value: 'full', label: 'Full Song' },
  ]

  let clipDuration = $state<number | 'full'>(30)

  // ── Title reveal ───────────────────────────────────────────────────────────

  const REVEAL_OPTIONS: { value: number | null; label: string }[] = [
    { value: 0, label: 'Immediately' },
    { value: 5, label: 'After 5s' },
    { value: 10, label: 'After 10s' },
    { value: 15, label: 'After 15s' },
    { value: null, label: 'Never' },
  ]

  let titleRevealDelay = $state<number | null>(5)

  // ── Start round ────────────────────────────────────────────────────────────

  let submitting = $state(false)
  let sourceError = $state('')

  async function handleStartRound() {
    if (submitting) return
    hostNameError = ''
    sourceError = ''

    const nameResult = validateHostName(hostNameInput, needsHostName)
    if (nameResult.error) {
      hostNameError = nameResult.error
      return
    }

    if (!selectedSource) {
      sourceError = 'Select a genre or playlist first'
      return
    }

    submitting = true
    try {
      const payload = buildStartRoundPayload(
        selectedSource,
        clipDuration,
        titleRevealDelay,
        nameResult.trimmed,
      )
      await startRound(code, payload)
      onStarted(nameResult.trimmed)
    } catch (err) {
      sourceError = err instanceof Error ? err.message : 'Failed to start round'
      // Server persists host_name before the Spotify fetch, so if we submitted a name
      // it's almost certainly already saved even though startRound failed. Tell the
      // parent so a retry doesn't re-show the name field.
      if (nameResult.trimmed && onHostNameMaybeSaved) onHostNameMaybeSaved(nameResult.trimmed)
    } finally {
      submitting = false
    }
  }

  // ── Modal lifecycle ────────────────────────────────────────────────────────

  function requestClose() {
    if (submitting) return
    onClose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') requestClose()
  }

  onMount(() => {
    loadPresets()
    window.addEventListener('keydown', handleKeydown)
  })

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onclick={requestClose}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="panel" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Round configuration">
    <button class="close-btn" onclick={requestClose} aria-label="Close">✕</button>

    <div class="config-panel">

      {#if needsHostName}
        <section class="option-section">
          <label class="option-label" for="host-name-input">Your name</label>
          <input
            id="host-name-input"
            class="name-input"
            type="text"
            maxlength="30"
            required
            aria-label="Your name"
            bind:value={hostNameInput}
          />
          {#if hostNameError}
            <p class="source-error">{hostNameError}</p>
          {/if}
        </section>
      {/if}

      <!-- Tab bar -->
      <div class="tab-bar" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'genre'}
          class="tab-btn"
          class:active={activeTab === 'genre'}
          onclick={() => activeTab = 'genre'}
        >Genre</button>
        <button
          role="tab"
          aria-selected={activeTab === 'search'}
          class="tab-btn"
          class:active={activeTab === 'search'}
          onclick={() => activeTab = 'search'}
        >Search</button>
      </div>

      <!-- Genre tab -->
      {#if activeTab === 'genre'}
        <div class="tab-panel" role="tabpanel">
          {#if presetsLoading}
            <p class="status-msg">Loading genres…</p>
          {:else if presetsError}
            <p class="error-msg">{presetsError}</p>
          {:else}
            <div class="preset-grid">
              {#each presets as preset (preset.playlistId)}
                <button
                  class="preset-card"
                  class:selected={selectedPresetId === preset.playlistId}
                  onclick={() => selectedPresetId = preset.playlistId}
                >
                  <span class="preset-name">{preset.name}</span>
                  <span class="preset-desc">{preset.description}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Search tab -->
      {#if activeTab === 'search'}
        <div class="tab-panel" role="tabpanel">
          <form class="search-form" onsubmit={handleSearch}>
            <input
              class="search-input"
              type="text"
              placeholder="Search playlists…"
              bind:value={searchQuery}
              aria-label="Search playlists"
            />
            <button class="search-btn" type="submit" disabled={searchLoading}>
              {searchLoading ? 'Searching…' : 'Search'}
            </button>
          </form>
          {#if searchError}
            <p class="error-msg">{searchError}</p>
          {:else if searchResults.length > 0}
            <ul class="search-results">
              {#each searchResults as result (result.playlistId)}
                <li>
                  <button
                    class="result-card"
                    class:selected={selectedPlaylistId === result.playlistId}
                    onclick={() => selectedPlaylistId = result.playlistId}
                  >
                    <span class="result-name">{result.name}</span>
                    <span class="result-meta">{result.owner} · {result.trackCount} tracks</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <!-- Clip duration pills -->
      <section class="option-section">
        <h2 class="option-label">Clip Duration</h2>
        <div class="pill-group" role="group" aria-label="Clip duration">
          {#each CLIP_OPTIONS as opt (opt.value)}
            <button
              class="pill"
              class:selected={clipDuration === opt.value}
              onclick={() => clipDuration = opt.value}
              aria-pressed={clipDuration === opt.value}
            >{opt.label}</button>
          {/each}
        </div>
      </section>

      <!-- Title reveal radios -->
      <section class="option-section">
        <h2 class="option-label">Title Reveal</h2>
        <div class="radio-group" role="radiogroup" aria-label="Title reveal timing">
          {#each REVEAL_OPTIONS as opt (String(opt.value))}
            <label class="radio-label">
              <input
                type="radio"
                name="titleReveal"
                checked={titleRevealDelay === opt.value}
                onchange={() => titleRevealDelay = opt.value}
              />
              {opt.label}
            </label>
          {/each}
        </div>
      </section>

      <!-- Error + Start button -->
      {#if sourceError}
        <p class="source-error">{sourceError}</p>
      {/if}
      <button
        class="start-btn"
        onclick={handleStartRound}
        disabled={submitting}
      >
        {submitting ? 'Starting…' : 'Start Round →'}
      </button>

    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 100;
    overflow-y: auto;
    padding: 2rem 1rem;
  }

  .panel {
    position: relative;
    background: #1a1a1a;
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    padding: 2.5rem 1rem 1.5rem;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    font-family: sans-serif;
  }

  .close-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    color: #aaa;
    font-size: 1.25rem;
    cursor: pointer;
    border-radius: 8px;
  }

  .close-btn:hover {
    color: #fff;
    background: #2a2a2a;
  }

  .config-panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .name-input {
    padding: 0.6rem 0.75rem;
    min-height: 44px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
    font-family: inherit;
  }

  /* Tab bar */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid #333;
  }

  .tab-btn {
    flex: 1;
    padding: 0.75rem;
    min-height: 44px;
    background: none;
    border: none;
    color: #aaa;
    font-size: 1rem;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }

  .tab-btn.active {
    color: #fff;
    border-bottom-color: #1db954;
  }

  /* Tab panels */
  .tab-panel {
    min-height: 200px;
  }

  .status-msg {
    color: #aaa;
    text-align: center;
    padding: 2rem 0;
  }

  .error-msg {
    color: #e05252;
    padding: 1rem 0;
  }

  /* Genre preset cards */
  .preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .preset-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem;
    min-height: 72px;
    background: #2a2a2a;
    border: 2px solid transparent;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    text-align: left;
  }

  .preset-card.selected {
    background: #1db954;
    border-color: #1db954;
  }

  .preset-name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .preset-desc {
    font-size: 0.8rem;
    opacity: 0.8;
  }

  /* Search */
  .search-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .search-input {
    flex: 1;
    padding: 0.6rem 0.75rem;
    min-height: 44px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
    font-family: inherit;
  }

  .search-input::placeholder {
    color: #888;
  }

  .search-btn {
    padding: 0.6rem 1rem;
    min-height: 44px;
    min-width: 80px;
    background: #333;
    border: 1px solid #555;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .search-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .search-results {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .result-card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.75rem;
    min-height: 60px;
    width: 100%;
    background: #2a2a2a;
    border: 2px solid transparent;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    text-align: left;
  }

  .result-card.selected {
    background: #1db954;
    border-color: #1db954;
  }

  .result-name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .result-meta {
    font-size: 0.8rem;
    opacity: 0.75;
  }

  /* Options */
  .option-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .option-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Clip pills */
  .pill-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .pill {
    padding: 0.5rem 1rem;
    min-height: 44px;
    min-width: 60px;
    background: #2a2a2a;
    border: 2px solid transparent;
    border-radius: 999px;
    color: #fff;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .pill.selected {
    background: #1db954;
    border-color: #1db954;
  }

  /* Title reveal radios */
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
    cursor: pointer;
    font-size: 0.95rem;
    padding: 0.25rem 0;
  }

  .radio-label input[type='radio'] {
    width: 18px;
    height: 18px;
    accent-color: #1db954;
    cursor: pointer;
  }

  /* Start button */
  .source-error {
    color: #e05252;
    font-size: 0.9rem;
  }

  .start-btn {
    width: 100%;
    padding: 1rem;
    min-height: 52px;
    background: #1db954;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    margin-top: 0.5rem;
  }

  .start-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
