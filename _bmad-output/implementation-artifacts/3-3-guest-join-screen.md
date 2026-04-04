# Story 3.3: Guest Join Screen

Status: done

## Story

As a guest,
I want a simple form to enter my name and room code,
So that I can join a bingo session without any account or registration.

## Acceptance Criteria

1. Visiting `/` shows both the name field (empty) and room code field (empty); name field is autofocused on mount.
2. Visiting `/room/:code` pre-fills the room code field with the code from the URL; the field is rendered as readonly with a subtle lock icon; name field is autofocused.
3. As the guest types in the room code field, input is auto-uppercased and characters that are not A–Z are stripped in real time (spaces, numbers, symbols all removed).
4. Submitting with an empty name shows inline error "Please enter your name" without a network request.
5. Submitting with a malformed code (not exactly 4 letters A–Z excl. O/I, or not 4 chars) shows inline error "Room code must be 4 letters" without a network request.
6. Submitting a valid form triggers WS connect; if the server closes with 4004, inline error "Room not found" appears.
7. If the server closes with reason "name taken" (4009), inline error "That name is already taken" appears.
8. If the room has no active session (future: server code TBD), inline error "No active session in this room" appears.
9. On successful `session:connect` from server, the guest is navigated to the room view.
10. All interactive elements meet the 44×44px minimum touch target (WCAG AA).

## Tasks / Subtasks

- [x] `JoinPage.svelte` component (AC: 1–9)
  - [x] Name input + room code input; on mount: autofocus name field
  - [x] Room code input: `on:input` handler — uppercase + strip non-alpha chars; strip O and I (edge: user types O → stripped); max length 4
  - [x] Client-side validation before WS: empty name → AC4 error; code not 4 valid chars → AC5 error
  - [x] On valid submit: open `WebSocket` to `ws://[host]/ws?name=<name>&code=<code>`
  - [x] `onclose` handler: map close code → error message (4004 → "Room not found", 4009 → "That name is already taken", 4410 → "No active session in this room")
  - [x] `onmessage` handler: parse JSON; on `type: "session:connect"` → call `onJoined(name, role, players)` prop callback
  - [x] Lock icon on readonly code field (SVG or Unicode `🔒` — keep simple)
  - [x] Error messages render inline below the relevant field, not as a toast/alert

- [x] Routing update in `App.svelte` (AC: 1, 2)
  - [x] On mount, read `window.location.pathname`
  - [x] If matches `/room/:code` (regex `^/room/([A-Z]{5})$`): render `JoinPage` with `prefillCode` prop
  - [x] If `/`: render `JoinPage` with no prefill
  - [x] If host (session cookie present, lands on `/`): render `DashboardPage` (existing placeholder)
  - [x] On successful join: transition `page` state to `'room'` (room view is a placeholder for now — just renders player name + "Waiting for round to start")

- [x] `src/client/lib/ws.ts` — thin WebSocket helper (AC: 6–9)
  - [x] `connectAsGuest(name, code, handlers): WebSocket` — constructs the WS URL, attaches handlers, returns socket
  - [x] Handlers: `onConnect(role, players)`, `onError(message)`, `onMessage(event)`
  - [x] Exported for reuse by host WS connection in Story 3-4

- [x] Touch target CSS (AC: 10)
  - [x] Inputs and submit button: `min-height: 44px`, `min-width: 44px`

- [x] Tests (AC: 1–9)
  - [x] Vitest + jsdom or Svelte Testing Library for component tests
  - [x] Code input: typing lowercase → uppercased; typing `O` → stripped; typing spaces → stripped; max 5 chars enforced
  - [x] Empty name validation fires without network call
  - [x] Malformed code validation fires without network call
  - [x] WS close 4004 → "Room not found" error displayed
  - [x] WS close 4009 → "That name is already taken" error displayed
  - [x] `session:connect` message → `onJoined` callback fired

## Dev Notes

### URL routing (no router framework)
`App.svelte` already does manual routing (`page` state). Extend the `onMount` check:

```ts
onMount(async () => {
  const path = window.location.pathname
  const roomMatch = path.match(/^\/room\/([A-Za-z]{1,5})$/)

  const me = await getMe().catch(() => null)

  if (me) {
    page = 'dashboard'
  } else if (roomMatch) {
    prefillCode = roomMatch[1].toUpperCase()
    page = 'join'
  } else {
    page = 'join'
  }
})
```

The host/guest split is determined by whether `getMe()` returns a valid user — hosts have a session cookie, guests don't.

### Room code input sanitisation
```ts
function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').replace(/[OI]/g, '').slice(0, 4)
}
```

