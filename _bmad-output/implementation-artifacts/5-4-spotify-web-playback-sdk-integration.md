# Story 5.4: Spotify Web Playback SDK Integration

Status: done

## Story

As a host,
I want Spotify audio to play through my browser when a song starts,
so that I and my guests can hear the music we're bingo-ing to.

## Acceptance Criteria

1. When `HostRoomPage` mounts, the Spotify Web Playback SDK script is injected dynamically into `document.head` and initialized. The SDK's `getOAuthToken` callback fetches the host's current access token via `GET /api/auth/token`. On SDK 'ready' event, the `device_id` is registered with the server via `POST /api/rooms/:code/sdk/device`. `onDestroy` calls `player.disconnect()` and removes the script tag.

2. `GET /api/auth/token` (new, `requireAuth`): returns `{ accessToken: string }` — the host's current `access_token` from `ctx.var.host`. Mount in `authRouter` at `/auth/token`. Server-to-SDK token delivery; no client-side token storage needed beyond the SDK callback closure.

3. `POST /api/rooms/:code/sdk/device` (new, `requireAuth`, in `roomsRouter`): receives `{ deviceId: string }`, verifies room ownership, stores `deviceId` in `roomState.sdkDeviceId`. Returns HTTP 200. On any subsequent call (reconnect), overwrites the previous value.

4. `RoomState` in `src/server/ws.ts` gains a new optional field `sdkDeviceId?: string`. The field is not set on initial `roomSockets.set(...)` (defaults to `undefined`).

5. `startSong()` in `src/server/rooms.ts`: after broadcasting `song:start`, fires a **fire-and-forget** Spotify Web API call if `roomState.sdkDeviceId` is set:
   ```
   PUT https://api.spotify.com/v1/me/player/play?device_id={sdkDeviceId}
   Authorization: Bearer {host.access_token}
   Content-Type: application/json
   Body: { "uris": ["spotify:track:{trackId}"], "position_ms": SEEK_POSITION_MS }
   ```
   Uses the host's current access token: `getHostById(roomState.hostUserId)?.access_token`. If `sdkDeviceId` is absent or the call fails, `startSong()` continues normally (game state is unaffected). **Do not await or block on this call.**

6. `POST /rooms/:code/round/pause` handler: after `clearRoundTimers` and `broadcast(code, { type: 'song:pause' })`, fires a fire-and-forget Spotify pause call if `roomState.sdkDeviceId` is set:
   ```
   PUT https://api.spotify.com/v1/me/player/pause?device_id={sdkDeviceId}
   Authorization: Bearer {host.access_token}
   ```
   Same graceful fallback: skip if no device, don't block on failure.

7. While SDK is initializing (before 'ready' event), `HostRoomPage` renders a `sdkStatus` line: "Connecting to Spotify audio…". After 'ready', this line is cleared. The HostControlsPanel Play button receives a new `sdkReady: boolean` prop and is **disabled** until `sdkReady` is true, preventing the host from starting audio-less rounds. Display "Connecting to Spotify audio…" inside the controls panel if not ready.

