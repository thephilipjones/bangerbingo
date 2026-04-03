# Story 1.1: PKCE OAuth & Session

Status: done

## Story

As a host,
I want to log in via Spotify OAuth and have my session persisted via a cookie,
so that I can access the app and make authenticated Spotify API calls without re-logging in on every visit.

## Acceptance Criteria

1. Navigating to `/auth/login` redirects the host to Spotify's OAuth authorization URL with a PKCE code challenge.
2. After Spotify redirects to `/auth/callback`, the server exchanges the code for access + refresh tokens, stores them in SQLite keyed to the host's Spotify `user_id`, and sets an httpOnly session cookie.
3. A host with a valid session cookie visiting `/login` is redirected to the dashboard (not shown the login screen again).
4. The `/login` screen renders a "Connect Spotify" button and a small, muted iOS disclaimer.
5. The server rejects requests to authenticated routes if no valid session cookie is present (401).
6. Local dev OAuth redirect uses `http://127.0.0.1` (not `localhost`).

## Tasks / Subtasks

- [x] Set up project skeleton (AC: all)
  - [x] Init Hono server (`src/server/index.ts`) with TypeScript
  - [x] Init Svelte 5 frontend (`src/client/`) — SPA mode, no SSR
  - [x] SQLite init (`src/server/db.ts`) — create `hosts` table on startup
  - [x] Environment config (`src/server/config.ts`) — load and validate env vars

- [x] SQLite hosts table (AC: 2)
  - [x] Schema: `user_id TEXT PRIMARY KEY, display_name TEXT, email TEXT, access_token TEXT, refresh_token TEXT, token_expires_at INTEGER`
  - [x] `upsertHost()` helper — insert or update on `user_id` conflict

- [x] PKCE OAuth server routes (AC: 1, 2, 6)
  - [x] `GET /auth/login` — generate `code_verifier` (48-byte random, base64url), compute `code_challenge` (SHA-256 → base64url), store `code_verifier` in a short-lived httpOnly cookie (`pkce_verifier`), redirect to Spotify authorize URL
  - [x] `GET /auth/callback` — read `code_verifier` from cookie, exchange `code` for tokens via Spotify token endpoint, fetch `/me` for user identity, call `upsertHost()`, delete `pkce_verifier` cookie, set `session` httpOnly cookie (Spotify `user_id`), redirect to `/`
  - [x] Error path in callback: Spotify returns `error` param → redirect to `/login?error=spotify_denied`

- [x] Session middleware (AC: 3, 5)
  - [x] `requireAuth` Hono middleware — read `session` cookie, look up host in SQLite, attach `ctx.var.host` or return 401
  - [x] Apply `requireAuth` to all future authenticated routes (wired but no protected routes exist yet in this story)

- [x] Frontend: `/login` route (AC: 3, 4)
  - [x] Svelte `LoginPage` component — "Connect Spotify" button links to `/auth/login`
  - [x] iOS disclaimer: `"⚠ Use desktop Chrome or Firefox for audio"` — small, muted, below the button
  - [x] On mount: if host already has a valid session (check `/api/me` or session cookie presence), redirect to `/` (dashboard placeholder)

- [x] Frontend: auth guard on app load (AC: 3)
  - [x] App-level session check on mount — `GET /api/me` → redirect to `/login` if 401, redirect away from `/login` if authenticated

- [x] `/api/me` endpoint (AC: 3, 5)
  - [x] `GET /api/me` — protected by `requireAuth`, returns `{ user_id, display_name }` — minimal payload for session check

## Dev Notes

### Stack
- **Backend:** Hono on Node 20+ (`@hono/node-server`). Use `hono/cookie` for all cookie operations.
- **Frontend:** Svelte 5 SPA. Routing via `svelte-routing` or manual hash/history routing — keep it minimal, no full router framework needed for MVP.
- **Database:** `better-sqlite3` (synchronous, no async overhead). Init at server startup; do NOT lazy-init.
- **No ORM.** Raw SQL only. Schema is tiny.

