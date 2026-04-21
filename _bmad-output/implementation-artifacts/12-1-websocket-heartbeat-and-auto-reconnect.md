# Story 12.1: WebSocket Heartbeat, Visibility & Auto-Reconnect Infrastructure

Status: ready-for-dev

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

## Dev Agent Record

### Agent Model Used

_TBD_

### Debug Log References

_TBD_

### Completion Notes List

_TBD_

### File List

_TBD_

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created. Status: ready-for-dev. |
