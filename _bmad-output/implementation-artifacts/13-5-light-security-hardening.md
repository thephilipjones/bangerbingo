# Story 13-5: Light Security Hardening

## Status: done

## Context

BangerBingo is publicly accessible on the internet (bangerbingo.net). While the user base is friends-first, giving the URL to a slightly broader audience warrants addressing the highest-severity security gaps. Three items have real attack surface for a public deployment:

1. **Session cookie is unsigned** — the cookie value is the raw Spotify `user_id` (a public/knowable string). Anyone who knows or guesses a host's Spotify user_id can forge a valid session cookie and act as that host. `SESSION_SECRET` is already validated at startup but never used for signing (deferred since Story 1-1).

2. **`playlistId` path param interpolated into Spotify API URL** — `GET /music/tracks/:playlistId` passes the param directly into `https://api.spotify.com/v1/playlists/{playlistId}/tracks`. An authenticated host can craft a path like `../me` to reach arbitrary Spotify API endpoints through the server's token.

3. **No rate limiting on guest join** — `POST /ws` (or the WS upgrade with a name param) allows unlimited join attempts, enabling room code enumeration and name-spray attacks.

## Acceptance Criteria

### AC-1 — Session cookie signing
The session cookie value is `{userId}.{hmac}` where `hmac = HMAC-SHA256(SESSION_SECRET, userId)` truncated to 16 hex chars (or full — pick one and document). `requireAuth` middleware validates the signature and returns 401 on mismatch. Existing sessions (unsigned cookies) are invalidated on deploy — hosts must re-login once.

**Files:** `src/server/auth.ts` — `setSessionCookie` (sign on write), `requireAuth` (verify on read). `SESSION_SECRET` is already required/validated in config.

**Approach:** Minimal — sign in `setSessionCookie`, verify in `requireAuth`. No new library needed (Node `crypto.createHmac` already used in auth.ts:29). Cookie format: `userId + '.' + sig`. Parsing: split on last `.`.

---

### AC-2 — `playlistId` sanitization
`GET /music/tracks/:playlistId` validates that `playlistId` matches `/^[A-Za-z0-9]+$/` before interpolation. Returns 400 "Invalid playlist ID" on mismatch.

**File:** `src/server/music/router.ts` — the `/tracks/:playlistId` handler, before the fetch call (~line 44).

**One line:** `if (!/^[A-Za-z0-9]+$/.test(playlistId)) return ctx.json({ message: 'Invalid playlist ID' }, 400)`

Spotify playlist IDs are Base62 strings — this regex is the correct allowlist.

---

### AC-3 — Rate limit on WS guest join
Apply a per-IP rate limit to the WebSocket upgrade handler (or the `player:join` WS message path). Limit: 10 join attempts per IP per 60 seconds. Exceed → close with code 4429 "Too many requests".

**File:** `src/server/ws.ts` — `setupWebSocketServer` upgrade handler or the `player:join` message handler.

**Approach:** Simple in-memory Map: `Map<ip, { count: number; resetAt: number }>`. Evict stale entries on each check (or periodically). No external dependency. IP from `req.socket.remoteAddress` on the upgrade request.

---

### AC-4 — No rate limit on host-only endpoints (out of scope)
Host endpoints are protected by `requireAuth` (signed cookie after AC-1). Rate limiting host endpoints is not in scope for this story.

---

### AC-5 — Test
- Cookie signing: unit test that a forged cookie (wrong sig) returns 401 from `requireAuth`.
- Playlist sanitization: test that `GET /music/tracks/../../etc` returns 400.
- Rate limit: test that the 11th join attempt from the same IP within 60s gets close code 4429.

## Files

- `src/server/auth.ts` — AC-1 (sign + verify)
- `src/server/music/router.ts` — AC-2 (validate playlistId)
- `src/server/ws.ts` — AC-3 (rate limit)
- `src/server/__tests__/auth.test.ts` (or rooms.test.ts) — AC-5

## Deferred Work Updates

Upon completion, remove from `deferred-work.md`:
- "Session cookie is raw `user_id` with no signature/MAC" (under "Deferred from: code review of 3-1" and "Deferred from: code review of 3-2") ✅
- "SESSION_SECRET is required/validated at startup but never used to sign the session cookie" (under "Deferred from: code review of 1-1") ✅
- "`playlistId` path param not sanitized before URL interpolation" (under "Deferred from: code review of 4-1") ✅

## Files

- `src/server/ws.ts` — AC-3: added `joinRateLimit` map, `checkJoinRateLimit` helper, and rate-limit guard at the top of the guest path
- `src/server/__tests__/ws.test.ts` — AC-5: import `joinRateLimit`, clear in `beforeEach`, added rate limit test (11th join → 4429)
- `src/server/__tests__/music.test.ts` — AC-5: added path traversal test (`..%2F..%2Fetc` → 400)
- `_bmad-output/implementation-artifacts/deferred-work.md` — removed 4 resolved deferred items

## Dev Agent Record

### Implementation Notes

**AC-1 (cookie signing):** Already fully implemented. `src/server/auth.ts` has `signUserId` (HMAC-SHA256, full hex sig) and `verifySession` (timing-safe compare) wired to `setSessionCookie` in the callback and `requireAuth` middleware. Tests already existed and pass.

**AC-2 (playlistId sanitization):** Already fully implemented in `src/server/music/router.ts:51` with a stricter regex `^[A-Za-z0-9]{20,30}$` (requires 20–30 Base62 chars). Tests for invalid IDs already existed.

