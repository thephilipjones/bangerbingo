# Deferred Work

## Deferred from: code review of 1-1-pkce-oauth-and-session (2026-04-03)

- SESSION_SECRET is required/validated at startup but never used to sign the session cookie. Spec says "wire up now, use later" — wire actual signing when needed.
- requireAuth middleware does not check token_expires_at. Expired access tokens remain valid until re-login. Story 1.2 handles refresh.
- access_token and refresh_token stored as plaintext in SQLite. Acceptable for friends-use MVP; consider encryption at rest for any broader deployment.
- No AbortController timeout on fetch() calls to Spotify token endpoint and /v1/me. A hung Spotify response will hang the callback handler indefinitely.
- refresh_token presence in Spotify token response is assumed but not guarded. PKCE auth code flow reliably returns it per Spotify docs, but no runtime guard exists.

## Deferred from: code review of 1-2-token-refresh-and-degraded (2026-04-03)

- Concurrent scheduler ticks can refresh the same host simultaneously — no per-host in-progress guard; two overlapping ticks can write conflicting tokens. Fix: add an in-progress Set checked before calling `refreshWithRetry`.
- `startRefreshScheduler()` runs unconditionally in test environment — unlike `serve()`, not guarded by `nodeEnv !== 'test'`; leaks a live interval across test files.
- Empty `refresh_token` in DB causes 4 unnecessary Spotify retries — application layer has no guard; schema NOT NULL covers normal flow.
- `/api/auth/status` `tokenExpiresAt` is stale — snapshot from `requireAuth` middleware; `degraded` is live but `tokenExpiresAt` lags one cycle when scheduler refreshes concurrently.
- Startup fan-out — after long downtime all expired hosts trigger simultaneously on first tick; low risk for ≤5 users.
- `authEvents` has no `'error'` listener — latent crash if any caller emits `'error'` without a registered handler.
- `retryWithBackoff` retries non-recoverable 4xx errors identically to 5xx — wastes up to 4 attempts on revoked tokens.
- `getAllHosts()` uses `SELECT *` — column projection would limit token exposure in memory.
- No jitter in backoff — multiple simultaneous expirations hammer Spotify in lockstep; low risk at ≤5 users.

## Deferred from: code review of 3-1-room-creation-api-and-code-generation (2026-04-03)

- No rate limiting or per-host room cap on POST /api/rooms — a single authenticated host can hammer the endpoint or exhaust the 24^5 code space over time. Harden in a future epic.
- Session cookie is raw `user_id` with no signature/MAC — trivially forgeable by anyone who knows a valid Spotify user ID. Pre-existing auth design; address when hardening auth.
- Prepared statements re-created on every DB call — `better-sqlite3` recommends caching. Pre-existing pattern in `db.ts`; optimize if performance becomes a concern.
- `SELECT *` in `getRoomsByHost`/`getRoomByCode` — future schema additions will silently appear in API responses. Low risk now; explicit projection preferred at hardening time.
- Test alphabet regex does not pin exact 24-char set — `/^[A-Z]+$/` and `/[OI]/` pass even with a wrong alphabet. Tighten in a future test-quality pass.
- `initDb` does not call `db.close()` before reassigning the module-level handle — silent connection leak on double-init. Pre-existing pattern; fix when adding graceful shutdown.
- POST /api/rooms returns HTTP 200 instead of 201 — REST convention deviation; spec does not mandate 201. Align if the API is ever consumed by strict REST clients.

## Deferred from: code review of 2-1-web-playback-sdk-spike (2026-04-03)

- `player.connect()` promise rejection unhandled — throwaway spike code; wire rejection handling in Epic 5's real `SpotifySDKProvider`.
- `player.pause()` rejection unhandled in auto-stop (`clipTimer` callback) and manual pause handler — throwaway spike code; handle in Epic 5.
- `initTime` measurement conflation — `btn-connect` handler overwrites `initTime` set in `initPlayer`; log label is accurate but comment implies it covers construction time too. Clarify in Epic 5 if latency budgeting matters.
- `seek()` during active playback not validated — spike uses `position_ms` on `/play` instead; `player.seek()` mid-clip behaviour unknown. Validate in Epic 5's `SpotifySDKProvider`.
- `state_changed` fires ~8–9 times in rapid burst at position 60000ms when playback starts at a seek position. Epic 5 game loop should debounce or skip events until position advances past the seek point before trusting state.

## Deferred from: code review of 3-2-websocket-room-session-and-player-presence (2026-04-03)

- Session cookie value used as literal user ID — no HMAC signing; pre-existing auth pattern from Story 3-1, acceptable for MVP.
- `getHostRoom` O(n) linear scan over all rooms on every `auth:degraded` event — not a correctness concern at friends-use scale.
- `roomSockets` entries never pruned — in-memory room state grows without bound across server lifetime; rooms should be evicted when host disconnects and all guests have left.
- `auth:degraded` event listener registered at module load and never removed — acceptable for production singleton, latent issue if module is ever re-evaluated.
- `parseCookies` does not handle RFC 6265 quoted cookie values — session cookie writer does not produce quoted values in practice.
- `getPlayerList` may theoretically include sockets in `CLOSING` state between disconnect and close-event cleanup — near-instant transition, single-threaded JS, no real exposure.
- No maximum guest count enforced — unlimited guests can join a room; out of scope for personal MVP.
- `setupWebSocketServer` called twice on the same `httpServer` would double-handle upgrades — not a real production scenario, but no guard exists.
- `roomSockets.hostUserId` populated from `room.host_user_id` which could be null if DB schema permits — pre-existing schema concern; null would permanently break `auth:degraded` delivery for that room.

## Deferred from: code review of 3-3-guest-join-screen (2026-04-03)

- Host login path (`page = 'login'`) now unreachable — by design for this sprint; story 3-4 will restore host login routing once the login+lobby screens are built.
- `data.role` unguarded in `session:connect` message parse — benign today since `handleJoined` discards `role`; becomes a silent contract violation when room view is built.
- `roomSockets` server-side accumulation — pre-existing issue logged in story 3-2 deferred work; rooms are never evicted when vacated.
- `handleJoined` in `App.svelte` discards `role` and `players` from the WS handshake — intentional stub; RoomPage will need both when the game loop is built in Epic 5.
