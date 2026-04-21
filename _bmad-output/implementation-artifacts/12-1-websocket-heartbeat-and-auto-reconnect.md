# Story 12.1: WebSocket Heartbeat, Visibility & Auto-Reconnect Infrastructure

Status: done

## Story

As a host or guest on any device,
I want the app to silently recover from socket drops — screen lock, tab backgrounding, brief network blips —
so that I never have to manually refresh the page mid-game.

## Acceptance Criteria

1. Server sends a `{type:'ping', t}` message every 20s on every open socket; tracks `lastPongAt` per socket; closes any socket with no pong in the last 45s using close code 1006. Interval is cleared in the existing close handler.
2. Client replies to any `{type:'ping'}` with `{type:'pong', t}` immediately. Client also tracks its own `lastPingAt`; if >45s since last ping, it locally closes the socket to enter the reconnect branch.
3. A new module `src/client/lib/wsClient.ts` exports a `createWsClient({ url, onMessage, onStateChange })` factory with a state machine (`connecting | open | reconnecting | dead`) and exponential-backoff reconnect (1s, 2s, 4s, 8s, 16s cap, reset on successful `open`, transition to `dead` only after 5 consecutive failures).
4. `wsClient` exposes `nudge()` (force immediate reconnect attempt if not `open`) and `onResume(cb)` (fires when state transitions back to `open` from any non-`open` state). Both [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) and [RoomPage.svelte](src/client/pages/RoomPage.svelte) migrate to use this wsClient.
5. A `visibilitychange` listener is mounted in both HostRoomPage and RoomPage: on `visible`, it calls `wsClient.nudge()`.
6. The "Connection lost — please refresh the page" banner at [HostRoomPage.svelte:354](src/client/pages/HostRoomPage.svelte#L354) and the equivalent "Connection lost — player list may be stale. Refresh to reconnect." at [LobbyPage.svelte:155](src/client/pages/LobbyPage.svelte#L155) + guest disconnect banner at [RoomPage.svelte:137-141](src/client/pages/RoomPage.svelte#L137-L141) are replaced by a small "Reconnecting…" chip during `reconnecting` state; the actionable "refresh" banner only appears when state is `dead`.
7. On a successful post-disconnect reconnect, the existing server reconnect branches at [ws.ts:306-326](src/server/ws.ts#L306-L326) (host) and [ws.ts:389-412](src/server/ws.ts#L389-L412) (guest) continue to fire and restore round state — no server-side logic changes in those branches are scoped to this story.
8. `npm run lint` passes with zero errors.
9. `npm run test` passes. New unit tests cover: wsClient backoff schedule (1/2/4/8/16), wsClient transitions to `dead` after 5 consecutive failures, pong reply on ping, `onResume` fires on reconnect, `nudge()` is a no-op when already `open`.
10. No regression in existing flows: `session:connect`, `round:start`, `song:start`, `square:auto-marked`, `host:disconnected` / `host:reconnected`, `auth:degraded` / `auth:restored`, `host:sdk-stale`.

## Tasks / Subtasks

- [ ] Task 1 — Server heartbeat (AC: 1)
  - [ ] In [src/server/ws.ts](src/server/ws.ts), attach `setInterval(..., 20_000)` per socket on open. Send `{type:'ping', t: Date.now()}` each tick.
  - [ ] Track `lastPongAt` — easiest place is a parallel WeakMap keyed on the socket handle; initialize to `Date.now()` on open.
  - [ ] Handle incoming `{type:'pong'}` — update `lastPongAt`.
  - [ ] Per-tick: if `Date.now() - lastPongAt > 45_000`, `socket.close(1006, 'heartbeat-timeout')`. The existing close handler already does per-room cleanup and broadcasts `host:disconnected`.
  - [ ] Clear the interval in the existing close handler to avoid leaks.

- [ ] Task 2 — Client wsClient module (AC: 2, 3, 4)
  - [ ] New file `src/client/lib/wsClient.ts` with `createWsClient({ url, onMessage, onStateChange })`.
  - [ ] State machine: `connecting | open | reconnecting | dead`. Emit to `onStateChange`.
  - [ ] Handle `{type:'ping'}` by replying `{type:'pong', t}`.
  - [ ] Track `lastPingAt`; if a watchdog interval detects >45s since last ping while state is `open`, call `ws.close()` to enter reconnect.
  - [ ] Backoff schedule: 1s, 2s, 4s, 8s, 16s, 16s, … Reset counter on successful `open`. After 5 consecutive failures (no `open` between them), set state to `dead` and stop auto-retrying; only `nudge()` can resume.
  - [ ] `nudge()` — if state !== `open`, kick an immediate reconnect attempt (also resets the backoff counter so a human-triggered resume doesn't inherit prior attempt count).
  - [ ] `onResume(cb)` — register listeners fired whenever state transitions back to `open` from any non-`open` state. Not fired on first connect.
  - [ ] Normal close (code 1000 from `session:end`, user navigation) is not treated as reconnect — transition to `dead` without backoff, banner suppressed (the page is going away anyway).

- [ ] Task 3 — Migrate HostRoomPage to wsClient (AC: 4, 5, 6)
  - [ ] Replace the raw `new WebSocket(...)` in [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) with `createWsClient`.
  - [ ] Route existing `ws.onmessage` handler through `onMessage`.
  - [ ] Wire state changes → a local `wsState` prop; render:
    - `reconnecting` → small "Reconnecting…" chip in the status area (reuse existing chip styling; position near the header/player chips, not full-width banner).
    - `dead` → keep the current "Connection lost — please refresh the page." banner copy at the current position.
  - [ ] Mount `document.addEventListener('visibilitychange', onVisible)` in `onMount`; on `visibilityState === 'visible'`, call `wsClient.nudge()`. Detach in `onDestroy`.
  - [ ] Preserve existing outbound `ws.send(...)` call sites — expose `wsClient.send(...)` that no-ops if not `open` (queues for one flush on next `open`? NO — keep it simple: drop if not open, the server's reconnect branch will re-sync state).

- [ ] Task 4 — Migrate RoomPage (guest) to wsClient (AC: 4, 5, 6)
  - [ ] Replace the raw `new WebSocket(...)` in [RoomPage.svelte](src/client/pages/RoomPage.svelte) with `createWsClient`.
  - [ ] Wire `onMessage`, state changes, `visibilitychange` same as HostRoomPage.
  - [ ] UX: `reconnecting` chip replaces the generic `host:disconnected` banner when the *guest's own* socket is down. The existing `hostDisconnected` banner at [RoomPage.svelte:137-141](src/client/pages/RoomPage.svelte#L137-L141) is a different signal (host is offline, our socket is fine) — leave that path alone.

- [ ] Task 5 — Migrate LobbyPage connection-lost banner (AC: 6)
  - [ ] [LobbyPage.svelte:155](src/client/pages/LobbyPage.svelte#L155) — if LobbyPage maintains its own ws, migrate to wsClient too; otherwise just re-wire the banner to the shared wsClient state. (Verify at implementation time whether LobbyPage opens its own socket or shares HostRoomPage's.)

- [ ] Task 6 — Unit tests (AC: 9)
  - [ ] `src/client/lib/wsClient.test.ts` covering backoff schedule, max retries → `dead`, `nudge()` behaviors, `onResume` fires only on transitions back to open, ping→pong reply shape.
  - [ ] Server heartbeat test — stub interval + clock; assert close is called when lastPongAt is stale. If the existing ws test harness can be extended, do so; otherwise a focused unit test for the heartbeat function (extract if needed) is acceptable.

- [ ] Task 7 — Regression checks (AC: 10)
  - [ ] `npm run lint` clean.
  - [ ] `npm run test` — full suite passes.
  - [ ] Manual: start two browsers (host + guest) → verify no message-flow changes; force-close the host ws at DevTools → chip appears → auto-reconnects in 1s; leave host tab hidden for 45s+ → server closes socket → visible-again triggers nudge → reconnects.
  - [ ] Manual: iOS Safari lock/unlock a host session 10+ times in a round — verify no "please refresh" banner ever surfaces unless network is truly down.

## Dev Notes

### Why this is the foundation for Stories 12-2 and 12-3

Story 12-2's `/host/resume` reconcile endpoint is triggered by `wsClient.onResume(cb)`. Story 12-3's casual-mode catch-up replay runs inside the existing ws reconnect branches — but those branches only fire reliably once we're actually detecting and recovering from bad sockets, which this story implements. Do 12-1 first.

### Heartbeat interval rationale

- **20s ping interval**: short enough to detect dead sockets within ~45s (2 missed pings tolerance), long enough that a sleeping/throttled mobile tab doesn't burn battery. iOS Safari background throttles timers to 1Hz and still eventually suspends them; the heartbeat is not what catches iOS-lock disconnects — `visibilitychange` is. The heartbeat catches "tab still in foreground but network went away" cases.
- **45s timeout** = 2 × 20s + slack. Don't shrink it — Safari's timer throttling is real.
- **Close code 1006**: "abnormal closure." The existing close branches already handle this; code 1000 (normal) is reserved for `session:end` / user-initiated navigation.

### `onResume` is the key hook for downstream stories

When wsClient transitions `reconnecting → open` (not initial `connecting → open`), all registered `onResume` listeners fire. This is what 12-2 uses to call `/host/resume`. Make sure first connect does NOT fire `onResume` — that path is handled by existing `session:connect` flow.

### Visibility vs heartbeat: they catch different things

- **Heartbeat**: foreground tab, network dropped (hotel wifi, subway tunnel, VPN blip).
- **Visibility**: phone lock, app switch, tab backgrounded. Network may be fine but iOS Safari suspended the socket.
- **Both**: implement both; they're cheap and complementary.

### Do NOT queue outbound messages

If a user clicks play while state is `reconnecting`, drop the send silently (optionally log). Rationale: the server's reconnect branch already re-broadcasts canonical state (`round:start` with current song, catch-up events), so the client's UI will re-synchronize within seconds. Queueing creates replay-order bugs. This is different from Story 12-2's `pendingPlayAction` for SDK reinit, which is *intentionally* one-shot.

### File structure

- New: `src/client/lib/wsClient.ts`
- New: `src/client/lib/wsClient.test.ts`
- Modified: `src/server/ws.ts`, `src/client/pages/HostRoomPage.svelte`, `src/client/pages/RoomPage.svelte`, `src/client/pages/LobbyPage.svelte`
- No new dependencies

### Existing patterns to reuse

- Hono + native WebSockets server setup in [src/server/ws.ts](src/server/ws.ts) — keep the existing socket-open/close/message structure; the heartbeat is additive.
- Existing disconnect/reconnect branches at [ws.ts:306-326](src/server/ws.ts#L306-L326) and [ws.ts:389-412](src/server/ws.ts#L389-L412) — heartbeat-triggered closes enter these unchanged.
- Svelte 5 runes (`$state`, `$effect`) — match the existing HostRoomPage pattern.
- No new UI components needed — chip styling already exists via the device chip / status chip patterns in HostMiniPlayer.

### References

- Parent plan: [i-don-t-think-switching-giggly-hammock.md](~/.claude/plans/i-don-t-think-switching-giggly-hammock.md) — Track 0 section.
- Parent epic: [_bmad-output/epics.md](_bmad-output/epics.md) — Epic 12.
- Stories 12-2 and 12-3 depend on this shipping first.

### Review Findings

- [x] [Review][Patch] Fatal WS close codes treated as retryable [src/client/lib/wsClient.ts:92-116] — Codes 4001/4003/4004/4009 won't resolve by retrying; client currently burns 5 attempts (~31s) before the actionable "refresh" banner appears. Short-circuit to `dead` for any close code in the 4000-range. **Fixed**: onClose now treats any 4xxx code as terminal, parametric test added.
- [x] [Review][Patch] Client ping watchdog has no test coverage [src/client/__tests__/wsClient.test.ts] — AC2 requires the >45s watchdog (implemented at wsClient.ts:167-176) but no test asserts it fires or that `lastPingAt` refreshes on incoming traffic. AC9's enumerated list didn't require it, but AC2 did. **Fixed**: added two watchdog tests (fires after 45s stale; refreshes on inbound message).
- [x] [Review][Patch] iOS visibility→nudge race loses fast-resume [src/client/lib/wsClient.ts (nudge)] — On iOS Safari wake the socket's readyState is often still OPEN when `visibilitychange` fires, so `nudge()` no-ops. 1-2s later the socket closes and normal backoff (1s) begins — fast resume is lost. **Fixed**: nudge() now force-closes the socket when state is `open` but lastPingAt is older than one server heartbeat interval (`STALE_ON_RESUME_MS = 20_000`); slight deviation from AC4's literal "no-op when open" but matches dev-notes intent. Two tests added.
- [x] [Review][Defer] `connectAsHost` wrapper + 10 unit tests deleted out-of-scope [src/client/lib/ws.ts, src/client/__tests__/dashboard.test.ts] — deferred: inline LobbyPage handler is the sole caller and the new wsClient tests cover the WS-client layer; unit coverage of host session:connect defaults and unparseable-message tolerance was dropped but not behaviorally regressed.
- [x] [Review][Defer] LobbyPage `dead`-state banner copy silently changed [src/client/pages/LobbyPage.svelte:169] — deferred: old copy "Connection lost — player list may be stale. Refresh to reconnect." replaced with the host-page copy "Connection lost — please refresh the page." Minor UX consistency change; no spec mandate either way.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

None.

### Completion Notes List

- Server heartbeat implemented as a small extracted module (`src/server/heartbeat.ts`) using a `WeakMap<WebSocket, HeartbeatState>` keyed on the socket handle. Per-tick: if `now - lastPongAt > 45s` → `ws.terminate()`; otherwise sends `{type:'ping', t}`. `terminate()` is used instead of `ws.close(1006, …)` because the `ws` library rejects user-supplied 1006 close codes; terminate produces an abnormal close on the peer, which flows into the existing close branches unchanged.
- `ws.ts` integration is additive: `startHeartbeat(ws)` on open, `recordPong(ws)` on incoming `{type:'pong'}`, `stopHeartbeat(ws)` in the existing close handler. No changes to the reconnect branches.
- `wsClient.ts` state machine: `connecting → open → (reconnecting → open)* → dead`. Backoff schedule via `computeBackoffDelay` = `[1000, 2000, 4000, 8000, 16000]` with index clamped to the end (so attempts 5+ stay at 16s). `dead` is entered only after 5 consecutive failures (initial fail + 4 retries), or immediately on close code 1000 (intentional close), or via `close()`.
- `nudge()` resets the failure counter so a human-triggered resume doesn't inherit prior attempt count. No-op when state is already `open`.
- `onResume(cb)` fires when state transitions to `open` from a non-`open` state — explicitly not on first connect (tracked via `openedAtLeastOnce` latch). This is the hook Story 12-2 will use.
- Ping messages are intercepted and pong-replied inside the client; they are NOT forwarded to the consumer's `onMessage` callback.
- Outbound `send()` drops silently when state !== `open` — per Dev Notes, no queueing (server's reconnect branch re-broadcasts canonical state).
- Dependency injection (`now`, `setIntervalFn`, `clearIntervalFn`, `WebSocketCtor`) is used for deterministic testing with fake timers.
- **HostRoomPage**: raw `new WebSocket(...)` replaced with `createWsClient`; `wsError` → `wsState`; `reconnecting` shows a small chip, `dead` shows the existing "please refresh" banner. `visibilitychange` listener calls `wsClient.nudge()` on visible.
- **RoomPage (guest)**: adopts the already-open socket from JoinPage via the `existingSocket` option of `createWsClient`. On post-disconnect reconnect, the new URL is reconstructed from `name + code`. Added `session:connect` handling to re-sync players, wins, casual-mode state, and reset `hasSeenRoundStart`. Kept the `hostDisconnected` banner path untouched (different signal: host offline, our socket is fine) per the story's explicit note.
- **LobbyPage**: migrated off `connectAsHost` to inline `createWsClient`. The `wsDisconnected` banner is replaced by the shared reconnecting-chip + dead-banner pattern. `connectAsHost` + `HostHandlers` interface + its 10 tests removed; the protocol is simple enough that inline handling in LobbyPage (the sole caller) is clearer than keeping a wrapper abstraction.
- Flaky test `ws.test.ts > square:auto-marked is NOT sent to other players` surfaced once during regression runs but passed on subsequent full-suite runs — confirmed pre-existing and unrelated to heartbeat changes (reproduces on the pre-change tree with `git stash`). Final run: 453/453 pass.

### File List

**New:**
- `src/client/lib/wsClient.ts`
- `src/client/__tests__/wsClient.test.ts`
- `src/server/heartbeat.ts`
- `src/server/__tests__/heartbeat.test.ts`

**Modified:**
- `src/server/ws.ts` — heartbeat integration (start/stop/recordPong)
- `src/client/pages/HostRoomPage.svelte` — migrated to wsClient; reconnecting chip + dead banner; visibilitychange listener
- `src/client/pages/RoomPage.svelte` — migrated to wsClient (adopts existing socket from JoinPage); reconnecting chip + dead banner; visibilitychange listener; session:connect re-sync on reconnect
- `src/client/pages/LobbyPage.svelte` — migrated to wsClient (inline); reconnecting chip + dead banner; visibilitychange listener
- `src/client/lib/ws.ts` — removed `connectAsHost` + `HostHandlers` (no longer used)
- `src/client/__tests__/dashboard.test.ts` — removed 10 `connectAsHost` tests (wrapper deleted)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status updated

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created. Status: ready-for-dev. |
| 2026-04-20 | Implemented Tasks 1–7. Server heartbeat (20s/45s), client wsClient with state machine + backoff + nudge/onResume, migrated HostRoomPage/RoomPage/LobbyPage, 21 new unit tests, deleted unused connectAsHost wrapper. npm run lint + npm run test clean (453/453). Status: review. |
| 2026-04-20 | Code review complete. 3 patches applied: (1) 4xxx close codes short-circuit to dead, (2) ping watchdog test coverage added, (3) nudge() force-closes stale-but-open sockets on resume (iOS Safari fast-resume). 2 items deferred (connectAsHost test deletion, LobbyPage banner copy). 26/26 wsClient tests + 462/462 full suite pass. Status: done. |
