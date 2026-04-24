# Deferred Work

## Deferred from: code review of 14-5-overlay-escape-and-focus (2026-04-23)

- **`document.contains()` passes for inert-subtree elements** — `returnTo.focus()` silently no-ops when `returnTo` is inside an `inert` ancestor. Fix would be to add `&& !returnTo.closest('[inert]')` to the guard. Narrow edge case; inert usage in HostRoomPage only applies to `.host-game` when RoundConfigOverlay is open, and overlays are rendered outside that subtree in the common path. (`src/client/lib/useOverlay.svelte.ts:26`)
- **`RoundConfigOverlay` Escape gives no feedback during `submitting` state** — pressing Escape while a round-start fetch is in flight silently no-ops (guard `if (submitting) return`). No shake, toast, or aria-live announcement. Pre-existing design decision, not introduced by 14-5. (`src/client/components/RoundConfigOverlay.svelte`)

## Deferred from: code review of 14-3-reconnect-replay-completeness (2026-04-23)

- **Host/guest divergence on `paused` field in reconnect `round:start` payload** — host branch sends `paused: activeRound.paused === true`; guest branch omits `paused` entirely. Pre-existing inconsistency; not introduced by 14-3. (src/server/ws.ts)
- **Late-joiner reconnect into a won round replays winner's `winningTileIds` against own card** — gate `round.cards.has(name)` admits any player who ever had a card in the round; the replayed `round:win` carries `winnerCard` which the client renders against, so visuals are correct, but the guest's own card shown in the preceding `round:start` replay doesn't align with the winning highlight semantics. Pre-existing 13-1 behavior. (src/server/ws.ts)

## Deferred from: code review of 14-4-websocket-origin-check (2026-04-23)

- **`new URL(req.url)` outside try/catch in upgrade handler** — pre-existing: if `req.url` is a full absolute URI, the `URL` constructor can throw in the `upgrade` event handler, crashing the process. Guard would be `try { url = new URL(...) } catch { socket.destroy(); return }`. Not introduced by 14-4. (src/server/ws.ts:788)
- **IPv6 loopback `[::1]` not accepted in dev mode** — `u.hostname === '127.0.0.1'` covers IPv4 only; a dev browser resolving `localhost` to `::1` gets a 403. Low impact for current dev setup; fix when IPv6 dev support is needed. (src/server/ws.ts:766)
- **Allowlist match is case-sensitive raw string** — `cfg.allowlist.has(origin)` does no URL normalisation; an operator who sets `WS_ALLOWED_ORIGINS=HTTPS://BANGERBINGO.NET` silently rejects all connections. Browsers always send lowercase scheme+host per RFC 6454, so risk is misconfiguration only. (src/server/ws.ts:761)
- **Origin with path component or explicit default port fails allowlist** — `https://bangerbingo.net/` (trailing slash) or `https://bangerbingo.net:443` won't match `https://bangerbingo.net`. Browsers never include path per RFC 6454; risk is operator misconfiguration or non-browser client. (src/server/ws.ts:761)
- **`WS_ALLOWED_ORIGINS` blank slots dropped silently** — `filter(Boolean)` removes empty entries after trimming without logging; a fat-fingered comma (e.g. `a.com, ,b.com`) silently reduces the allowlist. (src/server/ws.ts:756)
- **`roomSockets.has('AAAA')` origin-rejection test assertions lack explicit afterEach cleanup** — pre-existing test isolation pattern; if a prior test leaves `AAAA` in `roomSockets`, the assertion fails with a misleading failure message. (src/server/__tests__/ws.test.ts:1955,1971)
- **`0.0.0.0` not treated as loopback in dev mode** — some tools bind Vite to `0.0.0.0`, which would produce an origin of `http://0.0.0.0:5173` in the browser (unusual but possible). Not a blocking concern for the current dev setup. (src/server/ws.ts:766)
- **403 response lacks `Content-Length: 0` header** — technically non-conformant per RFC 7230 §3.3 for responses with no body, but `Connection: close` prevents keep-alive reuse and all tested clients handle it correctly. Pre-existing pattern matching the 400 path. (src/server/ws.ts:793)

## Deferred from: code review of 13-11-playback-indicator-bar (2026-04-23)

- **Clock skew: bar starts WS-latency ms late per track** — `playbackStartedAt = Date.now()` is set when the `song:start` WS message is *received*, not when the server fires it. LAN latency (~10–50ms) means the bar lags audio slightly; resets per-track so drift doesn't accumulate. Spec accepts this ("verified by observation"); would require a server-side broadcast timestamp to eliminate. (src/client/lib/gameState.svelte.ts)
- **`round:win` does not reset bar — bar remains at last progress during win overlay** — AC 7 only requires reset on `round:start`; bar stays at its current position (may be mid-sweep) until the next round begins. Visible if GameHeader is shown behind the win overlay. Fix: add `playbackStartedAt = 0` to the `round:win` branch of `processWsMessage`. (src/client/lib/gameState.svelte.ts)
- **Reconnect mid-clip: bar stays empty for the remainder of the clip** — `round:start` reconnect payload carries no clip-start timestamp or `effectiveDurationMs`, so `playbackStartedAt` stays 0 until the next `song:start`. Safe fallback (bar hidden rather than showing garbage), but clip progress is lost for reconnecting clients. Fix would require server to include clip-start time in `round:start` replay payload. (src/server/ws.ts)
- **Test magic number `179_000` — pre-computed literal for `FULL_MODE_TAIL_MS` offset** — `expect(msg.effectiveDurationMs).toBe(179_000)` with a comment explaining `180_000 - 1_000`. If `FULL_MODE_TAIL_MS` changes, the test fails with a cryptic mismatch rather than pointing at the constant. Consider expressing as `DEFAULT_TRACK_DURATION_MS - FULL_MODE_TAIL_MS` via imported constants. (src/server/__tests__/rooms.test.ts)

## Deferred from: code review of 13-2-casual-mode-persistence-across-restart (2026-04-22)

- **Array-typed snapshot passes `playerCasualModes` guard silently** — `typeof snap.playerCasualModes === 'object'` also matches arrays; an empty array produces a correct empty Map, but a non-empty array (corrupted snapshot) would yield numeric string keys as player names with no warning. An `!Array.isArray` guard would surface the anomaly. (src/server/ws.ts:161)
- **Redundant top-level `allowCasualMode` alongside `currentRound.config.allowCasualMode`** — both fields are written atomically in `persistRoomState` and the rehydrate override is gated on `roomState.currentRound`; no divergence is possible today, but any future path that writes the top-level field independently from `config` would silently win. By-spec design, comment documents the intent. (src/server/ws.ts:119, 197-199)
- **`priorCasualModes` (host-revoke memory) not persisted across restart** — when the host revokes `allowCasualMode`, opted-in names are moved to `priorCasualModes` and `playerCasualModes` is cleared. A server restart during the revoked state loses `priorCasualModes`, so re-enabling casual mode won't auto-restore previous opt-ins. Narrow edge case; not in scope for 13-2. (src/server/ws.ts:persistRoomState, src/server/rooms.ts:1190-1204)