**AC-3 (WS guest join rate limit):** Implemented. Added `export const joinRateLimit` (Map) and `checkJoinRateLimit(ip)` helper to `src/server/ws.ts`. The check fires at the very start of the guest path (before name/room validation), using `req.socket.remoteAddress`. Limit: 10 per IP per 60 seconds; excess → `ws.close(4429, 'Too many requests')`. Stale entries evict naturally on next check for that IP.

**AC-4:** Out of scope — host endpoints protected by `requireAuth`.

**AC-5 (tests):** All three required tests are now present and passing:
- Forged cookie → 401: pre-existing in `auth.test.ts`
- Path traversal ID → 400: added `..%2F..%2Fetc` test in `music.test.ts`
- Rate limit (11th join → 4429): added in `ws.test.ts`; `joinRateLimit` is cleared in `beforeEach` to prevent test cross-contamination.

### Completion Notes

All ACs satisfied. 519 tests pass (0 regressions). Deferred work items removed from `deferred-work.md`.

## Change Log

- 2026-04-22: Implemented AC-3 WS guest join rate limiting (10/60s per IP, close 4429); added AC-5 rate limit test and path traversal playlist test; removed 4 resolved deferred items.

## Review Findings

### Decision Needed (resolved)

- [x] [Review][Decision] **Rate-limit check fires AFTER WS upgrade & after `startHeartbeat`** [src/server/ws.ts:432] — Resolved: hoist the check above `startHeartbeat` for the no-cookie branch (small surgical fix; does not avoid TCP+upgrade cost but eliminates the heartbeat-timer leak per blocked attempt). Promoted to patch.
- [x] [Review][Decision] **Rate limit keyed on `req.socket.remoteAddress`** [src/server/ws.ts:432] — Dismissed: deployment no longer uses Caddy/any reverse proxy, so `remoteAddress` is the real client IP. Add a one-line code comment noting the assumption so a future proxy reintroduction is flagged.

### Patches (applied 2026-04-22)

- [x] [Review][Patch] **Hoist `joinRateLimit` check above `startHeartbeat` (from D1)** [src/server/ws.ts] — Done. Cookie/sessionUserId parsing lifted to top of `handleConnection`; rate-limit gate now runs before `startHeartbeat`. Added comment about no-proxy assumption.
- [x] [Review][Patch] **HIGH — Same `playlistId` injection exists at `POST /api/rooms/:code/round`** [src/server/rooms.ts:567-570] — Done. Same `^[A-Za-z0-9]{20,30}$` regex applied. New test: `returns 400 for path traversal characters in playlistId` in rooms.test.ts. All test fixtures using `'pl_abc'` updated to a 22-char shape (`'aaaaaaaaaaaaaaaaaaaaaa'`).
- [x] [Review][Patch] **Rate-limit map is unbounded** [src/server/ws.ts:292-300] — Done. Added 60s `setInterval` sweep of expired entries; `.unref()` so it doesn't keep the process alive in tests/scripts.
- [x] [Review][Patch] **`verifySession` accepts empty `userId`** [src/server/auth.ts:26-29] — Done. Changed `lastDot === -1` to `lastDot <= 0` so `.<sig>` cookies are rejected pre-HMAC.
- [~] [Review][Patch] **Rate-limit test does not assert the off-by-one boundary** — Skipped on review. The existing `for (let i = 0; i < 10; i++) ... expect(closed.code).toBe(4004)` already proves the 10th attempt closes 4004 (a `count >= 9` regression would fail iteration 9). Off-by-one in either direction is already covered.
- [x] [Review][Patch] **`joinRateLimit.clear()` in `beforeEach` is load-bearing but undocumented** [src/server/__tests__/ws.test.ts:131-139] — Done. Added 3-line comment explaining the coupling.
- [x] [Review][Patch] **Sig-length choice not documented** [src/server/auth.ts:19-21] — Done. Added one-line comment on `signUserId` noting the full-64-char choice.

### Deferred (pre-existing / out of scope)

- [x] [Review][Defer] **No HTTP-endpoint rate limiting** [src/server/music/router.ts, src/server/rooms.ts] — deferred, AC-4 explicitly excludes host endpoints; spec did not include search/lookup endpoints either.
- [x] [Review][Defer] **Session cookie has no expiry, rotation, or server-side revocation** [src/server/auth.ts] — deferred, pre-existing; signed payload is `userId` only, no `iat`/version, so a leaked cookie is valid for 30d. Out of scope for 13-5.
- [x] [Review][Defer] **No Origin check on WS upgrade (CSWSH risk)** [src/server/ws.ts] — deferred, pre-existing; not introduced by this story.
- [x] [Review][Defer] **Within 10/60s budget, attacker can name-spray a known room code** [src/server/ws.ts:438-460] — deferred, inherent to the chosen 10/60s spec limit; would need a separate per-room or per-name throttle story.

### Dismissed

- AC-2 regex `{20,30}` is stricter than spec's `[A-Za-z0-9]+` — improvement, not a regression.
- AC-5 forged-cookie test claimed pre-existing — verified at `src/server/__tests__/auth.test.ts:311`.
- `config.sessionSecret` validation — verified at `src/server/config.ts:11` (`required('SESSION_SECRET')`).
- Fixed-window boundary burst, exported mutable `joinRateLimit` Map, `'unknown'` bucket, IPv4-mapped IPv6 (subsumed under decision-needed proxy/IP item), CSRF on `/logout` (Lax mitigates), `clearHostTokens` swallowed errors (intentional), close-reason length, `timingSafeEqual` length pre-check (sigs are fixed 64 chars).
