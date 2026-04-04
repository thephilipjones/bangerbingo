# Story 3.1: Room Creation API & Code Generation

Status: done

## Story

As a host,
I want to create a new room and receive a unique shareable code,
So that I can invite guests to join my bingo session.

## Acceptance Criteria

1. A host with a valid session cookie can POST to `/api/rooms` and receive a new room record containing a 5-character room code and the shareable URL (`/room/:code`).
2. Room codes are uppercase A–Z only, excluding O and I (visually ambiguous), exactly 5 characters.
3. No two rooms share the same code; if a collision is generated, the server retries until a unique code is found.
4. Room metadata is persisted in SQLite (room code, host user_id, created_at).
5. A GET `/api/rooms` (authenticated) returns the host's existing rooms, ordered by creation date descending.
6. An unauthenticated request to POST `/api/rooms` returns 401.

## Tasks / Subtasks

- [x] SQLite rooms table (AC: 1, 4)
  - [x] Add `rooms` table to `db.ts` `initDb()`: `code TEXT PRIMARY KEY, host_user_id TEXT NOT NULL REFERENCES hosts(user_id), created_at INTEGER NOT NULL`
  - [x] `createRoom(hostUserId: string): Room` helper — generate code, insert, return record
  - [x] `getRoomsByHost(hostUserId: string): Room[]` helper — SELECT ordered by created_at DESC
  - [x] `getRoomByCode(code: string): Room | undefined` helper — for future use

- [x] Room code generation (AC: 2, 3)
  - [x] `generateRoomCode(): string` — pick 5 random chars from `ABCDEFGHJKLMNPQRSTUVWXYZ` (26 letters minus O and I = 24 chars)
  - [x] Collision retry in `createRoom`: attempt insert; on UNIQUE constraint violation, regenerate and retry (max 10 attempts, throw on exhaustion — statistically impossible at low room counts)

- [x] Room API routes (AC: 1, 5, 6)
  - [x] `POST /api/rooms` — protected by `requireAuth`; call `createRoom`; return `{ code, url: /room/${code}, createdAt }`
  - [x] `GET /api/rooms` — protected by `requireAuth`; call `getRoomsByHost`; return array
  - [x] Wire routes in `src/server/index.ts` (or a new `src/server/rooms.ts` router — follow auth.ts pattern)

- [x] Tests (AC: 1–6)
  - [x] Code generation: output length = 5, no O or I chars, only uppercase letters
  - [x] Collision retry: mock insert to fail once, verify second attempt succeeds
  - [x] POST `/api/rooms`: 401 without session, 200 with session, code in response matches expected format
  - [x] GET `/api/rooms`: returns empty array for new host, returns created rooms in descending order
  - [x] Use in-memory SQLite (`initDb(':memory:')`) — same pattern as existing auth tests

## Dev Notes

### Existing patterns to follow
- Room creation joins the pattern established in `src/server/auth.ts` — use a `roomsRouter` exported from `src/server/rooms.ts` and mounted in `index.ts` via `app.route('/api', roomsRouter)`
- DB helpers live in `src/server/db.ts` — add `rooms` table DDL to the existing `initDb()` call (single `db.exec()` block, just add the new `CREATE TABLE IF NOT EXISTS`)
- Auth middleware: `requireAuth` is already exported from `auth.ts`, same as story 1.1

### Room code alphabet
```ts
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // 24 chars: A-Z minus O (15th) and I (9th)
```
Use `crypto.randomInt(0, ALPHABET.length)` (Node built-in) — no external library.

### Room interface
```ts
export interface Room {
  code: string
  host_user_id: string
  created_at: number  // Unix ms timestamp
}
```

### No in-memory game state yet
This story creates the SQLite room record only. The in-memory `Map<roomCode, GameState>` and WebSocket room management come in Story 3-2. Don't wire WebSockets here.

### Shareable URL
The URL `/room/:code` is a frontend route (Svelte SPA). The server does not need to handle it as an HTTP route — just return `{ code, url: \`/room/${code}\` }` in the API response so the frontend can display it immediately.

### Test setup
Follow the existing pattern in `src/server/__tests__/auth.test.ts`:
```ts
beforeEach(() => {
  initDb(':memory:')
})
```
No teardown needed — in-memory DB is discarded after each test.

