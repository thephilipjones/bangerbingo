# Story 14-3: Reconnect Replay Completeness

## Status: done

## Context

The reconnect path (`session:connect` + replay of `round:start` / `round:win`) has grown feature-by-feature over Epics 5, 12, and 13. Three small gaps have been logged in `deferred-work.md`, each independently minor but together they leave the reconnect experience inconsistent.

This story closes all three in a single pass:

1. **`round:end` is never replayed.** A client that disconnected after `round:end` was broadcast but before `currentRound` was cleared will never receive a reset signal on reconnect. It's stuck in mid-game UI until the next `round:start`. *(Deferred from 13-1 code review.)*
2. **Guest reconnect `round:start` payload missing `currentSongRevealed`.** Story 12-3 fix for host post-reveal re-blur only patched the host branch. Guests reconnecting after a song has been revealed still see a spurious re-blur. *(Deferred from song-masking re-blur fix.)*
3. **Reconnect into a won round leaves playback bar showing stale progress.** A reconnecting client gets the `round:start` replay (which sets `playbackStartedAt` to the original round-start time, way in the past), then `round:win`. The 13-11 playback indicator bar renders based on `playbackStartedAt` and ends up showing a maxed-out bar behind the Win Overlay. Fix scope is limited to the reconnect path; live-round behavior is unchanged. *(Deferred from 13-11.)*

All three are single-digit-line fixes clustered in two files.

## Story

As a **reconnecting player (host or guest)**,
I want **the client to arrive in the same UI state as a player who never disconnected**,
so that **reconnect after a win shows the Game Over screen cleanly, the masked-title state is honest, and the progress bar doesn't lie about where the current clip is**.

## Acceptance Criteria

**AC-1 — `round:end` replayed on reconnect when applicable.**
In [src/server/ws.ts](src/server/ws.ts) host + guest reconnect branches (~lines 411 and 578), when `activeRound.ended === true` **and** `activeRound.winData` is **not** set (i.e. round ended without a winner — manual end, autoplay cutoff), server sends `{ type: 'round:end' }` after the existing `round:start` replay. When `winData` is set, the existing `round:win` replay handles it; no duplicate `round:end` is sent.

**AC-2 — Guest `round:start` reconnect payload includes `currentSongRevealed`.**
The guest reconnect branch at [src/server/ws.ts:~593](src/server/ws.ts) adds `currentSongRevealed: activeRound.currentSongRevealed` to the `round:start` payload, matching the host branch. A guest reconnecting after reveal sees unblurred titles immediately; reconnecting before reveal continues to see them masked.

**AC-3 — Reconnect replay does not leave playback bar in stale state.**
On reconnect into a round that has ended with a win, the client's playback-bar state (`playbackStartedAt`, `effectiveDurationMs`) must end up zeroed so the bar renders hidden/empty behind the Win Overlay. Implementation approach (preferred): in [src/server/ws.ts](src/server/ws.ts) reconnect replay, when replaying `round:start` followed by `round:win`, omit `playbackStartedAt` from the `round:start` payload (or set it to 0) — the client already defaults to 0 when unset. **Live `round:win` broadcasts are unchanged**; connected clients retain today's behavior. Scope is strictly the reconnect path.

**AC-4 — No regression on live (non-reconnect) play.**
A full round played without any disconnect produces identical WS traffic, identical client state, identical visuals. The change is confined to what the server sends during reconnect replay.

**AC-5 — Tests.**
- Server test: reconnect into a manually-ended round (no winner) → client receives `round:end` after `round:start`.
- Server test: reconnect into an autoplay-cutoff-ended round (no winner) → same as above; the code path doesn't branch on how the round ended.
- Server test: guest reconnect mid-song-after-reveal → `round:start` payload includes `currentSongRevealed: true`.
- Server test: reconnect into a won round → replayed `round:start` payload omits (or zeros) `playbackStartedAt`; live `round:win` broadcast to connected clients continues to carry no such change.

## Implementation Sketch

**Server: [src/server/ws.ts](src/server/ws.ts)**

Host reconnect branch (~line 411):
```ts
if (activeRound.ended) {
  if (activeRound.winData) {
    ws.send(JSON.stringify({ type: 'round:win', ...activeRound.winData }))
  } else {
    ws.send(JSON.stringify({ type: 'round:end' }))
  }
}
```

Guest reconnect branch (~line 578) — same shape; additionally add `currentSongRevealed: round.currentSongRevealed` to the `round:start` payload sent above it.