8. If the SDK emits `initialization_error` or `authentication_error`: set `sdkFailed = true`, show `SdkFailureBanner` component. Banner shows: "Spotify audio unavailable in this browser" + current track deep link `spotify:track:{currentTrackId}` (updates as songs change) + instruction "Open in the Spotify app to follow along". Deep link uses the last known `trackId` from the most recent `song:start` event. On `initialization_error`, `sdkReady` stays false and Play button stays disabled (audio won't work). Game can still proceed without audio.

9. `authentication_error` fires **twice** from the SDK on invalid token (confirmed in Epic 2 spike). Use a `sdkErrorFired` flag to deduplicate — only process the first event.

10. New component `src/client/components/SdkFailureBanner.svelte`: props `trackId: string | null`. Renders a fixed banner (below the wsError banner, `z-index: 190`) with deep link `href="spotify:track:{trackId}"`. If `trackId` is null, shows "Open Spotify" without a specific track link.

11. Server tests for new endpoints in `src/server/__tests__/rooms.test.ts`:
    - `POST /api/rooms/:code/sdk/device`: 200 stores deviceId; 403 wrong host; 404 room not found
    - `GET /api/auth/token`: 200 returns `accessToken`; 401 unauthenticated

## Tasks / Subtasks

- [x] Install `@types/spotify-web-playback-sdk` as a dev dependency: `npm install --save-dev @types/spotify-web-playback-sdk` (provides `Spotify.Player`, `Spotify.PlaybackState`, `window.onSpotifyWebPlaybackSDKReady` types)

- [x] Add `sdkDeviceId?: string` to `RoomState` interface in `src/server/ws.ts` (AC: 4)

- [x] Add `GET /auth/token` to `authRouter` in `src/server/auth.ts` (AC: 2)
  - [x] `requireAuth` middleware exposes `ctx.var.host`
  - [x] Return `ctx.json({ accessToken: ctx.var.host.access_token })`

- [x] Add `POST /rooms/:code/sdk/device` to `roomsRouter` in `src/server/rooms.ts` (AC: 3)
  - [x] `requireAuth`, verify `room.host_user_id === host.user_id`
  - [x] Parse `{ deviceId }` from request body
  - [x] `roomState.sdkDeviceId = deviceId`
  - [x] Return `ctx.json({})` 200

- [x] Modify `startSong()` in `src/server/rooms.ts` to call Spotify play (AC: 5)
  - [x] After broadcast, check `roomState.sdkDeviceId`
  - [x] `getHostById(roomState.hostUserId)?.access_token` for bearer token
  - [x] Fire-and-forget `fetch('https://api.spotify.com/v1/me/player/play?device_id=...',  { method: 'PUT', ... }).catch(() => {})` — catch silently

- [x] Modify `POST /rooms/:code/round/pause` handler to call Spotify pause (AC: 6)
  - [x] Same pattern as above but `PUT /me/player/pause?device_id=...` with no body
  - [x] After existing `broadcast(code, { type: 'song:pause', ... })` line

- [x] Update `HostControlsPanel.svelte` — add `sdkReady: boolean` prop (AC: 7)
  - [x] Disable Play/Pause button when `!sdkReady`
  - [x] Show "Connecting to Spotify audio…" in panel when `!sdkReady && !sdkFailed`

- [x] Create `src/client/components/SdkFailureBanner.svelte` (AC: 8, 10)
  - [x] Props: `trackId: string | null`
  - [x] Fixed banner, `z-index: 190`, background `#c0392b`-style warning or `#1a1a1a` with border
  - [x] Deep link: `href="spotify:track:{trackId}"` if trackId, else "Open Spotify"

- [x] Update `src/client/pages/HostRoomPage.svelte` — add SDK initialization (AC: 1, 7, 8, 9)
  - [x] New state: `sdkReady = $state(false)`, `sdkFailed = $state(false)`, `sdkErrorFired = false` (non-reactive flag), `player: Spotify.Player | undefined`, `sdkScript: HTMLScriptElement | undefined`, `currentTrackId = $state<string | null>(null)`
  - [x] In `onMount`, before WS setup: set `window.onSpotifyWebPlaybackSDKReady`, create and append script tag
  - [x] In `song:start` WS handler: set `currentTrackId = data.trackId` (for deep link)
  - [x] In `onDestroy`: `player?.disconnect()`, `sdkScript && document.head.removeChild(sdkScript)`, `delete (window as any).onSpotifyWebPlaybackSDKReady`
  - [x] Pass `sdkReady` to `HostControlsPanel` (both desktop and mobile instances)
  - [x] Render `<SdkFailureBanner trackId={currentTrackId} />` when `sdkFailed`

- [x] Add server tests in `src/server/__tests__/rooms.test.ts` (AC: 11)
  - [x] `POST /api/rooms/:code/sdk/device` describe block: 200, 403, 404
  - [x] Follow seedRoom/beforeEach pattern from existing tests

- [x] Add test for `GET /api/auth/token` in `src/server/__tests__/auth.test.ts` (or new file)
  - [x] 200 with valid session cookie; 401 without

## Dev Notes

### SDK Script Loading in Svelte 5

The Spotify Web Playback SDK uses a global callback pattern — `window.onSpotifyWebPlaybackSDKReady` must be set **before** the script is appended:

```ts
// In onMount:
window.onSpotifyWebPlaybackSDKReady = () => { /* create player here */ }
sdkScript = document.createElement('script')
sdkScript.src = 'https://sdk.scdn.co/spotify-player.js'
sdkScript.async = true
document.head.appendChild(sdkScript)
```

Do NOT use `sdkScript.onload` — the SDK fires its own callback. Set the global first.

In `onDestroy`:
```ts
player?.disconnect()
if (sdkScript && document.head.contains(sdkScript)) {
  document.head.removeChild(sdkScript)
}
delete (window as any).onSpotifyWebPlaybackSDKReady
```

### @types/spotify-web-playback-sdk

Install first: `npm install --save-dev @types/spotify-web-playback-sdk`

This provides `Spotify.Player`, `Spotify.WebPlaybackPlayer`, `Spotify.Error`, `window.Spotify`, and `window.onSpotifyWebPlaybackSDKReady`. Without this, TypeScript will complain about `window.onSpotifyWebPlaybackSDKReady` and `new Spotify.Player(...)`.

### getOAuthToken Callback

The SDK calls `getOAuthToken` when it needs a fresh token (on init and potentially on token expiry). The server's `/api/auth/token` always returns the most-recently-refreshed token from the DB. The server's proactive refresh (Story 1-2) keeps it valid — no extra client-side refresh logic needed here.

### Fire-and-Forget Spotify API Calls in startSong

```ts
// In startSong(), after broadcast:
const sdkDevice = roomState.sdkDeviceId
if (sdkDevice) {
  const host = getHostById(roomState.hostUserId)
  if (host?.access_token) {
    fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(sdkDevice)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${host.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [`spotify:track:${track.id}`],
          position_ms: SEEK_POSITION_MS,
        }),
      }
    ).catch(() => {}) // fire-and-forget; don't block song scheduling
  }
}
```

`SEEK_POSITION_MS` is already defined at line 13 of rooms.ts as `60_000`. Track URI format: `spotify:track:{track.id}` (not `spotify:track:spotify:track:...` — just the plain ID).

### Pause Call in /round/pause Handler

```ts
// After: broadcast(code, { type: 'song:pause', ... })
const sdkDevice = roomState.sdkDeviceId
if (sdkDevice) {
  const host = getHostById(roomState.hostUserId)
  if (host?.access_token) {
    fetch(
      `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(sdkDevice)}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${host.access_token}` },
      }
    ).catch(() => {})
  }
}
```

