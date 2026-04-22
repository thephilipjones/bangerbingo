# Story 13-7: Host / Guest / Neither Identity Flow

## Status: Done

## Context

Once authenticated, users have no clean path back to the join page or to experience the app as a guest. The `/` URL is polymorphic — it shows Dashboard for authenticated users and the Join form for unauthenticated users — which causes confusion when testing across devices (especially on mobile Safari where clearing cookies requires digging through settings). Additionally, when an authenticated Host 1 navigates to `/{code}` belonging to Host 2's session, the WS is rejected with 4003 but the client shows a silent error banner with no graceful fallback.

This story establishes a clear three-state identity model:

| State | URL | Gets there via |
|---|---|---|
| **Host** | `/host` | Login / OAuth callback |
| **Guest** | `/` | "Join a Session" button or direct visit |
| **Neither** | `/` | Reset Host (full clear) |

No new dependencies, no DB schema changes, no new API endpoints.

---

## Changes

### A — Move Dashboard to `/host`; `/` always shows Join

**File:** `src/client/lib/ws.ts` — `determineInitialPage`

**Current:**
```ts
if (me) return { page: 'dashboard' }
return { page: 'join' }
```

**New:**
```ts
if (pathname === '/host') {
  return me ? { page: 'dashboard' } : { page: 'login' }
}
// /{code} branch unchanged
// All other paths including / → always join
return { page: 'join' }
```

Full function after change:
```ts
export function determineInitialPage(
  me: MeResponse | null,
  pathname: string
): { page: Page; prefillCode?: string; roomCode?: string } {
  if (pathname === '/host') {
    return me ? { page: 'dashboard' } : { page: 'login' }
  }
  const roomMatch = pathname.match(/^\/([A-HJ-NP-Za-hj-np-z]{4})$/)
  if (roomMatch) {
    const code = sanitizeCode(roomMatch[1])
    if (me) return { page: 'lobby', roomCode: code }
    return { page: 'join', prefillCode: code }
  }
  return { page: 'join' }
}
```

The server catch-all at `src/server/index.ts:52` already serves `index.html` for any unmatched route — `/host` works without any server change.

---

### B — Fix OAuth callback redirect

**File:** `src/server/auth.ts` — `GET /auth/callback` success path (currently line 198)

Change:
```ts
return ctx.redirect('/')
```
To:
```ts
return ctx.redirect('/host')
```

---

### C — Fix App.svelte routing handlers for `/host`

**File:** `src/client/App.svelte`

All handlers that navigate back to Dashboard must push `/host` to the history stack:

```ts
function handleAuthenticated() {
  history.pushState(null, '', '/host')
  page = 'dashboard'
}

function handleBackToDashboard() {
  history.pushState(null, '', '/host')
  page = 'dashboard'
}

function handleSessionEnded() {
  history.pushState(null, '', '/host')
  page = 'dashboard'
}
```

`handleGuestLeave` already pushes to `/` with `page = 'join'` — no change needed.

---

### D — Add "Join a Session" button to Dashboard

**File:** `src/client/App.svelte`

Add handler:
```ts
function handleJoinAsGuest(code?: string) {
  prefillCode = code ?? ''
  history.pushState(null, '', code ? `/${code}` : '/')
  page = 'join'
}
```

Update DashboardPage usage:
```svelte
<DashboardPage onEnterLobby={handleEnterLobby} onJoinAsGuest={() => handleJoinAsGuest()} />
```

Update LobbyPage usage:
```svelte
<LobbyPage code={currentRoomCode} onRoundStarted={handleRoundStarted} onBackToDashboard={handleBackToDashboard} onJoinAsGuest={handleJoinAsGuest} />
```

**File:** `src/client/pages/DashboardPage.svelte`

Add `onJoinAsGuest` to props:
```ts
let { onEnterLobby, onJoinAsGuest }: {
  onEnterLobby: (code: string) => void
  onJoinAsGuest: () => void
} = $props()
```

Add "Join a Session" button in the template, positioned between "Start New Session" and the room list — **not** in the danger row. This is a neutral navigation action, not destructive:
```svelte
<Button variant="ghost" size="lg" onclick={onJoinAsGuest}>Join a Session</Button>
```

