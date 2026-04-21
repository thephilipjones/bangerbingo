# Story 13-4: Test Quality Pass

## Status: Ready for Development

## Context

Three targeted test-quality fixes that eliminate flakiness and false confidence. Each is mechanical with no production code changes.

## Items

### Item A — Guard `startRefreshScheduler` in test environment
**File:** `src/server/refresh.ts` (or wherever `startRefreshScheduler` is called from `index.ts`)  
**Context:** `startRefreshScheduler()` runs unconditionally including in test env, unlike `serve()`. It leaks a live interval that occasionally fires `auth:restored` during unrelated ws.test.ts tests, causing a flaky `next(auth:restored) timed out` unhandled rejection.  
**Fix:** Add `if (process.env.NODE_ENV !== 'test')` guard around the `startRefreshScheduler()` call at startup. Mirror the existing guard on `serve()`.  
**Deferred item resolved:** "`startRefreshScheduler()` runs unconditionally in test environment" (Deferred from code review of 1-2)

---

### Item B — Seed `Math.random` in `generateCards` uniqueness test
**File:** `src/server/__tests__/cards.test.ts`  
**Context:** The `generateCards` uniqueness test uses `Math.random()` without seeding, making it theoretically non-deterministic.  
**Fix:** Before the test, stub `Math.random` with a deterministic sequence using `vi.spyOn(Math, 'random').mockImplementation(...)` or a simple counter-based stub. Restore after. Alternatively, use `vi.stubGlobal('Math', { ...Math, random: seededRandom })`.  
**Deferred item resolved:** "`generateCards` uniqueness test is non-deterministic" (Deferred from code review of 4-3)

---

### Item C — Fix flaky wall-clock timing assertion in `ws.test.ts`
**File:** `src/server/__tests__/ws.test.ts` — host disconnect test  
**Context:** `Date.now()` delta assertion is non-deterministic under load; occasionally fails in CI.  
**Fix:** Replace the wall-clock delta assertion (`expect(elapsed).toBeLessThan(200)`) with a structural assertion — check that the host's WS `readyState` is `WebSocket.CLOSED` and/or that `roomSockets.get(code)?.hostSocket` is null/undefined. The timing guarantee is not meaningful to test.  
**Deferred item resolved:** "Flaky 200ms wall-clock timing assertion in host disconnect test" (Deferred from code review of 3-5)

## Files

- `src/server/index.ts` (or `refresh.ts`) — Item A guard
- `src/server/__tests__/cards.test.ts` — Item B
- `src/server/__tests__/ws.test.ts` — Item C

## Deferred Work Updates

Upon completion, remove from `deferred-work.md`:
- "`startRefreshScheduler()` runs unconditionally in test environment" (under "Deferred from: code review of 1-2")
- "`generateCards` uniqueness test is non-deterministic" (under "Deferred from: code review of 4-3")
- "Flaky 200ms wall-clock timing assertion in host disconnect test (`ws.test.ts`)" (under "Deferred from: code review of 3-5")
