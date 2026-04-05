# Deferred Work

## Deferred from: code review of 7-1-root-cleanup-host-login-cookie-localstorage (2026-04-05)

- Rapid repeated clicks on Host Login fire handler multiple times — minor, no orphaning risk once mid-connect guard lands, page transition is idempotent.
- Host Login button may overlap `<h1>BangerBingo</h1>` on narrow viewports — cosmetic, no verified overlap at current breakpoints, revisit if reported.
- No test for `determineInitialPage` priority ordering (authenticated + /room/:code path) — pre-existing coverage gap, function's `if (me)` early-return is obvious on inspection.

## Deferred from: code review of 5-6-song-history-late-join-sync-and-auth-reauth (2026-04-04)

- `SongHistoryDrawer` missing keyboard trap and Escape key handler — `role="dialog"` without focus management; WCAG 2.1 SC 2.1.2 gap; acceptable for mobile-first MVP.
- `auth:restored` silently dropped if host socket is offline at event time — banner stays stuck if popup completes while host is disconnected; low-probability scenario.
- Popup stays open if Spotify returns `?error=` on callback — error path in `/auth/callback` doesn't detect popup mode; popup stays open with error page; out of spec scope (AC8 only covers user-closed case).
- `authEvents` module-level `restored` listener never torn down — test isolation leak; mirrors pre-existing `degraded` listener pattern; acceptable for production singleton.
- Duplicate `song:start` entries on WS reconnect replay — subsequent `round:start` resets state so self-healing; pre-existing pattern.
- `reinitSdk()` race when SDK script still loading at `auth:restored` time — `initSdkPlayer()` existing guards likely handle this; pre-existing pattern.

## Deferred from: code review of 5-4-spotify-web-playback-sdk-integration (2026-04-04)

- `GET /auth/token` returns token without on-demand refresh — intentional per story Dev Notes (Story 1-2 proactive refresh handles freshness); small expiry window remains if background scheduler lags.
- `startSong` and `/round/pause` Spotify calls use `host.access_token` without expiry check — fire-and-forget silent failure if token expired; same root cause as above, design decision.
- `not_ready` fires mid-session: controls lock with no recovery explanation and no visible reason beyond "Connecting to Spotify audio…" — spec doesn't address this case.
- `player.connect()` return value (Promise<boolean>) ignored — if resolves `false` with no event, UI stuck on "Connecting…" indefinitely with no user feedback.
- `fetch('/api/auth/token')` in `getOAuthToken` has no error handling — network failure passes `undefined` to SDK callback, SDK fires `authentication_error` (handled), but uncaught promise rejection surfaces in console.
- `sdkErrorFired` one-way latch prevents recovery after transient error — intentional MVP design, retry requires page reload.

## Deferred from: code review (2026-04-04)

- Existing sessions don't gain new playlist scopes until re-auth — OAuth inherent; needs scope-detection + re-auth prompt feature.
- 502 response from `/rooms/:code/round` can't distinguish Spotify 404 (bad playlist ID) from Spotify 401 (stale token) — needs status-aware error handling and auth recovery.
- `data.playlists` key could be absent in Spotify search response — pre-existing; `?.` guard returns empty array silently but no error is surfaced.

## Deferred from: code review of 5-1-song-scheduling-and-host-playback-controls (2026-04-04)

- `/next` silently unpauses a paused round — spec (AC3) has no guard; calling `/next` while paused advances and clears `paused` as a side effect. May need explicit guard in a later story.
- Round stays `active: true` after `songs:exhausted` — spec doesn't require deactivation; post-exhaustion `/play` returns 400 "already playing" which is misleading but acceptable for MVP.
- Stale fired timer IDs retained in `round.timers` after expiry — `clearTimeout` on a fired timer is a no-op; harmless for MVP but `round.timers.autoAdvance !== undefined` cannot be used as a "timer pending" predicate by future code.

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