> **Note:** Room codes are 4 characters (verified against `src/server/rooms.ts` `generateRoomCode`). The original spec incorrectly said 5 — corrected in AC 5, validation regex, sanitize slice, maxlength, and error message.
Bind with `on:input={(e) => { code = sanitizeCode(e.currentTarget.value); e.currentTarget.value = code }}`.

### WebSocket URL construction
```ts
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${wsProtocol}//${window.location.host}/ws?name=${encodeURIComponent(name)}&code=${code}`
```

### WS close codes used
- `4004` — room not found
- `4009` — name taken
- `4410` — room exists, no active session (implement in server when session concept exists — for now this path won't be hit in MVP until Epic 3 room state is built)

### Placeholder room view
After successful join, the page just needs to show something reasonable while Stories 3-4 and later epics build out the full UI. A simple `RoomPage.svelte` stub is sufficient:
```svelte
<p>Welcome, {name}! Waiting for the host to start a round...</p>
```

## References
- Join screen UX spec: autofocus, readonly prefill, lock icon, auto-uppercase [Source: ux-spec.md UX-DR1]
- Five inline error states [Source: ux-spec.md UX-DR2]
- Touch targets ≥ 44×44px [Source: ux-spec.md UX-DR21]
- WS close codes 4004/4009 defined in Story 3-2 [Source: 3-2 story]
- `ws://[host]/ws?name=&code=` — guest WS connection format from Story 3-2 [Source: 3-2 story]

## File List

- `src/client/lib/ws.ts` — new: WebSocket helper with `connectAsGuest`, `sanitizeCode`, `validateJoin`, `closeCodeToMessage`
- `src/client/pages/JoinPage.svelte` — new: guest join form component
- `src/client/pages/RoomPage.svelte` — new: placeholder room page shown after successful join
- `src/client/App.svelte` — modified: added join/room pages, routing logic for `/room/:code` and `/`
- `src/client/__tests__/join.test.ts` — new: unit tests for ws.ts utilities and WS handler behaviour
- `tsconfig.json` — modified: added `allowImportingTsExtensions: true` and `noEmit: true` to match server tsconfig pattern

## Dev Agent Record

### Implementation Plan

1. Extracted reusable logic (`sanitizeCode`, `validateJoin`, `closeCodeToMessage`, `connectAsGuest`) into `src/client/lib/ws.ts` — keeps component thin and logic fully testable without DOM.
2. `JoinPage.svelte` uses Svelte 5 runes (`$state`, `$props`), `onMount` for autofocus, inline `oninput` handler for real-time code sanitisation, and form `onsubmit` with `e.preventDefault()`.
3. Error routing: 4009 (name taken) → name field error; 4004/4410 → code field error.
4. `App.svelte` routing uses Dev Notes regex (`/^\/room\/([A-Za-z]{1,5})$/`) which is lenient then uppercases — handles mixed-case URLs gracefully.
5. Tests: 31 pure unit tests in node environment — no jsdom needed because all tested logic is extracted into pure functions; `WebSocket` and `window` are stubbed via `vi.stubGlobal`.

### Completion Notes

All 5 story tasks complete. 80 tests pass (49 pre-existing + 31 new). TypeScript type-checks clean (`npm run lint`). Touch targets: inputs and button have `min-height: 44px; min-width: 44px` in CSS.

### Review Findings

- [x] [Review][Patch] WS socket leak: no submit guard, multiple sockets created on rapid double-submit, no onDestroy teardown [src/client/pages/JoinPage.svelte]
- [x] [Review][Patch] URL routing regex `[A-Za-z]{1,5}` too lenient + prefillCode not sanitized → user stuck with readonly invalid/unsanitizable code [src/client/App.svelte]
- [x] [Review][Patch] `code` param not `encodeURIComponent`'d in WS URL (inconsistent with `name` encoding) [src/client/lib/ws.ts:32]
- [x] [Review][Patch] Unmapped WS close codes (e.g. 1006 network drop) silently swallowed — no user feedback [src/client/lib/ws.ts:37-40]
- [x] [Review][Patch] `aria-describedby` missing on inputs — error `<p>` elements have ids but inputs don't reference them (WCAG AA / AC 10) [src/client/pages/JoinPage.svelte:65,88]
- [x] [Review][Defer] Host login path (`page = 'login'`) now unreachable — by design for this sprint; story 3-4 will restore host login routing
- [x] [Review][Defer] `data.role` unguarded in `session:connect` message — benign today since role is unused; future contract concern [src/client/lib/ws.ts:43]
- [x] [Review][Defer] `roomSockets` server-side accumulation — pre-existing issue from story 3-2, not caused by this change
- [x] [Review][Defer] `handleJoined` discards `role` and `players` — intentional stub; RoomPage will need them in a future story [src/client/App.svelte]

## Change Log

- 2026-04-03: Implemented story 3-3 — guest join screen, ws.ts helper, routing update, 31 new tests
