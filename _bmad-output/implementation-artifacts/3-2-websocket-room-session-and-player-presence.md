# Story 3.2: WebSocket Room Session & Player Presence

Status: done

## Story

As a host or guest,
I want my connection to be recognised by the server and all player arrivals and departures broadcast in real time,
So that everyone in the room always sees an accurate player list.

## Acceptance Criteria

1. A host connecting to the WebSocket sends `session:connect` with their session cookie; the server responds with `{ type: "session:connect", role: "host", players: string[] }`.
2. A guest connecting sends `session:connect` with `{ name, code }`; the server responds with `{ type: "session:connect", role: "guest", players: string[] }` and broadcasts `{ type: "player:joined", name }` to all other clients in the room.
3. When a guest disconnects, all remaining clients in the room receive `{ type: "player:left", name }` within 200ms.
4. When a guest reconnects with the same name, the server restores their slot (does not create a duplicate) and broadcasts `player:joined` again.
5. The host's player list (returned in `session:connect` and updated via `player:joined`/`player:left`) is always accurate — it reflects only currently-connected guests.
6. If the room code does not exist, the server closes the WebSocket with code 4004 and reason `"room not found"`.
7. If the name is already taken by a currently-connected guest, the server closes the WebSocket with code 4009 and reason `"name taken"`.
8. If `auth:degraded` fires for the room's host, the server broadcasts `{ type: "auth:degraded" }` to all clients in the room.
9. The server manages connections using a native WebSocket room map — no external pub/sub, no socket.io.

## Tasks / Subtasks

- [x] In-memory room state (AC: 1–5, 9)
  - [x] Create `src/server/ws.ts` — owns the room connection map
  - [x] `roomSockets: Map<roomCode, { host: WebSocket | null, guests: Map<name, WebSocket> }>`
  - [x] `broadcast(roomCode, payload, exclude?)` helper — send JSON to all sockets in room, skip `exclude` if provided
  - [x] `getPlayerList(roomCode): string[]` — returns names of currently-connected guests

- [x] WebSocket upgrade route (AC: 1, 2, 6, 7, 9)
  - [x] `GET /ws` — upgrade handler using `ws` package's `WebSocketServer` with `noServer: true` + HTTP server `upgrade` event (note: `@hono/node-server` v1.19 does not export `/ws`; used `ws` package directly)
  - [x] On `open`: read query params (`?code=XXXXX`) and session cookie to determine role
    - Host path: valid session cookie + room owned by this host → add to `roomSockets[code].host`; send `session:connect` with `role: "host"` + current player list
    - Guest path: `?name=<name>&code=<code>` → validate room exists (4004), validate name not taken (4009), add to `roomSockets[code].guests`; send `session:connect` with `role: "guest"` + player list; broadcast `player:joined` to others
  - [x] On `close`:
    - If host: set `roomSockets[code].host = null`; broadcast `host:disconnected` (Story 3-5 wires the freeze logic — here just broadcast)
    - If guest: remove from guests map; broadcast `player:left` to remaining clients
  - [x] Mount in `src/server/index.ts`

- [x] Wire `auth:degraded` to WS broadcast (AC: 8)
  - [x] In `ws.ts`, listen on `authEvents` (already exported from `refresh.ts`): `authEvents.on('degraded', userId => { /* find room for this host, broadcast auth:degraded */ })`
  - [x] To find room by host: add `getHostRoom(userId): string | undefined` helper in `ws.ts` that searches `roomSockets`

- [x] Tests (AC: 1–8)
  - [x] Use `ws` package to create test WebSocket clients against the running test server
  - [x] Host connect: valid session → receives `session:connect` with `role: "host"`
  - [x] Guest connect: valid name + code → receives `session:connect` with `role: "guest"`; other connected clients receive `player:joined`
  - [x] Guest disconnect: remaining clients receive `player:left`
  - [x] Room not found: WS closes with 4004
  - [x] Name taken: WS closes with 4009
  - [x] `auth:degraded` event: emitting on `authEvents` causes broadcast to room clients

### Review Findings