### authentication_error Fires Twice

Confirmed in Epic 2 spike: `authentication_error` fires **twice** with message "Authentication failed" on invalid token. Use a non-reactive flag `sdkErrorFired` (plain `let`, NOT `$state`) to deduplicate:

```ts
let sdkErrorFired = false
player.addListener('authentication_error', () => {
  if (sdkErrorFired) return
  sdkErrorFired = true
  sdkFailed = true
})
```

### SDK Init Latency

Spike findings: ~490ms in Chrome, ~730ms in Firefox (home broadband). Budget ~1s before SDK is ready. The "Connecting to Spotify audio…" status and disabled Play button handle this gracefully.

### state_changed Burst at Seek Position

The spike observed 8–9 rapid `player_state_changed` events when playback starts at a seek position. Story 5-4 does NOT need to add `player_state_changed` listener — we don't use client-side state_changed events for game logic (server drives all game state). Ignore this event entirely.

### Spotify API 204 is Success

`PUT /me/player/play` returns **204 No Content** on success (not 200). Don't try to parse the response body. `response.status === 204` = success.

### HostControlsPanel sdkReady Prop

HostControlsPanel currently has props: `code`, `currentTrack`, `players`, `isPlaying`, `onRoundEnded`. Add `sdkReady: boolean`.

