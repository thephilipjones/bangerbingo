# Story 14-5: Universal Overlay Escape + Focus Helper

## Status: done

## Context

Every overlay in the codebase — Round Config, Host Controls, Players, Song History, Device Picker, Win Overlay, Round Config Advanced, Host Controls Overlay — has been deferred on the same two a11y gaps in its respective code review:

1. **No Escape-to-close handler.**
2. **No focus movement on open / no focus return on close.**

Ten-plus deferred items in `deferred-work.md` point to this. Full WCAG-listbox or full focus-trap compliance is a much bigger investment — but the two things keyboard users notice **immediately** (Escape works; Tab lands inside the modal instead of behind it) are a single small helper away.

This story ships that helper and retrofits every overlay. It is explicitly **not** a full a11y pass — no focus trap, no arrow-key navigation inside listboxes, no ARIA-activedescendant, no roving tabindex. Just Escape + initial focus + focus return. The deferred items citing those fuller patterns stay deferred; this takes a large chunk of them off the list without a big-bang rewrite.

## Story

As a **keyboard user (laptop host with no mouse, accessibility-first user, or someone who just hit Esc out of habit)**,
I want **every modal and overlay to close on Escape and return focus to the thing that opened it**,
so that **I'm not stuck clicking a tiny X button or losing my place in the page every time I use an overlay**.

## Acceptance Criteria

**AC-1 — Shared helper exists.**
New file [src/client/lib/useOverlay.svelte.ts](src/client/lib/useOverlay.svelte.ts) exports a helper (exact shape TBD during impl — likely a Svelte 5 attachment or a plain function called in `$effect`). The helper:

- Binds a `keydown` listener on mount; pressing `Escape` calls a provided `onClose` callback.
- On mount: records `document.activeElement` as the "return target" and moves focus to either (a) a caller-specified `initialFocus` element, or (b) the first focusable element inside the overlay root.
- On unmount / close: returns focus to the recorded return target, if it still exists and is focusable.

No focus trap (Tab can still leave). No arrow-key logic. Just the three things above.

**AC-2 — Retrofit: every overlay uses the helper.**
Each of the following uses the helper and passes an `onClose` that matches its existing close behavior:

- [RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte)
- [HostControlsOverlay.svelte](src/client/components/HostControlsOverlay.svelte)
- [PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte)
- [SongHistoryDrawer.svelte](src/client/components/SongHistoryDrawer.svelte)
- [DevicePicker.svelte](src/client/components/DevicePicker.svelte)
- [WinOverlay.svelte](src/client/components/WinOverlay.svelte) — Escape dismisses only if the overlay is already in its "dismissible" state (not during the mandatory hold window); Win Overlay already distinguishes these states.
- Any confirmation dialog (End Round / End Session / Delete Session) — use the helper if it's mounted as a modal.

**AC-3 — No regression on existing click-to-close / backdrop-click behavior.**
Tapping the backdrop, tapping the X/close button, or whichever existing dismiss path each overlay has, continues to work. The helper only adds Escape as an additional path.

