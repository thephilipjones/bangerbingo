# Story 13-6: Win Jingle Audio

## Status: Done

## Context

`WinOverlay.svelte` already renders three distinct visual presets (hype/deadpan/minimal) but plays no audio. The `audioPreset` prop flows all the way through the component tree and is stored in `gameState`, but `onMount` in `WinOverlay` never plays a sound. Philip has never heard a win jingle. This story wires it up.

No audio files exist in the project. Rather than sourcing external files, we'll generate the sounds programmatically using the Web Audio API — no loading time, no CDN dependency, no autoplay policy friction (triggered by the same user gesture that caused the bingo win).

## Audio Design

| Preset | Character | Sound |
|--------|-----------|-------|
| `hype` | Triumphant fanfare | C major arpeggio ascending: C5→E5→G5→C6, each note 80ms, slight reverb tail |
| `deadpan` | Flat acknowledgement | Single 440Hz sine wave, 300ms, fade-out — like a flat "bong" |
| `minimal` | Subtle chime | Single 880Hz sine wave, 150ms, fast fade — barely there |

All sounds play once when the overlay mounts. No loop, no volume control (respects system volume).

## Acceptance Criteria

**AC-1 (Hype):** When `audioPreset === 'hype'`, mounting `WinOverlay` plays the C major arpeggio through the Web Audio API. Confetti animation continues to fire in sync.

**AC-2 (Deadpan):** When `audioPreset === 'deadpan'`, mounting `WinOverlay` plays the flat 440Hz single note.

**AC-3 (Minimal):** When `audioPreset === 'minimal'` (default), mounting `WinOverlay` plays the subtle 880Hz chime.

**AC-4 (Reconnect guard):** If `WinOverlay` is mounted as part of a reconnect replay (Story 13-1 — `winData` was already set before the replay), audio does NOT play again. The `isReplay` flag set in 13-1's `round:win` handler passes down as a prop (`playAudio={!isReplay}`) or is inferred from a module-level `winAudioPlayed` flag.

**AC-5 (AudioContext unlock):** If the AudioContext is locked (browser autoplay policy), the first user interaction after mount (dismiss tap, start-next-round tap) unlocks it before sound. In practice, bingo wins are triggered by a tile tap → server win detection → WinOverlay mount, so the AudioContext should already be unlocked. No special handling needed unless testing reveals otherwise.

**AC-6 (Teardown):** `onDestroy` cancels any in-progress audio nodes. No memory leaks.

**AC-7 (No external files):** All audio is generated via Web Audio API. No `.mp3`, `.wav`, or `.ogg` assets added to the repo.

## Implementation Notes

**`src/client/components/WinOverlay.svelte`:**

Add a new file `src/client/lib/winAudio.ts`:
```ts
export function playWinAudio(preset: 'hype' | 'deadpan' | 'minimal'): void {
  const ctx = new AudioContext()
  if (preset === 'hype') {
    // C5, E5, G5, C6 at 80ms each
    const notes = [523.25, 659.25, 783.99, 1046.50]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'triangle'
      const start = ctx.currentTime + i * 0.08
      gain.gain.setValueAtTime(0.3, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25)
      osc.start(start)
      osc.stop(start + 0.25)
    })
  } else if (preset === 'deadpan') {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 440
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } else {
    // minimal
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  }
  // AudioContext auto-closes after all nodes finish
}
```

In `WinOverlay.svelte` `onMount`:
```ts
import { playWinAudio } from '../lib/winAudio.ts'

onMount(() => {
  if (!isReplay) {
    try { playWinAudio(effectivePreset) } catch { /* autoplay blocked — silent */ }
  }
  // ... existing timer setup
})
```

Add `isReplay?: boolean` prop to `WinOverlay`. Default `false`. Passed from `HostRoomPage` and `RoomPage` based on whether this mount is a reconnect replay (see Story 13-1 AC-3/AC-4).

## Files

- `src/client/lib/winAudio.ts` — new file (audio generation)
- `src/client/components/WinOverlay.svelte` — add `isReplay` prop + call `playWinAudio` on mount
- `src/client/pages/HostRoomPage.svelte` — pass `isReplay` to WinOverlay
- `src/client/pages/RoomPage.svelte` — pass `isReplay` to WinOverlay

## Dependencies

This story depends on **Story 13-1** (Reconnect-After-Win) for the `isReplay` flag. If shipping before 13-1, default `isReplay={false}` everywhere and add replay guard in a follow-up.

## Deferred Work Updates

No existing deferred item to close. This is a new capability (audio was never implemented, not explicitly deferred with a tracker entry).

---

## Dev Agent Record

### Implementation Notes

Audio is triggered in the WS message handlers in both page components (not in `WinOverlay.svelte` or `GameOverView.svelte`) because the replay guard (`isWinReplay`) is already captured at that layer. `WinOverlay.svelte` is an unused component; the actual win view is rendered by `GameOverView.svelte`.

The `isReplay` prop approach described in the story spec was adapted: instead of threading a prop through the component tree, the replay guard already existed in both pages via `isWinReplay = data.type === 'round:win' && game.winData !== null`. Audio is called directly in the WS handler — cleaner and consistent with existing patterns.

### Files Changed

- `src/client/lib/winAudio.ts` — new file: Web Audio API jingle generator (hype/deadpan/minimal)
- `src/client/pages/RoomPage.svelte` — import + call `playWinAudio` on `round:win` when not replay
- `src/client/pages/HostRoomPage.svelte` — import + call `playWinAudio` on `round:win` when not replay
- `src/client/__tests__/winAudio.test.ts` — 8 unit tests covering all three presets and edge cases

### Change Log

- 2026-04-22: Implemented win jingle audio via Web Audio API (story 13-6)

---

### Review Findings

- [x] [Review][Patch] Use singleton AudioContext — replace per-call `new AudioContext()` with a module-level shared instance; AC-6 no-leak requirement. — `src/client/lib/winAudio.ts`
- [x] [Review][Decision] Hype 250ms decay accepted as intentional reverb tail — "each note 80ms" refers to note-start spacing; the 250ms exponential fade is the spec's "slight reverb tail". No change needed.
- [x] [Review][Patch] Silent `catch` swallows all errors, not just autoplay blocks — `catch { /* autoplay blocked — silent */ }` eats every exception including `RangeError` from scheduling bugs and `NotAllowedError` from autoplay policy; only `NotAllowedError` should be silenced. — `src/client/pages/RoomPage.svelte:94`, `src/client/pages/HostRoomPage.svelte:493`
- [x] [Review][Patch] "Unknown preset" test calls `playWinAudio('minimal')`, not an unknown value — Test at `winAudio.test.ts:80` is titled "unknown preset falls through to minimal" but calls `playWinAudio('minimal')` — a valid preset. The `else` fallback path is never actually exercised. — `src/client/__tests__/winAudio.test.ts:80`
- [x] [Review][Defer] Mid-round join client always hears 'minimal' (missed round:start) [`src/client/lib/gameState.svelte.ts`] — deferred, pre-existing
- [x] [Review][Defer] Shared vi.fn() instances in test mock inflate connect/start/stop call counts [`src/client/__tests__/winAudio.test.ts`] — deferred, pre-existing test mock design
- [x] [Review][Defer] isWinReplay guard assumes round:start always precedes round:win — message drop/reorder could silently skip audio on a genuine win [`src/client/pages/RoomPage.svelte:91`] — deferred, pre-existing message ordering assumption
