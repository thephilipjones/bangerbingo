# Epic 12 Reliability — Bug-Dump Fix Plan

> Playtest follow-up after stories 12-1 (WS heartbeat/reconnect) and 12-2 (Spotify-first mobile playback + resume reconcile). Four independent tracks, orderable in any sequence; C and A are the highest-value.

## Context

Epic 12 added WS heartbeat/reconnect (12-1) and Spotify-first mobile playback + resume reconcile (12-2). Playtest surfaced four distinct problems and two non-issues. This plan splits the fix into four independent tracks plus one observability addition.

**Non-issues (confirmed, no action):**
- **Shuffle still works.** [src/server/rooms.ts:421](../../src/server/rooms.ts#L421) calls `shuffle(...)` on every `startRound`; Fisher-Yates in [src/server/game/cards.ts:11-17](../../src/server/game/cards.ts#L11-L17). Unchanged by Epic 12 commits.
- **`vite ws proxy socket error: ECONNRESET`** is vite's dev proxy logging the expected socket close when the client's WS disconnects. Not a backend bug.

---

## Track A — Host reconnect doesn't restore current-song UI

**Symptom.** After host reconnects mid-round, HostMiniPlayer shows "Waiting for round to start…" and the play button fails with "Playback control failed — check Spotify is active" until the current clip naturally ends.

**Root cause.** On host reconnect, [src/server/ws.ts:341](../../src/server/ws.ts#L341) resends the cached `roundStartPayload` (fields defined at [src/server/rooms.ts:445-453](../../src/server/rooms.ts#L445-L453)). The payload has **no current-song fields** — no `currentSongIndex`, no `paused`, no current-track title/artist. The client only sets `currentTrack` inside the `song:start` handler at [src/client/pages/HostRoomPage.svelte:517-521](../../src/client/pages/HostRoomPage.svelte#L517-L521), so `currentTrack` stays `null`, which drives the stale UI at [src/client/components/HostMiniPlayer.svelte:84](../../src/client/components/HostMiniPlayer.svelte#L84). The HTTP `/host/resume` response carries the Spotify truth ([rooms.ts:856-944](../../src/server/rooms.ts#L856-L944)) but the client never maps it onto `currentTrack` ([HostRoomPage.svelte:411-428](../../src/client/pages/HostRoomPage.svelte#L411-L428)).

**Fix — minimal and local.** The reconnect send at [src/server/ws.ts:341](../../src/server/ws.ts#L341) already has everything needed. Augment that single unicast with `currentSongIndex` and `paused` (do **not** mutate the cached `roundStartPayload` — spread into a new object at send site):

```ts
ws.send(JSON.stringify({
  ...activeRound.roundStartPayload,
  card: hostCard,
  songHistory: activeRound.songHistory,
  currentSongIndex: activeRound.currentSongIndex,
  paused: activeRound.paused === true,
}))
```

On the client, in the `round:start` handler at [src/client/pages/HostRoomPage.svelte:479-496](../../src/client/pages/HostRoomPage.svelte#L479-L496), when `data.currentSongIndex >= 0` and `songHistory` is non-empty, hydrate `currentTrack` from `songHistory[songHistory.length - 1]` (the current song is always the last entry because `startSong` pushes on every track change — [rooms.ts:216-226](../../src/server/rooms.ts#L216-L226)) and set `isPlaying = !data.paused`. Skip the auto-play fetch on this branch (already guarded by `history.length === 0` at line 488 — leave that guard).

One event (`round:start`) carries one concept (round context including "where we are in it"); no synthetic `song:start` resend, no new event name, no flag dance. The drift path in `/host/resume` continues to handle Spotify-truth reconciliation unchanged.

**Files:** [src/server/ws.ts](../../src/server/ws.ts), [src/client/pages/HostRoomPage.svelte](../../src/client/pages/HostRoomPage.svelte).

**Test:** Add a server-side assertion in [src/server/__tests__/ws.test.ts](../../src/server/__tests__/ws.test.ts) that the reconnect send includes `currentSongIndex` and `paused`. Add a client assertion (host-page or gameState test file) that `round:start` with non-empty `songHistory` populates `currentTrack`.

---

## Track B — First-song plays wrong track after "start any song"

**Symptom.** First host setup: user opens BB, follows "Open Spotify on your phone and play any song to activate it, then tap Refresh" ([src/client/pages/HostRoomPage.svelte:697-700](../../src/client/pages/HostRoomPage.svelte#L697-L700)), pauses the random song, taps Refresh. Round starts. Spotify plays the paused random song, not round 1's track.

**Evidence is soft.** The `startSong` play call already includes `uris: [spotify:track:<id>]` for `isTrackChange=true` ([rooms.ts:255-275](../../src/server/rooms.ts#L255-L275)) and the 404-retry path passes the same uris-bearing builder as `retryBuildRequest` (line 274). So the code path *should* replace Spotify's context. The observed failure implies one of:
1. The play call never fired (e.g. `callSpotifyOnDevice` hit 401/401-refresh path and silently dropped — [rooms.ts:56-62](../../src/server/rooms.ts#L56-L62)).
2. The 404-transfer path cleared `activeDeviceId` and broadcast `host:sdk-stale` ([rooms.ts:79-82](../../src/server/rooms.ts#L79-L82)), and a subsequent play hit a different code path without uris.
3. Spotify honored the URI but the user perceived the random song because playback briefly straddled the transition.

**Fix — observability + one defensive change:**

1. **Add `[spotify:play]` log at `startSong` entry** with `{ code, songIndex, isTrackChange, trackId, activeDeviceId }`. Place at [src/server/rooms.ts:251](../../src/server/rooms.ts#L251) before `callSpotifyOnDevice`. One line. Turns the next repro into a diagnosable log trail.

2. **Defensive context-clear on first song of round.** In `startSong`, when `isTrackChange === true && round.currentSongIndex === -1` (exactly the "first song of round" case, at the point BEFORE `round.currentSongIndex = songIndex` is assigned at line 227), issue a fire-and-forget `PUT /me/player/pause?device_id=<activeDeviceId>` **before** the play request. Two lines, idempotent — pausing an already-paused device returns 403/404 which existing handlers swallow. Guarantees the URI-bearing play call isn't racing a resume of prior context.

Do **not** add broader surgery (pre-play pause on every track, retry wrappers, activeDeviceId re-fetch) until the log from (1) shows what actually happens on next repro.

**Files:** [src/server/rooms.ts](../../src/server/rooms.ts) only.

**Test:** Unit test that `startSong(..., 0)` on a fresh round issues a pause before the play (assert via `callSpotifyOnDevice` mock order).

---

## Track C — Casual Mode divergence on reconnect + let-it-ride

**Symptom A (reconnect).** Session has Casual Mode Allowed = on, both host + guest toggled on. Host disconnects+reconnects. Result: session "Allowed" setting shows Off, host's toggle shows Off, guest's toggle still on, guest sees the (i) info tooltip implying a mismatch.

**Symptom B (let-it-ride).** Guest's personal Casual toggle is lost on the next round; must re-enable.

**Root cause.** Two inverted guards, identical shape in both pages:

[src/client/pages/HostRoomPage.svelte:479-483](../../src/client/pages/HostRoomPage.svelte#L479-L483):
```ts
if (data.type === 'round:start') {
  if (hasSeenRoundStart) {
    casualModeOn = false
  }
  hasSeenRoundStart = true
```

[src/client/pages/RoomPage.svelte:108-112](../../src/client/pages/RoomPage.svelte#L108-L112): same pattern.

`hasSeenRoundStart` is module-scoped and set once; it never resets to `false` except for the guest's `session:connect` path ([RoomPage.svelte:107](../../src/client/pages/RoomPage.svelte#L107)). So the *second* `round:start` the page sees — either the reconnect resend from [ws.ts:341](../../src/server/ws.ts#L341) or a let-it-ride round:start from [rooms.ts:477](../../src/server/rooms.ts#L477) — forces `casualModeOn = false`. The server already preserves `playerCasualModes` across rounds (Story 9-2 comment at [rooms.ts:441-443](../../src/server/rooms.ts#L441-L443)) and broadcasts the correct `allowCasualMode` in every `round:start`, so the client-side reset is the whole bug.

**Fix.** Delete the inverted guard in both pages. Leave the rest of the handler intact.

- [src/client/pages/HostRoomPage.svelte:479-483](../../src/client/pages/HostRoomPage.svelte#L479-L483): remove the `if (hasSeenRoundStart) casualModeOn = false` block and the `hasSeenRoundStart = true` line. If no other consumer references `hasSeenRoundStart`, delete the declaration.
- [src/client/pages/RoomPage.svelte:107-112](../../src/client/pages/RoomPage.svelte#L107-L112): remove `hasSeenRoundStart = false` in `session:connect`, remove the `if (hasSeenRoundStart) casualModeOn = false` block, delete the declaration if unused.

After this: `casualModeOn` mutates only on explicit user toggle or on `session:connect` (which reads `casualModeNames` from server state). Matches the Story 9-2 server contract. `allowCasualMode` arriving in the round:start payload continues to drive the session setting UI.

**Server-side is already correct — do not touch:**
- `replayAutoMarksToSocket` ([rooms.ts:185-202](../../src/server/rooms.ts#L185-L202)) and the reconnect sweep at [ws.ts:348-352](../../src/server/ws.ts#L348-L352) already replay auto-marks for a reconnecting host.
- `startContinuousRound` preserves `allowCasualMode` ([rooms.ts:517](../../src/server/rooms.ts#L517)) and never touches `playerCasualModes` → guest state survives let-it-ride on the server.

**Known remaining gap (flag, don't fix):** `playerCasualModes` is in-memory only, reset on rehydrate at [ws.ts:153](../../src/server/ws.ts#L153). A full server restart still clears toggles. The existing comment at [ws.ts:87-93](../../src/server/ws.ts#L87-L93) acknowledges this. Unrelated to the user's reported bug.

**Files:** [src/client/pages/HostRoomPage.svelte](../../src/client/pages/HostRoomPage.svelte), [src/client/pages/RoomPage.svelte](../../src/client/pages/RoomPage.svelte).

**Test:** Update or add a host-page test asserting `casualModeOn` survives a second `round:start` event. Same for RoomPage.

---

## Track D — Guest UI cleanup

**Fix 1 — remove host-disconnected banner.**
- Delete markup at [src/client/pages/RoomPage.svelte:180-184](../../src/client/pages/RoomPage.svelte#L180-L184).
- Delete state transitions at [RoomPage.svelte:124-127](../../src/client/pages/RoomPage.svelte#L124-L127) and the `hostDisconnected` local + its CSS.
- Server broadcasts at [ws.ts:387](../../src/server/ws.ts#L387) (disconnect) and the reconnect counterpart can stay as cheap no-ops, OR delete if no other consumer. Grep `host:disconnected|host:reconnected` across `src/` before deleting. Test [src/client/__tests__/join.test.ts:209-212](../../src/client/__tests__/join.test.ts#L209-L212) references `host:disconnected` — update or remove.

**Fix 2 — remove "Waiting for next song…" copy.**
- Delete `statusLine = 'Waiting for next song…'` at [RoomPage.svelte:115](../../src/client/pages/RoomPage.svelte#L115) and [:117](../../src/client/pages/RoomPage.svelte#L117).
- Keep the `session:connect` → round-ended default ("Waiting for the host to start a round...") at [:120](../../src/client/pages/RoomPage.svelte#L120) — different state.
- If `statusLine` becomes dead after removal, delete the variable and its template binding.

**Files:** [src/client/pages/RoomPage.svelte](../../src/client/pages/RoomPage.svelte), [src/server/ws.ts](../../src/server/ws.ts) (if deleting broadcasts), [src/client/__tests__/join.test.ts](../../src/client/__tests__/join.test.ts).

---

## Critical files

- [src/server/ws.ts](../../src/server/ws.ts) — Track A reconnect augment, Track D broadcast decision
- [src/server/rooms.ts](../../src/server/rooms.ts) — Track B log + defensive pause
- [src/client/pages/HostRoomPage.svelte](../../src/client/pages/HostRoomPage.svelte) — Track A client hydrate, Track C reset removal
- [src/client/pages/RoomPage.svelte](../../src/client/pages/RoomPage.svelte) — Track C reset removal, Track D UI cleanup
- [src/client/__tests__/join.test.ts](../../src/client/__tests__/join.test.ts) — Track D
- [src/server/__tests__/ws.test.ts](../../src/server/__tests__/ws.test.ts) and [src/server/__tests__/rooms.test.ts](../../src/server/__tests__/rooms.test.ts) — Track A + B

## Reused utilities (no new abstractions)

- `broadcast` at [src/server/ws.ts:180](../../src/server/ws.ts#L180), direct `ws.send` for unicast (Track A)
- `runCasualModeSweep` + `replayAutoMarksToSocket` at [rooms.ts:108-202](../../src/server/rooms.ts#L108-L202) — already wired for reconnect
- `callSpotifyOnDevice` + `reissueExpectedTrack` at [rooms.ts:56-100](../../src/server/rooms.ts#L56-L100) — reuse as-is

## Verification

1. **Track A**: `npm run dev`. Host starts round, song 1 playing. Kill host network 10s, restore. HostMiniPlayer shows song 1 title/artist and responsive play controls within ~2s, before song 1 ends.
2. **Track B**: Fresh Spotify with a random song paused. Host starts round. First audio heard is round 1's track, not the random song. Check server logs for the new `[spotify:play]` line on round start.
3. **Track C**: Host + guest both toggle Casual on (with Allowed = on). Host disconnects+reconnects. Both toggles still on, Allowed still on, no (i) tooltip mismatch for guest. Host clicks Let It Ride. Guest toggle still on in round 2 without re-enabling.
4. **Track D**: Host disconnects 15s. Guest UI: no banner, no "Waiting for next song…" text. Host reconnects. Guest UI: no flicker.
5. `npm run test` full suite passes after each track's edits.

## Ordering suggestion

C first — one-file diff per page, highest user-visible lift. Then A (single unicast + client hydrate). Then D (pure removal). Then B (observability + defensive pause; requires live repro to verify). Each track ships independently.
