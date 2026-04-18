<!--
  RoundConfigOverlay — modal overlay hosting the round-configuration surface.
  7-5 will add prop `variant: 'first-round' | 'mid-session'` and render a warning banner
  + confirmation dialog for the End Round entry point (when a round is live).
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { startRound } from '../lib/api.ts'
  import type { AudioPreset } from '../lib/api.ts'
  import { validateHostName, buildStartRoundPayload } from '../lib/roundConfig.ts'

  const VIBE_OPTIONS: { value: AudioPreset; label: string }[] = [
    { value: 'hype', label: 'Hype' },
    { value: 'deadpan', label: 'Deadpan' },
    { value: 'minimal', label: 'Minimal' },
  ]

  let audioPreset = $state<AudioPreset>('minimal')
  let allowCasualMode = $state(false)

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

  // ── Playlists (presets + search) ───────────────────────────────────────────

  interface Preset {
    name: string
    description: string
    playlistId: string
  }

  interface PlaylistResult {
    name: string
    owner: string
    trackCount: number
    playlistId: string
  }

  let presets = $state<Preset[]>([])
  let presetsLoading = $state(false)
  let presetsError = $state('')

  let searchQuery = $state('')
  let searchResults = $state<PlaylistResult[]>([])
  let searchLoading = $state(false)
  let searchError = $state('')

  let selectedPlaylist = $state<{ id: string; name: string } | null>(null)
  let playlistRegionEl = $state<HTMLDivElement | null>(null)

  const isSearching = $derived(searchQuery.trim().length > 0)

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

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  $effect(() => {
    const q = searchQuery.trim()
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    if (q === '') {
      searchResults = []
      searchError = ''
      searchLoading = false
      return
    }
    searchLoading = true
    searchError = ''
    const seq = ++searchSeq
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}`)
        if (seq !== searchSeq) return
        if (!res.ok) throw new Error('Search failed')
        const data = await res.json()
        if (seq !== searchSeq) return
        searchResults = data
        searchError = ''
        if (playlistRegionEl) playlistRegionEl.scrollTop = 0
      } catch {
        if (seq !== searchSeq) return
        searchResults = []
        searchError = 'Search failed. Please try again.'
      } finally {
        if (seq === searchSeq) searchLoading = false
      }
    }, 250)
  })

  $effect(() => {
    isSearching
    if (playlistRegionEl) playlistRegionEl.scrollTop = 0
  })

  function selectPreset(p: Preset) {
    selectedPlaylist = { id: p.playlistId, name: p.name }
  }

  function selectResult(r: PlaylistResult) {
    selectedPlaylist = { id: r.playlistId, name: r.name }
  }

  function clearSearch() {
    searchQuery = ''
  }

  function clearSelection() {
    selectedPlaylist = null
  }

  const selectionVisibleInCurrentList = $derived.by(() => {
    if (!selectedPlaylist) return true
    const id = selectedPlaylist.id
    if (isSearching) return searchResults.some((r) => r.playlistId === id)
    return presets.some((p) => p.playlistId === id)
  })

  const selectedSource = $derived(selectedPlaylist?.id ?? null)

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
    { value: 0, label: 'Now' },
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 15, label: '15s' },
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
        audioPreset,
        allowCasualMode,
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

      <!-- Playlist picker: search input + unified grid region -->
      <div class="playlist-picker">
        <div class="search-bar">
          <input
            class="search-input"
            type="text"
            role="searchbox"
            placeholder="Search playlists…"
            aria-label="Search playlists"
            inputmode="search"
            enterkeyhint="search"
            autocomplete="off"
            bind:value={searchQuery}
          />
          {#if searchQuery !== ''}
            <button
              class="clear-btn"
              type="button"
              aria-label="Clear search"
              onclick={clearSearch}
            >✕</button>
          {/if}
        </div>

        {#if selectedPlaylist && !selectionVisibleInCurrentList}
          <div class="selected-chip">
            <span class="selected-chip-label">Selected: {selectedPlaylist.name}</span>
            <button
              class="selected-chip-clear"
              type="button"
              aria-label="Clear selection"
              onclick={clearSelection}
            >✕</button>
          </div>
        {/if}

        <div
          class="playlist-region"
          role="region"
          aria-live="polite"
          bind:this={playlistRegionEl}
        >
          {#if isSearching}
            {#if searchLoading}
              <p class="status-msg">Searching…</p>
            {:else if searchError}
              <p class="error-msg">{searchError}</p>
            {:else if searchResults.length === 0}
              <p class="status-msg">No playlists found for "{searchQuery.trim()}"</p>
            {:else}
              <div class="preset-grid">
                {#each searchResults as result (result.playlistId)}
                  <button
                    class="preset-card"
                    class:selected={selectedPlaylist?.id === result.playlistId}
                    aria-pressed={selectedPlaylist?.id === result.playlistId}
                    onclick={() => selectResult(result)}
                  >
                    <span class="preset-name">{result.name}</span>
                    <span class="preset-desc">{result.owner} · {result.trackCount} tracks</span>
                  </button>
                {/each}
              </div>
            {/if}
          {:else if presetsLoading}
            <p class="status-msg">Loading genres…</p>
          {:else if presetsError}
            <p class="error-msg">{presetsError}</p>
          {:else}
            <div class="preset-grid">
              {#each presets as preset (preset.playlistId)}
                <button
                  class="preset-card"
                  class:selected={selectedPlaylist?.id === preset.playlistId}
                  aria-pressed={selectedPlaylist?.id === preset.playlistId}
                  onclick={() => selectPreset(preset)}
                >
                  <span class="preset-name">{preset.name}</span>
                  <span class="preset-desc">{preset.description}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Vibe preset pills -->
      <section class="option-section">
        <h2 class="option-label">Vibe</h2>
        <div class="pill-group" role="group" aria-label="Vibe preset">
          {#each VIBE_OPTIONS as opt (opt.value)}
            <button
              class="pill"
              class:selected={audioPreset === opt.value}
              onclick={() => audioPreset = opt.value}
              aria-pressed={audioPreset === opt.value}
            >{opt.label}</button>
          {/each}
        </div>
      </section>

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

      <!-- Title reveal pills -->
      <section class="option-section">
        <h2 class="option-label">Title Reveal</h2>
        <div class="pill-group" role="group" aria-label="Title reveal timing">
          {#each REVEAL_OPTIONS as opt (String(opt.value))}
            <button
              class="pill"
              class:selected={titleRevealDelay === opt.value}
              onclick={() => titleRevealDelay = opt.value}
              aria-pressed={titleRevealDelay === opt.value}
            >{opt.label}</button>
          {/each}
        </div>
      </section>

      <!-- Casual Mode toggle -->
      <section class="option-section">
        <h2 class="option-label">Casual Mode</h2>
        <div class="pill-group" role="group" aria-label="Casual mode">
          <button
            class="pill"
            class:selected={!allowCasualMode}
            onclick={() => allowCasualMode = false}
            aria-pressed={!allowCasualMode}
          >Off</button>
          <button
            class="pill"
            class:selected={allowCasualMode}
            onclick={() => allowCasualMode = true}
            aria-pressed={allowCasualMode}
          >Allow</button>
        </div>
      </section>

      {#if needsHostName}
        <section class="option-section">
          <label class="option-label" for="host-name-input">Your name</label>
          <input
            id="host-name-input"
            class="host-name-input"
            type="text"
            maxlength="30"
            placeholder="Play along!"
            aria-label="Your name"
            bind:value={hostNameInput}
          />
          {#if hostNameError}
            <p class="source-error">{hostNameError}</p>
          {/if}
        </section>
      {/if}

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
    background: var(--bg);
    color: var(--fg);
    border: var(--rule-heavy) solid var(--rule);
    width: 100%;
    max-width: 480px;
    padding: 3rem 1rem 1.5rem;
  }

  .close-btn {
    position: absolute;
    top: 0.35rem;
    right: 0.35rem;
    width: 36px;
    height: 36px;
    min-width: 36px;
    min-height: 36px;
    padding: 0;
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: var(--fg);
    background: var(--bg-2);
  }
  .close-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .config-panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .host-name-input {
    padding: 0.6rem 0.75rem;
    min-height: 44px;
    background: var(--bg);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    font-size: 1rem;
    font-family: inherit;
  }
  .host-name-input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Playlist picker */
  .playlist-picker {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .search-bar {
    position: relative;
    display: flex;
    align-items: center;
  }

  .clear-btn {
    position: absolute;
    right: 0.25rem;
    top: 50%;
    transform: translateY(-50%);
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clear-btn:hover {
    color: var(--fg);
    background: var(--bg-2);
  }

  .selected-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem 0.35rem 0.75rem;
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--accent);
    color: var(--fg);
    font-size: 0.85rem;
    align-self: flex-start;
    max-width: 100%;
  }

  .selected-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-chip-clear {
    min-width: 28px;
    min-height: 28px;
    background: none;
    border: none;
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .selected-chip-clear:hover {
    color: var(--fg);
    background: var(--bg-2);
  }

  .playlist-region {
    min-height: 280px;
    max-height: 280px;
    overflow-y: auto;
    padding: 0.25rem;
  }

  .status-msg {
    color: var(--fg-muted);
    text-align: center;
    padding: 2rem 0;
  }

  .error-msg {
    color: var(--danger);
    padding: 1rem 0;
    text-align: center;
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
    gap: 0.15rem;
    padding: 0.5rem 0.75rem;
    min-height: 56px;
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    text-align: left;
  }

  .preset-card.selected {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .preset-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .preset-name {
    font-weight: 600;
    font-size: 0.95rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
  }

  .preset-desc {
    font-size: 0.8rem;
    opacity: 0.8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Search input */
  .search-input {
    width: 100%;
    padding: 0.6rem 3rem 0.6rem 0.75rem;
    min-height: 44px;
    background: var(--bg);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    font-size: 1rem;
    font-family: inherit;
  }
  .search-input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .search-input::placeholder {
    color: var(--fg-muted);
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
    color: var(--fg-muted);
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
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    font-size: 0.9rem;
  }

  .pill.selected {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Start button */
  .source-error {
    color: var(--danger);
    font-size: 0.9rem;
  }

  .start-btn {
    width: 100%;
    padding: 1rem;
    min-height: 52px;
    background: var(--accent);
    border: var(--rule-thick) solid var(--accent);
    color: var(--accent-fg);
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    margin-top: 0.5rem;
  }
  .start-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .start-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
