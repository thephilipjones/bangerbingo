# Story 13-9: Clip Duration "Full" — Playback, Reconnect, and Auto-Advance Fixes

## Status: ready-for-dev

## Context

Playtest (2026-04-22) surfaced three related bugs when the host selects **Full** as the clip duration in Advanced Settings:

1. **Full starts at the chorus offset (60s), not the beginning of the song.** `startSong()` unconditionally issues `position_ms: SEEK_POSITION_MS` (60 000ms) to Spotify. That's correct for timed clips (where we intentionally jump to a punchy chorus position), but wrong for Full — the whole song should play from 0.
2. **UI toggle reverts to "30s" while playback persists as Full.** On reconnect (WS close → reopen, host reload), the server replays a `roundStartPayload` snapshot frozen at round start. The PATCH `/round-config` handler ([src/server/rooms.ts](src/server/rooms.ts#L1147)) mutates `currentRound.config` and `pendingRound`, but never updates `roundStartPayload`. Client `gameState` overwrites its optimistic `clipDuration` with the stale value from the replayed `round:start`. Server-side behaviour is correct; only the UI state and the replay payload are stale.
3. **When a Full song reaches its end, playback doesn't continue to the next song.** `startSong()` deliberately skips the `autoAdvance` timer when `clipDuration === 'full'`, and no other end-of-track detection exists (no SDK `player_state_changed` listener, no `/me/player` poller). Spotify either sits on the ended track or — worse — kicks in its own autoplay and starts a non-BB "similar" track.

All three fixes are server-side. Client components (`AdvancedSettings.svelte`, `gameState.svelte.ts`, `HostRoomPage.svelte`) already handle `'full'` correctly — they were just being fed stale/missing data.

Context for Bug 3's approach: rather than detecting end-of-track, schedule `autoAdvance` to fire **~1s before** the track actually ends using `track.durationMs`. This is strictly simpler than end-event listening and sidesteps the two Spotify quirks above (autoplay takeover, stuck-on-ended). `track.durationMs` must be added to the `Track` interface and the Spotify `fields` query — a small addition that's also needed for a future clip progress indicator (noted in user memory).

No new dependencies. No DB schema changes.

---

## Changes

### A — Full-mode starts at position 0

**File:** `src/server/rooms.ts` — `startSong` (around lines 214–340)

Introduce a local `startOffsetMs` derived from the round config. Replace the three hardcoded uses of `SEEK_POSITION_MS` inside `startSong` with this variable:

```ts
const startOffsetMs = round.config.clipDuration === 'full' ? 0 : SEEK_POSITION_MS
```

Uses:
- `song:start` broadcast `seekPositionMs` field at [rooms.ts:260](src/server/rooms.ts#L260) — send `startOffsetMs`.
- `startBuildRequest` body `position_ms` at [rooms.ts:284](src/server/rooms.ts#L284) — send `startOffsetMs`.

Also update the two external call sites that pass a hardcoded `SEEK_POSITION_MS` into `reissueExpectedTrack`:
- `handleSetPlayerDevice` at [rooms.ts:745](src/server/rooms.ts#L745) — pass `round.config.clipDuration === 'full' ? 0 : SEEK_POSITION_MS`.
- `POST /host/resume` drift re-issue at [rooms.ts:932](src/server/rooms.ts#L932) — same conditional; and the returned `position` field at [rooms.ts:942](src/server/rooms.ts#L942) should match.

Do **not** change the `SEEK_POSITION_MS` constant itself — it remains the correct value for timed clips.

---

### B — PATCH `/round-config` updates the frozen replay payload

**File:** `src/server/rooms.ts` — PATCH handler (around lines 1147–1247)

After assigning `roomState.currentRound.config = merged` at [rooms.ts:1199](src/server/rooms.ts#L1199), also rebuild the stored `roundStartPayload` so reconnect replays reflect the latest config:

```ts
roomState.currentRound.roundStartPayload = {
  ...roomState.currentRound.roundStartPayload,
  clipDuration: merged.clipDuration,
  titleRevealDelay: merged.titleRevealDelay,
  audioPreset: merged.audioPreset,
  allowCasualMode: merged.allowCasualMode,
}
```

Rationale: the replay path at [src/server/ws.ts:409-416](src/server/ws.ts#L409-L416) (host) and [ws.ts:577-579](src/server/ws.ts#L577) (guest returning) spreads `roundStartPayload` as the `round:start` message. Client `gameState.processWsMessage` reads `data.clipDuration` from it at [src/client/lib/gameState.svelte.ts:160](src/client/lib/gameState.svelte.ts#L160). Keeping the stored payload in sync with `merged` removes the stale-value window entirely. No client change required.

---

### C — Add `durationMs` to the `Track` type

**File:** `src/server/music/spotify.ts`

1. `Track` interface at [spotify.ts:19-24](src/server/music/spotify.ts#L19-L24) — add:
   ```ts
   durationMs: number
   ```

2. `SpotifyTracksResponse` shape at [spotify.ts:40-49](src/server/music/spotify.ts#L40-L49) — add `duration_ms: number` to the inner `track` shape.

3. `getPlaylistTracks` fields query at [spotify.ts:97](src/server/music/spotify.ts#L97) — change to:
   ```ts
   url.searchParams.set('fields', 'items(track(id,name,artists,album(images),duration_ms))')
   ```

4. The mapping block at [spotify.ts:118-123](src/server/music/spotify.ts#L118-L123) — include:
   ```ts
   durationMs: item.track!.duration_ms ?? 180_000,
   ```
   The `?? 180_000` fallback (3 minutes) guards the rare case Spotify omits `duration_ms`. Better than crashing; a wrong-by-a-few-seconds advance is acceptable for scope.

No callers consume the new field yet outside of Changes D and E — Track is carried through `round.playlist` (which is persisted via existing `persistRoomState`), so persistence covers restart automatically.

---

### D — Full-mode `autoAdvance` timer

**File:** `src/server/rooms.ts` — `startSong` (around lines 331–339)

Replace the current two-branch block:

```ts
if (round.config.clipDuration !== 'full') {
  round.clipStartedAt = Date.now()
  round.timers.autoAdvance = setTimeout(() => {
    if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
    advanceToNext(roomCode, roomState)
  }, (round.config.clipDuration as number) * 1000)
} else {
  round.clipStartedAt = undefined
}
```

With a single unified branch that computes `effectiveMs`:

```ts
const FULL_MODE_TAIL_MS = 1_000  // fire this far before the track actually ends
round.clipStartedAt = Date.now()
const effectiveMs = round.config.clipDuration === 'full'
  ? Math.max(1_000, track.durationMs - FULL_MODE_TAIL_MS)
  : (round.config.clipDuration as number) * 1000
round.timers.autoAdvance = setTimeout(() => {
  if (roomState.currentRound?.roundNumber !== capturedRoundNumber) return
  advanceToNext(roomCode, roomState)
}, effectiveMs)
```

Key points:
- `FULL_MODE_TAIL_MS = 1_000` is the intentional lead time — `advanceToNext` issues the next `play` call with ~1s still remaining in the current track, preempting Spotify's autoplay and avoiding the "stuck on ended track" state.
- The `Math.max(1_000, …)` guards against pathologically short tracks (<1s) that would otherwise schedule a negative timeout.
- `clipStartedAt` is now set in Full mode too (it previously was `undefined`). Needed for the `host/resume` drift check in Change E.
- Define `FULL_MODE_TAIL_MS` as a module-scope const near `SEEK_POSITION_MS` at [rooms.ts:21](src/server/rooms.ts#L21) so it can be reused in Change E.

**Pause/resume parity:** the pre-existing timed-clip resume path re-arms the timer for the full `clipDuration` (imprecise but accepted — see [rooms.ts:648-649](src/server/rooms.ts#L648-L649)). Keep the same behaviour for Full: on resume, re-arm for `track.durationMs - FULL_MODE_TAIL_MS`. A user who paused near the end of a Full song will auto-advance slightly later than ideal. Acceptable for scope; do not add position reconciliation unless it's part of this story's tests.

---

### E — `host/resume` drift correction accepts Full mode

**File:** `src/server/rooms.ts`

1. Update `clipDurationMs` helper at [rooms.ts:812-814](src/server/rooms.ts#L812-L814) to accept the current track and return a real number for Full:

   ```ts
   function clipDurationMs(cd: ClipDuration, track: Track): number {
     return cd === 'full'
       ? Math.max(1_000, track.durationMs - FULL_MODE_TAIL_MS)
       : cd * 1000
   }
   ```

   Return type changes from `number | null` to `number`. Callers now always get a usable ms value.

2. Drift check at [rooms.ts:947-958](src/server/rooms.ts#L947-L958) — consume the new signature and use a `startOffsetMs` when computing elapsed:

   ```ts
   const currentTrack = round.playlist[round.currentSongIndex]
   const clipMs = clipDurationMs(round.config.clipDuration, currentTrack)
   const startOffsetMs = round.config.clipDuration === 'full' ? 0 : SEEK_POSITION_MS
   if (round.clipStartedAt !== undefined && !round.paused) {
     const spotifyElapsedMs = Math.max(0, spotifyPositionMs - startOffsetMs)
     if (spotifyElapsedMs >= clipMs) {
       if (roomState.currentRound?.active && roomState.currentRound.roundNumber === round.roundNumber) {
         void advanceToNext(code, roomState)
       }
       return ctx.json({ state: 'advanced' })
     }
     // ...remaining drift-reconcile logic unchanged
   }
   ```

   Remove the `clipMs !== null` guard — it's now always non-null. Keep the `!round.paused` guard (existing comment explains why).

3. Verify no other callers of `clipDurationMs` exist (grep before and after). If any do, update their call sites accordingly.

---

## Acceptance Criteria

**AC 1 — Full starts at position 0**
Given `clipDuration === 'full'` and a new song begins, the Spotify `play` call body includes `position_ms: 0` (not `60_000`), and the `song:start` broadcast carries `seekPositionMs: 0`.

**AC 2 — Timed clips unchanged**
Given `clipDuration !== 'full'` (20/30/45/60s), the Spotify `play` body and `song:start` broadcast both carry `position_ms: 60_000` / `seekPositionMs: 60_000` as today.

**AC 3 — PATCH updates the replay payload**
Given an active round started with `clipDuration: 30`, when the host PATCHes `/round-config` to `{ clipDuration: 'full' }`, `roomState.currentRound.roundStartPayload.clipDuration` equals `'full'` immediately after the handler returns.

**AC 4 — Reconnect reflects live config**
Given (AC 3) has fired, when a host reconnects and the server resends `round:start` from `roundStartPayload`, the payload's `clipDuration` is `'full'` (matching live config). Same guarantee for a returning guest. Client `gameState.clipDuration` ends up `'full'` after reconnect.

**AC 5 — Full-mode track auto-advances**
Given `clipDuration === 'full'` and a playing track with `durationMs = N`, `round.timers.autoAdvance` is scheduled to fire `N - 1000` ms after `startSong` (floor 1000ms). On fire, `advanceToNext` runs and the next song's `song:start` broadcasts within a few hundred ms of the current track's actual end.

**AC 6 — `Track.durationMs` populated from Spotify**
Given a Spotify playlist response with `items[i].track.duration_ms`, the `Track` objects returned by `getPlaylistTracks` include `durationMs` equal to that value. Missing `duration_ms` falls back to `180_000`.

**AC 7 — Full-mode pause/resume**
Given a Full-mode track is playing and the host pauses, then resumes from the host controls: playback resumes and the `autoAdvance` timer is re-armed for `durationMs - 1000` from the resume moment. (Slight over-shoot past the natural end if the pause happened mid-track is expected and accepted.)

**AC 8 — `host/resume` drift check handles Full**
Given an active Full-mode round on reconnect, `host/resume` computes `clipMs = max(1000, durationMs - 1000)` and `startOffsetMs = 0`, so `spotifyElapsedMs = spotifyPositionMs`. If `spotifyElapsedMs >= clipMs`, the response is `state: 'advanced'` and `advanceToNext` fires. No crash, no `clipMs === null` early-exit.

**AC 9 — Mode switches mid-round take effect on next song**
Given a round running in `30s` mode currently on song A, when the host switches to `Full` during song A: song A continues under its original 30s timer; song B (and later) starts at 0 and auto-advances ~1s before its own end. Conversely, switching Full → 30s mid-song keeps the current Full timer but the next song seeks to 60s with a 30s timer.

**AC 10 — No regressions in timed-clip flow**
All pre-existing tests covering timed-clip behaviour continue to pass unchanged (aside from the `clipDurationMs` signature update).

---

## Files Modified

- `src/server/rooms.ts` — Changes A, B, D, E: `startOffsetMs` in `startSong`; `roundStartPayload` refresh in PATCH; unified `autoAdvance` branch with `FULL_MODE_TAIL_MS`; `clipDurationMs` signature + drift check.
- `src/server/music/spotify.ts` — Change C: `Track.durationMs`, `SpotifyTracksResponse.duration_ms`, `fields` query, mapper.
- `src/server/__tests__/rooms.test.ts` — new Full-mode cases (AC 1, 5, 8, 9); PATCH-updates-roundStartPayload case (AC 3/4); update existing `seekPositionMs === 60_000` assertions to scope them to non-Full cases (AC 2). Fixtures that construct `Track` objects may need a `durationMs` field added.
- `src/server/__tests__/ws.test.ts` — fixtures that construct `Track`/`round.playlist` entries need `durationMs`. Add a test that reconnect after a PATCH to `clipDuration: 'full'` produces a `round:start` payload with `clipDuration: 'full'`.
- `src/server/music/__tests__/spotify.test.ts` — new test for AC 6 (`durationMs` mapping + `?? 180_000` fallback).

No client file changes. No CSS changes.

---

## Tests

### Update existing tests

**`src/server/__tests__/rooms.test.ts`**

- [rooms.test.ts:861](src/server/__tests__/rooms.test.ts#L861) — the existing `expect(msg.seekPositionMs).toBe(60_000)` assertion must remain valid for its timed-clip test context. If it runs against a test that doesn't explicitly set `clipDuration`, confirm the default is a timed value (e.g. 30). If any test inadvertently becomes Full after the change, split it.
- Extend the fixture round-start in any test that constructs `Track` inline to include `durationMs` (e.g. `180_000` or `200_000`).
- Remove `clipMs !== null` branches in tests that assume `clipDurationMs` returned `null` for Full.

### New tests in `src/server/__tests__/rooms.test.ts`

- **`'Full-mode song:start uses position_ms 0 and seekPositionMs 0'`** — start a round with `clipDuration: 'full'`, call `/round/play`, assert the broadcast `song:start` has `seekPositionMs: 0` and the spied Spotify `fetch` body has `position_ms: 0`. (AC 1)
- **`'Full-mode schedules autoAdvance for durationMs - 1000'`** — use fake timers; seed a playlist whose first track has `durationMs: 200_000`; start the round; advance `199_000`ms; assert `song:start` for track index 1 broadcast; advance any further to confirm not earlier. (AC 5)
- **`'PATCH /round-config updates currentRound.roundStartPayload'`** — start a round in `30s`; PATCH to `{ clipDuration: 'full' }`; assert `roomState.currentRound.roundStartPayload.clipDuration === 'full'`. (AC 3)
- **`'reconnect after PATCH replays round:start with updated clipDuration'`** — start `30s`, PATCH to `full`, simulate host reconnect via WS test harness; assert the replayed `round:start` message has `clipDuration: 'full'`. (AC 4)
- **`'host/resume advances when Full-mode elapsed >= clipMs'`** — active Full round, stub `/me/player` to return `progress_ms: track.durationMs - 500` and `is_playing: true`; call `/host/resume`; assert response state `advanced` and `round.currentSongIndex` incremented. (AC 8)
- **`'mode switch mid-song applies to next song not current'`** — start `30s`; after song 0 begins, PATCH to `full`; let the 30s timer fire; assert song 1 plays with `position_ms: 0` and `autoAdvance` scheduled for song 1's `durationMs - 1000`. (AC 9)

### New test file / extension

**`src/server/music/__tests__/spotify.test.ts`** (extend)

- **`'getPlaylistTracks populates durationMs from duration_ms'`** — mock Spotify response with `duration_ms: 215_000`; assert each returned `Track.durationMs === 215_000`. (AC 6)
- **`'getPlaylistTracks falls back to 180_000 when duration_ms missing'`** — mock one item with `duration_ms: undefined`; assert `Track.durationMs === 180_000`. (AC 6 fallback)

---

## Dev Notes

- **Do not change `SEEK_POSITION_MS`.** The 60 000ms chorus-offset is still correct for timed clips. Only scope the decision at call sites via `startOffsetMs`.
- **`FULL_MODE_TAIL_MS = 1000` is deliberate.** Firing `advanceToNext` with a full second of audio remaining preempts Spotify's own auto-next and avoids a dead-stop "ended" state. Do not reduce this to 0 or "detect end event".
- **`roundStartPayload` is load-bearing for reconnect.** Every field in that object must stay in lockstep with `currentRound.config`. If you later add a new config field, update both the initial build at [rooms.ts:497-506](src/server/rooms.ts#L497-L506) *and* the PATCH refresh in Change B.
- **`Track.durationMs` has a future consumer.** A clip progress indicator is planned — keep `durationMs` flowing through `persistRoomState` / WS payloads if any future change touches those. For this story, only the server uses it.
- **Spotify `fields` query change is a wire-format change.** Any test that mocks the Spotify tracks response must include `duration_ms` on mocked items or the fallback branch will fire — make it explicit in new tests.
- **Commit style:** follow project convention — `feat: clip-duration full-mode playback fixes` (no scope parens).
- **Package manager:** run `npm run test` and `npm run typecheck` (not `bun run …`). Bun is not installed in this environment.
- **No client changes.** If a reviewer suggests touching `AdvancedSettings.svelte` or `gameState.svelte.ts`, push back — the client state flow is correct; only the server's replayed payload was stale.
- **Pre-existing resume imprecision on timed clips is out of scope.** This story does not fix the fact that timed-clip resume re-arms for full clip duration. Keep Full-mode resume at parity (same imprecision).
- **No DB migrations.** `played_songs` is untouched. `persistRoomState` covers the new `durationMs` field implicitly because it serialises the full `round.playlist`.

---

## References

- Plan file: `/Users/Philip/.claude/plans/clip-duration-full-should-logical-crown.md` (this story's source of truth)
- Epic 13 retro: [epic-13-retro-2026-04-22.md](_bmad-output/implementation-artifacts/epic-13-retro-2026-04-22.md) (context: this bug surfaced after 13-8's retrospective; epic reopened for this single story)
- Prior clip-duration work: [9-2-live-round-settings-and-pre-round-simplification.md](_bmad-output/implementation-artifacts/9-2-live-round-settings-and-pre-round-simplification.md) introduced the PATCH flow now being fixed
- Prior reconnect work: [13-1-reconnect-after-win-state-replay.md](_bmad-output/implementation-artifacts/13-1-reconnect-after-win-state-replay.md) established the `roundStartPayload` replay pattern this story extends

---

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
