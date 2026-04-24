<!--
  RoundConfigOverlay — modal overlay hosting the round-configuration surface.
  7-5 will add prop `variant: 'first-round' | 'mid-session'` and render a warning banner
  + confirmation dialog for the End Round entry point (when a round is live).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { X, ArrowRight, CaretRight, Info } from 'phosphor-svelte'
  import { startRound } from '../lib/api.ts'
  import type { AudioPreset } from '../lib/api.ts'
  import type { TitleRevealDelay } from '../lib/bingo.ts'
  import { validateHostName, buildStartRoundPayload } from '../lib/roundConfig.ts'
  import { readHostPrefs, writeHostPrefs } from '../lib/hostPrefs.ts'
  import AdvancedSettings from './AdvancedSettings.svelte'
  import { useOverlay } from '../lib/useOverlay.svelte.ts'
  import { extractPlaylistId } from '../lib/playlistUrl.ts'

  function ticketIn(_node: Element) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { duration: 0, css: () => '' }
    }
    return {
      duration: 380,
      delay: 60,
      easing: cubicOut,
      css: (t: number) => {
        const translateY = (1 - t) * -100
        const rotateX = (1 - t) * 6
        return `transform: perspective(900px) translateY(${translateY}%) rotateX(${rotateX}deg);`
      }
    }
  }

  function ticketOut(_node: Element) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { duration: 0, css: () => '' }
    }
    return {
      duration: 320,
      easing: (t: number) => t * t,
      css: (t: number) => {
        const translateY = (1 - t) * 120
        const rotateX = (1 - t) * -8
        const opacity = t < 0.3 ? t / 0.3 : 1
        return `transform: perspective(900px) translateY(${translateY}%) rotateX(${rotateX}deg); opacity: ${opacity};`
      }
    }
  }

  type ClipDuration = number | 'full'

  let audioPreset = $state<AudioPreset>('minimal')
  let allowCasualMode = $state(false)
  let clipDuration = $state<ClipDuration>(30)
  let titleRevealDelay = $state<TitleRevealDelay>(10)

  let {
    code,
    initialHostName,
    roundActive = false,
    topOffset,
    onClose,
    onStarted,
    onHostNameMaybeSaved,
  }: {
    code: string
    initialHostName: string | null
    roundActive?: boolean
    topOffset?: number
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
  let spotifyDegraded = $state(false)

  let searchQuery = $state('')
  let searchResults = $state<PlaylistResult[]>([])
  let searchLoading = $state(false)
  let searchError = $state('')
  let searchOffset = $state(0)
  let searchHasMore = $state(false)
  let paginating = $state(false)
  let showPlaylistTip = $state(false)

  let selectedPlaylist = $state<{ id: string; name: string } | null>(null)
  let playlistRegionEl = $state<HTMLDivElement | null>(null)

  const isSearching = $derived(searchQuery.trim().length > 0)

  async function loadPresets() {
    presetsLoading = true
    presetsError = ''
    spotifyDegraded = false
    try {
      const res = await fetch('/api/music/presets')
      if (res.status === 503) {
        spotifyDegraded = true
        presetsError = 'Spotify connection expired.'
      } else if (!res.ok) {
        throw new Error('Failed to load genres')
      } else {
        presets = await res.json()
      }
    } catch {
      presetsError = 'Failed to load genres. Please try again.'
    } finally {
      presetsLoading = false
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  const PAGE_SIZE = 10

  $effect(() => {
    const q = searchQuery.trim()
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    // Bump seq unconditionally so any in-flight paginate from a prior query
    // is invalidated — including the empty-query (clear) branch where no
    // new search will fire to overwrite stale appends.
    const seq = ++searchSeq
    if (q === '') {
      searchResults = []
      searchError = ''
      searchLoading = false
      searchOffset = 0
      searchHasMore = false
      paginating = false
      return
    }
    // URL/URI paste branch — skip debounced keyword search
    const pastedId = extractPlaylistId(q)
    if (pastedId) {
      searchLoading = true
      searchError = ''
      searchResults = []
      searchHasMore = false
      searchOffset = 0
      paginating = false
      void (async () => {
        try {
          const res = await fetch(`/api/music/tracks/${pastedId}`)
          if (seq !== searchSeq) return
          if (res.status === 404 || res.status === 401) {
            searchError =
              "Couldn't load this playlist. Is it set to Public in Spotify? (Private playlists can't be read.)"
            return
          }
          if (!res.ok) {
            searchError = 'Failed to load. Try again.'
            return
          }
          const tracks = (await res.json()) as { id: string }[]
          if (seq !== searchSeq) return
          const name = 'Pasted playlist'
          searchResults = [{ playlistId: pastedId, name, owner: '', trackCount: tracks.length }]
          searchHasMore = false
          selectedPlaylist = { id: pastedId, name }
          if (playlistRegionEl) playlistRegionEl.scrollTop = 0
        } catch {
          if (seq !== searchSeq) return
          searchError = 'Failed to load. Try again.'
        } finally {
          if (seq === searchSeq) searchLoading = false
        }
      })()
      return
    }

    searchLoading = true
    searchError = ''
    searchOffset = 0
    searchHasMore = false
    paginating = false
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}&offset=0`)
        if (seq !== searchSeq) return
        if (!res.ok) throw new Error('Search failed')
        const data = await res.json() as { results: PlaylistResult[]; hasMore: boolean }
        if (seq !== searchSeq) return
        searchResults = data.results
        searchHasMore = data.hasMore
        searchOffset = PAGE_SIZE
        searchError = ''
        if (playlistRegionEl) playlistRegionEl.scrollTop = 0
        fillIfNotScrollable(seq)
      } catch {
        if (seq !== searchSeq) return
        searchResults = []
        searchHasMore = false
        searchError = 'Search failed. Please try again.'
      } finally {
        if (seq === searchSeq) searchLoading = false
      }
    }, 250)
  })

  async function loadMoreResults() {
    if (paginating || !searchHasMore || !isSearching) return
    const q = searchQuery.trim()
    if (q === '') return
    const seq = searchSeq
    const offset = searchOffset
    paginating = true
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}&offset=${offset}`)
      if (seq !== searchSeq) return
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json() as { results: PlaylistResult[]; hasMore: boolean }
      if (seq !== searchSeq) return
      searchResults = [...searchResults, ...data.results]
      searchOffset = offset + PAGE_SIZE
      searchHasMore = data.hasMore
    } catch {
      if (seq !== searchSeq) return
      // Silent failure on subsequent pages — stop paginating, keep existing results.
      searchHasMore = false
    } finally {
      if (seq === searchSeq) {
        paginating = false
        fillIfNotScrollable(seq)
      }
    }
  }

  // If the region isn't tall enough to scroll but more pages are available,
  // auto-paginate. Handles short first pages (Spotify filtering nulls) and
  // very sparse result sets where a scroll event would never fire.
  function fillIfNotScrollable(seq: number) {
    if (!playlistRegionEl || !searchHasMore) return
    if (seq !== searchSeq) return
    requestAnimationFrame(() => {
      if (seq !== searchSeq) return
      if (!playlistRegionEl || paginating) return
      if (playlistRegionEl.scrollHeight <= playlistRegionEl.clientHeight + 80) {
        void loadMoreResults()
      }
    })
  }

  function handleRegionScroll() {
    if (!playlistRegionEl) return
    const el = playlistRegionEl
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      void loadMoreResults()
    }
  }

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
      writeHostPrefs({ clipDuration, titleRevealDelay, audioPreset, allowCasualMode })
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

  let panelEl = $state<HTMLElement | null>(null)
  useOverlay({ onClose: () => requestClose(), root: () => panelEl })

  onMount(() => {
    const prefs = readHostPrefs()
    if (prefs) {
      clipDuration = prefs.clipDuration
      titleRevealDelay = prefs.titleRevealDelay
      audioPreset = prefs.audioPreset
      allowCasualMode = prefs.allowCasualMode
    }
    loadPresets()
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  style:padding-top={topOffset != null ? `${topOffset}px` : undefined}
  onclick={requestClose}
  in:fade={{ duration: 80 }} out:fade={{ duration: 220 }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="panel"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-label="Round configuration"
    in:ticketIn out:ticketOut
    bind:this={panelEl}
  >
    <header class="panel-header">
      <h2 class="picker-header">Pick a playlist</h2>
      <button class="close-btn" onclick={requestClose} aria-label="Close"><X size={16} weight="bold" aria-hidden="true" /></button>
    </header>

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
            ><X size={16} weight="bold" aria-hidden="true" /></button>
          {/if}
          <button
            class="info-tip-btn"
            type="button"
            aria-label="Playlist tip"
            aria-expanded={showPlaylistTip}
            onclick={() => { showPlaylistTip = !showPlaylistTip }}
          ><Info size={14} aria-hidden="true" /></button>
        </div>
        {#if showPlaylistTip}
          <div class="playlist-tip" role="note">
            <strong>Tip — use your own playlist</strong>
            <p>Paste a Spotify playlist link here (e.g. <code>open.spotify.com/playlist/…</code>) and we'll load it directly.</p>
            <p>Note: the playlist must be set to <strong>Public</strong> in Spotify. Private playlists aren't readable by the app.</p>
          </div>
        {/if}

        {#if selectedPlaylist && !selectionVisibleInCurrentList}
          <div class="selected-chip">
            <span class="selected-chip-label">Selected: {selectedPlaylist.name}</span>
            <button
              class="selected-chip-clear"
              type="button"
              aria-label="Clear selection"
              onclick={clearSelection}
            ><X size={16} weight="bold" aria-hidden="true" /></button>
          </div>
        {/if}

        <div
          class="playlist-region"
          role="region"
          aria-live="polite"
          bind:this={playlistRegionEl}
          onscroll={handleRegionScroll}
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
              {#if paginating}
                <p class="status-msg status-msg-footer">Loading more…</p>
              {/if}
            {/if}
          {:else if presetsLoading}
            <p class="status-msg">Loading genres…</p>
          {:else if presetsError}
            <div class="error-msg">
              <p>{presetsError}</p>
              {#if spotifyDegraded}
                <a class="reconnect-btn" href="/auth/login">Reconnect Spotify</a>
              {/if}
            </div>
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

      <details class="advanced-details">
        <summary class="advanced-summary">
          <span>Settings</span>
          <CaretRight class="chevron" aria-hidden="true" weight="bold" size={14} />
        </summary>
        <div class="advanced-body">
          <AdvancedSettings
            mode="pre-round"
            {clipDuration}
            {titleRevealDelay}
            {audioPreset}
            {allowCasualMode}
            onClipDurationChange={(v) => { clipDuration = v }}
            onTitleRevealDelayChange={(v) => { titleRevealDelay = v }}
            onAudioPresetChange={(v) => { audioPreset = v }}
            onAllowCasualModeChange={(v) => { allowCasualMode = v }}
          />
        </div>
      </details>

      {#if needsHostName}
        <section class="option-section">
          <label class="option-label" for="host-name-input">Your name</label>
          <input
            id="host-name-input"
            class="host-name-input"
            type="text"
            maxlength="30"
            placeholder="Host"
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
      {#if roundActive}
        <p class="replace-round-note">Starting this round will end the current one for everyone.</p>
      {/if}
      <button
        class="start-btn"
        onclick={handleStartRound}
        disabled={submitting}
      >
        {#if submitting}
          Starting…
        {:else}
          {roundActive ? 'Start New Round' : 'Start Round'} <ArrowRight size={16} aria-hidden="true" />
        {/if}
      </button>

    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop-bg);
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
    border: var(--rule-thick) solid var(--rule);
    width: 100%;
    max-width: 480px;
    padding: 0;
    transform-origin: top center;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 1.15rem 0.5rem 0.95rem 1.25rem;
    border-bottom: var(--rule-thin) solid var(--rule);
  }

  .close-btn {
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
    padding: 1.25rem 1rem 1.5rem;
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

  .picker-header {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    color: var(--fg);
    margin: 0;
  }

  .search-bar {
    position: relative;
    display: flex;
    align-items: center;
  }

  .clear-btn {
    position: absolute;
    right: 2rem;
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

  .info-tip-btn {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    min-width: 32px;
    min-height: 44px;
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.25rem;
  }

  .info-tip-btn:hover { color: var(--fg); }
  .info-tip-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .playlist-tip {
    background: var(--bg-2);
    border: var(--rule-thin) solid var(--rule);
    padding: 0.65rem 0.75rem;
    font-size: 0.82rem;
    color: var(--fg);
  }

  .playlist-tip strong { font-weight: 700; }

  .playlist-tip p {
    margin: 0.35rem 0 0;
    color: var(--fg-muted);
  }

  .playlist-tip code {
    font-family: monospace;
    font-size: 0.8rem;
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

  .status-msg-footer {
    padding: 0.75rem 0 0.25rem;
    font-size: 0.85rem;
  }

  .error-msg {
    color: var(--danger);
    padding: 1rem 0;
    text-align: center;
  }

  .reconnect-btn {
    display: inline-block;
    margin-top: 0.5rem;
    padding: 0.4rem 1rem;
    background: var(--accent);
    color: var(--bg);
    font-size: 0.85rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }

  /* Genre preset cards */
  .preset-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
    padding: 0.6rem 4.75rem 0.6rem 0.75rem;
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

  /* Advanced settings disclosure */
  .advanced-details {
    border: var(--rule-thin) solid var(--rule);
    background: var(--bg-2);
  }

  .advanced-summary {
    cursor: pointer;
    padding: 0.6rem 0.75rem;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--fg);
    user-select: none;
    list-style: none;
  }
  .advanced-summary::-webkit-details-marker { display: none; }
  .advanced-summary::marker { content: ''; }
  .advanced-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  :global(.chevron) {
    color: var(--fg-muted);
    transition: transform 0.15s ease;
    display: inline-block;
  }
  .advanced-details[open] :global(.chevron) {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.chevron) { transition: none; }
  }

  .advanced-body {
    padding: 0.75rem;
    border-top: var(--rule-thin) solid var(--rule);
    background: var(--bg);
  }

  /* Start button */
  .source-error {
    color: var(--danger);
    font-size: 0.9rem;
  }

  .replace-round-note {
    color: var(--fg-muted);
    font-size: 0.85rem;
    margin: 0;
    text-align: center;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
  }
  .start-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .start-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
