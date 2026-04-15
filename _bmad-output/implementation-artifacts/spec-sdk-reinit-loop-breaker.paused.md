---
title: 'Break host SDK reinit loop on persistent device 404'
type: 'bugfix'
created: '2026-04-14'
status: 'draft'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When Spotify returns `404 Device not found` for a host's SDK device, the server transfers-playback, retries, and on still-404 broadcasts `host:sdk-stale`. The client reinitializes the SDK, registers the new device, and the next play attempt 404s again — kicking off another `host:sdk-stale` → reinit cycle. The loop fires roughly every second: the host sees the mini-player oscillate between "Connecting to Spotify audio…" and the play/pause bar, and the console logs `[spotify:play] 404 — attempting device reactivation` / `transfer failed 404` continuously.

**Approach:** Bound the recovery attempts. Introduce a client-side reinit circuit breaker that tracks consecutive reinits and, after N failures within a window, stops auto-reiniting and surfaces the existing `SdkFailureBanner` so the host can manually recover (reload / open Spotify app). The counter resets on any observable playback success (`song:start` received).

## Boundaries & Constraints

**Always:**
- A single transient 404 must still auto-recover via **one** reinit (preserve today's happy-recovery path).
- The circuit breaker must be per-mount of `HostRoomPage` (a fresh mount starts fresh).
- Logs must make the breaker visible: log when the counter increments and when it trips.
- When tripped, `sdkFailed = true` so the existing `SdkFailureBanner` is shown; the oscillating "Connecting to Spotify audio…" status must disappear.

**Ask First:**
- Any change to server-side `callSpotifyOnDevice` retry/transfer logic or to the `host:sdk-stale` broadcast contract.
- Introducing new server state, new WS message types, or a new REST endpoint.

**Never:**
- Do not re-fire `/round/play` from the server on `/sdk/device` registration (that was the stashed attempt that created this loop). The circuit lives on the client.
- Do not auto-refresh the page, force re-login, or disconnect the WS.
- Do not attempt to preserve song seek position across reinit, fix mid-round reconnect `isPlaying` sync, or harden `/auth/token` — those are separate concerns deferred to follow-up work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Transient 404, recoverable | First `host:sdk-stale` after long stable playback | One reinit, SDK becomes ready, counter=1; on next `song:start` counter resets to 0 | N/A |
| Persistent 404, device dead | 3 `host:sdk-stale` broadcasts within 30s, no `song:start` between them | First two trigger reinit; third is ignored; `sdkFailed=true`, banner shown, no further `/sdk/device` POSTs | Log `[host] sdk reinit budget exhausted` once |
| Recovery after breaker trips | User reloads page (fresh mount) | Counter starts at 0, reinit path works again | N/A |
| Ignored after trip | Further `host:sdk-stale` while tripped | No reinit, no log spam (log once per trip) | N/A |
| Success resets counter | Counter=1, then `song:start` observed, then another stale 60s later | Second stale triggers reinit (counter was reset to 0) | N/A |

</frozen-after-approval>

## Code Map

- [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — owns `reinitSdk()`, `sdkReinitializing`, `sdkReady`, `sdkFailed`, and the `host:sdk-stale` handler. All changes live here.
- [src/server/rooms.ts](src/server/rooms.ts) — `callSpotifyOnDevice` is the source of the `host:sdk-stale` broadcast. Read-only reference; do not modify.
- [src/client/components/SdkFailureBanner.svelte](src/client/components/SdkFailureBanner.svelte) — existing fallback UI; reused unchanged when the breaker trips.

## Tasks & Acceptance

**Execution:**
- [ ] [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — add `sdkReinitCount` + `sdkReinitFirstAt` state (component-local, not `$state` if not rendered). In the `host:sdk-stale` handler, bump the counter, and if `count >= 2` within the last 30s, set `sdkFailed=true`, log once, and return without calling `reinitSdk()`. Reset counter to 0 on `song:start` message.
- [ ] [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — verify `reinitSdk()` still sets `sdkReinitializing` re-entrancy guard so stacked `host:sdk-stale` messages during an in-flight reinit collapse to one attempt (no code change expected; confirm by reading).

**Acceptance Criteria:**
- Given a host page mounted with `sdkReady=true`, when the server broadcasts `host:sdk-stale` once, then `reinitSdk()` runs exactly once and, if the new device is healthy, the next `song:start` clears the counter back to 0.
- Given 3 `host:sdk-stale` broadcasts arrive within 30s with no intervening `song:start`, when the third arrives, then `reinitSdk()` is **not** called, `sdkFailed` becomes `true`, and a single `[host] sdk reinit budget exhausted` warning appears in the console.
- Given the breaker has tripped, when additional `host:sdk-stale` broadcasts arrive, then no further reinit runs and no additional log lines are emitted.
- Given `sdkFailed=true` from the breaker, when the host reloads the page, then the counter resets and auto-recovery works again.

## Verification

**Commands:**
- `bun run check` — expected: no new type errors in `HostRoomPage.svelte`.
- `bun test src/server/__tests__/rooms.test.ts` — expected: existing `host:sdk-stale` broadcast tests still pass (no server changes).

**Manual checks (if no CLI):**
- Start a round, then simulate a persistent stale device by pointing the host's Spotify to another device mid-round (or revoke the SDK token). Confirm the mini-player no longer oscillates: you see at most 2 "Connecting to Spotify audio…" flashes followed by the red `SdkFailureBanner`. Console shows 2 `[spotify:play] 404` lines and exactly one `sdk reinit budget exhausted` line.
- Start a round, let one song play, then force a single 404 (e.g. toggle Spotify device away and back). Confirm one reinit recovers playback and the counter resets (triggering another stale later still recovers).
