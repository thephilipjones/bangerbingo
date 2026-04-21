# Story 13-5: Light Security Hardening

## Status: Ready for Development

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
- "Session cookie is raw `user_id` with no signature/MAC" (under "Deferred from: code review of 3-1" and "Deferred from: code review of 3-2")
- "SESSION_SECRET is required/validated at startup but never used to sign the session cookie" (under "Deferred from: code review of 1-1")
- "`playlistId` path param not sanitized before URL interpolation" (under "Deferred from: code review of 4-1")