## Deferred from: code review of 13-5-light-security-hardening (2026-04-22)

- ~~**Pre-existing flake: `square:auto-marked is NOT sent to other players` times out under full-suite parallelism**~~ — Fixed in commit 3ab11aa ("fix: deflake square:auto-marked negative test"), between 13-5 and 13-2.
- **No HTTP-endpoint rate limiting** — `/api/music/search`, `/api/music/tracks/:id`, room lookup, etc. are all unrate-limited. AC-4 explicitly excludes host endpoints from 13-5 scope; would need a separate hardening story if friends-only assumption widens. (src/server/music/router.ts, src/server/rooms.ts)
- **Session cookie has no expiry, rotation, or server-side revocation** — Signed payload is `userId` only, no `iat`/version field, no revocation list. A leaked cookie is valid for 30 days; logout clears tokens but the signed cookie still verifies if replayed. Pre-existing; out of scope for 13-5. (src/server/auth.ts:19-22, 182-188)
- **No Origin check on WebSocket upgrade (CSWSH)** — Nothing rejects cross-site WS connects on the upgrade. Pre-existing; not introduced by 13-5. (src/server/ws.ts setupWebSocketServer)
- **Within rate-limit budget, name-spray reconnaissance against a known room is unmitigated** — 10 attempts/60s is enough for an attacker to enumerate "is name X taken?" via 4009/4004 distinguishability on a known room code. Inherent to the chosen 10/60s spec limit; would need a per-room or per-name throttle. (src/server/ws.ts:438-460)

## Deferred from: code review of 13-4-test-quality-pass (2026-04-22)

- **`roomSockets.get('AAAA')?.host` optional chaining masks room-deleted vs host-nulled** — in `ws.test.ts` host-disconnect test, `?.host` returns `undefined` if the room entry were deleted; `.toBeNull()` would fail with confusing message. Current server does `r.host = null` (not delete), so safe today. (src/server/__tests__/ws.test.ts:384)
- **LCG seed uniqueness not validated for alternate seeds** — comment says "LCG produces enough variation" but doesn't lock in the seed value; if seed `0x9e3779b1` is changed without re-verifying, the distinctness guarantee is unverified. (src/server/__tests__/cards.test.ts:120)
- **`generateCard` uses `pool.slice(0, 25)` regardless of pool size** — uniqueness comes from shuffle ordering of the first 25 tracks only; the old "large pool" rationale was misleading; pre-existing production behavior. (src/server/game/cards.ts — `generateCard`)

## Deferred from: code review of 13-3-server-client-micro-fixes (2026-04-22)

- ~~**New `/host/resume` advance branch lacks `roundStillMatches` guard**~~ — Guard added (`roomState.currentRound?.active && roundNumber` check before `advanceToNext`) plus test for `advanced` state path. (src/server/rooms.ts, src/server/__tests__/rooms.test.ts)
- ~~**No test coverage for `/host/resume` auto-advance branch and sweep `round.ended` guard**~~ — Tests added: `returns advanced when Spotify position past clip end`, `returns ok when round inactive at request time`, `sweep is a no-op when round.ended is true`. Let-It-Ride 403/409 error copy (client-side) remains untested — no Svelte component test harness yet.

## Deferred from: code review of 13-7-host-guest-neither-identity-flow (2026-04-22)

- **`clearHostTokens` errors silently swallowed in logout** — `try { clearHostTokens(userId) } catch { /* no-op */ }` in `POST /auth/logout` absorbs all DB errors including the case where a valid session cookie references a user that was deleted from the DB. Tokens aren't cleared (host doesn't exist), but there is no log or metric for this anomaly. Low severity for friends-use; worth noting if the host DB is ever pruned. (src/server/auth.ts — logout handler)
- ~~**`verifySession` length-check short-circuits `timingSafeEqual`**~~ — Fixed: both sig and expected are now hashed to fixed 32-byte buffers via `crypto.createHash('sha256')` before `timingSafeEqual`, removing the format/length early-return. (src/server/auth.ts)

## Resolved inline (2026-04-21)

- ~~**"Use desktop Chrome or Firefox for audio" disclaimer removed from LoginPage**~~ — deleted from `src/client/pages/LoginPage.svelte`. Epic 10 + 12 make this obsolete.
- ~~**4 failing tests in rooms.test.ts (POST /api/rooms/:code/player/device)**~~ — test expectations updated to match Story 12-4 Track B's reissueExpectedTrack implementation. All 507 tests pass.
- ~~**Authenticated host navigating to a room URL now handles foreign hosts**~~ — Story 13-7 lands Host 1 on guest Join with prefilled code when they visit Host 2's `/{code}`. Own-room paths still route to Lobby.
- ~~**`determineInitialPage` test coverage for `/host` + `/` + auth**~~ — Story 13-7 adds explicit tests for `/host`-authed, `/host`-unauth, and `/`-authed.

---

## Deferred from: code review of 13-1-reconnect-after-win-state-replay (2026-04-21)