### PKCE implementation detail
Spotify requires PKCE per [RFC 7636](https://tools.ietf.org/html/rfc7636):
- `code_verifier`: 43–128 URL-safe chars. Generate as `crypto.randomBytes(48).toString('base64url')` (Node built-in `crypto`, no library needed — gives 64 base64url chars, within spec).
- `code_challenge`: `Buffer.from(crypto.createHash('sha256').update(code_verifier).digest()).toString('base64url')`
- `code_challenge_method`: `S256`

Store `code_verifier` in an httpOnly cookie (`pkce_verifier`, `maxAge: 300`, `path: /auth/callback`) — no server-side session store needed.

### Spotify OAuth endpoints
```
Authorize: https://accounts.spotify.com/authorize
Token:     https://accounts.spotify.com/api/token
Me:        https://api.spotify.com/v1/me
```

Authorize URL params:
```
client_id, response_type=code, redirect_uri, scope, state (optional, skip for MVP), code_challenge, code_challenge_method=S256
```

Required scopes for Web Playback SDK + user identity:
```
streaming user-read-email user-read-private
```

Token exchange: POST to token endpoint with `Content-Type: application/x-www-form-urlencoded`, body:
```
grant_type=authorization_code, code, redirect_uri, client_id, code_verifier
```
No `Authorization` header needed for PKCE (no client_secret). This is intentional.

Token response fields to store:
- `access_token` — used for Spotify API calls
- `refresh_token` — used in Story 1.2 for silent refresh
- `expires_in` (seconds) — store as `token_expires_at = Date.now() + expires_in * 1000`

### Local dev redirect URI
Use `http://127.0.0.1:PORT/auth/callback` — NOT `http://localhost:PORT/auth/callback`. Spotify removed `localhost` support in Nov 2025. This URI must also be registered in the Spotify Developer Dashboard app settings.

### Session cookie
```ts
setCookie(ctx, 'session', host.user_id, {
  httpOnly: true,
  sameSite: 'Lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30  // 30 days
  // secure: true in production only — set based on NODE_ENV
})
```

Do NOT JWT-encode the session. Plain `user_id` in an httpOnly cookie is sufficient — the `requireAuth` middleware validates it against SQLite.

### Environment variables
```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=    # Not used in PKCE token exchange, but keep for future use
SPOTIFY_REDIRECT_URI=     # Full URI e.g. http://127.0.0.1:3000/auth/callback
SESSION_SECRET=           # For future signed cookies — wire up now, use later
PORT=3000
NODE_ENV=development
```

Validate all required vars at startup and crash fast with a clear message if missing.

### Project Structure Notes
No existing codebase — this is story 1.1, the greenfield start. Establish these paths as the canonical structure:
```
src/
  server/
    index.ts          ← Hono app + server entry
    db.ts             ← SQLite init + query helpers
    config.ts         ← env var loading/validation
    auth.ts           ← PKCE routes + middleware
  client/
    App.svelte        ← root component + routing
    pages/
      LoginPage.svelte
    lib/
      api.ts          ← fetch wrappers for /api/* endpoints
```

All future stories build on this layout. Do not deviate.

### References
- Spotify auth constraints: PKCE mandatory (Implicit Grant removed Nov 2025), `http://127.0.0.1` for local dev, no client_secret in PKCE token exchange [Source: memory/spotify_api_constraints_2026.md]
- Session cookie: httpOnly, server-side only — tokens never sent to client [Source: prd.md#NFR7]
- iOS disclaimer text and login screen layout [Source: ux-spec.md#Screen: Login / Setup]
- `session:connect` WS payload references `role: "host"` — the session cookie is how the server will identify host WS connections (wired in Epic 3, but cookie must exist from this story) [Source: ux-spec.md#WebSocket Event Contracts]
- MusicProvider abstraction is an Epic-level architectural requirement — this story does NOT implement it, but token storage schema must support it [Source: prd.md#NFR16]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- TypeScript initially configured with `moduleResolution: node` which doesn't allow `.ts` extensions in imports (used by tsx). Fixed by switching to `moduleResolution: bundler` with `allowImportingTsExtensions: true` and `noEmit: true`.

### Completion Notes List

- Project skeleton created from scratch: package.json, tsconfig.json, tsconfig.server.json, vite.config.ts, .gitignore, .env.example
- `src/server/config.ts`: validates 4 required env vars at startup; crashes with clear message if any missing
- `src/server/db.ts`: synchronous better-sqlite3, hosts table created on `initDb()` call; `upsertHost()` uses INSERT … ON CONFLICT; `getHostById()` for session lookup; `initDb(':memory:')` used in tests for isolation
- `src/server/auth.ts`: PKCE code_verifier via `crypto.randomBytes(48).toString('base64url')` (64 chars, within RFC 7636 spec); code_challenge via SHA-256 → base64url; pkce_verifier stored in httpOnly cookie (path=/auth/callback, maxAge=300); full callback error handling for Spotify errors, missing verifier, failed token exchange, failed /me fetch
- `src/server/index.ts`: Hono app with `authRouter` at `/auth`, `/api/me` protected by `requireAuth`, static serving in production via `@hono/node-server/serve-static`
- `src/client/App.svelte`: Svelte 5 SPA with `$state` for page routing; checks `/api/me` on mount for auth guard
- `src/client/pages/LoginPage.svelte`: "Connect Spotify" button + iOS disclaimer (small, muted); also checks session on mount to redirect if already authenticated
- `src/client/lib/api.ts`: `getMe()` fetch wrapper; returns null on 401, throws on other errors
- 14 tests: 3 db tests (insert, upsert, not-found), 11 auth tests (login redirect, PKCE cookie, 127.0.0.1 enforcement, callback error paths, successful exchange, requireAuth 401s and pass-through, /api/me protection)
- All 14 tests pass; TypeScript type-checks clean

### File List

- package.json
- tsconfig.json
- tsconfig.server.json
- vite.config.ts
- vitest.config.ts
- .gitignore
- .env.example
- src/server/index.ts
- src/server/config.ts
- src/server/db.ts
- src/server/auth.ts
- src/server/__tests__/db.test.ts
- src/server/__tests__/auth.test.ts
- src/client/index.html
- src/client/main.ts
- src/client/App.svelte
- src/client/pages/LoginPage.svelte
- src/client/lib/api.ts

### Review Findings

- [x] [Review][Patch] Unhandled exception when getMe() throws in App.svelte and LoginPage.svelte [src/client/App.svelte:10, src/client/pages/LoginPage.svelte:10] — both onMount handlers call getMe() without try/catch; non-401 errors (network failure, 5xx) leave page stuck at 'loading' forever
- [x] [Review][Patch] global.fetch mutated in test without cleanup [src/server/__tests__/auth.test.ts:87] — `global.fetch = vi.fn()` not restored after test; subsequent tests see the mock
- [x] [Review][Patch] tokenRes.json() / meRes.json() can throw on malformed Spotify response [src/server/auth.ts:90,104] — JSON parse errors propagate as unhandled 500 instead of redirecting to error page
- [x] [Review][Patch] upsertHost() not wrapped in try/catch in callback [src/server/auth.ts:115] — SQLite error leaves session cookie unset and pkce_verifier un-deleted; user gets 500 with no recovery path
- [x] [Review][Defer] SESSION_SECRET required but unused in session cookie signing [src/server/config.ts:12] — deferred, pre-existing; spec says "wire up now, use later"
- [x] [Review][Defer] No token expiration check in requireAuth [src/server/auth.ts:requireAuth] — deferred, pre-existing; Story 1.2 handles refresh explicitly
- [x] [Review][Defer] Tokens stored in plaintext SQLite [src/server/db.ts] — deferred, pre-existing; acceptable for friends-use MVP
- [x] [Review][Defer] No timeout on external Spotify fetch calls [src/server/auth.ts:85,100] — deferred, pre-existing; acceptable for MVP scope
- [x] [Review][Defer] refresh_token assumed present in Spotify token response [src/server/auth.ts:122] — deferred, pre-existing; PKCE auth code flow always returns refresh_token per Spotify docs

## Change Log

- 2026-04-03: Story 1.1 implemented from scratch — PKCE OAuth flow, SQLite session store, Svelte 5 SPA with auth guard, 14 tests passing