**Client: no changes required.** The fix is server-side only. The client's existing `round:start` handler already writes `playbackStartedAt` from the payload — if the server omits it (or sends 0) during reconnect replay, the client's downstream bar-render logic naturally hides the bar.

## Defer / Out of Scope

- **Reconnect mid-clip bar resync** — `round:start` replay still carries no clip-start timestamp, so a reconnecting client sees a hidden bar until the *next* `song:start`. Fix would require server to include `playbackStartedAt` / `songStartedAt` in reconnect payload. Separate story if ever prioritized. *(13-11 deferred.)*
- **Mid-reveal-delay reconnect tile re-mask** — client `round:start` handler rebuilds tiles with `masked: false` even during the 5-second reveal delay window. Pre-existing design gap, not introduced by reconnect logic. *(Song-masking deferred.)*

## Tasks / Subtasks

- [x] **T1** — Add `round:end` replay in host reconnect branch when `ended && !winData` (AC-1)
- [x] **T2** — Add `round:end` replay in guest reconnect branch when `ended && !winData` (AC-1)
- [x] **T3** — Verify AC-2 already satisfied: guest reconnect `round:start` already carries `currentSongRevealed` (confirmed at ws.ts line 594 — no code change needed)
- [x] **T4** — Zero `playbackStartedAt` in host reconnect `round:start` when replaying into a won round (AC-3)
- [x] **T5** — Zero `playbackStartedAt` in guest reconnect `round:start` when replaying into a won round (AC-3)
- [x] **T6** — Add 4 server tests covering AC-1, AC-2, AC-3 (AC-5)
- [x] **T7** — Run full regression suite; all 593 tests pass

## Dev Agent Record

### Implementation Plan

Server-only changes confined to two `if` blocks in `src/server/ws.ts` (reconnect paths only):

- **AC-1**: Changed `if (ended && winData)` to `if (ended) { if (winData) { round:win } else { round:end } }` in both host (~line 427) and guest (~line 597) branches.
- **AC-2**: Already implemented — `currentSongRevealed: round.currentSongRevealed` was already present in the guest reconnect `round:start` payload from a prior fix. No code change needed.
- **AC-3**: Added `...(ended && winData ? { playbackStartedAt: 0 } : {})` spread to the reconnect `round:start` payload in both host and guest branches. The server-side `roundStartPayload` object is unmodified — only the unicast reconnect message is affected.

### Completion Notes

- 4 new tests added to `ws.test.ts` under `Story 14-3: Reconnect replay completeness` describe block
- All existing 589 + 4 new = 593 tests pass
- Live `round:win` broadcast in `rooms.ts` is unchanged (AC-4 naturally satisfied — different code path)

## File List

- `src/server/ws.ts` — modified (reconnect replay logic, both host and guest branches)
- `src/server/__tests__/ws.test.ts` — modified (4 new tests for AC-5)

## Change Log

- **2026-04-23** — Story 14-3 implemented: added `round:end` replay for no-winner ended rounds (AC-1), confirmed `currentSongRevealed` already present in guest reconnect payload (AC-2), zeroed `playbackStartedAt` in reconnect-into-won-round `round:start` payload (AC-3). All 593 tests pass.
- **2026-04-23** — Code review: gated `round:end` replay with `pendingClaims` sentinel to prevent spurious replay during `/round/claim` validation window. 594 tests pass.

## Review Findings

- [x] [Review][Patch] Claim-window race can fire spurious `round:end` on reconnect — gated `round:end` replay in both host + guest branches with `!roomState.pendingClaims.has(CLAIM_PENDING_SENTINEL)` to skip replay while `/round/claim` is mid-validation (matches existing `player:rename` race pattern at [rooms.ts:1088](src/server/rooms.ts#L1088)). Added test covering the sentinel-held state. [src/server/ws.ts](src/server/ws.ts), [src/server/__tests__/ws.test.ts](src/server/__tests__/ws.test.ts)
- [x] [Review][Defer] Host/guest divergence on `paused` field in reconnect payload [src/server/ws.ts](src/server/ws.ts) — deferred, pre-existing
- [x] [Review][Defer] Late-joiner reconnect replay uses own card but winner's tileIds [src/server/ws.ts](src/server/ws.ts) — deferred, pre-existing (13-1 behavior)

## References

- [src/server/ws.ts:411-428](src/server/ws.ts#L411-L428) — host reconnect replay
- [src/server/ws.ts:578-602](src/server/ws.ts#L578-L602) — guest reconnect replay
- [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts) `round:win` branch
- Deferred entries in `_bmad-output/implementation-artifacts/deferred-work.md` — 13-1, song-masking, 13-11
