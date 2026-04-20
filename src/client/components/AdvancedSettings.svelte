<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { AudioPreset } from '../lib/api.ts'
  import { patchRoundConfig } from '../lib/api.ts'
  import { writeHostPrefs } from '../lib/hostPrefs.ts'
  import InfoTooltip from './InfoTooltip.svelte'
  import type { TitleRevealDelay } from '../lib/bingo.ts'

  type ClipDuration = number | 'full'

  type Mode = 'pre-round' | 'live'
  type RowKey = 'clipDuration' | 'titleRevealDelay' | 'audioPreset' | 'allowCasualMode'

  let {
    mode,
    code,
    clipDuration,
    titleRevealDelay,
    audioPreset,
    allowCasualMode,
    onClipDurationChange,
    onTitleRevealDelayChange,
    onAudioPresetChange,
    onAllowCasualModeChange,
  }: {
    mode: Mode
    code?: string
    clipDuration: ClipDuration
    titleRevealDelay: TitleRevealDelay
    audioPreset: AudioPreset
    allowCasualMode: boolean
    onClipDurationChange?: (v: ClipDuration) => void
    onTitleRevealDelayChange?: (v: TitleRevealDelay) => void
    onAudioPresetChange?: (v: AudioPreset) => void
    onAllowCasualModeChange?: (v: boolean) => void
  } = $props()

  const CLIP_OPTIONS: { value: ClipDuration; label: string }[] = [
    { value: 20, label: '20s' },
    { value: 30, label: '30s' },
    { value: 45, label: '45s' },
    { value: 60, label: '60s' },
    { value: 'full', label: 'Full' },
  ]

  const REVEAL_OPTIONS: { value: TitleRevealDelay; label: string }[] = [
    { value: 0, label: 'Now' },
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 15, label: '15s' },
    { value: null, label: 'Never' },
  ]

  const PRESET_OPTIONS: { value: AudioPreset; label: string }[] = [
    { value: 'hype', label: 'Hype' },
    { value: 'deadpan', label: 'Deadpan' },
    { value: 'minimal', label: 'Minimal' },
  ]

  const TOOLTIPS: Record<RowKey, string> = {
    clipDuration: 'How long each song plays before moving on.',
    titleRevealDelay: 'How long until the song title and artist are revealed.',
    audioPreset: 'Celebration style when someone wins — Hype (loud), Deadpan (dry), Minimal (subtle).',
    allowCasualMode: 'Allow players to opt into autopilot where squares are marked for them at the end of a song.',
  }

  const SAVED_COPY: Record<RowKey, string> = {
    clipDuration: 'Saved — applies to next song',
    titleRevealDelay: 'Saved — applies to next song',
    audioPreset: 'Saved — applies to next song',
    allowCasualMode: 'Saved',
  }

  // Per-row save + error pill state (live mode only).
  let savedFlags = $state<Record<RowKey, boolean>>({
    clipDuration: false,
    titleRevealDelay: false,
    audioPreset: false,
    allowCasualMode: false,
  })
  let errorMsgs = $state<Record<RowKey, string | null>>({
    clipDuration: null,
    titleRevealDelay: null,
    audioPreset: null,
    allowCasualMode: null,
  })
  // Per-row sequence counter — latest click wins; earlier responses ignored.
  const seqByRow: Record<RowKey, number> = {
    clipDuration: 0,
    titleRevealDelay: 0,
    audioPreset: 0,
    allowCasualMode: 0,
  }
  const savedTimers: Record<RowKey, ReturnType<typeof setTimeout> | undefined> = {
    clipDuration: undefined,
    titleRevealDelay: undefined,
    audioPreset: undefined,
    allowCasualMode: undefined,
  }
  const errorTimers: Record<RowKey, ReturnType<typeof setTimeout> | undefined> = {
    clipDuration: undefined,
    titleRevealDelay: undefined,
    audioPreset: undefined,
    allowCasualMode: undefined,
  }

  onDestroy(() => {
    for (const row of Object.keys(savedTimers) as RowKey[]) {
      clearTimeout(savedTimers[row])
      clearTimeout(errorTimers[row])
    }
  })

  function markSaved(row: RowKey) {
    savedFlags = { ...savedFlags, [row]: true }
    errorMsgs = { ...errorMsgs, [row]: null }
    clearTimeout(savedTimers[row])
    savedTimers[row] = setTimeout(() => {
      savedFlags = { ...savedFlags, [row]: false }
    }, 1500)
  }

  function markError(row: RowKey) {
    errorMsgs = { ...errorMsgs, [row]: "Couldn't save — try again." }
    clearTimeout(errorTimers[row])
    errorTimers[row] = setTimeout(() => {
      errorMsgs = { ...errorMsgs, [row]: null }
    }, 3000)
  }

  async function applyLive<K extends RowKey>(
    row: K,
    newValue: ClipDuration | TitleRevealDelay | AudioPreset | boolean,
    previousValue: ClipDuration | TitleRevealDelay | AudioPreset | boolean,
    applyOptimistic: () => void,
    revert: () => void,
  ) {
    if (!code) return
    // Guard against no-op clicks.
    if (newValue === previousValue) return

    applyOptimistic()
    const mySeq = ++seqByRow[row]

    const partial: Record<string, unknown> = { [row]: newValue }

    try {
      const res = await patchRoundConfig(code, partial)
      if (mySeq !== seqByRow[row]) return // stale response — newer click superseded this one
      if (res.ok) {
        markSaved(row)
        writeHostPrefs({ [row]: newValue } as never)
      } else {
        revert()
        markError(row)
      }
    } catch {
      if (mySeq !== seqByRow[row]) return
      revert()
      markError(row)
    }
  }

  function selectClipDuration(v: ClipDuration) {
    const prev = clipDuration
    if (mode === 'pre-round') {
      onClipDurationChange?.(v)
      return
    }
    applyLive(
      'clipDuration', v, prev,
      () => onClipDurationChange?.(v),
      () => onClipDurationChange?.(prev),
    )
  }

  function selectTitleRevealDelay(v: TitleRevealDelay) {
    const prev = titleRevealDelay
    if (mode === 'pre-round') {
      onTitleRevealDelayChange?.(v)
      return
    }
    applyLive(
      'titleRevealDelay', v, prev,
      () => onTitleRevealDelayChange?.(v),
      () => onTitleRevealDelayChange?.(prev),
    )
  }

  function selectAudioPreset(v: AudioPreset) {
    const prev = audioPreset
    if (mode === 'pre-round') {
      onAudioPresetChange?.(v)
      return
    }
    applyLive(
      'audioPreset', v, prev,
      () => onAudioPresetChange?.(v),
      () => onAudioPresetChange?.(prev),
    )
  }

  function selectAllowCasualMode(v: boolean) {
    const prev = allowCasualMode
    if (mode === 'pre-round') {
      onAllowCasualModeChange?.(v)
      return
    }
    applyLive(
      'allowCasualMode', v, prev,
      () => onAllowCasualModeChange?.(v),
      () => onAllowCasualModeChange?.(prev),
    )
  }
