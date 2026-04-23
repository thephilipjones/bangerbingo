# Story 13-11: Playback Indicator Bar

## Status: done

## Context

Players (host and guests) currently have no visual feedback on how much of the clip has played or remains. The game header ([src/client/components/GameHeader.svelte](src/client/components/GameHeader.svelte)) is fixed at the top of the viewport (`position: fixed`, `z-index: 20`) and ends in a static 3px `border-bottom` using `var(--rule)`. That border is the natural home for a live progress bar — it "comes alive" as the clip plays.

Design (reviewed in party-mode planning with Sally/Winston/Barry, then constrained by Philip):

- **Standard music-player timeline.** Red sweeps left→right over a neutral background. No color blending, no gradient wash.
- **Played (left of marker):** `var(--accent)` (the app's red).
- **Unplayed (right of marker):** `var(--rule)` — identical to the old static border color, so an observer reads it as the border coming alive.
- **Marker:** 2px `var(--fg)` sliver at the leading edge of the fill.
- **Paused / no song:** bar is hidden entirely (neutral border remains visible). No freeze-in-place.

Critical correctness win: the **server already knows** the exact clip window via the existing `clipDurationMs(cd, track)` helper at [rooms.ts:819](src/server/rooms.ts#L819), which is the same value used by the auto-advance `setTimeout` at [rooms.ts:334-338](src/server/rooms.ts#L334-L338). Sending that value on `song:start` means the bar hits 100% at **precisely** the moment auto-advance fires — zero drift, zero client-side duration math, no need to handle the `'full'` mode special case on the client.

Epic 13 groundwork already done:
- Story 13-9 added `track.durationMs` to the server `Track` interface ([spotify.ts:19-25](src/server/music/spotify.ts#L19-L25)) and wired `durationMs - FULL_MODE_TAIL_MS` into the auto-advance timer for `'full'` mode. This was anticipated for the progress indicator (see user-memory `project_progress_indicator.md`).
- Story 13-10 added `awaitingFirstStart` and Play-readiness gating — unrelated but relevant context: the bar must not appear before the first `song:start`, and on `round:start` with paused-first-round, the bar should be in its "hidden" state.

No DB schema changes. No new dependencies. Pure additive: one new server field on an existing broadcast, one new client component, two new `gameState` fields, two prop passes.

---

## Story

As a **bingo player (host or guest)**,
I want **a live playback indicator bar on the top border of the game header**,
so that **I can see at a glance how much of the current clip has played and how much remains — within the configured clip window (20/30/45/60s or Full)**.

---

## Acceptance Criteria

**AC 1 — Server broadcasts `effectiveDurationMs` on `song:start`**
Given a round is active and `startSong()` fires, when the server broadcasts the `song:start` WS message, then the payload includes `effectiveDurationMs: clipDurationMs(round.config.clipDuration, track)` — the **same value** used for the auto-advance timer. For timed clips: `clipDuration * 1000`. For `'full'`: `Math.max(1_000, track.durationMs - FULL_MODE_TAIL_MS)`.

**AC 2 — `gameState` tracks playback clock**
Given `processWsMessage` receives `song:start`, then `game.playbackStartedAt = Date.now()` and `game.effectiveDurationMs = data.effectiveDurationMs ?? 0`. Given `song:pause`, then `game.playbackStartedAt = 0` (bar hides). Given `round:start`, then both `playbackStartedAt = 0` and `effectiveDurationMs = 0` (clean slate for the new round).

**AC 3 — Bar visible on both host and guest during playback**
Given a timed clip is playing (20/30/45/60s), when either the host (`HostRoomPage`) or a guest (`RoomPage`) is viewing the game, then the playback bar is visible on the bottom edge of the GameHeader, red filling left→right over the neutral `var(--rule)` background, with a 2px `var(--fg)` marker at the leading edge.

**AC 4 — Bar hits 100% at auto-advance**
Given a 30s clip, when playback begins, then the bar visibly reaches 100% width at the same moment `song:start` fires for the next track (server auto-advance triggers). Tolerance: within one animation frame (~17ms) of the server event. Verified by observation — no drift accumulates across multiple tracks.

**AC 5 — Full mode uses server-computed window**
Given `clipDuration === 'full'` and the current track has `durationMs = 180_000`, when playback begins, then the bar range is **server-supplied** (`180_000 - FULL_MODE_TAIL_MS = 179_000ms`). The client does **not** re-derive this. If `effectiveDurationMs` arrives as 0 or undefined (legacy broadcast without the field), the bar stays hidden — no broken state.

**AC 6 — Bar hides on pause**
Given playback is active and the host pauses (`song:pause` broadcasts), then the bar disappears entirely on both host and guest (the neutral border reappears). No frozen bar, no lingering marker.

**AC 7 — Bar hides between rounds**
Given a round ends and a new `round:start` arrives, then the bar is hidden until the first `song:start` of the new round fires. The transition through the paused-first-round state (Story 13-10) is covered by this — `playbackStartedAt` stays 0 until the host taps Play.

**AC 8 — Dark theme correctness**
Given the user toggles dark theme, then the bar's colors adapt via the same CSS variables (`--rule` for unplayed, `--accent` for played, `--fg` for marker). No hard-coded colors.

**AC 9 — No regression on static header**
Given no round is active (waiting room, game-over), then the header renders exactly as today: 3px bottom line using `var(--rule)`. The PlaybackBar component is either not rendered or renders a track that is visually identical to the removed `border-bottom`.

**AC 10 — rAF loop is cleaned up**
Given the PlaybackBar component unmounts (e.g., navigating away), then its `requestAnimationFrame` loop is cancelled. No memory leak, no background ticking.

---

## Tasks / Subtasks

- [x] **Task 1: Server — add `effectiveDurationMs` to `song:start` broadcast** (AC: #1, #5)
  - [x] Edit [src/server/rooms.ts](src/server/rooms.ts) in the `song:start` broadcast block (~line 256-268)
  - [x] Add `effectiveDurationMs: clipDurationMs(round.config.clipDuration, track),` as the last field
  - [x] Verify `clipDurationMs` helper is already in scope at the call site (it's defined at line 819 in the same file — reuse; do **not** duplicate the logic inline)

- [x] **Task 2: Client `gameState` — add 2 reactive fields** (AC: #2, #6, #7)
  - [x] Edit [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts)
  - [x] Add two `$state` declarations near the existing `let clipDuration = $state<ClipDuration>(30)` (around line 76):
    - [x] `let playbackStartedAt = $state(0)` — `Date.now()` at last `song:start`; `0` = stopped/paused
    - [x] `let effectiveDurationMs = $state(0)` — clip window in ms from server
  - [x] In `processWsMessage`, inside the `song:start` branch (~line 208-223), add after existing tile/history updates:
    ```ts
    playbackStartedAt = Date.now()
    effectiveDurationMs = (data.effectiveDurationMs as number | undefined) ?? 0
    ```
  - [x] Add a new branch for `song:pause` in `processWsMessage` (currently only handled by HostRoomPage; guests need it for the bar to hide):
    ```ts
    } else if (data.type === 'song:pause') {
      playbackStartedAt = 0
    ```
    Place it between the existing `song:start` and `song:reveal` branches. Update the trailing comment at line ~264 to reflect that `song:pause` is now handled here (remove from the "handled by caller" list).
  - [x] In the `round:start` branch (~line 154-175), add alongside the existing resets:
    ```ts
    playbackStartedAt = 0
    effectiveDurationMs = 0
    ```
  - [x] Add two getters to the return object (~line 283+, alongside the other `get` properties):
    ```ts
    get playbackStartedAt() { return playbackStartedAt },
    get effectiveDurationMs() { return effectiveDurationMs },
    ```
  - [x] **Do not** touch `HostRoomPage`'s local `isPlaying` state — it's wired to the Spotify SDK and HostMiniPlayer; it remains independent. The guest page's new `song:pause` handling via `processWsMessage` is purely additive (RoomPage currently ignores `song:pause` — no regression risk).

- [x] **Task 3: New component — `PlaybackBar.svelte`** (AC: #3, #4, #8, #9, #10)
  - [x] Create [src/client/components/PlaybackBar.svelte](src/client/components/PlaybackBar.svelte)
  - [x] Props: `{ startedAt: number; durationMs: number }` — no `playing` prop needed (`startedAt <= 0` signals paused/stopped)
  - [x] Internal `let now = $state(Date.now())` plus `$effect` that runs `requestAnimationFrame` only while `startedAt > 0 && durationMs > 0`:
    ```ts
    $effect(() => {
      if (startedAt <= 0 || durationMs <= 0) return
      let raf: number
      const tick = () => { now = Date.now(); raf = requestAnimationFrame(tick) }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    })
    ```
  - [x] Derived `progress`: `Math.min(1, Math.max(0, (now - startedAt) / durationMs))` — clamped to `[0, 1]`
  - [x] Template (only renders when playing):
    ```svelte
    {#if startedAt > 0 && durationMs > 0}
      <div class="pb-track" aria-hidden="true">
        <div class="pb-fill" style:width="{progress * 100}%"></div>
        <div class="pb-marker" style:left="{progress * 100}%"></div>
      </div>
    {/if}
    ```
    **Implementation note:** the track is always rendered; only `.pb-fill` and `.pb-marker` are gated by the `{#if}`. This is required so AC 6 (bar hides on pause → neutral border reappears) and AC 9 (header renders like today when no round is active) still hold after `border-bottom` is removed from `.game-header`. The always-rendered neutral track reads as the old static border.
  - [x] Styles (scoped):
    - `.pb-track`: `position: absolute; bottom: 0; left: 0; right: 0; height: var(--rule-thick); background: var(--rule);`
    - `.pb-fill`: `position: absolute; top: 0; left: 0; height: 100%; background: var(--accent);`
    - `.pb-marker`: `position: absolute; top: 0; width: 2px; height: 100%; background: var(--fg); transform: translateX(-50%);`
  - [x] `aria-hidden="true"` on the track — decorative, no screen reader announcement

- [x] **Task 4: Wire into `GameHeader.svelte`** (AC: #3, #9)
  - [x] Edit [src/client/components/GameHeader.svelte](src/client/components/GameHeader.svelte)
  - [x] Import: `import PlaybackBar from './PlaybackBar.svelte'`
  - [x] Add two optional props to the existing `$props()` destructure (default 0 for graceful no-round state):
    ```ts
    playbackStartedAt = 0,
    effectiveDurationMs = 0,
    ```
    Add to the TS type: `playbackStartedAt?: number; effectiveDurationMs?: number`
  - [x] Add `<PlaybackBar startedAt={playbackStartedAt} durationMs={effectiveDurationMs} />` as the **last child** of the `.game-header` `<div>` (after `.right-cluster`)
  - [x] CSS changes to `.game-header`:
    - Add `position: relative;` — **skipped**: `.game-header` is already `position: fixed`, which itself creates a positioning context for absolutely-positioned descendants. Adding `position: relative` would override the fixed layout.
    - **Remove** `border-bottom: var(--rule-thick) solid var(--rule);` — PlaybackBar's `.pb-track` replaces it
  - [x] Verify `padding: 10px 8px` remains unchanged — the 3px track occupies the same bottom-edge real estate as the removed border, so header height is identical

- [x] **Task 5: Pass new props from both pages** (AC: #3)
  - [x] Edit [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte) — find the `<GameHeader ... />` call site and add:
    ```svelte
    playbackStartedAt={game.playbackStartedAt}
    effectiveDurationMs={game.effectiveDurationMs}
    ```
  - [x] Edit [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — same two additions to the `<GameHeader ... />` call site
  - [x] No other changes to either page. **Do not** touch HostRoomPage's `song:pause` handler or its local `isPlaying` state.

- [x] **Task 6: Tests** (AC: #1, #2, #4, #6, #7)
  - [x] New test in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts): `'song:start broadcast includes effectiveDurationMs for timed clips'` — start a round with `clipDuration: 30`, assert the broadcast payload has `effectiveDurationMs: 30_000`
  - [x] Second test: `'song:start broadcast includes effectiveDurationMs for Full mode'` — start a round with `clipDuration: 'full'` and a track with `durationMs: 180_000`, assert the broadcast has `effectiveDurationMs: 180_000 - FULL_MODE_TAIL_MS`
  - [x] **Chose the "extend existing test" path** — added `expect(msg.effectiveDurationMs)` assertions to `'Full-mode song:start uses seekPositionMs 0'` (179_000ms) and `'timed-clip song:start uses seekPositionMs 60_000'` (30_000ms). Both cover AC #1 and #5.
  - [x] No new client tests. The rAF/visual behaviour is manual-verification (Svelte component tests are not established in this repo for HostRoomPage/RoomPage/GameHeader — introducing them for this story is out of scope, consistent with 13-10 precedent)

### Review Findings

- [x] [Review][Patch] `songs:exhausted` does not reset `playbackStartedAt` — bar pins at 100% after playlist ends [src/client/lib/gameState.svelte.ts]
- [x] [Review][Defer] Clock skew: `playbackStartedAt = Date.now()` on WS receive introduces per-track latency offset [src/client/lib/gameState.svelte.ts] — deferred, accepted design limitation; spec accepts ~17ms tolerance and resets per-track so drift doesn't accumulate
- [x] [Review][Defer] `round:win` does not reset bar — bar remains at last progress during win overlay until `round:start` fires [src/client/lib/gameState.svelte.ts] — deferred, within spec (AC 7 only requires reset on `round:start`)
- [x] [Review][Defer] Reconnect: bar stays empty mid-clip — `round:start` payload carries no clip-start timestamp [src/client/lib/gameState.svelte.ts] — deferred, safe fallback; reconnect resync is out of scope
- [x] [Review][Defer] Test magic number: `expect(msg.effectiveDurationMs).toBe(179_000)` is a pre-computed literal — if `FULL_MODE_TAIL_MS` changes the test failure is cryptic [src/server/__tests__/rooms.test.ts] — deferred, minor test quality

---

## Dev Notes

### Why `effectiveDurationMs` from server, not `durationMs` + client math

Earlier plan iterations considered sending raw `track.durationMs` and having the client compute the `'full'`-mode window via `durationMs - SEEK_POSITION_MS` or similar. **Rejected** for two reasons:

1. **Single source of truth.** The server already calls `clipDurationMs(cd, track)` to set the auto-advance `setTimeout` delay. If the bar re-derives independently, any future change to the full-mode formula (e.g., tweaking `FULL_MODE_TAIL_MS`, adding fade-out logic) must be mirrored in two places — server timer and client bar — or they drift. Using the server-computed value guarantees bar:timer parity by construction.
2. **Simplicity.** The client needs zero knowledge of `SEEK_POSITION_MS`, `FULL_MODE_TAIL_MS`, or the full-mode branch. One number arrives, the bar uses it. If `effectiveDurationMs` is 0 (legacy payload), the bar hides gracefully.

The existing `clipDurationMs` helper at [rooms.ts:819-823](src/server/rooms.ts#L819-L823) is **already the canonical function** — just call it in the broadcast.

### Why `playbackStartedAt = 0` as the paused sentinel (not a separate `isPlaying` bool)

An earlier draft proposed adding `isPlaying: boolean` to `gameState`. Simpler and equivalent: `playbackStartedAt = 0` means "not playing." The PlaybackBar guards both rAF start and template rendering on `startedAt > 0`. One less piece of state, one fewer prop, one fewer export, identical behaviour.

### Why bar hides on pause (not frozen)

Showing a frozen red bar mid-header while nothing is happening is visually noisy and ambiguous (is the song stuck? did the app crash?). Hiding cleanly reverts to the original static-border look, which is the universal "nothing happening" signal in the current UI. On resume (host taps Play → new `song:start` broadcasts), the bar snaps back to 0 and sweeps again — this matches the server's actual behaviour (auto-advance timer is reset on resume in the current `startSong` implementation).

### Pause/resume caveat (deferred — do not fix in this story)

On resume after pause, the bar restarts from 0 rather than continuing from the paused position. The server currently broadcasts `song:start` with `seekPositionMs = 60_000` (or `0` for full mode) on **every** start — it does not communicate the actual mid-clip resume position. Fixing this would require server changes to broadcast the true current position on resume. **Out of scope.** In practice, pause is rare during active gameplay, and "bar restarts on resume" is acceptable — the existing auto-advance timer on the server also resets, so bar and timer stay in sync even with the restart.

### rAF vs `setInterval`

Use `requestAnimationFrame`. Two reasons:
1. Visual progress matches display refresh (smooth, no jank).
2. Automatically throttles when the tab is backgrounded — no wasted work, and the bar catches up on tab refocus because `now = Date.now()` is real-wall-clock.

### Z-index and stacking

The `.game-header` is `z-index: 20`. PlaybackBar lives **inside** it as `position: absolute`, so it inherits the header's stacking context — no separate z-index needed. The HostMiniPlayer at `z-index: 20` (bottom of viewport) is unaffected.

### `prefers-reduced-motion`

Deferred (not in AC). A future polish pass could pause the rAF loop for users with `prefers-reduced-motion: reduce` and show only the marker advancing in discrete jumps (e.g., every second). Not required for MVP — the bar is a continuous linear sweep with no flashing or bouncing, which already complies with WCAG 2.3.1 (no seizure risk).

### Colors — definitive

- **Played:** `var(--accent)` — resolves to `#D7261E` (light) / `#D7261E` (dark) — same in both themes.
- **Unplayed:** `var(--rule)` — resolves to `#111111` (light, matches ink) / `#9A958D` (dark, matches muted border).
- **Marker:** `var(--fg)` — resolves to `#111111` (light) / `#EFEBE4` (dark).

Contrast in dark mode: red on muted gray is visible; ink-on-red and paper-on-red contrast for the marker is solid. No hard-coded RGB values — everything flows through [tokens.css](src/client/styles/tokens.css).

### Commit style

Per user preference: `feat: playback indicator bar` (no scope parens — see user memory `feedback_commit_style.md`).

### Package manager

`npm run test` / `npm run typecheck` — **bun is not installed** (user memory: `feedback_bun_not_installed.md`).

### Scope discipline

**Do not:**
- Add a `prefers-reduced-motion` branch (deferred).
- Add numeric elapsed/total timestamps next to the bar (not in AC).
- Animate color changes (intentionally omitted — hard two-tone per Philip).
- Tweak `clipDurationMs()` helper's formula (not this story's concern).
- Refactor HostRoomPage's `isPlaying` state into gameState (explicitly out of scope — avoids churning SDK-wired code for no visible benefit).
- Add a `song:resume` WS message (the deferred accuracy-on-resume feature, not MVP).

---

### Project Structure Notes

- New component lives in `src/client/components/` alongside other game-overlay components (`GameHeader.svelte`, `HostMiniPlayer.svelte`, `BingoCard.svelte`).
- No changes to routing, DB schema, WebSocket handshake, or build config.
- Scoped Svelte styles only — no additions to global `tokens.css` or `global.css`.

---

### References

- **Plan file:** `/Users/Philip/.claude/plans/new-feature-playback-reactive-clock.md` — party-mode design discussion (Sally/Winston/Barry) and final simplified design.
- **Story 13-9:** [13-9-clip-duration-full-fixes.md](_bmad-output/implementation-artifacts/13-9-clip-duration-full-fixes.md) — added `track.durationMs` to the `Track` type and established `clipDurationMs(cd, track)` as the single full-mode-aware duration helper. This story reuses that helper directly.
- **Story 13-10:** [13-10-first-round-start-gate-and-lobby-header-passthrough.md](_bmad-output/implementation-artifacts/13-10-first-round-start-gate-and-lobby-header-passthrough.md) — established `paused`-on-first-round semantics; the bar must stay hidden during paused-first-round, which `playbackStartedAt = 0` achieves automatically.
- **Story 7-5:** [7-5-game-page-header-and-players-overlay.md](_bmad-output/implementation-artifacts/7-5-game-page-header-and-players-overlay.md) — established the current GameHeader structure that this story modifies.
- **User memory: `project_progress_indicator.md`** — explicitly anticipated this feature during 13-9 planning: "keep `durationMs` populated — progress indicator will consume it."
- [src/server/rooms.ts:256-268](src/server/rooms.ts#L256-L268) — `song:start` broadcast block (Change target for Task 1).
- [src/server/rooms.ts:819-823](src/server/rooms.ts#L819-L823) — `clipDurationMs(cd, track)` helper (reused, not duplicated).
- [src/client/lib/gameState.svelte.ts:208-223](src/client/lib/gameState.svelte.ts#L208-L223) — `song:start` handling in `processWsMessage` (Change target for Task 2).
- [src/client/components/GameHeader.svelte:44-82](src/client/components/GameHeader.svelte#L44-L82) — template + `.game-header` CSS rule (Change target for Task 4).
- [src/client/styles/tokens.css](src/client/styles/tokens.css) — `--rule`, `--accent`, `--fg`, `--rule-thick` definitions (consumed read-only by PlaybackBar).

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (claude-opus-4-7)

### Debug Log References

- `npm run test` → 577/577 pass (29 test files)
- `npm run lint` → one pre-existing unrelated error in `src/client/__tests__/winAudio.test.ts(82,31): TS2304: Cannot find name 'AudioPreset'` (verified present on `git stash`ed baseline, unchanged by this story)

### Completion Notes List

- Task 1 wired `effectiveDurationMs: clipDurationMs(round.config.clipDuration, track)` into the `song:start` broadcast at [src/server/rooms.ts:273](src/server/rooms.ts#L273). `clipDurationMs` is a top-level `function` declaration (hoisted), so referencing it from the broadcast site above its definition is fine. No duplicate of the `'full' ? … : cd*1000` logic was added at the call site.
- Task 2 added `playbackStartedAt` and `effectiveDurationMs` `$state` fields to `createGameState`, plus getters on the returned object. `song:start` now records the local clock + server window; `round:start` resets both; new `song:pause` branch in `processWsMessage` zeroes `playbackStartedAt` so the bar hides for guests (previously guests ignored `song:pause` entirely — this is purely additive). The HostRoomPage-local `song:pause` handler for `isPlaying` is untouched.
- Task 3 `PlaybackBar.svelte`: single `$effect` starts the rAF loop only when `startedAt > 0 && durationMs > 0` and returns a `cancelAnimationFrame` cleanup, so unmount or prop-transition to a hidden state cancels the loop (AC #10). `progress` is a `$derived` clamped to `[0, 1]`.
  - **Divergence from story template, intentional:** the `.pb-track` is always rendered; only the `.pb-fill` and `.pb-marker` children are gated by `{#if startedAt > 0 && durationMs > 0}`. The story's verbatim template wrapped the whole track in the `{#if}`, but with `border-bottom` removed from `.game-header` (Task 4), that would violate AC 6 ("neutral border reappears on pause") and AC 9 ("header renders as today when no round is active"). Always-rendered neutral track = visually identical to the old static border, which is exactly the design-section intent ("the border coming alive").
- Task 4: added import + props + final `<PlaybackBar>` in `.game-header`, removed the `border-bottom`. Skipped the `position: relative` edit because `.game-header` is already `position: fixed`, which creates a positioning context for abs-positioned descendants on its own; forcing `relative` would fight the fixed layout. `padding: 10px 8px` retained — the 3px track occupies the same bottom-edge real estate.
- Task 5: two props passed from both `RoomPage.svelte` and `HostRoomPage.svelte` `<GameHeader>` call sites. No other page changes.
- Task 6: extended two existing `song:start` assertion tests in `rooms.test.ts` rather than adding brand-new `it` blocks (the story explicitly allowed this as the preferred path). Full-mode assertion covers `180_000 - FULL_MODE_TAIL_MS = 179_000`; timed-clip assertion covers `clipDuration * 1000 = 30_000`.
- Verified all 10 ACs:
  - AC 1, 5 — server tests pass with explicit `effectiveDurationMs` checks for timed + full.
  - AC 2 — state wiring covered by code inspection + server tests (server field arrives; client reads it verbatim).
  - AC 3, 6, 7 — wiring from gameState → GameHeader → PlaybackBar confirmed; both pages pass the props.
  - AC 4 — bar hits 100% at auto-advance because server sends the exact same `clipDurationMs` value that powers the auto-advance `setTimeout` (bar:timer parity by construction).
  - AC 8 — all colors flow through `--rule` / `--accent` / `--fg` — no hard-coded RGB.
  - AC 9 — always-rendered neutral track is visually identical to the removed `border-bottom` (same color, same thickness, same position).
  - AC 10 — `$effect` cleanup calls `cancelAnimationFrame(raf)`.

### File List

- `src/server/rooms.ts` — added `effectiveDurationMs` field to `song:start` broadcast
- `src/client/lib/gameState.svelte.ts` — added `playbackStartedAt` + `effectiveDurationMs` state, `song:pause` handler, `round:start` reset, two getters
- `src/client/components/PlaybackBar.svelte` — NEW component
- `src/client/components/GameHeader.svelte` — imported PlaybackBar, added two optional props, removed `border-bottom`, mounted `<PlaybackBar>` as last child
- `src/client/pages/RoomPage.svelte` — passed two new props to `<GameHeader>`
- `src/client/pages/HostRoomPage.svelte` — passed two new props to `<GameHeader>`
- `src/server/__tests__/rooms.test.ts` — extended two existing tests with `effectiveDurationMs` assertions
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status `ready-for-dev` → `in-progress` → `review`
- `_bmad-output/implementation-artifacts/13-11-playback-indicator-bar.md` — status, task checkboxes, Dev Agent Record, File List, Change Log

### Change Log

- 2026-04-23 — Story 13-11 implementation complete; status → review.
