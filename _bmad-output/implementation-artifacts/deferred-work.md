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

## Deferred from: code review of 2-1-web-playback-sdk-spike (2026-04-03)

- `player.connect()` promise rejection unhandled — throwaway spike code; wire rejection handling in Epic 5's real `SpotifySDKProvider`.
- `player.pause()` rejection unhandled in auto-stop (`clipTimer` callback) and manual pause handler — throwaway spike code; handle in Epic 5.
- `initTime` measurement conflation — `btn-connect` handler overwrites `initTime` set in `initPlayer`; log label is accurate but comment implies it covers construction time too. Clarify in Epic 5 if latency budgeting matters.
- `seek()` during active playback not validated — spike uses `position_ms` on `/play` instead; `player.seek()` mid-clip behaviour unknown. Validate in Epic 5's `SpotifySDKProvider`.
- `state_changed` fires ~8–9 times in rapid burst at position 60000ms when playback starts at a seek position. Epic 5 game loop should debounce or skip events until position advances past the seek point before trusting state.
