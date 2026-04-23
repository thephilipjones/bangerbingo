# Story 14-4: WebSocket Origin Check (CSWSH Hardening)

## Status: ready-for-dev

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