## Deferred from: code review of 3-4-login-and-lobby-screens (2026-04-03)

- Authenticated host navigating to `/room/CODE` lands on dashboard — pre-existing design decision (same behavior as before this story); intent of deep-linked room URL is silently discarded for authenticated users.
- Create Room button not disabled while room list is still loading — minor concurrent UX gap; no spec requirement to gate it.
- `applyPlayerEvent` does not deduplicate player names — inflated player count if server sends duplicate `player:joined`; server already prevents duplicate names at connection time.
- `player:joined` before `session:connect` ordering race — client overwrites any optimistic state with `session:connect` snapshot; server sends `session:connect` synchronously on connect, making this a near-impossible race in practice.

## Deferred from: code review of 3-5-host-disconnect-and-reconnect (2026-04-03)

- Flaky 200ms wall-clock timing assertion in host disconnect test (`ws.test.ts`) — `Date.now()` delta will fail non-deterministically under load or constrained CI; replace with a structural assertion or mock timers.
- Silent error swallowing in `RoomPage.onMount` `onError` handler — if server closes the guest WS (4004, 4009, etc.), the guest sees no UI feedback; revisit when double-WebSocket lifecycle is corrected.
- `closeCodeToMessage` in `ws.ts` has no entries for close codes 4000 ("missing name") and 4001 ("unauthorized") — pre-existing gap; guest receives generic "Connection failed" message for these codes.

## Deferred from: code review of 4-1-track-pool-api (2026-04-04)

- `playlistId` path param not sanitized before URL interpolation — authenticated host can reach arbitrary Spotify API paths through the server's token (src/server/music/router.ts:44).
- Concurrent token refresh race: two simultaneous requests both see expiring token and call `refreshWithRetry` in parallel — low risk at ≤5 users but wastes Spotify quota (src/server/music/router.ts:21-28).
- Inline token refresh block duplicated verbatim in `/music/search` and `/music/tracks/:playlistId` handlers — future fix must be applied twice (src/server/music/router.ts).
- `token_expires_at` ms/seconds unit not enforced at DB schema level — if written in seconds, every request would attempt an inline refresh (src/server/music/router.ts:24).

## Deferred from: code review of 4-2-round-configuration-screen (2026-04-04)

- `pendingRound` silently dropped + `roundNumber` non-durable when `roomSockets` has no entry — if host hasn't opened a WS connection yet, round config is returned (HTTP 200) but never stored; counter resets on server restart. Explicitly acceptable for this story per dev notes; Story 4-3 will consume `pendingRound`. (src/server/rooms.ts)
- `onRoundStarted()` fires before any WebSocket broadcast to guests — host navigates to lobby while guests receive no signal. By design as placeholder per AC8; Epic 5 will add the WS round-start broadcast. (src/client/pages/RoundConfigPage.svelte + src/server/rooms.ts)
- API response for presets/search not shape-validated before rendering — non-array response would crash `{#each}` at runtime. Low risk for server-controlled endpoints; acceptable for MVP scope. (src/client/pages/RoundConfigPage.svelte)

## Deferred from: code review of 4-3-card-generation-and-round-start (2026-04-04)