- [x] [Review][Patch] Missing `ws.on('error')` handler — unhandled error events will crash the Node.js process [src/server/ws.ts — host and guest connection paths]
- [x] [Review][Patch] Host reconnect overwrites old socket reference without closing it — old TCP connection is leaked until the underlying connection drops [src/server/ws.ts — host path ~line 90]
- [x] [Review][Patch] Guest name with only whitespace (e.g. `?name=%20%20`) passes the `!name` guard and is stored/broadcast — no server-side normalization [src/server/ws.ts:95]
- [x] [Review][Patch] `socket.destroy()` sends a TCP RST with no prior HTTP 400 response — browsers/proxies cannot distinguish this from a connectivity failure [src/server/ws.ts:153-155]
- [x] [Review][Patch] `broadcast()` has no try/catch around `socket.send()` — one failing socket aborts delivery to all remaining sockets in the loop [src/server/ws.ts:22-30]
- [x] [Review][Patch] Host connecting with both a session cookie and a `?name=` query param is silently routed to the guest path — host slot never set, no rejection [src/server/ws.ts:64]
- [x] [Review][Patch] `delay(20)` in reconnect test is an arbitrary wall-clock wait — will be flaky on slow CI [src/server/__tests__/ws.test.ts:290]
- [x] [Review][Patch] `connect()` helper registers `ws.once('close', ...)` that is never removed after `open` fires — calls `reject` on an already-settled Promise for any post-open close event [src/server/__tests__/ws.test.ts:161]
- [x] [Review][Defer] Session cookie value used as literal user ID — no HMAC signing; pre-existing auth pattern established in Story 3-1, acceptable for MVP [src/server/ws.ts:55] — deferred, pre-existing
- [x] [Review][Defer] `getHostRoom` is O(n) linear scan over all rooms — not a correctness concern at this scale [src/server/ws.ts:38-42] — deferred, pre-existing
- [x] [Review][Defer] `roomSockets` entries never pruned — in-memory room state grows without bound across server lifetime [src/server/ws.ts] — deferred, pre-existing
- [x] [Review][Defer] `auth:degraded` event listener registered at module load and never removed — acceptable for production singleton [src/server/ws.ts:139] — deferred, pre-existing
- [x] [Review][Defer] `parseCookies` does not strip RFC 6265 quoted cookie values — session cookie writer does not produce quoted values in practice [src/server/ws.ts:46-50] — deferred, pre-existing
- [x] [Review][Defer] `getPlayerList` may include sockets in CLOSING state — near-instant transition, single-threaded JS, no real exposure [src/server/ws.ts:32-35] — deferred, pre-existing
- [x] [Review][Defer] No maximum guest count enforced — out of scope for personal MVP [src/server/ws.ts] — deferred, pre-existing
- [x] [Review][Defer] `setupWebSocketServer` called twice on the same `httpServer` would double-handle upgrades — not a real production scenario [src/server/ws.ts:143] — deferred, pre-existing
- [x] [Review][Defer] `roomSockets.hostUserId` set from `room.host_user_id` which could be null if DB schema permits — pre-existing schema concern [src/server/ws.ts:107] — deferred, pre-existing

## Dev Notes

### Hono WebSocket with node adapter
`@hono/node-server` exposes `createNodeWebSocket` for upgrading HTTP connections to native WebSockets:

```ts
import { createNodeWebSocket } from '@hono/node-server/ws'
import { serve } from '@hono/node-server'

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/ws', upgradeWebSocket((c) => {
  return {
    onOpen(evt, ws) { /* ... */ },
    onMessage(evt, ws) { /* ... */ },
    onClose(evt, ws) { /* ... */ },
  }
}))

serve({ fetch: app.fetch, port: config.port }, (info) => {
  injectWebSocket(info.server) // must call after serve()
})
```

The `ws` object in handlers is Hono's `WSContext` wrapper. To get the raw `WebSocket` for the room map, use `ws.raw` (typed as `unknown` — cast to `WebSocket`).

### WebSocket event payload shapes
All messages are JSON. Clients parse with `JSON.parse(event.data)` and switch on `type`.

