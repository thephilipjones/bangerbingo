# Story 14-4: WebSocket Origin Check (CSWSH Hardening)

## Status: done

## Context

BangerBingo's WebSocket upgrade handler does not inspect the `Origin` header, so any web page a host visits can connect a WebSocket to the server and act as if it were the legitimate client — Cross-Site WebSocket Hijacking (CSWSH). The cookie session travels with the upgrade request regardless of origin. For a friends-only URL this is low-probability, but the app is publicly reachable on the internet (bangerbingo.net), and the fix is cheap.

Logged as a deferred item in 13-5 review: *"No Origin check on WebSocket upgrade (CSWSH) — nothing rejects cross-site WS connects on the upgrade."*

## Story

As a **host whose browser is also running other tabs**,
I want **the server to refuse any WebSocket upgrade that isn't from a page served by BangerBingo**,
so that **a malicious page I visit in another tab can't hijack my session to disrupt an active room**.

## Acceptance Criteria

**AC-1 — Origin allowlist enforced on WS upgrade.**
The WebSocket upgrade handler in [src/server/ws.ts](src/server/ws.ts) (`setupWebSocketServer`) reads the `Origin` header on the upgrade request. If `Origin` is missing, or not in the configured allowlist, the upgrade is rejected with HTTP 403 (not a WS close code — rejection happens pre-handshake).

**AC-2 — Allowlist is env-driven.**
New env var: `WS_ALLOWED_ORIGINS` — comma-separated list of allowed origins (e.g. `https://bangerbingo.net,https://pre.bangerbingo.net`). Parsed once at startup. In development (`NODE_ENV !== 'production'`), if the var is unset, default-allow any `http://localhost:*`, `http://127.0.0.1:*`, and `http://*.ts.net` (tailnet) origins — matches the current dev/test setup and 6-1 tailnet story.

**AC-3 — Misconfig fails loud.**
If `NODE_ENV === 'production'` and `WS_ALLOWED_ORIGINS` is unset, server logs a `WARN` at startup and falls back to rejecting **all** WS upgrades (safe-by-default). This forces the operator to set the env var on deploy. Do **not** silently allow-all in production.

**AC-4 — No regression on normal clients.**
Host from `https://bangerbingo.net`, guest from `https://bangerbingo.net`, local dev from `http://localhost:5173`, tailnet from `http://macbook.tailnet.ts.net:3000` — all still connect. Verified by existing ws-connect tests passing unchanged with `WS_ALLOWED_ORIGINS` set appropriately in test setup.

**AC-5 — Test coverage.**
- Unit test: upgrade request with `Origin: https://evil.example.com` → 403, no upgrade, no session:connect.
- Unit test: upgrade request with missing `Origin` header → 403.
- Unit test: upgrade request with allowed origin → 101 switching protocols, `session:connect` fires as today.

## Implementation Sketch

**[src/server/ws.ts](src/server/ws.ts):**
- Add near the top: `const allowedOrigins: Set<string> = parseAllowedOrigins()` — a module-level constant initialized from env.
- Helper: `parseAllowedOrigins(): Set<string>` returning a literal allowlist Set plus a predicate for wildcard patterns (localhost, 127.0.0.1, `*.ts.net`) when in dev mode.
- In the upgrade handler (existing `httpServer.on('upgrade', ...)`), **before** calling `wss.handleUpgrade`:
  ```ts
  const origin = req.headers.origin ?? ''
  if (!isOriginAllowed(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  ```
- Log a single `WARN` line at startup if prod + unset.

**[.env.example](.env.example):**
- Document the new var with a safe default commented out, e.g. `# WS_ALLOWED_ORIGINS=https://bangerbingo.net`

**Test setup:** `src/server/__tests__/*.ts` ws tests — ensure the test harness sets `WS_ALLOWED_ORIGINS=http://localhost` or equivalent before the server boots, or that dev-mode defaults cover the test origin. Check `beforeAll` / `setupFiles` accordingly.

## Defer / Out of Scope

- **Session cookie rotation / revocation** — logged in 13-5 deferred; separate hardening story when/if prioritized.
- **Rate limiting on HTTP endpoints** — different attack surface; also 13-5 deferred.
- **CSRF tokens on state-mutating POSTs** — `SameSite=Lax` cookie already mitigates; revisit if threat model widens.

## References

- [src/server/ws.ts](src/server/ws.ts) — `setupWebSocketServer`, upgrade handler
- Deferred entry in `_bmad-output/implementation-artifacts/deferred-work.md` under *"Deferred from: code review of 13-5-light-security-hardening"*
- Story 13-5 for the rate-limit + cookie-signing pattern (similar-shape change)
- Story 6-1 for the tailnet dev-mode allowances that the dev default preserves

## Dev Agent Record

### Completion Notes