- `sessionPlayedIds` grows with duplicate entries across rounds — functionally harmless (Set in buildPool deduplicates), but array balloons; deduplicate on append if it ever matters at scale. (src/server/rooms.ts)
- State mutation + WS broadcast precede `recordPlayedSongs` — if SQLite throws after cards are sent, DB misses the round's tracks and next round won't down-rank them. Move persist before broadcast if atomicity is ever required. (src/server/rooms.ts)
- Concurrent `POST /round` requests can race on `roomState.currentRound` — two simultaneous calls both compute `roundNumber = 1`, both broadcast, last write wins for in-memory state. No real risk for single-host personal app; add in-flight guard if multi-concurrent start is ever possible. (src/server/rooms.ts)
- Token expiry NaN guard — if `token_expires_at` is 0/null/undefined, subtraction yields NaN and refresh is skipped silently. Pre-existing pattern from music/router.ts; audit all inline refresh blocks when hardening auth. (src/server/rooms.ts)
- `played_songs` has no FK reference to `rooms(code)` — orphaned rows accumulate on room deletion; room code reuse (331,776 combinations) could produce false down-ranking. Add FK or periodic cleanup when adding room lifecycle management. (src/server/db.ts)
- `generateCards` uniqueness test is non-deterministic — `Math.random()` not seeded; rare CI flake theoretically possible. Seed with a fixed value or use a deterministic pool in this test. (src/server/__tests__/cards.test.ts)
- `roundNumber` pendingRound fallback — falls back to `pendingRound.roundNumber + 1` when `currentRound` is absent; stale `pendingRound` could produce wrong round number in edge cases. Currently harmless since `pendingRound` is set each round. (src/server/rooms.ts)
- Host reconnecting mid-round receives no `round:start` re-send — host client must independently reconcile state. Out of scope for this story; consider adding equivalent of late-join logic to host reconnect path in Epic 5 or hardening epic. (src/server/ws.ts)
- Late-join guest gets blank card for round 1; if round 2 starts, a new real card is generated but round 1 blank is never backfilled. Acceptable per current design; revisit when multi-round UX is built in Epic 5. (src/server/ws.ts)

## Deferred from: code review of 5-2-bingo-card-ui-and-tile-marking (2026-04-04)

- `song:reveal` fires unconditionally regardless of `titleRevealDelay` — server contract guarantees `song:reveal` is never sent when `titleRevealDelay === null`, so no-op in practice; no client guard needed for MVP. (src/client/pages/RoomPage.svelte)
- `toggleMark` allows marking a masked tile before reveal — UX choice; spec does not prohibit early marking by position; reconsider if playtesting reveals it's confusing. (src/client/lib/bingo.ts)
- Masked tile stays masked through `round:win` in null-delay games — game is over at that point; acceptable UX for MVP. (src/client/lib/bingo.ts)
- Duplicate `trackId` in card causes both tiles to reveal/mask simultaneously — server-side concern; `generateCard` already prevents duplicates via Set deduplication. (src/client/lib/bingo.ts)
- Multiple `tile.free === true` tiles all highlight on 'FREE' win — server always sends exactly one free tile at index 12; purely theoretical. (src/client/lib/bingo.ts)

## Deferred from: code review of 5-3-host-card-view-and-controls-panel (2026-04-04)

- Mid-round reconnect doesn't replay current song state — `ws.ts` replays `round:start` but not `song:start`; host card stays unmasked and `isPlaying=false` if reconnecting while a song plays. (src/server/ws.ts)
- `roundStartPayload` stale on reconnect — `isPlaying` and track info wrong until next server WS event after host reconnects mid-song. (src/server/ws.ts)
- `handlePlayPause`/`handleNext` fire-and-forget — no error handling, silent failure, stale UI state on 4xx/5xx. (src/client/components/HostControlsPanel.svelte)
- Confirmation dialog missing keyboard focus trap — `aria-modal` declared but no focus lock or Escape key handler (WCAG 2.1.2). (src/client/components/HostControlsPanel.svelte)
- 404 for "no active round" semantically incorrect — should be 409 Conflict; matches existing endpoint pattern so deferred. (src/server/rooms.ts)
- 60vh mobile sheet may obscure too much of the card — spec says ~40% card visible; needs real-device verification. (src/client/pages/HostRoomPage.svelte)
- `round/end` guard rejects if `active=false` after `songs:exhausted` — host cannot end exhausted round via REST before `round:end` WS arrives. (src/server/rooms.ts)

## Deferred from: deployment architecture planning (2026-04-04)