The JoinPage already has an `onHostLogin` button that routes back to Login → Dashboard. The round-trip works with zero additional logic.

---

### E — Fix Reset Host: clear server-side tokens + use replace()

**File:** `src/server/auth.ts` — `POST /auth/logout`

Import `clearHostTokens` (add to existing db import):
```ts
import { upsertHost, getHostById, clearHostTokens, type Host } from './db.ts'
```

Update the handler:
```ts
authRouter.post('/logout', (ctx) => {
  const cookie = getCookie(ctx, 'session')
  const userId = cookie ? verifySession(cookie) : null
  if (userId) {
    try { clearHostTokens(userId) } catch { /* no-op: cookie cleared regardless */ }
  }
  deleteCookie(ctx, 'session', { path: '/' })
  return ctx.body(null, 204)
})
```

The try/catch ensures the logout succeeds even if the host record has already been removed or the userId is invalid.

**File:** `src/client/pages/DashboardPage.svelte` — `handleResetHost`

Change:
```ts
window.location.href = '/'
```
To:
```ts
window.location.replace('/')
```

`replace()` prevents the pre-logout dashboard page from entering the browser's bfcache history stack, which is the likely cause of mobile Safari occasionally serving a stale authenticated dashboard after logout.

---

### F — Add `onDead` callback to wsClient

**File:** `src/client/lib/wsClient.ts` — `WsClientOptions` interface

Add optional callback:
```ts
export interface WsClientOptions {
  url: string
  onMessage: (data: unknown) => void
  onStateChange?: (state: WsState) => void
  onDead?: (closeCode: number) => void   // fired once when state transitions to 'dead'
  existingSocket?: WebSocket
  // ... rest unchanged
}
```

In the `onClose` handler (around line 95), wherever `setState('dead')` is called, also fire the callback. There are two paths — cover both:

```ts
const onClose = (ev: { code: number } | CloseEvent) => {
  if (disposed || ws !== sock) return
  ws = null
  const code = (ev as { code: number }).code
  if (code === 1000 || (code >= 4000 && code < 5000)) {
    setState('dead')
    options.onDead?.(code)     // <-- new
    stopWatchdog()
    return
  }
  // ... retry path (no onDead here — not terminal yet)
  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    setState('dead')
    options.onDead?.(code)     // <-- new
    stopWatchdog()
    return
  }
  // ...
}
```

---

### G — Handle 4003 in LobbyPage → fall through to guest join

**File:** `src/client/pages/LobbyPage.svelte`

Add `onJoinAsGuest` to props:
```ts
let {
  code,
  onRoundStarted,
  onBackToDashboard,
  onJoinAsGuest,
}: {
  code: string
  onRoundStarted: () => void
  onBackToDashboard: () => void
  onJoinAsGuest?: (code: string) => void
} = $props()
```

Wire `onDead` when creating the WS client:
```ts
wsClient = createWsClient({
  url,
  onMessage: handleWsMessage,
  onStateChange: (s) => { wsState = s },
  onDead: (closeCode) => {
    if (closeCode === 4003) onJoinAsGuest?.(code)
  },
})
```

No other LobbyPage changes needed. The 4003 rejection happens fast (server rejects on WS upgrade), so the user will see a brief flash of the lobby UI before the redirect — acceptable.

---

## Acceptance Criteria

**AC 1 — `/host` routes authenticated users to Dashboard**
Given a valid session cookie, navigating to `/host` shows the Dashboard page.

**AC 2 — `/host` redirects unauthenticated users to Login**
Given no session cookie, navigating to `/host` shows the Login page.

**AC 3 — `/` always shows Join regardless of auth**
Given a valid session cookie, navigating to `/` shows the Join page (not Dashboard). The session cookie is intact; navigating to `/host` returns to Dashboard.

**AC 4 — OAuth callback lands on `/host`**
After completing Spotify OAuth, the browser is redirected to `/host`, not `/`.

**AC 5 — "Join a Session" button appears on Dashboard**
The Dashboard has a "Join a Session" button. Tapping it navigates to the Join page (client-side; no auth change; URL becomes `/`).

**AC 6 — JoinPage → "Host Login" round-trip still works**
From the Join page (reached via "Join a Session"), tapping "Host Login" returns to Login → Dashboard at `/host`.