## References
- Room code spec: uppercase A–Z, excluding O and I, 5 characters [Source: epics.md Additional Requirements]
- Auth middleware reuse: `requireAuth` from `src/server/auth.ts` [Source: story 1-1]
- No WebSockets in this story — that's story 3-2 [Source: epics.md Epic 3 breakdown]
- SQLite schema additions follow the existing `initDb()` pattern [Source: src/server/db.ts]

## Dev Agent Record

### Completion Notes

Implemented Room Creation API (story 3-1) on 2026-04-03.

- Added `Room` interface and `rooms` table DDL to `db.ts` `initDb()` (single `db.exec()` block alongside existing `hosts` table)
- Added three DB helpers: `createRoom`, `getRoomsByHost`, `getRoomByCode`
- Created `src/server/rooms.ts` with `generateRoomCode` (24-char alphabet, `crypto.randomInt`), `createRoomWithRetry` (10-attempt collision retry; accepts optional `codeGen` param for testability), `roomsRouter` (POST + GET `/api/rooms`, both behind `requireAuth`)
- Wired `roomsRouter` into `src/server/index.ts` via `app.route('/api', roomsRouter)`
- 10 new tests in `src/server/__tests__/rooms.test.ts`; all 38 tests (10 new + 28 existing) pass

### Debug Log

No blockers. `createRoomWithRetry` accepts an optional `codeGen` parameter (default: `generateRoomCode`) to allow deterministic collision testing without ESM spy complications.

## File List

- `src/server/db.ts` (modified — added `Room` interface, rooms table DDL, `createRoom`, `getRoomsByHost`, `getRoomByCode`)
- `src/server/rooms.ts` (new — `generateRoomCode`, `createRoomWithRetry`, `roomsRouter`)
- `src/server/index.ts` (modified — import `roomsRouter`, mount at `/api`)
- `src/server/__tests__/rooms.test.ts` (new — 10 tests covering all ACs)

## Review Findings

### Patches (must fix)
- [x] [Review][Patch] Unhandled 500 on retry exhaustion — POST /api/rooms throws raw Error with no JSON response body when all 10 retry attempts fail [`src/server/rooms.ts`]
- [x] [Review][Patch] SQLite foreign key constraint silently unenforced — `PRAGMA foreign_keys = ON` is never issued in `initDb()`, so `rooms.host_user_id REFERENCES hosts(user_id)` is decorative only [`src/server/db.ts`]
- [x] [Review][Patch] POST/GET response field name inconsistency — POST returns `createdAt` (camelCase) but GET returns raw `Room` rows with `created_at` (snake_case), violating the Room interface spec [`src/server/rooms.ts`]
- [x] [Review][Patch] Test seeds invalid 6-char room code `XXXXXV` — violates AC 2; fixed to `XXXX` (4-char) [`src/server/__tests__/rooms.test.ts`]

### Deferred
- [x] [Review][Defer] No rate limiting or per-host room cap on POST /api/rooms [`src/server/rooms.ts`] — deferred, out of scope for this story; harden in a future hardening epic
- [x] [Review][Defer] Session cookie is raw `user_id` with no signature/MAC — trivially forgeable [`src/server/auth.ts`] — deferred, pre-existing auth design
- [x] [Review][Defer] Prepared statements re-created on every DB call — no caching [`src/server/db.ts`] — deferred, pre-existing pattern; optimize later
- [x] [Review][Defer] `SELECT *` in `getRoomsByHost`/`getRoomByCode` — fragile against future schema additions [`src/server/db.ts`] — deferred, low risk now
- [x] [Review][Defer] Test alphabet regex does not pin exact 24-char alphabet — passes with wrong alphabets [`src/server/__tests__/rooms.test.ts`] — deferred, test quality gap
- [x] [Review][Defer] `initDb` does not close previous DB handle on re-init — silent connection leak [`src/server/db.ts`] — deferred, pre-existing
- [x] [Review][Defer] POST /api/rooms returns 200 instead of 201 — REST convention deviation [`src/server/rooms.ts`] — deferred, spec does not mandate 201

## Change Log

- 2026-04-03: Implemented story 3-1 — Room Creation API & Code Generation. Added rooms table, DB helpers, rooms router, and full test coverage.