- `me.email` always returns null in Dev Mode (Spotify Feb 2026 change) — auth stores empty string via `?? ''` fallback (src/server/auth.ts:129); graceful but field is permanently empty. Remove the column or keep as empty placeholder; low priority for personal MVP.
- `currentRoomCode` could be empty string if LobbyPage flow is bypassed — WS connects to `/ws?code=` with no guard. (src/client/pages/HostRoomPage.svelte)

## Deferred from: code review of 5-5-win-detection-and-win-overlay (2026-04-04)

- `claimedTileIds` array length unbounded in `/round/claim` — O(25×n) card scan; acceptable for personal MVP; add max-length guard at hardening time. (src/server/rooms.ts)
- Late-joining guest's card absent from `round.cards` — they'll always receive 422 on a claim; explicitly deferred to story 5-6 (late-join sync). (src/server/rooms.ts + src/server/ws.ts)
- `WinData` type and `WIN_LINES` constant duplicated between client and server — code quality; no runtime bug; extract to shared types if a build step is added. (src/client/pages/RoomPage.svelte, src/client/pages/HostRoomPage.svelte, src/server/rooms.ts)
- `applyWinPath` may silently produce no highlight if a song was never revealed on a late-joined client — pre-existing pattern from bingo.ts; acceptable for MVP.

## Deferred from: code review of 3-3-guest-join-screen (2026-04-03)

- Host login path (`page = 'login'`) now unreachable — by design for this sprint; story 3-4 will restore host login routing once the login+lobby screens are built.
- `data.role` unguarded in `session:connect` message parse — benign today since `handleJoined` discards `role`; becomes a silent contract violation when room view is built.
- `roomSockets` server-side accumulation — pre-existing issue logged in story 3-2 deferred work; rooms are never evicted when vacated.
- `handleJoined` in `App.svelte` discards `role` and `players` from the WS handshake — intentional stub; RoomPage will need both when the game loop is built in Epic 5.

## Deferred from: project review vs directional docs (2026-04-05)

- **FR5 not implemented** — no "Disconnect Spotify / Reconnect" flow in a host settings screen. Epic 5 retro defers as post-launch for friends-use MVP.
- **FR11 not implemented** — no way to close a room session entirely (`DELETE /api/rooms/:code` + host UI); rooms persist in SQLite and `roomSockets` indefinitely. Ties into the `roomSockets` eviction debt already logged.
- **FR40 not implemented** — no guest-side settings overlay for personal preferences during a session; PRD lists in MVP scope but no story covered it. Low priority for MVP.
- **NFR13 unmet** — server restart loses in-progress round state (`roomSockets`, `currentRound`, `songHistory` are in-memory only). Acceptable for friends-use MVP; either downgrade NFR13 or plan a persistence story post-Epic 6.
- **NFR1–NFR5 performance targets unverified** — 500ms control response, 200ms WS broadcast, 2s card-load, 2-hour session stability have no measurement harness. Add lightweight timing asserts to the Epic 6 smoke-test script.
- **Masked-title blur animation visual verification pending** — UX spec requires 300ms blur-out + label fade on reveal; verify `BingoCard.svelte` / `bingo.ts` implement the transition before Epic 6 sign-off.
- **Desktop host split-view breakpoint verification pending** — UX spec requires card-60% / controls-40% inline layout at ≥768px; confirm `HostRoomPage.svelte` renders the split, not a scaled-up mobile layout.
- **NFR15 ("~200 lines of server core") overshot** — realistic for delivered scope, but the maintainability bar in the PRD is no longer accurate. Update NFR15 wording post-Epic-6 or acknowledge the new line-count target.

## Deferred from: code review of 6-1-local-dev-and-tailscale-multi-device-testing (2026-04-05)

- **Session cookie `Secure=false` in dev silently breaks if `NODE_ENV=production` is set over plain-HTTP tailnet** (src/server/auth.ts:87,96,186) — cookies would be rejected by browsers over HTTP when `secure: true`, leading to empty session with no warning. Pre-existing; relevant to Epic 6-2/6-3 deploy hardening when TLS + prod env layering is finalized.