**AC 7 — Reset Host clears Spotify tokens server-side**
After Reset Host, the host record in the DB has empty tokens (`access_token = ''`, `refresh_token = ''`). The Spotify "Connected" pill shows "Disconnected" after re-login until Spotify is re-authorized.

**AC 8 — Reset Host uses `location.replace` (no bfcache re-entry)**
After Reset Host, the pre-logout dashboard page is not reachable via the back button.

**AC 9 — Host 1 visiting Host 2's `/{code}` falls through to Guest Join**
Given Host 1 is authenticated and navigates to a room code owned by Host 2, the WS is rejected with 4003, and the client redirects Host 1 to the Join page with the code pre-filled.

**AC 10 — Existing host self-navigation to own `/{code}` still works**
Given an authenticated host navigates to their own room code URL, they reach the Lobby as host (unchanged behaviour).

---

## Files Modified

- `src/client/lib/ws.ts` — `determineInitialPage` (Change A)
- `src/server/auth.ts` — OAuth callback redirect + logout token clear (Changes B, E)
- `src/client/App.svelte` — routing handlers + `handleJoinAsGuest` (Changes C, D)
- `src/client/pages/DashboardPage.svelte` — "Join a Session" button + `location.replace` (Changes D, E)
- `src/client/lib/wsClient.ts` — `onDead` callback (Change F)
- `src/client/pages/LobbyPage.svelte` — 4003 fallback (Change G)

---

## Tests

### Update existing tests

**`src/client/__tests__/dashboard.test.ts`** — `determineInitialPage` describe block:

The test `'routes to dashboard when getMe() returns a user (skips login screen)'` currently asserts `page === 'dashboard'` for `determineInitialPage(user, '/')`. **Update** it to assert `page === 'join'` and rename to `'routes to join at / when authenticated (/ always shows join)'`.

Add new tests to the same describe block:
```ts
it('routes to dashboard at /host when authenticated', () => {
  expect(determineInitialPage(user, '/host').page).toBe('dashboard')
})

it('routes to login at /host when unauthenticated', () => {
  expect(determineInitialPage(null, '/host').page).toBe('login')
})

it('routes to join at / when authenticated (root always shows join)', () => {
  expect(determineInitialPage(user, '/').page).toBe('join')
})
```

The existing lobby + prefill tests (`/{code}` paths) are unchanged.

### New auth tests

**`src/server/__tests__/auth.test.ts`** — add a new describe block for `POST /auth/logout`:

```ts
describe('POST /auth/logout', () => {
  beforeEach(() => { initDb(':memory:') })

  it('clears session cookie and returns 204', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)
    upsertHost({ user_id: 'u1', ... })  // seed a host
    const cookie = `session=${signUserId('u1')}`
    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(204)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('session=')
    expect(setCookie).toMatch(/Max-Age=0|expires=.*1970/i)
  })

  it('clears Spotify tokens for authenticated host on logout', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)
    upsertHost({ user_id: 'u1', access_token: 'tok', refresh_token: 'ref', token_expires_at: Date.now() + 60_000, display_name: 'Philip', email: '' })
    const cookie = `session=${signUserId('u1')}`
    await app.request('/auth/logout', { method: 'POST', headers: { Cookie: cookie } })
    const host = getHostById('u1')
    expect(host?.access_token).toBe('')
    expect(host?.refresh_token).toBe('')
  })

  it('returns 204 even with no session cookie (graceful)', async () => {
    const app = new Hono()
    app.route('/auth', authRouter)
    const res = await app.request('/auth/logout', { method: 'POST' })
    expect(res.status).toBe(204)
  })
})
```