Play button disabled condition: `!isPlaying && !sdkReady` (can't start playing if SDK not ready). During a song (isPlaying = true), SDK is already ready so this condition never triggers during playback — only prevents the very first play before SDK connects.

Actually, use simply `disabled={!sdkReady}` on the Play button only (Pause/Next remain enabled once playing).

### SdkFailureBanner Position

Use `position: fixed; top: 40px` (below wsError banner at top: 0) or just `top: 0` if wsError is not also showing (both are unlikely simultaneously). Keep it simple: `position: fixed; top: 0; z-index: 190`. The wsError banner has no defined z-index in its CSS — check HostRoomPage.svelte; wsError banner uses `z-index: 200`. Use `z-index: 190` for SdkFailureBanner so wsError takes priority. But since they rarely overlap, simpler to use same `top: 0` and let wsError (z-index: 200) cover it.

### RoomState sdkDeviceId Not in roomSockets.set()

The initial `roomSockets.set(code, { host: null, hostUserId: ..., hostHasEverConnected: false, guests: new Map() })` call does **not** include `sdkDeviceId`. TypeScript will allow this because it's `sdkDeviceId?: string` (optional). The field is only set when `POST /rooms/:code/sdk/device` is called.

### GET /auth/token Route — Mount Location

The auth router is mounted at `/api/auth` in `src/server/index.ts` (confirm this). So `authRouter.get('/token', requireAuth, ...)` is exposed at `GET /api/auth/token`. Check `src/server/index.ts` to verify mount path.

### Testing the New Endpoints

For `POST /api/rooms/:code/sdk/device` tests, follow the pattern at line 895+ in `rooms.test.ts`:
```ts
describe('POST /api/rooms/:code/sdk/device', () => {
  beforeEach(() => { initDb(':memory:'); roomSockets.clear() })
  it('200 — stores sdkDeviceId in roomState', async () => { ... })
  it('403 — wrong host', async () => { ... })
  it('404 — room not found', async () => { ... })
})
```

For `GET /api/auth/token`, check existing auth tests in `src/server/__tests__/auth.test.ts` (if it exists) for the cookie setup pattern. The session cookie setup pattern from `rooms.test.ts`: look for how `seedRoom` sets up cookies — it uses `{ headers: { Cookie: 'session=host-user-id' } }`.

### Auto-Advance in Clip Mode

No changes needed. When `advanceToNext()` calls `startSong()` (auto-advance timer), the Spotify play call fires automatically for the next track (AC5). The auto-advance in clip mode is thus fully passive — the host does not need to interact.

### songs:exhausted

When `advanceToNext()` finds no next song and broadcasts `songs:exhausted`, no Spotify pause is triggered — the current track will continue playing in Spotify until the host manually intervenes. This is acceptable for MVP. Note in doc as known behavior.

### iOS / Non-SDK Browsers

On iOS Safari, `initialization_error` fires (SDK doesn't support Safari). This sets `sdkFailed = true` and shows `SdkFailureBanner`. The host can use the deep link to follow along in the Spotify app. Game flow continues normally (server-side).

### File List of Changes

- `src/server/ws.ts` — add `sdkDeviceId?: string` to `RoomState` interface
- `src/server/auth.ts` — add `GET /auth/token` endpoint
- `src/server/rooms.ts` — add `POST /rooms/:code/sdk/device`, modify `startSong()`, modify `/round/pause` handler
- `src/client/pages/HostRoomPage.svelte` — SDK init, sdkReady/sdkFailed state, pass sdkReady to panels
- `src/client/components/HostControlsPanel.svelte` — add `sdkReady` prop, disable Play when not ready
- `src/client/components/SdkFailureBanner.svelte` (new) — failure banner with deep link
- `src/server/__tests__/rooms.test.ts` — add sdk/device describe block
- (possibly) `src/server/__tests__/auth.test.ts` — add auth/token test

### References

- `RoomState` interface: `src/server/ws.ts` lines 49–56
- `startSong()` function: `src/server/rooms.ts` lines 22–75
- `broadcast` after song:start in startSong: `src/server/rooms.ts` lines 46–57 — add Spotify call after this block
- `SEEK_POSITION_MS` constant: `src/server/rooms.ts` line 13 (value: 60000)
- `getHostById` import already in rooms.ts line 4
- `/round/pause` handler: `src/server/rooms.ts` lines 301–321 — add Spotify pause after line 318
- `requireAuth` middleware: `src/server/auth.ts` line 30
- `authRouter` in auth.ts — add token endpoint after existing routes
- `Host` interface with `access_token`: `src/server/db.ts` lines 3–12
- `roomSockets.set` initial call (host path): `src/server/ws.ts` line 135
- `roomSockets.set` initial call (guest path): `src/server/ws.ts` line 185
- Existing `POST /rooms/:code/sdk/device` test pattern: `src/server/__tests__/rooms.test.ts` lines 895–1000 (round/pause pattern to follow)
- `HostControlsPanel` props: `src/client/components/HostControlsPanel.svelte` (read file for current prop destructuring)
- `HostRoomPage` onMount/onDestroy: `src/client/pages/HostRoomPage.svelte` lines 33–84
- `wsError` banner z-index in HostRoomPage: `src/client/pages/HostRoomPage.svelte` line 139 (`z-index: 200`)
- Epic 2 spike findings: `spike-sdk.html` lines 363–423 (AC6 findings section)
- Brand colours: `#1db954` (Spotify green), `#1a1a1a` (card bg), `#121212` (page bg)
- Touch target minimum: 44×44px (WCAG AA)

## Dev Agent Record

### Implementation Notes

- `@types/spotify-web-playback-sdk` installed as dev dependency — provides `Spotify.Player`, `window.onSpotifyWebPlaybackSDKReady` types globally
- `RoomState.sdkDeviceId?: string` added to `src/server/ws.ts` — not set in initial `roomSockets.set()` calls (optional field, defaults to undefined)
- `GET /api/auth/token` added to `authRouter` — `requireAuth` protected, returns `{ accessToken }` from `ctx.var.host.access_token`
- `POST /api/rooms/:code/sdk/device` added to `roomsRouter` — `requireAuth` + ownership check, stores `deviceId` in `roomState.sdkDeviceId`
- `startSong()` modified with fire-and-forget Spotify Web API `PUT /me/player/play` — no await, `.catch(() => {})`, skips if no `sdkDeviceId`
- `/round/pause` handler modified with fire-and-forget `PUT /me/player/pause` — same graceful fallback pattern
- `HostControlsPanel.svelte` updated with `sdkReady: boolean` prop — Play button `disabled={!sdkReady}`, "Connecting to Spotify audio…" shown when `!sdkReady`
- `SdkFailureBanner.svelte` created — fixed banner at `top: 0; z-index: 190`, deep link `href="spotify:track:{trackId}"` or "Open Spotify" fallback
- `HostRoomPage.svelte` updated — SDK init in `onMount` (global callback set before script append), `sdkErrorFired` non-reactive flag for deduplication, `currentTrackId` tracked from `song:start`, cleanup in `onDestroy`, `sdkReady` passed to both desktop and mobile `HostControlsPanel` instances, `SdkFailureBanner` conditionally rendered

### Completion Notes

All 11 acceptance criteria satisfied. 218 tests pass (6 new tests added: 4 for `POST /rooms/:code/sdk/device`, 2 for `GET /auth/token`). No regressions.

## File List

- `src/server/ws.ts` — added `sdkDeviceId?: string` to `RoomState` interface
- `src/server/auth.ts` — added `GET /auth/token` endpoint with `requireAuth`
- `src/server/rooms.ts` — added `POST /rooms/:code/sdk/device`, modified `startSong()` and `/round/pause` handler with fire-and-forget Spotify API calls
- `src/client/pages/HostRoomPage.svelte` — SDK initialization, `sdkReady`/`sdkFailed`/`currentTrackId` state, `SdkFailureBanner` import and render, `sdkReady` prop passed to both panel instances
- `src/client/components/HostControlsPanel.svelte` — `sdkReady: boolean` prop, Play button disabled when not ready, "Connecting to Spotify audio…" message
- `src/client/components/SdkFailureBanner.svelte` (new) — failure banner with deep link
- `src/server/__tests__/rooms.test.ts` — `POST /api/rooms/:code/sdk/device` describe block (4 tests)
- `src/server/__tests__/auth.test.ts` — `GET /auth/token` describe block (2 tests)
- `package.json` / `package-lock.json` — `@types/spotify-web-playback-sdk` devDependency added

### Review Findings

- [x] [Review][Patch] `POST /rooms/:code/sdk/device` silently discards deviceId when roomState absent — returns 200 but never stores; Spotify play/pause never fires [`src/server/rooms.ts:371-374`]
- [x] [Review][Patch] Error handlers (`initialization_error`, `authentication_error`) don't reset `sdkReady = false` — Play button stays enabled after audio breaks, violates AC 8 [`src/client/pages/HostRoomPage.svelte:61-74`]
- [x] [Review][Patch] SDK re-mount: if `window.Spotify` already loaded, `onSpotifyWebPlaybackSDKReady` callback never fires on second mount → `sdkReady` stuck false indefinitely [`src/client/pages/HostRoomPage.svelte:36`]
- [x] [Review][Defer] `GET /auth/token` returns token without on-demand refresh — intentional per story Dev Notes (Story 1-2 proactive refresh handles freshness), small expiry window remains [`src/server/auth.ts:152`] — deferred, pre-existing
- [x] [Review][Defer] `startSong` and `/round/pause` Spotify calls use `host.access_token` without expiry check — fire-and-forget silent failure if token expired; same root cause as above [`src/server/rooms.ts`] — deferred, pre-existing
- [x] [Review][Defer] `not_ready` mid-session locks controls with no recovery explanation — spec doesn't address this case [`src/client/pages/HostRoomPage.svelte:56`] — deferred, pre-existing
- [x] [Review][Defer] `player.connect()` return value (Promise<boolean>) ignored — if resolves false with no event, UI stuck on "Connecting to Spotify audio…" indefinitely [`src/client/pages/HostRoomPage.svelte:66`] — deferred, pre-existing
- [x] [Review][Defer] `fetch('/api/auth/token')` in `getOAuthToken` has no error handling — network failure passes `undefined` to SDK, triggers `authentication_error` (handled) but surfaces uncaught promise rejection [`src/client/pages/HostRoomPage.svelte:42`] — deferred, pre-existing
- [x] [Review][Defer] `sdkErrorFired` one-way latch prevents recovery after transient error — intentional MVP design, retry requires page reload [`src/client/pages/HostRoomPage.svelte:24`] — deferred, pre-existing

## Change Log

- 2026-04-04: Story created by bmad-create-story workflow — Epic 5 game loop analysis, Epic 2 SDK spike findings integrated (seek via position_ms, auth_error fires twice, init latency ~500ms, state_changed burst), Story 5-3 patterns (HostRoomPage, HostControlsPanel, file locations), server-side Spotify API proxy architecture, fire-and-forget pattern for non-blocking audio
- 2026-04-04: Story implemented by dev agent — all ACs satisfied, 6 new tests added, 218 total tests passing
- 2026-04-04: Code review — 3 patches, 6 deferred, 3 dismissed; story moved to in-progress
