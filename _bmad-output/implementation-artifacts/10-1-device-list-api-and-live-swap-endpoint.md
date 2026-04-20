# Story 10.1: Device List API & Live-Swap Endpoint

Status: done

## Story

As a host,
I want the server to expose my available Spotify Connect devices and accept a chosen device id as the playback target (swapping audio mid-round when I change it),
so that the client UI (Story 10-2) can populate a device picker and the existing play/pause/next codepath keeps working unchanged regardless of which device is active.

## Background

Epic 10 reframes the host as a pure Spotify Connect remote so any Connect-capable device (in-browser Web Playback SDK, iPhone native app, Sonos, Echo, hi-fi) can be the playback target. The server already calls Spotify Web API endpoints with `device_id=<whatever is stored in roomState.sdkDeviceId>`; the only coupling to the SDK today is how that id gets populated (the SDK `ready` callback POSTs to `/api/rooms/:code/sdk/device`). Generalising the write endpoint and exposing a list endpoint completes the decoupling — no changes to `callSpotifyOnDevice`, the 404→reactivation fallback, or any play/pause/next route.

This story is **server-only**. Stories 10-2 (Device Chip + Picker UI) and 10-3 (SDK Default, Preference Persistence & Failure Path) ship on top of the endpoints added here.

## Acceptance Criteria

### Device list endpoint — `GET /api/rooms/:code/player/devices`

1. **Happy path.** Given an authenticated host with a valid Spotify token, when the client sends `GET /api/rooms/:code/player/devices`, the server calls `GET https://api.spotify.com/v1/me/player/devices` using a token resolved through `withFreshToken` (silent refresh if within the 60s pre-expiry window) and returns HTTP 200 `{ devices: Array<{ id: string; name: string; type: string; is_active: boolean; is_restricted: boolean; volume_percent: number | null }> }` — exactly the subset of fields the client renders. Fields that Spotify omits on a given device pass through as `null` / `undefined` per Spotify's spec; the server does not fabricate defaults.

2. **Auth degraded.** Given the host's Spotify token has expired and `withFreshToken` returns `null` (refresh failed, host is in `isHostDegraded` state), when `GET /api/rooms/:code/player/devices` runs, the server returns HTTP 503 `{ message: 'Spotify auth degraded' }` — the same shape used by `startContinuousRound` at [src/server/rooms.ts:463](src/server/rooms.ts#L463). No new error surface; the client's existing `auth:degraded` handling in `HostRoomPage` is the re-auth path.

3. **Empty list is a valid response.** Given `/me/player/devices` returns an empty `devices` array (host has no active Spotify apps), when the server forwards the response, the endpoint returns HTTP 200 `{ devices: [] }`. Empty is a state, not an error.