```ts
// Server → Client
{ type: "session:connect", role: "host" | "guest", players: string[] }
{ type: "player:joined", name: string }
{ type: "player:left", name: string }
{ type: "host:disconnected" }   // broadcast when host WS closes — freeze logic in Story 3-5
{ type: "host:reconnected" }    // Story 3-5
{ type: "auth:degraded" }       // from authEvents listener
```

### Room state structure
```ts
interface RoomState {
  host: WebSocket | null
  guests: Map<string, WebSocket>  // name → socket
  // round state added in later epics
}

const roomSockets = new Map<string, RoomState>()
```

Room entries are created on first connection and persist until server restart. Rooms are only in SQLite for metadata (code, host_user_id, created_at from Story 3-1) — live presence is always in-memory.

### Guest reconnect handling
A guest "reconnecting" is just a new WebSocket that sends `session:connect` with the same name. Check: is there already an entry in `guests` for this name?
- If yes AND the old socket is still open → reject with 4009 (name taken — someone else might be using it)
- If yes AND the old socket is closed/null → overwrite the slot (reconnect case)

For MVP, check `ws.readyState === WebSocket.OPEN` to distinguish.

### auth:degraded wiring
`authEvents` is already exported from `refresh.ts` and emits `'degraded'` with the host's `userId`. In `ws.ts`:

```ts
import { authEvents } from './refresh.ts'

authEvents.on('degraded', (userId: string) => {
  for (const [code, room] of roomSockets) {
    // find which room this host owns — cross-ref with rooms table or store userId in RoomState
    if (room.hostUserId === userId) {
      broadcast(code, { type: 'auth:degraded' })
    }
  }
})
```

Add `hostUserId: string` to `RoomState` when the host connects.

### Validating room ownership on host connect
When a host WS connects, validate that the room code belongs to them:
```ts
const room = getRoomByCode(code)   // from db.ts (added in Story 3-1)
if (!room || room.host_user_id !== host.user_id) → close 4003 "not your room"
```

## References
- WS event contracts: `session:connect`, `player:joined`, `player:left`, `auth:degraded` [Source: ux-spec.md WebSocket Event Contracts]
- `authEvents` EventEmitter already exported from `refresh.ts` for this exact purpose [Source: src/server/refresh.ts:19]
- Room code + host_user_id available via `getRoomByCode()` added in Story 3-1 [Source: 3-1 story]
- No external pub/sub — native WS + in-memory Map [Source: epics.md Additional Requirements]
- NFR2: events broadcast within 200ms on home network [Source: prd.md]

## Dev Agent Record

### Implementation Notes

`@hono/node-server` v1.19 does not export a `/ws` subpath — `createNodeWebSocket` was never released. Used `ws` package's `WebSocketServer({ noServer: true })` pattern instead: listen for the HTTP server's `upgrade` event, call `wss.handleUpgrade`, then emit `connection`. Functionally identical to the story's intent and passes all ACs.

Test timing note: the server sends `session:connect` synchronously in the `connection` handler, which means it can arrive in the same TCP segment as the WebSocket handshake response. Tests use a message-buffering `connect()` helper that starts collecting messages before `open` fires, preventing a race condition where the first message is lost.

### Completion Notes

All 11 AC-mapped tests pass (49 total, 0 regressions). `player:left` broadcast verified under 200ms (AC 3). Reconnect path (AC 4) verified: overwriting stale closed socket. `auth:degraded` wired via module-level `authEvents.on` listener (fires once on module load).

## File List

- `src/server/ws.ts` (new)
- `src/server/index.ts` (modified — import + mount setupWebSocketServer)
- `src/server/__tests__/ws.test.ts` (new)
- `package.json` (modified — added `ws` dependency and `@types/ws` devDependency)
- `package-lock.json` (modified)

## Change Log

- 2026-04-03: Implemented Story 3-2 — WebSocket room session and player presence. Added `src/server/ws.ts` with in-memory room map, broadcast helper, host/guest connection handling, reconnect support, and `auth:degraded` wiring. Mounted on `GET /ws` via `ws` package `noServer` + HTTP upgrade event. 11 tests covering all ACs.