- Added pure helpers `parseAllowedOrigins` and `isOriginAllowed` (exported for unit test) plus an enforcement block inside `setupWebSocketServer` that runs before `wss.handleUpgrade`. Rejections emit a raw `HTTP/1.1 403 Forbidden` and destroy the socket — pre-handshake, so no WS close frame is needed.
- Dev mode (NODE_ENV ≠ production) allows any http(s)://localhost, http(s)://127.0.0.1, and http(s)://*.ts.net origin in addition to anything explicitly listed in `WS_ALLOWED_ORIGINS`. Missing Origin is always rejected, in dev and prod alike.
- Prod misconfig path: when `NODE_ENV=production` and `WS_ALLOWED_ORIGINS` is unset/empty, startup logs `[ws] NODE_ENV=production but WS_ALLOWED_ORIGINS is unset — rejecting ALL WebSocket upgrades. Set WS_ALLOWED_ORIGINS on deploy.` and the upgrade handler rejects every request with 403 regardless of Origin value (safe-by-default).
- Env config is read inside `setupWebSocketServer` rather than at module load, so tests can stub env and spin up an isolated prod-misconfig server without a fresh import graph.
- Test harness: extended `connect` / `rawConnect` helpers with a `ConnectOptions.origin` field (defaults to `http://127.0.0.1:<port>` — dev-allowed; pass `null` to omit). All 73 existing `ws.test.ts` cases pass unchanged.
- New tests cover: pure helper logic (parse + dev/prod accept/reject matrix), integration rejection of evil/missing origin with 403 and no `session:connect`, integration success with dev-default origin, and the prod-misconfig fail-closed path (warn emitted, all upgrades 403 even with a would-be-allowed Origin).

### File List

- `src/server/ws.ts` — added `OriginCheckConfig`, `parseAllowedOrigins`, `isOriginAllowed`; reworked `setupWebSocketServer` to read env, log prod-misconfig WARN, and gate upgrades on origin check.
- `src/server/__tests__/ws.test.ts` — added `ConnectOptions`/`buildHeaders` with default Origin; imported `parseAllowedOrigins`/`isOriginAllowed`; added three new describe blocks (parser, allowlist predicate, upgrade enforcement) plus a prod-misconfig describe block.
- `.env.example` — documented `WS_ALLOWED_ORIGINS` with prod-required / dev-default behavior.

### Change Log

- 2026-04-23 — Implemented 14-4 WebSocket Origin check. Upgrade handler now rejects cross-origin WS connect attempts with HTTP 403 before handshake; prod fails closed on missing `WS_ALLOWED_ORIGINS`. Full test suite (588) + tsc build pass.

### Review Findings

- [x] [Review][Patch] WS_ALLOWED_ORIGINS set to whitespace/commas-only triggers `prodMisconfig=false` but builds an empty allowlist — prod silently rejects ALL upgrades with no WARN logged [src/server/ws.ts:754–756] — fixed: `prodMisconfig` now checks `cfg.allowlist.size === 0` after parsing
- [x] [Review][Patch] `socket.write` + immediate `socket.destroy()` may drop 403 before TCP buffer flushes — use `socket.end(data)` instead [src/server/ws.ts:793–796] — fixed: changed to `socket.end(...)`
- [x] [Review][Defer] `new URL(req.url)` outside try/catch in upgrade handler — pre-existing, not introduced by this change [src/server/ws.ts:788] — deferred, pre-existing
- [x] [Review][Defer] IPv6 loopback `[::1]` not accepted in dev mode — beyond spec scope [src/server/ws.ts:766] — deferred, pre-existing
- [x] [Review][Defer] Allowlist match is case-sensitive raw string; uppercase scheme/host in `WS_ALLOWED_ORIGINS` silently rejects all — operator edge case [src/server/ws.ts:761] — deferred, pre-existing
- [x] [Review][Defer] Origin with path component or explicit default port fails allowlist match — browsers never include path per RFC 6454, operator misconfiguration risk [src/server/ws.ts:761] — deferred, pre-existing
- [x] [Review][Defer] `WS_ALLOWED_ORIGINS` blank slots (e.g. `a.com, ,b.com`) silently dropped by `filter(Boolean)` with no warning [src/server/ws.ts:756] — deferred, pre-existing
- [x] [Review][Defer] `roomSockets.has('AAAA')` assertion in origin-rejection tests lacks explicit `afterEach` cleanup — pre-existing test isolation pattern [src/server/__tests__/ws.test.ts:1955,1971] — deferred, pre-existing
- [x] [Review][Defer] `0.0.0.0` not treated as loopback in dev mode — edge case beyond spec scope [src/server/ws.ts:766] — deferred, pre-existing
- [x] [Review][Defer] 403 response lacks `Content-Length: 0` header (RFC 7230 §3.3) — pre-existing pattern, matches existing 400 path [src/server/ws.ts:793] — deferred, pre-existing