</script>

<div class="advanced-settings">
  <section class="option-section">
    <div class="row-header">
      <h3 class="option-label">Clip Duration</h3>
      <InfoTooltip label="Clip Duration" text={TOOLTIPS.clipDuration} />
    </div>
    <div class="pill-group" role="group" aria-label="Clip duration">
      {#each CLIP_OPTIONS as opt (String(opt.value))}
        <button
          type="button"
          class="pill"
          class:selected={clipDuration === opt.value}
          onclick={() => selectClipDuration(opt.value)}
          aria-pressed={clipDuration === opt.value}
        >{opt.label}</button>
      {/each}
    </div>
    {#if mode === 'live'}
      {#if savedFlags.clipDuration}
        <p class="saved-pill" role="status">{SAVED_COPY.clipDuration}</p>
      {:else if errorMsgs.clipDuration}
        <p class="error-pill" role="alert">{errorMsgs.clipDuration}</p>
      {/if}
    {/if}
  </section>

  <section class="option-section">
    <div class="row-header">
      <h3 class="option-label">Title Reveal</h3>
      <InfoTooltip label="Title Reveal" text={TOOLTIPS.titleRevealDelay} />
    </div>
    <div class="pill-group" role="group" aria-label="Title reveal timing">
      {#each REVEAL_OPTIONS as opt (String(opt.value))}
        <button
          type="button"
          class="pill"
          class:selected={titleRevealDelay === opt.value}
          onclick={() => selectTitleRevealDelay(opt.value)}
          aria-pressed={titleRevealDelay === opt.value}
        >{opt.label}</button>
      {/each}
    </div>
    {#if mode === 'live'}
      {#if savedFlags.titleRevealDelay}
        <p class="saved-pill" role="status">{SAVED_COPY.titleRevealDelay}</p>
      {:else if errorMsgs.titleRevealDelay}
        <p class="error-pill" role="alert">{errorMsgs.titleRevealDelay}</p>
      {/if}
    {/if}
  </section>

  <section class="option-section">
    <div class="row-header">
      <h3 class="option-label">Win Reaction</h3>
      <InfoTooltip label="Win Reaction" text={TOOLTIPS.audioPreset} />
    </div>
    <div class="pill-group" role="group" aria-label="Win reaction">
      {#each PRESET_OPTIONS as opt (opt.value)}
        <button
          type="button"
          class="pill"
          class:selected={audioPreset === opt.value}
          onclick={() => selectAudioPreset(opt.value)}
          aria-pressed={audioPreset === opt.value}
        >{opt.label}</button>
      {/each}
    </div>
    {#if mode === 'live'}
      {#if savedFlags.audioPreset}
        <p class="saved-pill" role="status">{SAVED_COPY.audioPreset}</p>
      {:else if errorMsgs.audioPreset}
        <p class="error-pill" role="alert">{errorMsgs.audioPreset}</p>
      {/if}
    {/if}
  </section>

  <section class="option-section">
    <div class="row-header">
      <h3 class="option-label">Casual Mode</h3>
      <InfoTooltip label="Casual Mode" text={TOOLTIPS.allowCasualMode} />
    </div>
    <div class="pill-group" role="group" aria-label="Casual mode">
      <button
        type="button"
        class="pill"
        class:selected={!allowCasualMode}
        onclick={() => selectAllowCasualMode(false)}
        aria-pressed={!allowCasualMode}
      >Off</button>
      <button
        type="button"
        class="pill"
        class:selected={allowCasualMode}
        onclick={() => selectAllowCasualMode(true)}
        aria-pressed={allowCasualMode}
      >Allow</button>
    </div>
    {#if mode === 'live'}
      {#if savedFlags.allowCasualMode}
        <p class="saved-pill" role="status">{SAVED_COPY.allowCasualMode}</p>
      {:else if errorMsgs.allowCasualMode}
        <p class="error-pill" role="alert">{errorMsgs.allowCasualMode}</p>
      {/if}
    {/if}
  </section>
</div>

<style>
  .advanced-settings {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .option-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row-header {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .option-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

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

  .saved-pill {
    color: var(--fg-muted);
    font-size: 0.8rem;
    margin: 0;
  }

  .error-pill {
    color: var(--danger);
    font-size: 0.8rem;
    margin: 0;
  }
</style>
