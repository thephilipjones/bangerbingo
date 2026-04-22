# Story 13-3: Server & Client Micro-Fixes Bundle

## Status: Done

## Context

A collection of independent small fixes identified across code reviews. Each item is self-contained with no inter-dependencies. None require design decisions.

Note: the "duplicate countdown ticker" item from the 8-3 code review has already been resolved — `countdownEndsAt` and countdown `$effect` blocks are completely absent from the codebase (removed in Epic 9-3). No action needed there.

## Items

### Item A — Remove `_room` dead parameter from `startRound`
**File:** `src/server/rooms.ts` — `startRound` function signature  
**Fix:** Remove the `_room` parameter (prefixed `_` to silence lint). If no other consumer passes it, delete from call sites too.  
**Deferred item resolved:** "`_room` dead parameter in `startRound`" (Deferred from code review of 8-3)

---

### Item B — `!round.ended` guard in `runCasualModeSweep`
**File:** `src/server/rooms.ts` — `runCasualModeSweep`  
**Fix:** Add early return: `if (!round || round.ended) return` at the top of the sweep function (or wherever the round-active check lives). Closes the tiny window where `round.ended = true` but `round.active = true` during a claim race.  
**Deferred item resolved:** "Sweep may fire during in-flight claim race" (Deferred from code review of 8-5)

---

### Item C — Handle past-clip-end branch in `/host/resume`
**File:** `src/server/rooms.ts` — `/host/resume` position-drift branch  
**Context:** When `spotifyElapsedMs >= clipMs`, the current code clamps and re-arms the timer, which could double-advance in rare cases. The fix is to treat `>= clipMs` as "clip ended" and call `startNextSong` (or the equivalent auto-advance path) rather than re-arming.  
**Fix:** In the drift-resolution branch after `DRIFT_THRESHOLD_MS` check, add:
```ts
if (spotifyElapsedMs >= clipMs) {
  // Clip already ended — advance instead of re-arming
  void startNextSong(code, roomState)
  return ctx.json({ state: 'advanced' })
}
```
Do not touch the happy-path `< clipMs` branch.  
**Deferred item resolved:** "Past-clip-end branch (`spotifyElapsedMs >= clipMs`) not explicitly handled" (Deferred from code review of 12-2)

---

### Item D — Fix Let-It-Ride 401 to show re-auth prompt
**File:** `src/client/pages/HostRoomPage.svelte` — `handleLetItRide`  
**Context:** If the host session cookie expires between rounds, `handleLetItRide` shows the generic transient error banner with no path back to auth. The `AuthDegradedBanner` re-auth popup pattern already exists elsewhere in the component.  
**Fix:** In `handleLetItRide`'s error handler, check for 401 response and set `authDegraded = true` (same as the WS `auth:degraded` handler).  
**Deferred item resolved:** "Let It Ride 401 has no re-auth prompt path" (Deferred from code review of 9-3)

---

### Item E — Fix `handleStartNextRound` error copy for 403/409
**Files:** `src/client/pages/HostRoomPage.svelte`  
**Context:** 403 (not owner) and 409 (no pending round / round not ended) both show "Couldn't start next round — try again." Retry will never succeed for these.  
**Fix:** Differentiate error copy:
- 403 → "Couldn't verify winner — try refreshing"
- 409 → "Round already started"
- Other → keep "Couldn't start next round — try again."  
**Deferred item resolved:** "`handleStartNextRound` error copy is generic for permanent failures" (Deferred from code review of 9-1)

---

### Item F — Evict `roomSockets` on explicit room destroy
**File:** `src/server/ws.ts` — `destroyRoom` function  
**Status:** Already implemented — `destroyRoom` already calls `roomSockets.delete(roomCode)` (step 4 in the function, added during Story 7-2). No code change needed.  
**Deferred item resolved:** "`roomSockets` entries never pruned" (Deferred from code review of 3-2)

## Files

- `src/server/rooms.ts` — Items A, B, C
- `src/client/pages/HostRoomPage.svelte` — Items D, E
- `src/client/pages/RoomPage.svelte` — Item E (no change needed — no next-round handler exists in guest view)
- `src/server/ws.ts` — Item F (no change needed — already implemented)

## Deferred Work Updates