4. **Auth gating.** Given a guest session or an unauthenticated request, when the request is made, the endpoint returns 401 (no session cookie) or 403 (session cookie present but `room.host_user_id !== host.user_id`) — the same shapes used by every other host-only endpoint in this router. Route is registered with `requireAuth` middleware; host-match check mirrors `/rooms/:code/sdk/device` at [src/server/rooms.ts:614-630](src/server/rooms.ts#L614-L630).

5. **Room not found.** Given the host is authenticated but `:code` does not match any room, when the request runs, the server returns HTTP 404 `{ message: 'Room not found' }`. Ordering mirrors `/sdk/device`: 404 check happens before the 403 host-match check (so unknown room is a 404, not a 403).

6. **Spotify upstream failure.** Given Spotify returns a non-200 for `/me/player/devices` (rate limit, 5xx), when the server receives it, the endpoint returns HTTP 502 `{ message: 'Spotify devices fetch failed' }` with the upstream status logged via `console.error`. The client treats this as "retryable" — surfaced as the inline picker error per Story 10-2 AC #7.

### Device-write endpoint (generalised) — `POST /api/rooms/:code/player/device`

7. **New canonical endpoint.** A new handler is registered at `POST /api/rooms/:code/player/device` that accepts `{ deviceId: string }` and behaves as described in ACs #8–#11 below. Payload key is `deviceId` (camelCase) — same shape as the existing `/sdk/device` body at [src/server/rooms.ts:622-623](src/server/rooms.ts#L622-L623).

8. **Legacy alias kept.** The existing `POST /api/rooms/:code/sdk/device` route stays registered and forwards to the same handler as `/player/device` (either via a thin wrapper or by registering both paths on the same handler function). This keeps the SDK `ready` callback on existing host pages working during rollout — removing the alias is out of scope for this epic.

9. **No gating on "freshness" of the id.** Given the host posts a `deviceId` that is not currently present in the room's last-known device list, when the handler processes the request, the id is still accepted and stored. The server does NOT cross-check against a cached device list — Spotify's own 404 response on the subsequent play call (already handled by `callSpotifyOnDevice` reactivation path at [src/server/rooms.ts:64-90](src/server/rooms.ts#L64-L90)) is the authoritative check.

10. **Lobby / between-rounds behaviour (no active round).** Given `roomState.currentRound` is absent OR `roomState.currentRound.active === false` OR `roomState.currentRound.paused === true`, when the host posts a new `deviceId`, the server persists `roomState.sdkDeviceId = deviceId` and returns HTTP 200 `{}`. It does NOT call `transfer_playback` — storing the selection is enough; the next `POST /round` or `POST /round/play` will use the new id when it fires its first `callSpotifyOnDevice`.

11. **Auth / room guards match `/sdk/device`.** 401 (no session), 404 (room not found), 403 (wrong host), 503 (no active WS session / `roomSockets.get(code)` returns undefined), 400 (invalid body: missing / non-string `deviceId`). Ordering matches the `/sdk/device` handler exactly so the alias and the new path return identical shapes for identical inputs.

### Live mid-round swap

12. **Seamless transfer during an active playing round.** Given `roomState.currentRound` exists AND `roomState.currentRound.active === true` AND `roomState.currentRound.paused === false` AND the posted `deviceId !== roomState.sdkDeviceId`, when the handler runs, the server issues `PUT https://api.spotify.com/v1/me/player` with body `{ device_ids: [newId], play: true }` and `Authorization: Bearer <freshToken>` using a `withFreshToken`-resolved token. On a 2xx response, the server updates `roomState.sdkDeviceId = newId`, returns HTTP 200 `{}`. The round's `currentSongIndex`, `songHistory`, autoAdvance / reveal timers, cards, and player state are all untouched — the swap is pure Spotify audio-routing; `callSpotifyOnDevice` will next fire play/pause/next against the new id without any further coordination.

13. **Persist room state after a successful swap.** On a successful transfer, call `persistRoomState(code)` so the new `sdkDeviceId` survives a server restart (existing pattern — `persistRoomState` already writes `sdkDeviceId` at [src/server/ws.ts:102](src/server/ws.ts#L102)). The legacy `/sdk/device` handler does NOT currently call `persistRoomState` — that's a pre-existing gap. If the unified handler calls it unconditionally after a successful device write (both the "no active round → store only" path and the "active round → transfer + store" path), the SDK-ready callback also benefits. Prefer unconditional `persistRoomState` after a successful store.

14. **Transfer failure — 404 (device dormant).** Given `PUT /me/player` returns 404 (the chosen device went dormant between the list fetch and the swap), when the handler sees the response, the server does NOT call the `callSpotifyOnDevice` reactivation logic (that reactivates the *stored* device; here we want to reject the *new* choice). The server does NOT update `roomState.sdkDeviceId` — the old id stays in room state. The handler returns HTTP 502 `{ message: 'Device unavailable — pick another' }` with the upstream status logged. The client surfaces this per Story 10-2 AC #7 (picker shows "Couldn't switch device" inline + reverts the optimistic chip update).

15. **Transfer failure — 401 (token revoked).** Given `PUT /me/player` returns 401 despite `withFreshToken` returning a fresh token (token revoked between refresh and call), when the handler sees the response, it follows the same pattern as `callSpotifyOnDevice`'s 401 branch at [src/server/rooms.ts:57-62](src/server/rooms.ts#L57-L62) — fire-and-forget `refreshWithRetry(hostUserId)`, do NOT update `sdkDeviceId`, return HTTP 503 `{ message: 'Spotify auth degraded' }`.

16. **Transfer failure — other (5xx / network).** Given `PUT /me/player` returns any other non-2xx or throws, when the handler catches it, it logs via `console.error('[spotify:transfer]', …)`, does NOT update `sdkDeviceId`, and returns HTTP 502 `{ message: 'Device swap failed' }`.

17. **Same-device no-op.** Given the posted `deviceId === roomState.sdkDeviceId` AND the round is active-playing, when the handler runs, it returns HTTP 200 `{}` without calling `PUT /me/player` — there is nothing to swap to. This prevents a pointless API call when the picker POSTs on a row the host is already on (belt-and-braces; the picker closes optimistically on tap regardless).

### No regression to existing play/pause/next codepaths

18. **`callSpotifyOnDevice` is not touched.** The existing function at [src/server/rooms.ts:34-99](src/server/rooms.ts#L34-L99) continues to read `roomState.sdkDeviceId` on each call — whether the id came from the SDK `ready` callback (legacy `/sdk/device` path) or from the user picker (new `/player/device` path) is invisible to every play/pause/next handler. The 404→`transfer_playback` reactivation path (lines 64-90) continues to wake the *stored* device; it is NOT repurposed for the user-picker transfer path in AC #12.

19. **`startRound` / `startSong` / `round/play` / `round/pause` / `round/next` routes are not modified by this story.** They continue to call `callSpotifyOnDevice` against `roomState.sdkDeviceId` unchanged. The only state they can observe changing from this story is that `sdkDeviceId` is now updatable mid-round by the new endpoint.

### Tests

20. **Unit tests for `GET /api/rooms/:code/player/devices` in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts).**
    - 200 happy path — mock `fetch` to return a fixture with `{ devices: [ {id, name, type, is_active, is_restricted, volume_percent}, … ] }` (use `vi.spyOn(global, 'fetch')` or the existing mock-fetch pattern in the file). Assert response body shape equals the full pass-through.
    - 200 empty devices list.
    - 503 when `withFreshToken` fails (seed host with expired token + force `isHostDegraded` true, or stub refresh to fail).
    - 401 when no session cookie.
    - 403 when session cookie belongs to a different host than `room.host_user_id`.
    - 404 when room does not exist.
    - 502 when Spotify returns 500.

21. **Unit tests for `POST /api/rooms/:code/player/device` in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts).**
    - 200 no-active-round — posts a `deviceId`, asserts `roomState.sdkDeviceId` updated, asserts `persistRoomState` path ran (assert via checking `active_rooms` DB row state_json includes the new `sdkDeviceId`, or spy on `upsertActiveRoom`).
    - 200 active-round transfer — seed an active round, mock `fetch` to return 200 for `PUT /me/player`, assert body sent is `{ device_ids: ['new-id'], play: true }`, assert `sdkDeviceId` updated post-call, assert `round.currentSongIndex` / `round.active` unchanged.
    - 200 same-device no-op — seed `sdkDeviceId='x'`, post `deviceId: 'x'` with active round, assert `fetch` was NOT called with the transfer URL.
    - 502 transfer 404 — mock `PUT /me/player` → 404, assert response is 502 `{ message: 'Device unavailable — pick another' }`, assert `sdkDeviceId` still equals the old value.
    - 503 transfer 401 — mock `PUT /me/player` → 401, assert 503 `{ message: 'Spotify auth degraded' }`, assert `sdkDeviceId` unchanged. (Verifying the fire-and-forget `refreshWithRetry` call via spy is nice-to-have; not strictly required.)
    - 502 transfer 5xx — mock → 500, assert 502, assert `sdkDeviceId` unchanged.
    - 400 invalid body — missing `deviceId`, non-string `deviceId`.
    - 401 / 403 / 404 / 503 auth+room guards (copy/adapt from existing `/sdk/device` describe block at [src/server/__tests__/rooms.test.ts:1400-1477](src/server/__tests__/rooms.test.ts#L1400-L1477)).

22. **Alias parity test.** A single parameterised test (or a pair of equivalent tests) asserts that `POST /api/rooms/:code/sdk/device` and `POST /api/rooms/:code/player/device` with the same payload produce identical effects on `roomState.sdkDeviceId` and identical response shapes — confirming the alias behaves like the new route. Scope this to the no-active-round path (the SDK `ready` callback case); the live-swap path is adequately covered on the canonical route per AC #21.

23. **No regression of existing `/sdk/device` tests.** The existing `describe('POST /api/rooms/:code/sdk/device', …)` block at [src/server/__tests__/rooms.test.ts:1400-1477](src/server/__tests__/rooms.test.ts#L1400-L1477) continues to pass without modification (beyond whatever alias-parity adds). If the handler is unified under a single function registered on two paths, these tests exercise the same code path as the new tests, which is fine — they still protect the legacy contract.

24. **Lint + type-check + test suite green.** `bun run lint` (which runs `tsc --noEmit`), `bun run test`, and `bun run build:client` all clean. No new `svelte-check` errors relative to the baseline documented in recent story Completion Notes.

### Out of scope (explicitly not this story)

- Client UI changes — `DeviceChip`, `DevicePicker`, `AdvancedSettings` row, banner copy rewrite. All in Story 10-2 / 10-3.
- `preferredDeviceId` in `hostPrefs` localStorage. Story 10-3.
- Behaviour changes to the SDK `ready` callback on `HostRoomPage`. Continues to POST to `/sdk/device`; only the server-side landing site changes (now routed through the unified handler).
- Storing a history of recent devices or analytics on device switches.
- Per-device volume control from the server.
- Any modification to `callSpotifyOnDevice` or its 404→reactivation fallback.
- Eventually removing the `/sdk/device` alias — keep it; removal is a later cleanup (not this epic).

## Tasks / Subtasks

- [x] **Server — unified device-write handler** (ACs #7–#17)
  - [x] Extract the existing `/sdk/device` handler body at [src/server/rooms.ts:614-630](src/server/rooms.ts#L614-L630) into a shared `handleSetPlayerDevice` function (or inline the logic in a new handler and have `/sdk/device` call into it).
  - [x] Register `POST /api/rooms/:code/player/device` with `requireAuth` + the unified handler.
  - [x] Re-register `POST /api/rooms/:code/sdk/device` as a thin alias (calls the same handler function, or registers on the same route handler).
  - [x] Inside the handler, resolve `freshHost` via `withFreshToken(ctx.var.host)`; return 503 `{ message: 'Spotify auth degraded' }` on null (matches `startContinuousRound` pattern at [src/server/rooms.ts:463](src/server/rooms.ts#L463)).
  - [x] Branch on "active-playing round" (see AC #12 guard exactly): if yes AND new id differs from current, call `PUT /v1/me/player` with `{ device_ids: [newId], play: true }`; on non-2xx, short-circuit per ACs #14/#15/#16 (do NOT update `sdkDeviceId`).
  - [x] On success (transfer-200 or no-active-round path), set `roomState.sdkDeviceId = deviceId` and call `persistRoomState(code)`.
  - [x] Return `ctx.json({})` with 200.
- [x] **Server — devices list handler** (ACs #1–#6)
  - [x] Register `roomsRouter.get('/rooms/:code/player/devices', requireAuth, …)`.
  - [x] Guard: 404 if `getRoomByCode(code)` returns null; 403 if `room.host_user_id !== ctx.var.host.user_id` (ordering: 404 before 403, mirroring `/sdk/device`).
  - [x] Resolve `freshHost` via `withFreshToken`; 503 on null.
  - [x] `fetch('https://api.spotify.com/v1/me/player/devices', { headers: { Authorization: 'Bearer ' + freshHost.access_token } })`.
  - [x] On non-2xx: log `console.error('[spotify:devices] <status>', bodyText)`, return 502 `{ message: 'Spotify devices fetch failed' }`.
  - [x] On 2xx: parse JSON, pass through `devices` as-is (Spotify's own field names and nullability). Return 200 `{ devices }`.
- [x] **Server tests — `/player/devices`** (AC #20).
- [x] **Server tests — `/player/device`** (AC #21).
- [x] **Server tests — alias parity** (AC #22).
- [x] **Server tests — existing `/sdk/device` regression** (AC #23). Existing describe block passes unchanged against the unified handler.
- [x] **Regression gates** (AC #24). `npm run lint` (= `tsc --noEmit`) clean, `npm run test` 440/440 green, `npm run build:client` clean. (Project uses npm, not bun — story's `bun run …` references are inherited copy from earlier docs.)
- [x] **Auth scope bump.** Added `user-read-playback-state user-modify-playback-state` to [src/server/auth.ts:105](src/server/auth.ts#L105) (flagged in "Latest Tech Information" scope risk callout). Existing hosts must re-login once for the new scopes to be granted; the existing `AuthDegradedBanner` re-auth path covers this.

### Review Findings

- [x] [Review][Patch] Missing persistence assertion in paused-round test — `'200 — paused round is NOT treated as active-playing'` asserts `sdkDeviceId` updated in memory but never checks the DB row; add a `getPersistedState()` assertion to cover the AC#13 persist path [src/server/__tests__/rooms.test.ts]
- [x] [Review][Patch] Empty-string `deviceId` bypasses 400 guard — `typeof body.deviceId !== 'string'` passes for `""`, which would propagate as `?device_id=` to Spotify and produce a silent API error; add a `body.deviceId.length > 0` check [src/server/rooms.ts:627]
- [x] [Review][Patch] `seedDegradedHost` duplicated in two describe blocks — identical helper copy-pasted into `GET /player/devices` and `POST /player/device` describes; hoist to module scope [src/server/__tests__/rooms.test.ts]
- [x] [Review][Patch] `vi.waitFor` has no explicit timeout in the transfer-401 test — fire-and-forget `refreshWithRetry` assertion relies on the default 1s timeout, which is fragile in CI; pass an explicit `{ timeout: 3000 }` option [src/server/__tests__/rooms.test.ts]
- [x] [Review][Defer] `GET /player/devices` has no WS-session presence check [src/server/rooms.ts] — deferred, pre-existing; spec doesn't require it for the GET; Story 10-2 (picker UI) owns the UX gate
- [x] [Review][Defer] AC#11 guard ordering: 400 body-check fires before 503 WS-session check [src/server/rooms.ts:626-630] — deferred, pre-existing; preserved unchanged from original `/sdk/device` handler; spec's "match /sdk/device exactly" takes precedence over the numbered list
- [x] [Review][Defer] Scope upgrade has no in-app re-consent gate [src/server/auth.ts:105] — deferred, pre-existing; dev notes explicitly document re-login requirement; AuthDegradedBanner covers gracefully
- [x] [Review][Defer] Transfer-401 returns 503 without retrying — deferred, pre-existing; matches established pattern in `callSpotifyOnDevice`; client's auth-degraded re-auth path is the recovery

## Dev Notes

### Why the legacy alias matters

Existing `HostRoomPage.svelte` at [src/client/pages/HostRoomPage.svelte:139-143](src/client/pages/HostRoomPage.svelte#L139-L143) POSTs to `/api/rooms/:code/sdk/device` from the Web Playback SDK `ready` listener. Story 10-3 may later point this at `/player/device` directly, but this story does NOT touch client code. Keep both paths functional; the alias is a zero-cost rename gate.

### Why `persistRoomState` is called on both the legacy and new paths

The existing `/sdk/device` handler [does not](src/server/rooms.ts#L614-L630) call `persistRoomState`. That is a pre-existing gap — after a server restart, a room whose only device update was the SDK `ready` callback would rehydrate with `sdkDeviceId: undefined`. Adding `persistRoomState` into the unified handler closes this gap for free and makes the "pick a device, then server restarts" case behave correctly for Story 10-3's preference persistence. Treat this as intentional; do not special-case the legacy path to skip persistence.

### Why the transfer-404 path does NOT reuse `callSpotifyOnDevice` reactivation

The reactivation logic at [src/server/rooms.ts:64-90](src/server/rooms.ts#L64-L90) exists to recover the *already-stored* SDK device when it goes dormant. In our case, the *newly-chosen* device is the one Spotify says doesn't exist — we should NOT reactivate it on the host's behalf; we should reject the swap and let the client surface the failure so the host can pick again. This is an important semantic distinction: reactivation wakes a device the host implicitly expected to be alive; a new-device 404 is the host explicitly picking something that isn't reachable.

### Why `transfer_playback` with `play: true`

Per the Spotify Web API docs and the pattern already in `callSpotifyOnDevice`, `PUT /v1/me/player` transfers the active playback context (playlist, track, position) to the new device. Setting `play: true` ensures audio resumes on the new device without the host needing to hit play again. The round's internal playback-state flag (`isPlaying` on the client, `round.paused` on the server) is not affected by the transfer — we're just changing where the audio comes out, not whether the round thinks it's playing.

### Expected request shape

```http
PUT https://api.spotify.com/v1/me/player
Authorization: Bearer <access_token>
Content-Type: application/json

{ "device_ids": ["<newDeviceId>"], "play": true }
```

Spotify returns 204 (No Content) on success. `res.ok` is true for 2xx; don't parse a body on success (there is none).

### Expected devices-list response shape (from Spotify)

```json
{
  "devices": [
    {
      "id": "74ASZWbe4lXaubB36ztrGX",
      "is_active": true,
      "is_private_session": false,
      "is_restricted": false,
      "name": "My fridge",
      "type": "Computer",
      "volume_percent": 100,
      "supports_volume": true
    }
  ]
}
```

We pass through only the fields listed in AC #1 (`id`, `name`, `type`, `is_active`, `is_restricted`, `volume_percent`). Drop `is_private_session` and `supports_volume` — the client doesn't render them. Do NOT rename fields; the client is built against Spotify's snake_case.

### Error-shape consistency

All error responses are `{ message: string }` — matching every other error in this router (`/sdk/device`, `/round/next-round`, `/rooms/:code/round`, etc.). No `{ error: … }` shape; no details object. The client's inline-error rendering is tolerant of either but let's stay consistent with the file.

### Sequencing with Story 10-2 / 10-3

The UI in 10-2 depends on `/player/devices` returning the exact field set in AC #1. If a shape tweak is unavoidable in implementation, coordinate with 10-2's planning — but the AC-listed fields match Spotify's own documented fields, so there should be no surprise.

### Key anti-patterns to avoid

- **Don't add a "refresh the devices list before accepting a write" guard.** AC #9 is explicit: no freshness check. Spotify's 404 on the subsequent play call (or the transfer call itself) is the authoritative check.
- **Don't modify `callSpotifyOnDevice`.** It's already device-agnostic. Changing it risks breaking the 404→reactivation path that Story 5-4 and Story 6-5 depend on.
- **Don't special-case the SDK device name.** The server never needs to know "which id corresponds to the Web Playback SDK vs a phone". `sdkDeviceId` is a misnomer at this point but renaming it is a separate refactor — do NOT rename in this story.
- **Don't call `transfer_playback` when the round is paused or not yet started** (AC #10). Storing the id is enough; the next round-start fires `callSpotifyOnDevice` against the new id anyway.
- **Don't try to roll back `sdkDeviceId` if the client later gives up on the swap.** The server commits the new id iff the transfer succeeded; client-side UX state (optimistic chip update, revert on 502) is 10-2's concern, not this story's.
- **Don't emit any new WebSocket broadcasts for device swaps.** The round's WS event surface is unchanged; the host owns their device choice locally, and other clients (guests) don't care which device the audio comes from.
- **Don't use `res.json()` on the transfer response.** It returns 204 No Content — `res.ok` is the success signal; there is no body to parse.

### Manual verification checklist (Philip)

- Host + no guests. Log in, open a room, open devtools Network tab. Observe the SDK `ready` callback POST hits `/api/rooms/:code/sdk/device` → 200. Start a round; music plays on the browser. This confirms the alias still works.
- Same room; make a manual request: `curl -b <session-cookie> https://<host>/api/rooms/:code/player/devices` → expect 200 with a `devices` array including at least the Bangerbingo SDK device.
- Open the Spotify iOS app, play any song (to wake the device), then `/player/devices` should include the phone.
- `curl -b <cookie> -X POST -H 'content-type: application/json' -d '{"deviceId":"<phone-id>"}' https://<host>/api/rooms/:code/player/device` while a round is playing → audio transfers to the phone within ~1s; round UI on the host browser unchanged (timers, card, history). `roomState.sdkDeviceId` is now the phone id; next `POST /round/round/pause` (or natural autoAdvance) calls pause on the phone.
- Same request with a bogus `deviceId` (e.g. `"deviceId":"zzz"`) → 502 `{ message: 'Device unavailable — pick another' }`; `roomState.sdkDeviceId` unchanged; next play/pause still addresses the old device.
- Request with no session cookie → 401. Request with a guest's cookie → 403. Request with an unknown `:code` → 404.
- Server restart mid-round (kill + relaunch), then `/round/round/play` → still hits the post-swap device id (persistence works).
- `bun run test` all green. `bun run lint` clean.

### Project Structure Notes

**Server (only):**
- `src/server/rooms.ts` — add `/player/devices` GET handler; add `/player/device` POST handler (or extract existing `/sdk/device` body into a shared handler function and register both paths on it); call `persistRoomState(code)` after a successful write.
- `src/server/__tests__/rooms.test.ts` — add two new describe blocks (`/player/devices`, `/player/device`) mirroring the `/sdk/device` block's shape; add a single alias-parity test.

No client, no WS event changes, no DB schema changes, no new env vars, no `ws.ts` changes (`RoomState.sdkDeviceId` already exists at [src/server/ws.ts:80](src/server/ws.ts#L80) and is already persisted at [src/server/ws.ts:102](src/server/ws.ts#L102) and [src/server/ws.ts:146](src/server/ws.ts#L146)).

**No file renames or moves.** Keep `sdkDeviceId` as the field name — renaming is a future cleanup beyond Epic 10.

### References

- Epic 10 brief: [_bmad-output/epics.md:183-191](_bmad-output/epics.md#L183-L191)
- Epic 10 full spec + Story 10-1 ACs: [_bmad-output/planning-artifacts/epics.md:1719-1794](_bmad-output/planning-artifacts/epics.md#L1719-L1794)
- Epic 10 design intent (2026-04-19 research thread): [_bmad-output/planning-artifacts/epics.md:1723-1729](_bmad-output/planning-artifacts/epics.md#L1723-L1729)
- Existing device-agnostic play/pause pattern: [src/server/rooms.ts:34-99](src/server/rooms.ts#L34-L99) (`callSpotifyOnDevice`)
- Existing `/sdk/device` handler (to be aliased): [src/server/rooms.ts:614-630](src/server/rooms.ts#L614-L630)
- Existing `/sdk/device` tests (regression anchor): [src/server/__tests__/rooms.test.ts:1398-1477](src/server/__tests__/rooms.test.ts#L1398-L1477)
- Token-refresh pattern: [src/server/auth.ts:39-45](src/server/auth.ts#L39-L45) (`withFreshToken`) + [src/server/rooms.ts:462-463](src/server/rooms.ts#L462-L463) (503 on null)
- `RoomState.sdkDeviceId` declaration + persistence: [src/server/ws.ts:80](src/server/ws.ts#L80), [src/server/ws.ts:102](src/server/ws.ts#L102), [src/server/ws.ts:146](src/server/ws.ts#L146)
- `RoundState` shape (for the "active playing round" guard): [src/server/ws.ts](src/server/ws.ts) (look for `RoundState` type — `active`, `paused`, `currentSongIndex` fields)
- Previous story (9-3): [_bmad-output/implementation-artifacts/9-3-collapse-continuous-mode-to-gameover-choice.md](_bmad-output/implementation-artifacts/9-3-collapse-continuous-mode-to-gameover-choice.md) — for current sprint cadence, error-shape conventions, and test-file patterns
- Spotify Web API — Get Available Devices: https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices
- Spotify Web API — Transfer Playback: https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback

## Previous Story Intelligence (from 9-3)

- **Error-shape convention.** This router returns `{ message: string }` for errors. Stick to it.
- **Test seed helpers.** `seedHost()`, `seedRoom()`, `sessionCookie()`, and `makeApp()` are the established helpers in [rooms.test.ts](src/server/__tests__/rooms.test.ts). Use them; don't invent new fixtures.
- **`bun run lint` == `tsc --noEmit`.** It's the TypeScript gate. Any unused imports from handler refactoring surface here.
- **`svelte-check` baseline.** 8 pre-existing errors as of 9-3. Don't add new ones; this story is server-only so `svelte-check` output should be byte-identical to baseline.
- **Coordinate-deploy WS protocol.** No WS changes in this story, but if one becomes tempting — don't. Epic 10 does not introduce any new WS events.
- **Auth UX gap.** The project has no universal re-auth prompt path on 401 from host endpoints (pre-existing, deferred across multiple stories). This story's 503-on-degraded behaviour falls into the same gap — the existing `AuthDegradedBanner` handles it on the next WS message, not on this endpoint's response directly.

## Git Intelligence Summary

Recent commits (last 5):
- `2ab1d93 fix: prevent playlist search results from overflowing horizontally` — client CSS, no server touch.
- `18f427f feat: rebuild playlist presets — curated non-Spotify defaults + length research` — client-only presets.
- `f64ded8 feat: paginated playlist search with infinite scroll` — client fetch pagination.
- `68bf4f2 docs: research — remote guest Spotify listen-along feasibility` — research note, no code.
- `e68b46d feat: fold End Round/End Session into "Start a New Round" from host menu` — UX flow, minor server.

None of the recent commits touch `/sdk/device` or `callSpotifyOnDevice`; the endpoints are stable since Story 5-4 / 6-5. No dependency updates that would shift the Spotify Web API contract. Safe baseline for this story.

## Latest Tech Information

- **Hono**: `roomsRouter.post(path, middleware, handler)` and `.get(path, middleware, handler)` are the idioms in use. Multiple routes can share a handler function — pass the same arrow function to two registrations. No Hono version changes relevant to this story.
- **Spotify Web API devices endpoint**: still at `/v1/me/player/devices` (unchanged since 2023). Still requires `user-read-playback-state` scope — confirm the host's OAuth scope includes this. Looking at [src/server/auth.ts:105](src/server/auth.ts#L105): current scope is `streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative`. **`user-read-playback-state` is NOT present.** Test-fetch `/me/player/devices` against an existing host token during dev — if Spotify 403s it, adding the scope is required (re-login flow). Flag this early; spec and Epic 10 design intent assume existing tokens work. Worst-case mitigation: add `user-read-playback-state` to the scope list and surface a "re-login for new permissions" toast on first 403 — but verify the assumption first by hitting the endpoint with your current token.
- **Spotify Web API transfer-playback**: `PUT /v1/me/player` requires `user-modify-playback-state` scope — also **NOT currently in the scope list**. Same check: the current `callSpotifyOnDevice` play/pause/next already calls `PUT /me/player/{play,pause,next}` and `PUT /me/player` (in the reactivation fallback) successfully — implying tokens already have this scope OR that the reactivation fallback has never actually fired in production. Confirm by either checking a known-working token (introspect scope) or reading recent server logs for `[spotify:play] 404 — attempting device reactivation`. If the reactivation path has been silently failing, it's a pre-existing bug — patch it in the same PR by adding `user-modify-playback-state` to the scope list; gate with a re-login prompt for existing hosts.

**🚨 Scope risk callout (first task in the Dev Agent's execution):** Before writing handler code, hit `https://api.spotify.com/v1/me/player/devices` with the current host token (via a throwaway test or by inlining a one-off log) and check the response. If 403, add `user-read-playback-state user-modify-playback-state` to the scope string in [src/server/auth.ts:105](src/server/auth.ts#L105). If re-login is needed, document it in the PR body so existing hosts get a heads-up. Do NOT skip this check — the rest of the story is pointless if the scope is missing.

## Project Context Reference

No `project-context.md` found in the repo. Sprint status, epics, and architecture all live under `_bmad-output/`. The project has no `CLAUDE.md` either; conventions are inferred from recent story files (9-1, 9-2, 9-3) which are authoritative.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

None.

### Completion Notes List

- Unified the existing `/sdk/device` body into a shared `handleSetPlayerDevice` handler registered on both `POST /api/rooms/:code/player/device` (canonical) and `POST /api/rooms/:code/sdk/device` (legacy alias, per AC #8).
- Same handler implements the live mid-round transfer logic (AC #12): when `currentRound.active && !currentRound.paused && newId !== sdkDeviceId`, it issues `PUT /v1/me/player` with `{ device_ids: [newId], play: true }` using a `withFreshToken`-resolved token. 2xx → update `sdkDeviceId` + `persistRoomState`; 404 → 502 "Device unavailable — pick another"; 401 → 503 "Spotify auth degraded" + fire-and-forget `refreshWithRetry`; other non-2xx / network → 502 "Device swap failed". `sdkDeviceId` is only mutated on success (ACs #14/#15/#16).
- Same-device no-op preserved (AC #17): early-return 200 `{}` when `isActivePlaying && newId === sdkDeviceId`, no `fetch` call.
- Paused or absent round → skips transfer, stores `sdkDeviceId`, calls `persistRoomState` (AC #10). This closes the pre-existing gap on the legacy `/sdk/device` path where the SDK `ready` callback was not persisting — now the unified handler persists unconditionally on any successful write (AC #13), including the SDK-ready callback.
- Added `GET /api/rooms/:code/player/devices` with 404 → 403 → 503 (auth-degraded) → 502 (upstream failure) ordering. Pass-through fields are exactly `{ id, name, type, is_active, is_restricted, volume_percent }` (AC #1); Spotify's `is_private_session` and `supports_volume` are dropped.
- **OAuth scope bump.** The scope string at [src/server/auth.ts:105](src/server/auth.ts#L105) previously did not include `user-read-playback-state` (required by `GET /me/player/devices`) or `user-modify-playback-state` (required by `PUT /me/player`). Added both scopes proactively (Open Question #1 in the spec). Existing hosts get a 403 from Spotify for the new endpoints until they re-login; the existing `AuthDegradedBanner` re-auth path covers that gracefully. Flag for PR body: existing hosts must re-authenticate once.
- `callSpotifyOnDevice` is untouched (AC #18). The 404→`transfer_playback` reactivation path retains its original semantics (waking the *stored* device) and does not get reused for the user-picker transfer path. `startRound`, `round/play`, `round/pause`, `round/next` are unchanged (AC #19).
- Tests added: 7 for `GET /player/devices`, 15 for `POST /player/device` (including a paused-round guard test that exercises the AC #10 store-only branch), 1 alias-parity test. Existing `/sdk/device` describe block passes unchanged against the unified handler (AC #23).
- Regression: `npm run lint` (= `tsc --noEmit`) clean, `npm run test` 440/440 green, `npm run build:client` clean. No `svelte-check` regressions (story is server-only).

### File List

- `src/server/auth.ts` — added `user-read-playback-state user-modify-playback-state` to OAuth scope string.
- `src/server/rooms.ts` — added `Context` type import; replaced inline `/sdk/device` handler with shared `handleSetPlayerDevice` handler; registered canonical `POST /player/device` + legacy alias `POST /sdk/device` on it; added `GET /player/devices` handler.
- `src/server/__tests__/rooms.test.ts` — added `describe` blocks for `GET /player/devices`, `POST /player/device`, and alias parity.

## Open Questions

1. **Scope audit (see Latest Tech Information section).** Does the current host OAuth scope include `user-read-playback-state` and `user-modify-playback-state`? The scope string at [src/server/auth.ts:105](src/server/auth.ts#L105) does not list them. The fact that the existing `callSpotifyOnDevice` 404→transfer reactivation path (which calls `PUT /me/player`) is present in the codebase implies it either works (scope already granted somehow, perhaps via Spotify's default "streaming"-includes-playback behaviour) OR has never been hit in production. Verify empirically before starting; if a scope bump is needed, it's a separate PR-worthy consideration (forces re-login for all existing hosts). **Recommend the Dev Agent pause and flag this before handler work if the test-fetch returns 403.**

2. **Persistence on legacy `/sdk/device`.** AC #13 + Dev Notes recommend unifying the handler so `persistRoomState` runs on both paths. Confirm this is acceptable — it's a strict improvement (closes a pre-existing gap), but if there's any reason the legacy path was deliberately non-persisting (there isn't any in the story 5-4 / 6-5 history I can see), raise it in PR review.

## Change Log

| Date       | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| 2026-04-20 | Story 10-1 drafted — Device List API + unified device-write endpoint with live mid-round swap. Server-only. Epic 10 first story. |
| 2026-04-20 | Story 10-1 implemented — unified `handleSetPlayerDevice` on `/player/device` + `/sdk/device` alias; new `GET /player/devices` handler; live mid-round transfer via `PUT /v1/me/player`; OAuth scope bumped for `user-read-playback-state` + `user-modify-playback-state` (hosts must re-login once). 23 new tests; 440/440 suite green; lint + build:client clean. |