Import `getHostById` at the top of the test file (it's already exported from `db.ts`).

### New wsClient tests

**`src/client/__tests__/wsClient.test.ts`** — add to the existing `'fatal application close codes'` describe block or add a new one:

```ts
describe('createWsClient — onDead callback', () => {
  it('fires onDead with close code when entering dead via 4xxx code', () => {
    const deadCodes: number[] = []
    const { client } = makeHarness({ onDead: (c) => deadCodes.push(c) })
    latest().simulateDrop(4003)
    expect(client.getState()).toBe('dead')
    expect(deadCodes).toEqual([4003])
  })

  it('fires onDead with close code when entering dead via max failures', () => {
    const deadCodes: number[] = []
    const { client } = makeHarness({ onDead: (c) => deadCodes.push(c) })
    for (let i = 0; i < 5; i++) {
      if (i > 0) vi.advanceTimersByTime(16_000)
      latest().simulateDrop(1006)
    }
    expect(client.getState()).toBe('dead')
    expect(deadCodes.length).toBe(1)
  })

  it('does not fire onDead if not provided', () => {
    const { client } = makeHarness()  // no onDead
    expect(() => latest().simulateDrop(4003)).not.toThrow()
    expect(client.getState()).toBe('dead')
  })
})
```

`makeHarness` will need to accept `onDead` in its options object and pass it through to `createWsClient`. Check how `makeHarness` is defined in the existing test file and extend it accordingly.

---

## Deferred Work Updates

Upon completion, remove from `deferred-work.md`:
- "Authenticated host navigating to `/room/CODE` lands on dashboard" (under "Deferred from: code review of 3-4")
- "No test for `determineInitialPage` priority ordering (authenticated + /room/:code path)" (under "Deferred from: code review of 7-1")

---

## Dev Notes

- The `Disconnect Spotify` button on Dashboard remains unchanged. It clears tokens but keeps the session cookie — intentional, for switching Spotify accounts without full logout.
- `clearHostTokens` throws if the host is not found in DB (see `db.ts:100`). The try/catch in the logout handler absorbs this — e.g., if a cookie with an invalid signature somehow reaches the route, `verifySession` returns null and we skip the clear entirely. No user-facing regression.
- The `onJoinAsGuest` prop on LobbyPage is optional (`?`). If App.svelte doesn't wire it, a 4003 rejection silently leaves the user on the dead-state banner — same behaviour as today. Wire it.
- Do not change the `/{code}` + auth → lobby routing. Hosts navigate to their own room URLs frequently (e.g., from bookmarks, shared links). The 4003 fallback in LobbyPage handles the "wrong host" case without complicating the routing logic.
- `window.location.replace('/')` vs `window.location.href = '/'`: both navigate, but `replace` does not add an entry to the session history stack. This prevents mobile Safari's back-forward cache from serving the stale authenticated dashboard if the user taps Back after a Reset Host.

---

## Dev Agent Record

### Completion Notes (2026-04-21)

- [x] Change A — `determineInitialPage` routes `/host` → dashboard/login, `/` → always join.
- [x] Change B — OAuth callback redirects to `/host`.
- [x] Change C — App.svelte `handleAuthenticated` / `handleSessionEnded` / `handleBackToDashboard` push `/host`.
- [x] Change D — Added `handleJoinAsGuest` + "Join a Session" button on Dashboard; wired through LobbyPage prop.
- [x] Change E — `POST /auth/logout` clears Spotify tokens via `clearHostTokens` (wrapped in try/catch); Dashboard uses `location.replace('/')`.
- [x] Change F — `onDead(closeCode)` added to `createWsClient`; fires once in both terminal paths (1000/4xxx close and max failures).
- [x] Change G — LobbyPage redirects host to guest Join with pre-filled code when the WS dies with 4003.

### File List

- Modified: `src/client/lib/ws.ts`
- Modified: `src/client/lib/wsClient.ts`
- Modified: `src/client/App.svelte`
- Modified: `src/client/pages/DashboardPage.svelte`
- Modified: `src/client/pages/LobbyPage.svelte`
- Modified: `src/server/auth.ts`
- Modified: `src/client/__tests__/dashboard.test.ts`
- Modified: `src/client/__tests__/wsClient.test.ts`
- Modified: `src/server/__tests__/auth.test.ts`
- Modified: `_bmad-output/implementation-artifacts/deferred-work.md`
- Modified: `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-04-21 — Implemented Host/Guest/Neither identity flow across client routing, OAuth callback, logout, and LobbyPage 4003 fallback. All 517 tests pass.

### Review Findings

- [x] [Review][Defer] `clearHostTokens` errors silently swallowed in logout [src/server/auth.ts] — deferred, pre-existing
- [x] [Review][Defer] `verifySession` length-check short-circuits before `timingSafeEqual` [src/server/auth.ts] — deferred, pre-existing