Removed from `deferred-work.md`:
- "`_room` dead parameter in `startRound`" (under "Deferred from: code review of 8-3") ✅
- "Sweep may fire during in-flight claim race" (under "Deferred from: code review of 8-5") ✅
- "Past-clip-end branch (`spotifyElapsedMs >= clipMs`) not explicitly handled" (under "Deferred from: code review of 12-2") ✅
- "Let It Ride 401 has no re-auth prompt path" (under "Deferred from: code review of 9-3") ✅
- "`handleStartNextRound` error copy is generic for permanent failures" (under "Deferred from: code review of 9-1") ✅
- "`roomSockets` entries never pruned" (under "Deferred from: code review of 3-2") ✅
- "Duplicate `$effect` countdown ticker" (under "Deferred from: code review of 8-3") — already resolved by Epic 9-3, removed as stale ✅

## Dev Agent Record

### Implementation Notes

**Item A:** Removed `_room: Room` from `startRound` signature and dropped the `room` argument from both call sites (`startContinuousRound` at line ~550 and the `/rooms/:code/round` handler at line ~605). The `room` null-check in `startContinuousRound` was retained for the 404 guard — only the pass-through to `startRound` was removed. `Room` type import remains used by `createRoomWithRetry`.

**Item B:** Changed `if (!round || !round.active) return` to `if (!round || !round.active || round.ended) return` in `runCasualModeSweep`. The `ended` flag is set optimistically before the claim is validated, so this closes the race window.

**Item C:** Added `if (spotifyElapsedMs >= clipMs)` branch before the existing drift-correction block. Calls `advanceToNext` (the actual auto-advance function — `startNextSong` was a spec pseudonym) via `void` fire-and-forget and returns `{ state: 'advanced' }`. The `spotifyElapsedMs` local was extracted from inside the `driftMs` block to be available for the new guard.

**Item D + E:** Combined into `handleLetItRide` — 401 sets `authDegraded = true` and returns early (triggering `AuthDegradedBanner`). 403 and 409 get specific copy; all other failures keep the original generic message.

**Item F:** `destroyRoom` in `ws.ts` already performs `roomSockets.delete(roomCode)` as step 4 (added in Story 7-2). Verified at line 244. Removed the deferred item from `deferred-work.md` as resolved.

### Completion Notes

All 6 deferred items resolved. Items A–E required code changes; Item F was a verification (already implemented). 517 tests pass with no regressions.

## File List

- `src/server/rooms.ts`
- `src/client/pages/HostRoomPage.svelte`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/13-3-server-client-micro-fixes.md`

## Change Log

- 2026-04-22: Items A–F implemented. `_room` param removed from `startRound`; `round.ended` guard added to `runCasualModeSweep`; past-clip-end branch added to `/host/resume`; `handleLetItRide` now triggers re-auth on 401 and shows specific copy for 403/409; `destroyRoom` roomSockets eviction verified already present. All 517 tests pass.
- 2026-04-22: Code review applied 4 patches — 403/409 error copy rewritten to match actual server semantics; client `/host/resume` union gained `'advanced'` state; `handleLetItRide` 401 branch now clears stale error state; redundant `spotifyElapsedMs < clipMs` conjunct removed. 2 items deferred to `deferred-work.md` (missing `roundStillMatches` guard on new advance branch; test coverage for 13-3 behavioral changes). 517 tests + typecheck pass.

## Review Findings

- [x] [Review][Patch] Decision D1 resolved: error copy updated to reflect actual server semantics — 403 → "Only the host can start the next round", 409 → "Previous round hasn't ended yet". Spec copy was misleading because it didn't match the server's actual 403 (ownership) / 409 (no completed round) meanings.
- [x] [Review][Patch] Added `'advanced'` to client `/host/resume` response state union at src/client/pages/HostRoomPage.svelte:413-416; now handled explicitly (`resumePausedChip = false`) instead of falling through to the "unknown state" console.warn.
- [x] [Review][Patch] 401 early-return in `handleLetItRide` now clears `nextRoundError` and `nextRoundErrorTimer` before setting `authDegraded`, avoiding stale-timer/stale-chip leak.
- [x] [Review][Patch] Removed redundant `spotifyElapsedMs < clipMs` conjunct in drift branch at src/server/rooms.ts:938 — the new `>= clipMs` early-return above already guarantees it.
- [x] [Review][Defer] New `/host/resume` advance branch lacks `roundStillMatches` guard [src/server/rooms.ts:931-934] — deferred, narrow race (winner claim or new round between Spotify position fetch and `advanceToNext`) could broadcast `song:start`/`songs:exhausted` over a game-over screen. The drift-correct branch at 902-905 has the guard; the new branch does not. Follow-up work.
- [x] [Review][Defer] No test coverage added for the three behavioral changes [src/server/rooms.ts, src/client/pages/HostRoomPage.svelte] — deferred, pre-existing story scope (tests not required). Pickup in 13-4 test-quality-pass.