- **Reconnect-after-win tests mutate `round.winData` directly rather than exercising `/round/claim`** — new tests at `src/server/__tests__/ws.test.ts` (describe "Reconnect after win") set `round.ended = true` and `(round as any).winData = {...}` inline, bypassing the real claim handler that populates `winData` in `rooms.ts`. A regression in the claim-path write would not be caught by these tests. Addresses in 13-4 test-quality pass. (src/server/__tests__/ws.test.ts:979-985, 1033-1039)
- **`round:end` not replayed on reconnect — client stuck in mid-game UI if it missed the broadcast** — `ws.ts` reconnect replay only handles `round:start` / `round:win`. A client that disconnected before `round:end` was sent, and reconnects after `currentRound` was cleared, never receives a reset signal. Pre-existing; not caused by 13-1. (src/server/ws.ts:340-386)
- **Reconnect-replay widens the existing guest-name-collision / host-name-spoof surface to ended rounds** — widening the guest reconnect guard from `round?.active` to `round?.active || round?.ended` means new guests (or typo'd names) now generate cards against ended rounds and mutate `round.cards`. Pre-existing name-collision pattern; tracked under Story 12-3 deferred work. (src/server/ws.ts:447-465)

## Deferred from: code review of song-masking-re-blur fix (2026-04-21)

- **Guest reconnect path not patched with `currentSongRevealed`** — `ws.ts` fix only targets the host reconnect unicast (lines 337–358). Guest reconnect `round:start` (separate branch in ws.ts) does not include `currentSongRevealed`, so guests can still see a spurious re-blur on reconnect after reveal. Out of scope for host-focused bug report; fix when the guest reconnect path is next touched. (src/server/ws.ts — guest connect branch)
- **Mid-reveal-delay reconnect: tile not re-masked even though `currentRevealed = false`** — the `round:start` handler rebuilds tiles via `initTiles` (all `masked: false`) but never calls `applyMask` for the in-progress song. A host reconnecting during the 5-second mask window sees the title immediately. Pre-existing gap; the plan's scope is post-reveal reconnect, not mid-delay. (src/client/lib/gameState.svelte.ts — `round:start` handler ~line 154)
- **`titleRevealDelay` config mutation mid-song + resume cross-product** — if the host PATCHes `titleRevealDelay` while a song is playing then pauses/resumes, `isTrackChange = false` means `currentSongRevealed` is never reset to match the new config. The reveal timer guard (`!currentSongRevealed`) short-circuits and no re-reveal fires. Pre-existing design gap; config changes were never retroactive to the current song. (src/server/rooms.ts — `startSong`)
- **Reveal timer restart on resume resets full delay, ignoring pre-pause elapsed time** — pausing at second 3 of a 5-second reveal, then resuming, re-arms a fresh 5-second timer. The UX implication (players wait an additional 5 seconds on resume) is now slightly more visible because `currentSongRevealed` propagates to clients. Pre-existing behavior, preserved intentionally. (src/server/rooms.ts — reveal timer block ~line 306)

## Deferred from: code review of 12-4-playtest-reliability-followup-fixes.md (2026-04-21)

- **Track C client test is a vacuous tautology** — `applyRoundStart` in `gameState.svelte.test.ts` is a pure identity function; test cannot catch a future regression where `round:start` mutates `casualModeOn`. Fix requires either mounting `HostRoomPage.svelte` or extracting the handler into a testable unit — a broader test-harness investment. (src/client/__tests__/gameState.svelte.test.ts:~310-325)
- **Track A client test mirrors handler logic in a local copy** — the `hydrate()` helper in `gameState.svelte.test.ts` reimplements the `round:start` branch from `HostRoomPage.svelte` rather than exercising it; a regression in the actual handler would not be caught. Consistent with project testing convention but worth upgrading when the broader harness supports Svelte component mounting. (src/client/__tests__/gameState.svelte.test.ts:~241-295)

## Deferred from: code review of 12-3-marks-and-casual-mode-reconnect-reliability (2026-04-20)

- **Guest name collision with `host_name` replays host indices to guest** — pre-existing system-wide ambiguity. Nothing prevents a guest joining with `name === room.host_name`; 12-3's unicast replay surfaces this because swept indices computed against the host's card would be emitted to that guest's socket. Fix belongs with a broader name-uniqueness pass, not this story. (src/server/ws.ts — guest connect branch)
- **Host marks persistence test bypasses real Svelte component binding** — [src/client/__tests__/gameState.svelte.test.ts](src/client/__tests__/gameState.svelte.test.ts) replicates the `createGameState` callback contract inline rather than mounting `HostRoomPage.svelte`. A comment in the test file acknowledges it "will not detect" drift. Manual Journey 3 covers it today. Upgrading to a component-level test is a broader harness investment.

## Deferred from: code review of 12-2-spotify-first-mobile-playback-and-resume-reconcile (2026-04-20)

- **Server clock skew vs Spotify continuous drift** — absolute-time comparison between `Date.now() - clipStartedAt` and Spotify's reported progress will produce persistent false drift on hosts with NTP skew. A broader fix (relative deltas between consecutive resumes) is worth its own story. (src/server/rooms.ts — /host/resume drift branch)
- **`postHostResume` double-POSTs `/player/device` on every mobile resume** — `pickMobileDevice` after `postHostResume` will re-set the same device id the server just adopted. Task 4's spec ordering explicitly requires this to avoid a race, so it's inefficiency, not correctness. (src/client/pages/HostRoomPage.svelte — wsClient.onResume handler)
- **`reissueExpectedTrack` doesn't verify 202/200 resulted in actual playback** — returning `drift-corrected` without a follow-up `/me/player` check is optimistic; silent device failures would mis-report to the client. (src/server/rooms.ts)
- **Malformed Spotify response body (valid JSON, wrong shape) not schema-validated** — optional-chain coverage is defensive for known shapes; a zod-style schema would catch API regressions explicitly. (src/server/rooms.ts — /host/resume parse)
- **Missing server tests: 401 from /me/player, malformed JSON body, progress_ms missing/null** — coverage nits; not required by AC #12 but would harden future changes. (src/server/__tests__/rooms.test.ts)
- **Missing client tests: navigator undefined (SSR), innerWidth=900 boundary** — coverage nits for `isMobileHost`. (src/client/__tests__/isMobileHost.test.ts)
- **`host:device-changed` broadcast assertion only checks host socket, not absence-on-other-sockets** — test-strength nit; broadcast-to-all is correct but under-asserted. (src/server/__tests__/rooms.test.ts)
- **Unauth `/host/resume` test doesn't assert Spotify fetch wasn't called** — security-adjacent ordering nit; current test only checks the 401 status. (src/server/__tests__/rooms.test.ts)
- **Guest `RoomPage` `host:device-changed` handler check (Task 6 subtask b)** — Task 6 says to safely ignore if guest UI doesn't display host device. Diff has no guest changes; verify on next touch of RoomPage. (src/client/pages/RoomPage.svelte)

## Deferred from: code review of 12-1-websocket-heartbeat-and-auto-reconnect (2026-04-20)

- **`connectAsHost` wrapper + 10 unit tests deleted out-of-scope** — inline LobbyPage handler is the sole caller and new wsClient tests cover the WS-client layer; unit coverage of host session:connect defaults and unparseable-message tolerance was dropped but not behaviorally regressed. (src/client/lib/ws.ts, src/client/__tests__/dashboard.test.ts)
- **LobbyPage `dead`-state banner copy silently changed** — old copy "Connection lost — player list may be stale. Refresh to reconnect." replaced with host-page copy "Connection lost — please refresh the page." Minor UX consistency change; no spec mandate either way. (src/client/pages/LobbyPage.svelte:169)

## Deferred from: code review of 10-3-sdk-default-preference-persistence-and-failure-path (2026-04-20)

- **Double `onSpotifyWebPlaybackSDKReady` assignment on HMR/fast-nav** — pre-existing: if the component is destroyed before the SDK script `load` event fires and a new instance mounts, a second `onSpotifyWebPlaybackSDKReady` is assigned and a second `<script>` tag appended. Unlikely in production but reachable in HMR. (src/client/pages/HostRoomPage.svelte — initSdkPlayer)
- **`device.id` could be null as Svelte keyed-each key in DevicePicker** — pre-existing: `SpotifyDevice.id` is typed `string | null`; if a null-id device slips through, Svelte reconciliation may collapse multiple null-id entries. Guard would go in the `loadDevices` fetch path inside DevicePicker. (src/client/components/DevicePicker.svelte)

## Deferred from: code review of 10-2-device-chip-and-picker-ui (2026-04-20)

- **No focus trap inside DevicePicker modal** — accessibility enhancement beyond spec ACs; #13/#14 only require tap-target size and dismiss behaviour. Consistent with other overlays in this codebase that also lack traps. (src/client/components/DevicePicker.svelte)
- **Listbox lacks arrow-key navigation / roving tabindex / `aria-activedescendant`** — beyond WAI-ARIA listbox conformance scope of this story; AC #13 only requires tap-target baseline. Every `<li role="option">` is tab-stoppable; consider roving tabindex in a future a11y pass. (src/client/components/DevicePicker.svelte)
- **`selectedDevice` not initialized from server on mount** — explicitly Story 10-3 scope (SDK-default tracking + `preferredDeviceId`). AC #2 and #20 require "Pick a device ▾" fallback until user picks; current behaviour is correct for 10-2. (src/client/pages/HostRoomPage.svelte)
- **`handleDeviceSelected` collapses all POST failures to one "Couldn't switch device" message** — matches existing `patchRoundConfig` pattern; finer-grained 401/404/5xx routing (route 401 to re-auth, 404 to session-ended) is a general-purpose enhancement for the whole client API layer. (src/client/pages/HostRoomPage.svelte)

## Deferred from: code review of 10-1-device-list-api-and-live-swap-endpoint (2026-04-20)

- **`GET /player/devices` has no WS-session presence check** — spec doesn't require it for GET (only POST/AC#11 needs the 503 guard); Story 10-2 picker UI owns the "no session → hide picker" UX gate. (src/server/rooms.ts)
- **AC#11 guard ordering: 400 body-check fires before 503 WS-session check** — preserved unchanged from original `/sdk/device` handler; spec's "ordering matches /sdk/device exactly" takes precedence over the numbered list; only affects the edge case of invalid body + no WS session simultaneously. (src/server/rooms.ts:626-630)
- **Scope upgrade has no in-app re-consent gate** — adding `user-read-playback-state` / `user-modify-playback-state` to the OAuth scope requires re-login for existing hosts; dev notes acknowledge this; `AuthDegradedBanner` re-auth path covers it gracefully. (src/server/auth.ts:105)
- **Transfer-401 returns 503 without retrying the transfer** — fire-and-forget `refreshWithRetry` then 503 matches the established pattern in `callSpotifyOnDevice`; client's auth-degraded re-auth path is the recovery. Pre-existing design. (src/server/rooms.ts)

## Deferred from: code review of modal-chrome-and-dark-mode-cleanup (2026-04-19)

- **`.header-btn.active { border-color: transparent }` loses affordance in forced-colors mode** — Windows High Contrast strips accent backgrounds; the transparent border gives no edge to replace it. Minor a11y concern, outside the chrome-cleanup plan's scope. (src/client/components/GameHeader.svelte:110)
- **`.entry:not(:last-child)` may flicker a border for one frame during Svelte transitions** — when the last entry is added/removed the previously-final entry briefly stops being `:last-child`, flashing a border-bottom. Cosmetic; filtering happens upstream in the entries array so no sustained visual bug. (src/client/components/SongHistoryDrawer.svelte:131)

## Deferred from: code review of 9-3-collapse-continuous-mode-to-gameover-choice (2026-04-19)

- **`session:connect` wire-protocol change without version bump** — `continuousMode` + `countdownRemainingMs` were removed from the payload; pre-deploy browser tabs will see `undefined` on those fields. Deploy practice (coordinated reload) covers this, and the project has no version field to hinge compatibility on. (src/server/rooms.ts)
- **No integration test for the Change It Up → `RoundConfigOverlay` mount flow** — unit tests assert the callback fires, but nothing exercises the overlay-mount-on-Game-Over path end-to-end. Manual verification checklist in Dev Notes covers the happy path. (src/client/__tests__/)
- **Buffered `round:end` during Game Over can yank host to lobby before CTA tap** — the `round:end` handler unconditionally calls `onRoundEnded()`. Pre-existing reconnect edge case; 9-3 exposes it more now that `round:dismissed` no longer also clears `winData`. (src/client/pages/HostRoomPage.svelte)
- **No `round:end` handler clears `winData` in gameState** — client-only state gets cleared on remount so no concrete symptom observed. Worth a defensive clear if weird Game-Over-sticks-around reports surface. (src/client/lib/gameState.svelte.ts)
- **No test for authenticated-caller-plus-missing-room returning 404 (not 403)** — guard ordering on `/round/next-round` is correct (404 before 403) but untested. Future reordering could leak room-existence info silently. (src/server/__tests__/rooms.test.ts)
- **`RoundConfigOverlay` backdrop dismisses without confirmation** — pre-existing overlay behavior; now reachable from the Change It Up path, so an accidental tap forces re-selecting playlist/vibe. (src/client/components/RoundConfigOverlay.svelte)
- **`pendingRound.roundNumber` is the sole fallback for next-round numbering** — `(currentRound?.roundNumber ?? base.roundNumber) + 1`. Computation is pre-existing; flagging because it's now the only path driving the number. Merits a unit test if "round N+1 shows as round 2" ever reports. (src/server/rooms.ts:457)

## Deferred from: code review of host-casual-toggle-and-status-line-trim (2026-04-19)

- **Guest with a name equal to `room.host_name` collides on `playerCasualModes` and sweep keys** — pre-existing throughout (the bingo-claim path at `src/server/rooms.ts:761` already coerces such a guest onto the host's card); this story extends the collision surface to casual-mode state. Low likelihood in friends-only flows but worth guarding later (e.g. reserve the host's name at guest-join time). (src/server/ws.ts, src/server/rooms.ts)
- **Orphaned casual-mode state if `room.host_name` is ever cleared after toggles** — `playerCasualModes[oldHostName]` and `autoMarkedTileIndices[oldHostName]` persist; the ☕ indicator would stay lit against a name nobody uses. Host-name clearing doesn't happen in any current flow, so this is theoretical. (src/server/ws.ts)

## Deferred from: code review of 9-1-game-over-page-state-and-auto-bingo (2026-04-19)

- **No CSRF / origin check / rate-limit on `POST /round/next-round`** — endpoint is intentionally unauthenticated (guest-callable) and gated only by `playerName === round.winnerName`. Consistent with the project's friends-only model and documented in the story's Dev Notes. Would need revisiting if the model ever widens beyond friends. (src/server/rooms.ts)
- **No server-side debounce when host + winning guest tap Start Next Round near-simultaneously** — both authorized callers pass their auth branch and both run `startContinuousRound`, which could double-broadcast `round:start`. Worth observing in real play before adding a guard. (src/server/rooms.ts)

## Deferred from: code review of 8-5-casual-mode-auto-mark-engine (2026-04-15)

- **Auto-claim latches permanently on failed claim** — `autoClaimFired` only resets on `round:start`, so a claim fetch failure locks out auto-claim for the rest of the round. Deferred: Epic 9 is about to minimize/remove the claim concept, so hardening this path would be wasted work. (src/client/pages/RoomPage.svelte)
- **Enable Casual Mode during paused pre-reveal marks tile without clearing reveal state** — the tile flips to marked but may still render with `masked`/`revealing` flags because `applyAutoMarks` doesn't touch mask state. Interacts with Story 5-6 reveal flow. (src/client/lib/bingo.ts, src/client/lib/gameState.svelte.ts)
- **Catch-up toast count reflects server-sent indices, not tiles actually applied** — cosmetic: post-reconnect the toast can say "Caught up on N songs" even when all N were already marked on the device. Low impact. (src/client/lib/gameState.svelte.ts)

## Deferred from: code review of 8-4-casual-mode-permission-and-player-toggle (2026-04-14)

- **Server accepts `player:casual-mode-changed` regardless of `allowCasualMode` flag** — missing server-side permission enforcement; client prevents this for normal usage, but a crafted message bypasses the host's permission gate. Low priority for friends-only app. (src/server/ws.ts)
- **No dedup/rate-limit on `player:casual-mode-changed` broadcast** — a spamming client triggers a broadcast per message; pre-existing pattern across the server, friends-only app. (src/server/ws.ts)

## Deferred from: code review of 8-3-continuous-mode (2026-04-14)

- **`handleDismissWin` silent failure when continuous on** — spec explicitly says "non-fatal; countdown just won't start"; host must re-dismiss if POST fails while continuous mode is enabled; no error shown by design. (src/client/pages/HostRoomPage.svelte)
- **`initialCountdownRemainingMs` seeded outside `gameState` constructor** — works correctly but breaks the factory's initialisation contract; `initialContinuousMode` is encapsulated, `initialCountdownRemainingMs` is not. Refactor candidate. (src/client/pages/RoomPage.svelte)
- **No `durationMs` type guard in `continuous:countdown-start` handler** — `countdownEndsAt = Date.now() + NaN` if server sends malformed payload; low risk since server is trusted, defensive hardening for future. (src/client/lib/gameState.svelte.ts)

## Deferred from: code review of 8-2-session-statistics (2026-04-14)

- **Display-name collision double-counts wins on both rows** — when a guest joins with the same name as `host_name`, a single win increments `winsByName[name]` once but `PlayerList` renders BOTH the host row and the guest row with `×N` and `Last round ✓`. Root cause: project-wide identity-by-display-name pattern. Spec Dev Notes explicitly defer the player-ID refactor. (src/client/components/PlayerList.svelte, src/server/rooms.ts)

## Deferred from: code review of 8-1-win-moment-hold-and-audio-presets (2026-04-14)

- **`selfName` matched as raw display name, not stable player ID** — `WinOverlay` compares `selfName === winnerName` using the raw user-entered name. Pre-existing project-wide pattern: identity by name (with case/whitespace variance) runs through join/claim/tile-marking flows. Fix needs a dedicated pass, not a one-file patch.
- **POST `/api/rooms/:code/round` with `audioPreset: null` coalesces to `'hype'`** — `body.audioPreset ?? 'hype'` treats explicit `null` as missing, inconsistent with the typeof-based handling of other fields. Low severity; no known client sends `null`.
- **No negative test for missing `audioPreset` field on start-round POST** — the default-to-`'hype'` path is only exercised indirectly via `validPayload`; no explicit assertion locks in that a body without `audioPreset` yields a `round:start` broadcast with `audioPreset: 'hype'`. Add when next touching `rooms.test.ts`.

## Deferred from: code review of 6-6-gitea-actions-cicd-branching-and-smoke-test (2026-04-13)

- **CI doesn't test the same image that deploys** — `docker compose up --build` rebuilds from source on the server; the image that passed CI tests is discarded. By-design for this stack; acceptable until image registry is introduced.
- **Staging deploy not pinned to tested commit SHA** — `git pull` runs in a separate job and may advance HEAD past the SHA that CI tested. Acceptable for staging.
- **No approval gate on prod deploy** — any user with tag-push rights deploys immediately after CI passes. Personal project; deferred.
- **SSH deploy key shared between staging and prod** — single key/host pair; compromise of one gives access to both. Deferred for personal project.
- **`docker network create bangerbingo-net` is a manual prerequisite** — not automated in deploy scripts; only relevant if the Caddy dual-stack path is ever reactivated. Currently inactive (cloudflared handles ingress).

## Deferred from: code review of 6-3-https-wss-via-caddy-reverse-proxy (2026-04-06)

- No firewall/NAT note for Let's Encrypt HTTP-01 — README notes domain must resolve but omits that port 80 must be publicly reachable; operators behind NAT will get silent ACME failures. Add a firewall prerequisite note to README.
- `APP_DOMAIN` unset gives cryptic Caddy parse error — no validation in compose or startup script; could be improved with a compose healthcheck or entrypoint guard.
- `SPOTIFY_REDIRECT_URI` in `.env.example` not updated for HTTPS production use — operators copying the example verbatim will get Spotify auth failures in production.
- No `caddy reload` instruction after Caddyfile edit for tailnet path — README should add `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile` instruction.
- WebSocket connections dropped on `app` container restart — pre-existing behavior; now the only ingress path. Consider documenting expected reconnect behavior.
- `caddy_config` volume purpose undocumented in README — minor; backup/restore operators are unaware of it.
- `wget` not explicitly installed in Dockerfile for `app` healthcheck — works on Alpine by default but not guaranteed across base image updates.

## Deferred from: code review of 7-3-round-config-overlay-and-host-name (2026-04-05)

## Deferred from: code review of 7-4-guest-waiting-room-and-host-as-player (2026-04-05)

- `isSelfRow` case-sensitivity: if stored guest name casing ever diverges from server echo, the `(you)` tag silently breaks. Pre-existing naming convention; fix upstream in join validation if normalisation is added.
- `applyPlayerEvent` on `player:joined` does not deduplicate — reconnecting guest can appear twice in the client list. Pre-existing helper behaviour; not introduced by 7-4.
- Guest `session:connect` server test uses partial field assertions rather than full `toEqual` — functionally correct but weaker than host-path style. Quality improvement only.
- `initialPlayers` frozen at RoomPage mount; WS messages arriving in the gap between JoinPage handoff and `onMount` could be missed. Pre-existing architecture concern; mitigated by Svelte 5 synchronous rerender.

## Deferred from: code review of 7-5-game-page-header-and-players-overlay (2026-04-05)

- PlayersOverlay: no focus trap / keyboard dismissal — explicitly out of scope per spec, matches project-wide a11y deferral precedent (7-3, 7-4).
- PlayersOverlay: `playerCount` in sheet title vs rendered row count mismatch when `hostName === null` + guests present — `computePlayerCount` excludes null host but placeholder "Host" row always renders; theoretical edge, hostName set before GameHeader visible in normal flow.
- PlayersOverlay: backdrop click fragility — sheet is sibling not child of overlay div; no `stopPropagation` needed today but fragile at extreme zoom. Systemic pattern from SongHistoryDrawer.
- PlayersOverlay: duplicate player name used as `#each` key — Svelte would warn on duplicate keys; server controls name uniqueness; fix upstream if deduplication is added.
- GameHeader: history button has no `aria-label` update when text changes from `"History"` to `"Nth Song"` — button's function (open drawer) doesn't change but label does; a11y polish, out of scope for 7-5.

- Concurrent first-round POSTs can both pass `host_name IS NULL` check (src/server/rooms.ts round route) — pre-existing race shape; low risk for 5-user personal app. Fix would be `UPDATE ... WHERE host_name IS NULL` + rows-affected check.
- Unicode/emoji length handling: `.length` counts UTF-16 surrogates, no grapheme count, no zero-width/control-char normalization (src/client/lib/roundConfig.ts, src/server/rooms.ts validation) — personal/friends context, aligns with existing guest-name validation.
- `getRooms()` fetches the entire host's room list just to read one `host_name` field (src/client/pages/LobbyPage.svelte onMount) — no `GET /api/rooms/:code` endpoint exists; pre-existing API shape.
- a11y gaps in overlay: no focus trap, svelte-ignore comments suppress real warnings, no keyboard equivalent for backdrop dismiss, focus not moved into modal on open (src/client/components/RoundConfigOverlay.svelte) — Dev Notes explicitly deferred focus trap as MVP-out-of-scope.
- No CSRF protection on `POST /api/rooms/:code/round` (src/server/rooms.ts) — pre-existing architectural concern; cookie SameSite mitigates.
- Search tab out-of-order response race + `selectedPlaylistId` inconsistency across tab switches (src/client/components/RoundConfigOverlay.svelte) — ported verbatim from RoundConfigPage.svelte, pre-existing behavior.

## Deferred from: code review of 7-2-host-management-session-list-and-delete (2026-04-05)

- 403/404 enumeration leak on `DELETE /api/rooms/:code` (src/server/rooms.ts:175-177) — pre-existing cross-route convention; same pattern in every other room route.
- No CSRF token on `POST /auth/logout` (src/server/auth.ts:200-203) — SameSite=Lax mitigates; logout-CSRF is nuisance-only, not privilege escalation.
- Narrow race: new WS connect can occur between `destroyRoom()` and `deleteRoom()` (src/server/ws.ts:92-120, src/server/rooms.ts:181-182) — single-request window; full fix requires a "room being destroyed" flag.
- No rate limiting on `DELETE /api/rooms/:code` (src/server/rooms.ts:171) — app-wide concern across all mutating routes.
- Client `session:end` handler is a no-op; no proactive `ws.close()` (src/client/lib/ws.ts:55-59, 127-130) — deferred by spec (Story 7-4 owns guest banner + redirect UX).
- Nested interactive: `<button class="trash-btn">` inside `<div role="button">` (src/client/pages/DashboardPage.svelte:124-138) — minor a11y, requires layout restructuring (promote row to `<button>` with sibling trash button via flex).

## Deferred from: code review of 7-1-root-cleanup-host-login-cookie-localstorage (2026-04-05)

- Rapid repeated clicks on Host Login fire handler multiple times — minor, no orphaning risk once mid-connect guard lands, page transition is idempotent.
- Host Login button may overlap `<h1>BangerBingo</h1>` on narrow viewports — cosmetic, no verified overlap at current breakpoints, revisit if reported.

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

- requireAuth middleware does not check token_expires_at. Expired access tokens remain valid until re-login. Story 1.2 handles refresh.
- access_token and refresh_token stored as plaintext in SQLite. Acceptable for friends-use MVP; consider encryption at rest for any broader deployment.
- No AbortController timeout on fetch() calls to Spotify token endpoint and /v1/me. A hung Spotify response will hang the callback handler indefinitely.
- refresh_token presence in Spotify token response is assumed but not guarded. PKCE auth code flow reliably returns it per Spotify docs, but no runtime guard exists.

## Deferred from: code review of 1-2-token-refresh-and-degraded (2026-04-03)

- Concurrent scheduler ticks can refresh the same host simultaneously — no per-host in-progress guard; two overlapping ticks can write conflicting tokens. Fix: add an in-progress Set checked before calling `refreshWithRetry`.
- Empty `refresh_token` in DB causes 4 unnecessary Spotify retries — application layer has no guard; schema NOT NULL covers normal flow.
- `/api/auth/status` `tokenExpiresAt` is stale — snapshot from `requireAuth` middleware; `degraded` is live but `tokenExpiresAt` lags one cycle when scheduler refreshes concurrently.
- Startup fan-out — after long downtime all expired hosts trigger simultaneously on first tick; low risk for ≤5 users.
- `authEvents` has no `'error'` listener — latent crash if any caller emits `'error'` without a registered handler.
- `retryWithBackoff` retries non-recoverable 4xx errors identically to 5xx — wastes up to 4 attempts on revoked tokens.
- `getAllHosts()` uses `SELECT *` — column projection would limit token exposure in memory.
- No jitter in backoff — multiple simultaneous expirations hammer Spotify in lockstep; low risk at ≤5 users.

## Deferred from: code review of 3-1-room-creation-api-and-code-generation (2026-04-03)

- No rate limiting or per-host room cap on POST /api/rooms — a single authenticated host can hammer the endpoint or exhaust the 24^5 code space over time. Harden in a future epic.
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

- `getHostRoom` O(n) linear scan over all rooms on every `auth:degraded` event — not a correctness concern at friends-use scale.
- `auth:degraded` event listener registered at module load and never removed — acceptable for production singleton, latent issue if module is ever re-evaluated.
- `parseCookies` does not handle RFC 6265 quoted cookie values — session cookie writer does not produce quoted values in practice.
- `getPlayerList` may theoretically include sockets in `CLOSING` state between disconnect and close-event cleanup — near-instant transition, single-threaded JS, no real exposure.
- No maximum guest count enforced — unlimited guests can join a room; out of scope for personal MVP.
- `setupWebSocketServer` called twice on the same `httpServer` would double-handle upgrades — not a real production scenario, but no guard exists.
- `roomSockets.hostUserId` populated from `room.host_user_id` which could be null if DB schema permits — pre-existing schema concern; null would permanently break `auth:degraded` delivery for that room.

## Deferred from: code review of 3-4-login-and-lobby-screens (2026-04-03)

- Create Room button not disabled while room list is still loading — minor concurrent UX gap; no spec requirement to gate it.
- `applyPlayerEvent` does not deduplicate player names — inflated player count if server sends duplicate `player:joined`; server already prevents duplicate names at connection time.
- `player:joined` before `session:connect` ordering race — client overwrites any optimistic state with `session:connect` snapshot; server sends `session:connect` synchronously on connect, making this a near-impossible race in practice.

## Deferred from: code review of 3-5-host-disconnect-and-reconnect (2026-04-03)

- Silent error swallowing in `RoomPage.onMount` `onError` handler — if server closes the guest WS (4004, 4009, etc.), the guest sees no UI feedback; revisit when double-WebSocket lifecycle is corrected.
- `closeCodeToMessage` in `ws.ts` has no entries for close codes 4000 ("missing name") and 4001 ("unauthorized") — pre-existing gap; guest receives generic "Connection failed" message for these codes.

## Deferred from: code review of 4-1-track-pool-api (2026-04-04)

- Concurrent token refresh race: two simultaneous requests both see expiring token and call `refreshWithRetry` in parallel — low risk at ≤5 users but wastes Spotify quota (src/server/music/router.ts:21-28).
- Inline token refresh block duplicated verbatim in `/music/search` and `/music/tracks/:playlistId` handlers — future fix must be applied twice (src/server/music/router.ts).
- `token_expires_at` ms/seconds unit not enforced at DB schema level — if written in seconds, every request would attempt an inline refresh (src/server/music/router.ts:24).

## Deferred from: code review of 4-2-round-configuration-screen (2026-04-04)

- `pendingRound` silently dropped + `roundNumber` non-durable when `roomSockets` has no entry — if host hasn't opened a WS connection yet, round config is returned (HTTP 200) but never stored; counter resets on server restart. Explicitly acceptable for this story per dev notes; Story 4-3 will consume `pendingRound`. (src/server/rooms.ts)
- `onRoundStarted()` fires before any WebSocket broadcast to guests — host navigates to lobby while guests receive no signal. By design as placeholder per AC8; Epic 5 will add the WS round-start broadcast. (src/client/pages/RoundConfigPage.svelte + src/server/rooms.ts)
- API response for presets/search not shape-validated before rendering — non-array response would crash `{#each}` at runtime. Low risk for server-controlled endpoints; acceptable for MVP scope. (src/client/pages/RoundConfigPage.svelte)

## Deferred from: code review of 4-3-card-generation-and-round-start (2026-04-04)

- State mutation + WS broadcast precede `recordPlayedSongs` — if SQLite throws after cards are sent, DB misses the round's tracks and next round won't down-rank them. Move persist before broadcast if atomicity is ever required. (src/server/rooms.ts)
- Concurrent `POST /round` requests can race on `roomState.currentRound` — two simultaneous calls both compute `roundNumber = 1`, both broadcast, last write wins for in-memory state. No real risk for single-host personal app; add in-flight guard if multi-concurrent start is ever possible. (src/server/rooms.ts)
- Token expiry NaN guard — if `token_expires_at` is 0/null/undefined, subtraction yields NaN and refresh is skipped silently. Pre-existing pattern from music/router.ts; audit all inline refresh blocks when hardening auth. (src/server/rooms.ts)
- `played_songs` has no FK reference to `rooms(code)` — orphaned rows accumulate on room deletion; room code reuse (331,776 combinations) could produce false down-ranking. Add FK or periodic cleanup when adding room lifecycle management. (src/server/db.ts)
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

## Deferred from: code review of 7-6-host-mini-player-and-controls-overlay (2026-04-06)

- `handlePlayPause` and `handleNext` swallow all fetch errors silently — no .catch(), no user feedback, UI isPlaying state can desync from server. Pre-existing pattern from HostControlsPanel. (src/client/pages/HostRoomPage.svelte)
- Keyboard accessibility / focus trap on HostControlsOverlay — no Escape key handler, no focus lock. Explicitly out of scope per AC #11; matches project-wide a11y deferral precedent.
- `sdkReinitializing` re-entry race: if `auth:restored` fires twice while first reinit is in-flight, the second call returns early but `sdkErrorFired` has been reset by the first — subsequent SDK errors are silently swallowed, player stuck on "Connecting…" indefinitely. Pre-existing; unrelated to story changes. (src/client/pages/HostRoomPage.svelte)

## Deferred from: code review of story 6-5 (2026-04-06)

- No WebSocket notification to active rooms on disconnect — disconnect endpoint clears tokens but doesn't broadcast `auth:degraded` or pause active rounds; players in active rooms get no signal that music stopped. Feature-level addition beyond story scope.
- Room creation allowed while Spotify is disconnected — `POST /rooms` succeeds but the room is dead-on-arrival (first round start returns 503). Guard on room creation would improve UX.

## Deferred from: code review of 6-2-production-dockerfile-and-docker-compose (2026-04-06)

- Port binding exposes all host interfaces (`0.0.0.0`) — `${PORT:-3000}:${PORT:-3000}` in `docker-compose.yml` should use `127.0.0.1:` prefix once Caddy is the sole ingress; intentional for story 6-2 pre-Caddy, address in story 6-3.
- `PORT` in `env_file` not visible to compose port interpolation — `${PORT:-3000}` in `ports:` resolves from host shell env, not `env_file:`; if `PORT` is only in `.env`, host maps `3000:3000` while container listens elsewhere; spec-defined syntax, address when Caddy takes over port routing in 6-3.
- Floating `node:22-alpine` base image tag — no digest pinning; upstream re-tag could cause ABI mismatch for `better-sqlite3` native binary; production hardening out of scope for this story.
- `serveStatic` wildcard ordering dependency — `/healthz` must remain before the wildcard; only a code comment enforces this; a future refactor could silently break the healthcheck (`src/server/index.ts`).

## Deferred from: code review of 6-1-local-dev-and-tailscale-multi-device-testing (2026-04-05)

- **Session cookie `Secure=false` in dev silently breaks if `NODE_ENV=production` is set over plain-HTTP tailnet** (src/server/auth.ts:87,96,186) — cookies would be rejected by browsers over HTTP when `secure: true`, leading to empty session with no warning. Pre-existing; relevant to Epic 6-2/6-3 deploy hardening when TLS + prod env layering is finalized.

## Deferred from: code review of 11-1-phosphor-icon-system (2026-04-20)

- **`aria-label="locked"` on lock-icon wrapper span is redundant announcement** — pre-existing pattern, `<span class="lock" aria-label="locked">` wraps the (formerly) `🔒` glyph; 11-1 preserved the span and only swapped the inner content. A screen reader will announce "locked" alongside the surrounding labelled button, duplicating intent. (src/client/pages/JoinPage.svelte:138)
- **Spotify device `type` enumeration gap in the replaced `deviceIcon` branching** — new `{#if}` chain covers `Smartphone`/`Speaker`/`Computer` → device-specific Phosphor icons with `MusicNote` fallback, same bucketing as the removed `deviceIcon()` helper. The Spotify Web API also returns `Tablet`, `TV`, `GameConsole`, `CastVideo`, `CastAudio`, `Automobile`, `STB`, `AVR`, `AudioDongle`, `Unknown`; all currently fall through to `MusicNote`. Not a regression — behavior preserved — but the new per-value structure invites richer mapping (e.g., `DeviceTablet`, `Television`, `GameController`). (src/client/components/DeviceChip.svelte, src/client/components/DevicePicker.svelte)


## Deferred from: code review of 13-6-win-jingle-audio (2026-04-22)

- **Mid-round join client always hears 'minimal' preset** — `audioPreset` defaults to `'minimal'` and is only updated on `round:start`. A client that connects mid-round (receiving `session:connect` + `round:win` without a preceding `round:start`) misses the host's configured preset. Pre-existing state-sync gap; not introduced by 13-6. (src/client/lib/gameState.svelte.ts)
- **Shared vi.fn() instances in test mock inflate call counts** — `makeAudioContextMock` returns a single `connect`, `start`, `stop` vi.fn() shared across all oscillator and gain node mocks. Assertions on call counts would produce inflated totals. Current tests don't assert on `connect` count so no false pass today, but the mock is structurally misleading. (src/client/__tests__/winAudio.test.ts)
- **isWinReplay guard assumes `round:start` always precedes `round:win`** — If `round:start` is dropped or reordered in the message queue, `game.winData` may still be non-null from a prior round and `isWinReplay` would fire `true`, silently skipping audio on a genuine new win. Theoretical; relies on the broader message ordering guarantee. (src/client/pages/RoomPage.svelte:91, src/client/pages/HostRoomPage.svelte:491)

## Deferred from: code review of 13-8-independent-cards-exclude-played-auto-reset (2026-04-22)

- **TOCTOU on concurrent `startRound`** — two simultaneous round-starts for the same room can both pass the `pool.length < 25` check before either calls `clearPlayedSongs`, causing a double-reset with no mutex around the read→check→clear→rebuild sequence. Theoretical for a single-host personal app. (src/server/rooms.ts:478-489)
- **Duplicate rows in `played_songs` on double-call to `startSong`** — `recordPlayedSongs` has no idempotency guard; if `startSong` fires twice for the same track index, the row is inserted twice. Functionally harmless because the exclusion consumer wraps IDs in a `Set`, but DB accumulates junk rows over time. (src/server/rooms.ts:~235)
- **`cardKey` is order-based, not content-based** — the uniqueness-retry in `generateCards` uses unsorted tile order in the key; two cards with identical songs in different tile positions are treated as distinct. Does not enforce content-level uniqueness. Statistically irrelevant for pools ≥50 tracks; AC 5 only guarantees differences at ≥50 tracks. (src/server/game/cards.ts:~21)
- **No `border-radius` on `.info-toast` CSS** — renders with square corners while all other status chips appear rounded. Cosmetic only. (src/client/pages/HostRoomPage.svelte:~825)

## Deferred from: code review of spec-player-name-edit (2026-04-22)

- **Outer `catch { /* ignore malformed */ }` swallows rename-handler runtime errors** — pre-existing pattern wrapping JSON.parse, now wraps 60+ lines of stateful rename migration on both host and guest branches. A DB write throw or null deref in the rename block is silently swallowed; client waits forever with no log. (src/server/ws.ts:515, :693)
- **`casualModeOn` in RoomPage may display stale after a self-rename** — local `$state` initialized from `initialCasualModeNames.includes(currentName)` at mount; no `$effect` re-reads `game.casualModePlayers.has(currentName)` after rename. Corrects itself on next `session:connect` bulk refresh. (src/client/pages/RoomPage.svelte:51)
- **No rate limit on `player:rename`** — a guest can spam renames; each triggers a broadcast to every socket and a `persistRoomState(code)` disk write. Friends-app threat model tolerates this today. (src/server/ws.ts:630-692)
- **Name validation does not handle zero-width, control, or Unicode-normalization variants** — `"Bob\u200B"`, embedded `\n`/`\t` inside a non-empty trimmed name, and NFC-vs-NFD case-variants can yield visually-identical but distinct names. Spec validation is trim + non-empty + ≤30; out of scope for this story. (src/server/ws.ts:633, :641-652)
- **`isClaiming` flipping true mid-edit silently discards typed-but-uncommitted input** — when `game.isClaiming` flips while the edit input is open, the row reverts with no feedback to the typing user. (src/client/components/PlayerList.svelte)
- **ws.test.ts rename-after-disconnect test has no close-broadcast sequencing** — `bob.close()` then awaiting `player:left` with `name: 'Bobby'` passes today by chance rather than by contract. (src/server/__tests__/ws.test.ts:672-693)
