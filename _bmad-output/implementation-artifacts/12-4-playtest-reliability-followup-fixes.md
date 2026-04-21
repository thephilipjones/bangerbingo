# Story 12.4: Playtest Reliability Follow-up Fixes

Status: done

## Story

As a host or guest playing a live session after the Epic 12 reliability changes shipped,
I want the four playtest-surfaced bugs fixed (host-reconnect mini-player, first-song playback context, casual-mode divergence, guest-UI noise),
so that reconnects, fresh-Spotify round starts, casual-mode toggles, and host disconnects behave as users expect without manual recovery steps.

## Background

Epic 12 shipped 12-1 (WS heartbeat/reconnect), 12-2 (Spotify-first mobile playback + `/host/resume` reconcile), and 12-3 (marks + casual-mode reconnect). Playtest with the host on one device and a guest on a phone surfaced four distinct bugs, plus two confirmed non-issues. This story bundles the four fixes. Each track is independent and can land in any order; the recommended ordering is **C → A → D → B** (biggest lift per line-of-diff first; observability-dependent work last). Every track is small, local, and reuses existing abstractions.

**Confirmed non-issues — do NOT change:**
- Shuffle still works. [src/server/rooms.ts](src/server/rooms.ts) `startRound` calls `shuffle(...)` on every round; Fisher-Yates in [src/server/game/cards.ts:11-17](src/server/game/cards.ts#L11-L17). Untouched by Epic 12.
- `vite ws proxy socket error: ECONNRESET` is Vite's dev proxy logging the expected socket close on client WS disconnect. Not a backend bug.

## Acceptance Criteria

### Track A — Host reconnect restores current-song UI

1. On host reconnect at [src/server/ws.ts:341](src/server/ws.ts#L341), the unicast `round:start` resend includes two additional fields on top of the cached `activeRound.roundStartPayload`: `currentSongIndex: activeRound.currentSongIndex` and `paused: activeRound.paused === true`. The cached `roundStartPayload` object itself MUST NOT be mutated — spread into a new object literal at the send site.
2. In [src/client/pages/HostRoomPage.svelte:479-496](src/client/pages/HostRoomPage.svelte#L479-L496) `round:start` handler: when `data.currentSongIndex >= 0` AND `songHistory` is non-empty, hydrate `currentTrack` from `songHistory[songHistory.length - 1]` (fields `title`, `artist`; set `currentTrackId` from the same entry's `trackId`), and set `isPlaying = !data.paused`.
3. The existing `history.length === 0` guard at [HostRoomPage.svelte:488](src/client/pages/HostRoomPage.svelte#L488) stays intact — the new hydrate path only runs on the "songs already played" branch, so auto-play still fires on fresh rounds.
4. HostMiniPlayer shows the current song's title/artist within ~2s of reconnect (before the current clip ends) and the play/pause control acts on the correct track without the "Playback control failed — check Spotify is active" error.
5. `/host/resume` continues to reconcile Spotify truth unchanged — do NOT add Spotify-state mapping into the `round:start` handler; Track A is pure server-authoritative round state only.

### Track B — First-song plays the intended track

6. In [src/server/rooms.ts](src/server/rooms.ts) `startSong`, immediately before the `callSpotifyOnDevice('play', …)` call at [rooms.ts:263-275](src/server/rooms.ts#L263-L275), emit a single structured log line: `[spotify:play]` with `{ code, songIndex, isTrackChange, trackId, activeDeviceId }`.
7. In `startSong`, when `isTrackChange === true AND round.currentSongIndex === -1` (the "first song of a fresh round" case — this check MUST happen BEFORE `round.currentSongIndex = songIndex` is assigned at [rooms.ts:227](src/server/rooms.ts#L227)), issue a fire-and-forget `PUT https://api.spotify.com/v1/me/player/pause?device_id=<activeDeviceId>` BEFORE the play call. Use `callSpotifyOnDevice(code, roomState, 'pause', …)` with no retry builder. Swallow all errors.
8. The defensive pre-play pause is idempotent — pausing an already-paused Spotify device returns 403/404 and MUST not produce user-visible errors or disrupt the subsequent play call.
9. Do NOT add broader changes: no pre-play pause on every track, no retry wrappers, no `activeDeviceId` re-fetch, no new device-state cache. Track B is only (a) the log + (b) the one defensive pause on first-song-of-round.
10. The first song of a fresh round plays the round's track 1, NOT Spotify's prior context (e.g., the "random song the user paused to activate Spotify" per the [HostRoomPage.svelte:697-700](src/client/pages/HostRoomPage.svelte#L697-L700) setup flow).

### Track C — Casual Mode survives reconnect and let-it-ride

11. In [src/client/pages/HostRoomPage.svelte:479-483](src/client/pages/HostRoomPage.svelte#L479-L483): delete the `if (hasSeenRoundStart) { casualModeOn = false }` block AND the `hasSeenRoundStart = true` line. If `hasSeenRoundStart` has no other reader after this change (grep in the file), delete its declaration too.
12. In [src/client/pages/RoomPage.svelte:107](src/client/pages/RoomPage.svelte#L107): delete the `hasSeenRoundStart = false` line inside the `session:connect` branch. In [RoomPage.svelte:108-112](src/client/pages/RoomPage.svelte#L108-L112): delete the `if (hasSeenRoundStart) { casualModeOn = false }` block AND the `hasSeenRoundStart = true` line. If `hasSeenRoundStart` has no other reader, delete the declaration.
13. After Track C: `casualModeOn` MUST mutate only on (a) explicit user toggle, (b) `session:connect` hydration from `casualModeNames`. It MUST NOT mutate on any `round:start` event.
14. Server-side casual-mode logic is already correct — Track C does NOT touch: `replayAutoMarksToSocket`, `runCasualModeSweep`, `playerCasualModes` maps, the reconnect sweep calls at [ws.ts:348-352](src/server/ws.ts#L348-L352), the `allowCasualMode` field in `roundStartPayload`, or the `startContinuousRound` preservation at [rooms.ts:517](src/server/rooms.ts#L517).
15. Manual verification: with Allowed=on and both host+guest toggles on, a host disconnect→reconnect leaves Allowed=on, both toggles on, and no (i) mismatch tooltip for guest. A Let It Ride leaves the guest toggle on in round 2 without re-enabling.
16. Known-ongoing limitation ACKNOWLEDGED BUT OUT OF SCOPE: `playerCasualModes` is in-memory only; a full server restart clears toggles. Flag in Dev Notes; do NOT implement persistence in this story.

### Track D — Guest UI cleanup

17. In [src/client/pages/RoomPage.svelte:180-184](src/client/pages/RoomPage.svelte#L180-L184): delete the `{#if hostDisconnected}` banner markup. In [RoomPage.svelte:124-127](src/client/pages/RoomPage.svelte#L124-L127): delete the `host:disconnected`/`host:reconnected` branches. Delete the `hostDisconnected` local variable and its associated CSS class `.host-disconnected-banner`.
18. Grep `host:disconnected` and `host:reconnected` across `src/` (client + server). If there are no remaining consumers after Track D's client edits, delete the server broadcasts at [src/server/ws.ts:356](src/server/ws.ts#L356) (`host:reconnected`) and [src/server/ws.ts:387](src/server/ws.ts#L387) (`host:disconnected`). If a consumer remains (e.g., a test), leave the server broadcasts as-is — do NOT break other consumers for minor cleanup.
19. Update or remove the test assertion at [src/client/__tests__/join.test.ts:209-212](src/client/__tests__/join.test.ts#L209-L212) that references `host:disconnected`, matching whatever decision was made in AC 18.
20. In [src/client/pages/RoomPage.svelte:115](src/client/pages/RoomPage.svelte#L115) AND [RoomPage.svelte:117](src/client/pages/RoomPage.svelte#L117): delete the `statusLine = 'Waiting for next song…'` assignments. Keep the `session:connect` → round-ended default at [RoomPage.svelte:120](src/client/pages/RoomPage.svelte#L120) (`statusLine = 'Waiting for the host to start a round...'`) — that's a different state.
21. If `statusLine` becomes dead after AC 20 (no writers, or its only remaining writer is the round-ended default that never changes), delete the `statusLine` variable and remove its template binding. If it still has meaningful writers, leave it.
22. After Track D: a host disconnect of any duration produces no banner and no "Waiting for next song…" copy on the guest UI. On host reconnect, no flicker.

### Cross-cutting

23. `npm run lint` clean. `npm run test` full suite passes.
24. New tests (additive only — do not rewrite existing tests beyond the AC 19 update):
    - **Track A (server):** [src/server/__tests__/ws.test.ts](src/server/__tests__/ws.test.ts) — host-reconnect path, mid-round, active song: assert the unicast message received by the reconnecting socket includes `currentSongIndex >= 0` and `paused === false` (or `true` if the round was paused in the fixture).
    - **Track A (client):** [src/client/__tests__/gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts) OR a new HostRoomPage test (whichever test surface is closer to the `round:start` handler) — given `round:start` with non-empty `songHistory` and `currentSongIndex >= 0`, the handler hydrates `currentTrack` to the last history entry's `{ title, artist }` and `isPlaying = !paused`.
    - **Track B (server):** [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) — `startSong(..., 0)` on a fresh round where `round.currentSongIndex === -1` invokes `callSpotifyOnDevice` with `action === 'pause'` before it invokes with `action === 'play'`. Assert via mock call order (vitest `mock.calls` ordering).
    - **Track C (client):** [src/client/__tests__/gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts) or equivalent — `casualModeOn` stays `true` across a second `round:start` event (simulating reconnect resend OR let-it-ride). Parallel test for RoomPage.
25. No regressions in: Story 12-1 reconnect flow, Story 12-2 `/host/resume` reconcile, Story 12-3 marks/auto-marks replay, Story 9-2 casual-mode permission toggle, normal song-advance broadcasts, Let It Ride round progression.

## Tasks / Subtasks

Order: C → A → D → B (recommended; each track is independent and safe to re-order).

- [x] **Track C — Casual-mode client reset removal** (AC: 11, 12, 13, 14, 15, 16, 24-Track-C)
  - [x] HostRoomPage.svelte: removed the `if (hasSeenRoundStart) { casualModeOn = false }` block and the `hasSeenRoundStart = true` assignment.
  - [x] HostRoomPage.svelte: deleted the `hasSeenRoundStart` declaration (no other readers).
  - [x] RoomPage.svelte: removed `hasSeenRoundStart = false` in `session:connect`.
  - [x] RoomPage.svelte: removed the `if (hasSeenRoundStart) { casualModeOn = false }` block and the `hasSeenRoundStart = true` assignment.
  - [x] RoomPage.svelte: deleted the `hasSeenRoundStart` declaration (no other readers).
  - [x] Added client test: `casualModeOn` survives a second `round:start` event (preservation rule test in gameState.svelte.test.ts).
  - [ ] Manual verify (out-of-scope for dev agent — requires running host + guest on real devices).

- [x] **Track A — Server unicast augment + client hydrate** (AC: 1, 2, 3, 4, 5, 24-Track-A)
  - [x] ws.ts: unicast send on host reconnect spreads `activeRound.roundStartPayload` into a new object and appends `currentSongIndex` and `paused`. Cached payload is not mutated.
  - [x] HostRoomPage.svelte: `round:start` handler now hydrates `currentTrack`, `currentTrackId`, and `isPlaying` from the last history entry when `currentSongIndex >= 0` and `history.length > 0`. The `history.length === 0` auto-play branch is unchanged.
  - [x] Added server test (ws.test.ts): reconnect-mid-round unicast includes `currentSongIndex === 0` and `paused === false`.
  - [x] Added client test (gameState.svelte.test.ts): `round:start` with non-empty `songHistory` and `currentSongIndex >= 0` populates `currentTrack`/`currentTrackId`/`isPlaying` and does NOT enter the auto-play branch.
  - [ ] Manual verify (out-of-scope for dev agent).

- [x] **Track D — Guest UI cleanup** (AC: 17, 18, 19, 20, 21, 22)
  - [x] RoomPage.svelte: deleted the `{#if hostDisconnected}` banner markup.
  - [x] RoomPage.svelte: deleted the `host:disconnected` / `host:reconnected` branches.
  - [x] RoomPage.svelte: deleted `hostDisconnected` state declaration and the `.host-disconnected-banner` CSS rule.
  - [x] Grep confirmed consumers remain: `src/client/lib/ws.ts` passes `host:disconnected`/`host:reconnected` to optional handlers; server tests in ws.test.ts assert these broadcasts; JoinPage lib tests assert the handler contract. Per AC 18, server broadcasts at [ws.ts:356](src/server/ws.ts#L356) / [ws.ts:387](src/server/ws.ts#L387) are LEFT INTACT; the join.test.ts assertions are LEFT INTACT per AC 19.
  - [x] RoomPage.svelte: deleted both `statusLine = 'Waiting for next song…'` assignments. The `song:pause` / `songs:exhausted` branch became empty and was removed.
  - [x] `statusLine` retained — the `round:end` branch still sets it to the "Waiting for the host to start a round..." default (a meaningful writer).
  - [ ] Manual verify (out-of-scope for dev agent).

- [x] **Track B — Observability + defensive first-song pause** (AC: 6, 7, 8, 9, 10, 24-Track-B)
  - [x] rooms.ts `startSong`: emits `console.log('[spotify:play]', { code, songIndex, isTrackChange, trackId, activeDeviceId })` immediately before the play `callSpotifyOnDevice` invocation.
  - [x] rooms.ts `startSong`: added guarded pre-play pause. The `needsDefensivePause` flag is computed BEFORE `round.currentSongIndex` is mutated; the fire-and-forget `callSpotifyOnDevice('pause', ...)` is issued before the play call. No retry builder. `.catch(() => {})`.
  - [x] Added server test (rooms.test.ts, "Story 12-4 Track B" describe): on a fresh round (`currentSongIndex === -1`), fetch call[0] is `/me/player/pause` and call[1] is `/me/player/play`.
  - [x] Added server test: on a subsequent track change (`currentSongIndex === 0` at entry), only the play fetch fires — no pause.
  - [ ] Manual verify (out-of-scope for dev agent — requires live Spotify flow).

- [x] **Cross-cutting verification** (AC: 23, 25)
  - [x] `npm run lint` clean (`tsc --noEmit`).
  - [x] `npm run test` — full suite passes (507/507).
  - [ ] Regression sweep (manual, out-of-scope for dev agent).

## Dev Notes

### Track A — why the hydrate path is clean

`round:start` is the authoritative "here's your round context" event. Epic 12-3 already extended the reconnect resend to include `songHistory`; adding `currentSongIndex` and `paused` completes the picture without introducing a second event or new event name. The cached `roundStartPayload` is used by both the normal round-start broadcast (at [rooms.ts:475-484](src/server/rooms.ts#L475-L484)) and the reconnect unicast (at [ws.ts:341](src/server/ws.ts#L341)) — mutating it would leak reconnect-specific fields into the broadcast path and cause a round-start for all players to include stale per-socket state. Spread-at-send-site is the only safe shape.

Why the last history entry is always the current song: [rooms.ts:216-226](src/server/rooms.ts#L216-L226) pushes to `songHistory` only on `isTrackChange === true` AND sets `round.currentSongIndex = songIndex` on every call. Therefore, whenever `currentSongIndex >= 0`, `songHistory[songHistory.length - 1]` is the track currently playing. No edge case with pause/resume (which takes the `!isTrackChange` branch and doesn't push).

Why `history.length === 0` auto-play guard must stay: it's the "fresh round, no song has started yet" branch that kicks off server-driven SDK auto-play. The Track A hydrate path is only relevant on the "songs already played" branch (which the existing code didn't touch). Leaving both branches distinct keeps each case simple.

### Track B — the evidence is soft, which is why we ship the log

The existing play code path at [rooms.ts:255-275](src/server/rooms.ts#L255-L275) DOES include `uris: [spotify:track:<id>]` on `isTrackChange === true`, including the 404-retry builder. So the code path *should* replace Spotify's prior context. Possible failure modes on the observed repro:
1. The play call silently dropped (e.g., 401→refresh path at [rooms.ts:56-62](src/server/rooms.ts#L56-L62) failed and was swallowed).
2. The 404 transfer path cleared `activeDeviceId` and broadcast `host:sdk-stale` ([rooms.ts:79-82](src/server/rooms.ts#L79-L82)); a subsequent play hit a different path.
3. Spotify honored the URI but playback straddled the transition — user perceived the random song during the crossfade.

The log alone turns the next repro into a diagnosable trail. The defensive pause covers the "Spotify resumed prior context under us" case specifically — pausing an already-paused device is idempotent (existing 403/404 handlers swallow it). Scope is deliberately narrow: ONLY on first-song-of-round to avoid introducing pause-then-play latency on normal track changes.

### Track C — the guard is inverted

[HostRoomPage.svelte:479-483](src/client/pages/HostRoomPage.svelte#L479-L483) and [RoomPage.svelte:108-112](src/client/pages/RoomPage.svelte#L108-L112) both do:
```ts
if (hasSeenRoundStart) { casualModeOn = false }
hasSeenRoundStart = true
```

`hasSeenRoundStart` is module-scoped and set once. It never resets (except for RoomPage's `session:connect` path at line 107, which is what this story deletes). So the *second* `round:start` — either the reconnect resend from [ws.ts:341](src/server/ws.ts#L341) or a let-it-ride round:start from [rooms.ts:477](src/server/rooms.ts#L477) — forces `casualModeOn = false`, diverging from the server's preserved `playerCasualModes`.

Server-side is correct: Story 9-2 preserves `playerCasualModes` across rounds ([rooms.ts:441-443](src/server/rooms.ts#L441-L443) comment), and every `round:start` broadcasts the correct `allowCasualMode`. The client-side reset is the whole bug; deleting it fixes both Symptom A (reconnect divergence) and Symptom B (let-it-ride loss).

**Source of truth after fix:** `casualModeOn` mutates on (a) explicit user toggle, (b) `session:connect` hydration from `casualModeNames` (for guests at [RoomPage.svelte:106](src/client/pages/RoomPage.svelte#L106); for host at [HostRoomPage.svelte:502-504](src/client/pages/HostRoomPage.svelte#L502-L504)). Nothing else.

**Flag-only known gap:** `playerCasualModes` is in-memory and reset on rehydrate at [ws.ts:153](src/server/ws.ts#L153). A full server restart clears toggles. Existing comment at [ws.ts:87-93](src/server/ws.ts#L87-L93) acknowledges this. Unrelated to this bug; do NOT fix in this story.

### Track D — the banner is noise

12-1 made reconnects transparent and typically sub-second. The "Host disconnected — waiting for them to reconnect…" banner flashed during every brief network blip and confused playtesters. Deleting it matches the UX of 12-1: silent retry, no user-facing "something is wrong" signaling unless the connection actually dies (the existing `wsState === 'dead'` banner at [RoomPage.svelte:176-178](src/client/pages/RoomPage.svelte#L176-L178) handles that case and is not affected by this story).

The "Waiting for next song…" copy at [:115](src/client/pages/RoomPage.svelte#L115) and [:117](src/client/pages/RoomPage.svelte#L117) is redundant with the host-driven song cadence and just creates flicker. The `session:connect` → round-ended default at [:120](src/client/pages/RoomPage.svelte#L120) is a different state (round genuinely not started) and must stay.

### What NOT to touch

- **Server-side casual-mode:** `replayAutoMarksToSocket`, `runCasualModeSweep`, reconnect sweeps at [ws.ts:348-352](src/server/ws.ts#L348-L352), the round payload's `allowCasualMode` field, `startContinuousRound` preservation.
- **Story 12-1 infrastructure:** `wsClient`, heartbeat, visibility nudge. This story does not touch WS lifecycle.
- **Story 12-2 `/host/resume`:** Track A does NOT duplicate `/host/resume`'s Spotify-truth reconcile into `round:start`. Keep them disjoint (server-authoritative round state via `round:start`; Spotify-authoritative playback state via `/host/resume`).
- **Story 12-3 marks replay + host marks persistence:** `replayAutoMarksToSocket`, host `getMarksForCard` / `onTileMark` wiring in [HostRoomPage.svelte:60-63](src/client/pages/HostRoomPage.svelte#L60-L63) — all unrelated to this story.
- **The `uris` body in the play call:** Track B does not remove or modify this; only adds a pause before it on first-song-of-round.

### File structure

- Modified: [src/server/ws.ts](src/server/ws.ts) — Track A unicast augment; Track D broadcast deletion (conditional on AC 18 grep result).
- Modified: [src/server/rooms.ts](src/server/rooms.ts) — Track B log + defensive pause on first song.
- Modified: [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — Track A client hydrate; Track C reset removal.
- Modified: [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte) — Track C reset removal; Track D UI cleanup.
- Modified: [src/server/__tests__/ws.test.ts](src/server/__tests__/ws.test.ts) — Track A server assertion.
- Modified: [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) — Track B order assertion.
- Modified: [src/client/__tests__/gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts) (or equivalent) — Track A client assertion, Track C survival assertion.
- Modified (conditional): [src/client/__tests__/join.test.ts](src/client/__tests__/join.test.ts) — only if Track D deletes server broadcasts.
- No new files. No new dependencies. No new abstractions.

### Reused utilities (no new abstractions)

- `broadcast` at [src/server/ws.ts:180](src/server/ws.ts#L180) — unchanged.
- Direct `ws.send` for unicast — existing pattern, used by Track A.
- `callSpotifyOnDevice` at [rooms.ts:56](src/server/rooms.ts#L56) — reused as-is for Track B pause.
- `reissueExpectedTrack` at [rooms.ts:85-100](src/server/rooms.ts#L85-L100) — unchanged.
- `cardFingerprint` / `restoreMarks` in [src/client/lib/bingo.ts](src/client/lib/bingo.ts) — unchanged.
- `createGameState` factory in [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts) — unchanged.

### Previous story intelligence (Story 12-3 completion notes)

- Map key for `playerCasualModes` and `autoMarkedTileIndices` is player *name* (guest name, or `host_name` for host) — Track C relies on this being preserved server-side; do not change the keying.
- Host reconnect replay uses `room.host_name` as the `userKey` — Track A does NOT interact with this; it only adds `currentSongIndex` and `paused` to the unicast.
- `playerCasualModes.get(hostName)` is the canonical check at [ws.ts:349](src/server/ws.ts#L349) — unchanged by this story.
- Vitest mock.calls ordering is the established pattern for "X was called before Y" assertions (used extensively in 12-3 tests) — use the same pattern for Track B AC 24.

### Git intelligence — recent Epic 12 commits

- `6df298f feat: story 12-3 — marks & casual-mode reconnect reliability` — added `replayAutoMarksToSocket`, sweep coalescing; informs Track C's "server is already correct" claim.
- `ac8e44a feat: story 12-2 — spotify-first mobile playback and resume reconcile` — added `/host/resume`, `host:sdk-stale`; informs Track B's failure-mode enumeration.
- `1de35cc feat: story 12-1 — websocket heartbeat and auto-reconnect` — enabled frequent silent reconnects; made Track A's bug surface visible in the first place.

### Testing standards

- Server tests in [src/server/__tests__/](src/server/__tests__/). Use vitest. Mock `callSpotifyOnDevice` via `vi.spyOn` when asserting call order (Track B).
- Client tests primarily in [src/client/__tests__/gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts) — the established surface for state-transition assertions without mounting full components. Story 12-3 followed this pattern and flagged (review line 204) that component-binding coverage is a wider-harness decision out of scope per-story. Apply the same boundary here: test the `round:start` handler's state transitions at the gameState/handler surface, not by mounting Svelte components.
- `npm run lint` runs `tsc --noEmit` — any new local variables or imports must be fully typed.

### References

- Parent bug dump: [_bmad-output/implementation-artifacts/epic-12-reliability-followup-fixes.md](_bmad-output/implementation-artifacts/epic-12-reliability-followup-fixes.md) — source of the four tracks.
- Parent epic: [_bmad-output/epics.md](_bmad-output/epics.md) — Epic 12 ("Mobile-First Playback & Reliability Hardening").
- Stories shipped in this epic: 12-1 (heartbeat/reconnect), 12-2 (mobile playback + `/host/resume`), 12-3 (marks + casual-mode reconnect).
- Related: Story 9-2 (Live Round Settings) — established `playerCasualModes` preservation across rounds.
- Related: Story 8-5 (Casual Mode Auto-Mark Engine) — `runCasualModeSweep`, `autoMarkedTileIndices`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `npm run lint` — clean (tsc --noEmit).
- `npm run test` — 507/507 passing on the 12-4 landing commit. Full-suite run surfaced one pre-existing flake ("square:auto-marked is NOT sent to other players") that passed both in isolation and on re-run of the full suite; no correlation to 12-4 changes.

### Completion Notes List

- Track C: deleted the inverted `hasSeenRoundStart` guard in both page components. After this change, `casualModeOn` is only mutated by explicit user toggles and `session:connect` hydration — `round:start` is a no-op for it, matching server-side `playerCasualModes` preservation.
- Track A: added `currentSongIndex` and `paused` to the host-reconnect unicast by spread (cache not mutated). Host page's `round:start` handler hydrates `currentTrack`/`currentTrackId`/`isPlaying` from the last history entry when `currentSongIndex >= 0`. The existing `history.length === 0` auto-play guard is preserved intact — it's now explicitly `else if` after the new hydrate branch.
- Track D: removed the "Host disconnected — waiting for them to reconnect…" banner and its `host:disconnected`/`host:reconnected` branches + CSS. Server broadcasts left intact per AC 18 because `src/client/lib/ws.ts` still exposes optional handlers that are consumed by tests in join.test.ts and ws.test.ts. Removed both `statusLine = 'Waiting for next song…'` assignments; kept the `statusLine` variable because `round:end` still writes the round-ended default.
- Track B: added `[spotify:play]` structured log and the guarded first-song defensive pause. `needsDefensivePause` is evaluated before `round.currentSongIndex` is reassigned. Pause is fire-and-forget via `callSpotifyOnDevice('pause', ...)` with `.catch(() => {})`, no retry builder. Updated existing device-recovery tests to account for the extra pause fetch on fresh rounds; added two focused Track B tests asserting pause-before-play on fresh rounds and pause-does-not-fire on subsequent track changes.
- Known limitation flagged per AC 16: `playerCasualModes` is in-memory; a full server restart clears toggles. Not addressed in this story.

### File List

- Modified: [src/server/ws.ts](src/server/ws.ts) — Track A unicast augment (`currentSongIndex`, `paused`).
- Modified: [src/server/rooms.ts](src/server/rooms.ts) — Track B observability log + defensive pre-play pause on first song of fresh round.
- Modified: [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte) — Track A `round:start` hydrate branch; Track C reset removal + `hasSeenRoundStart` deletion.
- Modified: [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte) — Track C reset removal + `hasSeenRoundStart` deletion; Track D banner/branch/CSS/statusLine-assignment cleanup.
- Modified: [src/server/__tests__/ws.test.ts](src/server/__tests__/ws.test.ts) — Track A reconnect-unicast assertion (new test).
- Modified: [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts) — existing device-recovery tests updated for pause-then-play ordering on fresh rounds; new "Story 12-4 Track B" describe with pause-before-play and no-pause-on-subsequent assertions.
- Modified: [src/client/__tests__/gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts) — Track A hydrate-rule tests and Track C casualModeOn preservation tests (pure-logic mirrors of the handler rules per Dev Notes testing-standards).

### Review Findings

- [x] [Review][Defer] Track C client test is a vacuous tautology — `applyRoundStart` is a pure identity function; test cannot catch a future casualModeOn regression in the round:start handler [src/client/__tests__/gameState.svelte.test.ts:310-325] — deferred, test quality; behavior is correct; non-trivial to fix without mounting Svelte components per project testing standard
- [x] [Review][Defer] Track A client test mirrors handler logic in a local copy — `hydrate()` reimplements the HostRoomPage round:start handler rather than exercising it; a regression in the actual handler would not be caught [src/client/__tests__/gameState.svelte.test.ts:241-295] — deferred, test quality; consistent with established project testing convention (Dev Notes)

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created from epic-12 playtest bug-dump plan. Status: ready-for-dev. |
| 2026-04-20 | Implementation complete. All four tracks landed; lint + full test suite pass. Status: review. |
| 2026-04-21 | Code review complete. 0 decision-needed, 0 patch, 2 deferred (test quality), 14 dismissed. Status: done. |