**AC-4 — Focus return survives re-renders.**
If the triggering button is re-rendered but logically still present (e.g., a gear icon that's the same button after a Svelte reactivity tick), focus still returns to it. Implementation allowance: capture by `HTMLElement` ref; if the ref is detached at close time, focus falls back to `document.body` (no throw).

**AC-5 — Win Overlay-during-reconnect edge case.**
If Win Overlay mounts as a reconnect replay (no triggering interaction), the helper's "return target" is `document.activeElement` at mount time (likely `body`). Escape-to-dismiss still works once the overlay enters dismissible state. No assertion of a specific focus-return target in that case.

**AC-6 — Tests.**
- Unit test on the helper: mounting with an `onClose` + pressing Escape fires the callback.
- Unit test: focus moves to initial element on mount; focus returns to trigger on unmount.
- One integration-ish test per overlay is not required — the helper test plus visual inspection is sufficient for this pass.

## Implementation Sketch

**Helper shape (proposed, not final):**
```ts
export function useOverlay(opts: {
  onClose: () => void
  root: () => HTMLElement | null    // Svelte $state or bind:this getter
  initialFocus?: () => HTMLElement | null
}): void {
  $effect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    const target = opts.initialFocus?.() ?? findFirstFocusable(opts.root())
    target?.focus()

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') opts.onClose() }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      if (returnTo && document.contains(returnTo)) returnTo.focus()
    }
  })
}
```

Each overlay calls `useOverlay({ onClose: closeOverlay, root: () => overlayEl })` in its `<script>` block. Most overlays already have a local `closeOverlay` function and a bindable root element.

**Scope discipline:** Don't touch listbox ARIA, don't add focus trap, don't add arrow-key navigation inside overlays. Leave those deferred items deferred.

## Risk Notes

- **Stacking overlays** — if two overlays are open simultaneously (e.g., Confirm dialog on top of Host Controls), both register Escape listeners. First `Escape` closes the top one (its `onClose` fires); the other's listener remains until it too closes. Acceptable; works because top overlay unmounts first. Verify during impl.
- **WinOverlay hold window** — passing `onClose: () => { if (isDismissible) dismiss() }` is the right shape; don't disable the listener during the hold because that's easier to get wrong.

## References

- Deferred entries in `_bmad-output/implementation-artifacts/deferred-work.md` — multiple ("No focus trap", "no Escape key handler", "keyboard equivalent for backdrop dismiss", etc.) across 5-3, 5-6, 7-3, 7-5, 7-6, 10-2, 5-5
- [src/client/components/](src/client/components/) — home for all overlays listed in AC-2

## Tasks/Subtasks

- [x] Task 1: Create `useOverlay` helper
  - [x] Write `src/client/lib/useOverlay.svelte.ts` with Escape listener, initial focus, and focus return
- [x] Task 2: Retrofit all overlays
  - [x] HostControlsOverlay.svelte — add useOverlay + bind:this
  - [x] PlayersOverlay.svelte — add useOverlay + bind:this
  - [x] SongHistoryDrawer.svelte — add useOverlay + bind:this
  - [x] RoundConfigOverlay.svelte — replace manual window listener with useOverlay
  - [x] DevicePicker.svelte — replace svelte:window + returnFocusEl with useOverlay
  - [x] WinOverlay.svelte — add useOverlay with hold-window guard
- [x] Task 3: Clean up returnFocusEl from HostRoomPage.svelte
- [x] Task 4: Write tests (AC-6)
  - [x] Helper test: Escape fires onClose
  - [x] Helper test: focus moves to first/specified element on mount; returns on unmount
- [x] Task 5: Fix RoundConfigOverlay test (keydown target: window → document)

## File List

- `src/client/lib/useOverlay.svelte.ts` — new shared helper
- `src/client/__tests__/useOverlay.test.ts` — new unit tests (7 tests)
- `src/client/__tests__/helpers/OverlayHarness.svelte` — test harness component
- `src/client/components/HostControlsOverlay.svelte` — retrofitted
- `src/client/components/PlayersOverlay.svelte` — retrofitted
- `src/client/components/SongHistoryDrawer.svelte` — retrofitted
- `src/client/components/RoundConfigOverlay.svelte` — replaced manual window listener
- `src/client/components/DevicePicker.svelte` — replaced svelte:window + returnFocusEl
- `src/client/components/WinOverlay.svelte` — retrofitted with hold-window guard
- `src/client/pages/HostRoomPage.svelte` — removed chipRef and returnFocusEl prop
- `src/client/__tests__/RoundConfigOverlay.test.ts` — updated keydown target to document

## Dev Agent Record

### Completion Notes

Implemented `useOverlay` as a Svelte 5 `$effect`-based helper in `.svelte.ts` format. The helper:
1. Records `document.activeElement` at mount time as the return target
2. Finds the first focusable element inside the overlay root (or uses `initialFocus()`) and calls `.focus()`
3. Attaches a `keydown` listener on `document`; Escape calls `onClose`
4. On cleanup: removes listener and returns focus to the recorded target (falls back silently if detached)

All six overlays retrofitted. `DevicePicker` had an existing manual handler and `returnFocusEl` prop — both replaced. `RoundConfigOverlay` had manual `window.addEventListener` — replaced with `useOverlay`. `WinOverlay` uses a hold-window guard: `onClose: () => { if (showCtas || showGuestDismiss) onDismiss() }`.

All props use `() => prop()` closure pattern to avoid the Svelte 5 "captures initial value" warning.

Pre-existing test failure in `hostPrefs.test.ts` (unrelated to this story — present on main before these changes).

### Review Findings

- [x] [Review][Patch] Stacking overlays — Escape closes all simultaneously, not just topmost [`src/client/lib/useOverlay.svelte.ts`]
- [x] [Review][Patch] Detached `returnTo` silently no-ops — spec requires `document.body.focus()` fallback [`src/client/lib/useOverlay.svelte.ts:26`]
- [x] [Review][Patch] AC-4 test asserts only "no throw", not that `activeElement === document.body` [`src/client/__tests__/useOverlay.test.ts:79-93`]
- [x] [Review][Patch] `handleClose` in DevicePicker is a dead-code wrapper around `onClose` — remove the indirection [`src/client/components/DevicePicker.svelte`]
- [x] [Review][Patch] No `beforeEach(cleanup)` — focus state from a prior test can bleed into focus assertions [`src/client/__tests__/useOverlay.test.ts`]
- [x] [Review][Defer] `document.contains()` passes for inert-subtree elements — `focus()` silently no-ops on inert targets [`src/client/lib/useOverlay.svelte.ts:26`] — deferred, narrow edge case, pre-existing inert usage
- [x] [Review][Defer] `RoundConfigOverlay` Escape gives no feedback during `submitting` state — pre-existing design decision [`src/client/components/RoundConfigOverlay.svelte`] — deferred, pre-existing

## Change Log

- 2026-04-23: Implemented story 14-5 — universal overlay Escape + focus helper. Created `useOverlay.svelte.ts`, added 7 unit tests, retrofitted 6 overlays, removed `returnFocusEl` prop from DevicePicker. Status → review.
- 2026-04-23: Code review complete — 5 patches, 2 deferred, 10 dismissed.
