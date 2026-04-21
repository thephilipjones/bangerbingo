# Story 13-3: Server & Client Micro-Fixes Bundle

## Status: Ready for Development

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
**Fix:** In `handleLetItRide`'s error handler, check for 401 response and dispatch the same `auth:degraded` event (or call the same `triggerReauth` helper) used elsewhere in `HostRoomPage.svelte`. Do not add new error UI.  
**Deferred item resolved:** "Let It Ride 401 has no re-auth prompt path" (Deferred from code review of 9-3)

---

### Item E — Fix `handleStartNextRound` error copy for 403/409
**Files:** `src/client/pages/RoomPage.svelte`, `src/client/pages/HostRoomPage.svelte`  
**Context:** 403 (wrong winner name) and 409 (no pending round) both show "Couldn't start next round — try again." Retry will never succeed for these.  
**Fix:** Differentiate error copy:
- 403 → "Couldn't verify winner — try refreshing"
- 409 → "Round already started"
- Other → keep "Couldn't start next round — try again."  
**Deferred item resolved:** "`handleStartNextRound` error copy is generic for permanent failures" (Deferred from code review of 9-1)

---

### Item F — Evict `roomSockets` on explicit room destroy
**File:** `src/server/ws.ts` — `destroyRoom` function  
**Context:** `roomSockets` entries are never pruned. Rooms should be evicted when explicitly destroyed (session:end / admin delete). Do NOT evict on host disconnect alone (host may reconnect).  
**Fix:** At the end of `destroyRoom(code)`, add `roomSockets.delete(code)` if not already present.  
**Scope:** Only on explicit destroy — not on host disconnect, not on a timeout. Philip asked for no complexity here.  
**Deferred item resolved:** "`roomSockets` entries never pruned" (Deferred from code review of 3-2)

## Files

- `src/server/rooms.ts` — Items A, B, C
- `src/client/pages/HostRoomPage.svelte` — Items D, E
- `src/client/pages/RoomPage.svelte` — Item E
- `src/server/ws.ts` — Item F

## Deferred Work Updates

Upon completion, remove from `deferred-work.md`:
- "`_room` dead parameter in `startRound`" (under "Deferred from: code review of 8-3")
- "Sweep may fire during in-flight claim race" (under "Deferred from: code review of 8-5")
- "Past-clip-end branch (`spotifyElapsedMs >= clipMs`) not explicitly handled" (under "Deferred from: code review of 12-2")
- "Let It Ride 401 has no re-auth prompt path" (under "Deferred from: code review of 9-3")
- "`handleStartNextRound` error copy is generic for permanent failures" (under "Deferred from: code review of 9-1")
- "`roomSockets` entries never pruned" (under "Deferred from: code review of 3-2")
- "Duplicate `$effect` countdown ticker" (under "Deferred from: code review of 8-3") — already resolved by Epic 9-3, remove as stale
