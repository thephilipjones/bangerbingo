# Story 7.3: Round Config as Overlay + Host Name Capture

Status: done

## Story

As a host starting a new session (or a new round within one),
I want the Round Config surface to be an overlay I can open and close without changing pages, with a "Your name" field the first time I configure a round in a given session,
So that the flow from Host Management → Start New Session → Start Round is one continuous surface and my name is captured once for use by the host-as-player feature in Story 7-4.

## Acceptance Criteria

1. **Overlay component replaces the standalone page.** A new component [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte) renders the same config inputs today's [src/client/pages/RoundConfigPage.svelte](src/client/pages/RoundConfigPage.svelte) renders (genre/search tabs, presets, search results, clip-duration pills, title-reveal radios, Start Round CTA). It is a modal: fixed overlay with dimmed backdrop, centered content (reuses the existing dark card styling), scroll-inside-content on mobile viewport. The `'roundconfig'` Page state and `RoundConfigPage.svelte` file are removed; [src/client/App.svelte](src/client/App.svelte) no longer routes to them.

2. **"Your name" field at top of overlay.** When `room.host_name` is not yet set for the target room, a required text input labelled `Your name` is rendered above the tab bar. Constraints: trimmed value, 1–30 chars. Start Round is disabled (or shows inline error on submit) when the field is empty/invalid. When `room.host_name` is already set on the room, the name field is **not rendered** at all (the overlay jumps straight to tab bar → config options).

3. **Name is persisted to `rooms.host_name` on Start Round.** `POST /api/rooms/:code/round` accepts an optional `hostName: string` in the request body (trimmed, 1–30 chars). When present, the server writes it to the new `rooms.host_name` column **before** returning the round config response. Subsequent `GET /api/rooms` calls return the stored `host_name` on the row; the overlay uses this to skip the name field next time. No separate endpoint is needed — `POST .../round` is the single write site in this story.

4. **Entry point — Dashboard "Start New Session".** Clicking Start New Session on [src/client/pages/DashboardPage.svelte](src/client/pages/DashboardPage.svelte) still calls `createRoom()` then `onEnterLobby(code)` (unchanged wiring). [src/client/pages/LobbyPage.svelte](src/client/pages/LobbyPage.svelte) detects this first-time-entry scenario (room has no `host_name` AND no prior round has been played in this client session) and **auto-opens the overlay on mount**. The lobby's spinning vinyl / trivia remain visible behind the backdrop.

5. **Entry point — Lobby "Configure Round" button.** The existing `Configure Round →` button in [src/client/pages/LobbyPage.svelte](src/client/pages/LobbyPage.svelte) now opens the overlay locally (toggles an `isConfigOpen` state). It **does NOT** navigate away from the lobby. Between-rounds re-entry (host ends a round, returns to lobby, taps Configure Round again) works the same way — the overlay opens with the name field hidden (room.host_name is already set from the first round).

6. **Start Round closes the overlay and navigates to the host game page.** The overlay's `onStarted` callback closes the modal, then the parent (LobbyPage) calls its existing `onConfigureRound` prop — which is renamed to `onRoundStarted` at the App.svelte boundary to reflect the new semantic. App.svelte sets `page = 'hostroom'`. The existing `round:start` broadcast logic on the server is unchanged; clients still receive it via WS.

7. **Close / Cancel.** The overlay has a close affordance (✕ button in top-right of the modal panel; also Esc key; also backdrop click). Closing the overlay WITHOUT clicking Start Round returns the host to the lobby screen with no state changes (no room created, no name persisted, no API call made — name input text is discarded). Auto-open-on-mount (AC #4) can still be closed the same way — the host returns to a normal lobby view.

8. **Mid-session warning scaffolding (deferred variant, noted here for 7-5).** When the overlay is opened from the lobby AND a round has already been played in this session (`room.host_name` set AND this is not the very first open), the overlay shows **no warning banner and no confirmation dialog** in this story — between-rounds state has no live round to interrupt. The full mid-session "End Round" variant (warning banner + confirmation dialog) ships in Story 7-5 when the Host Controls Overlay → End Round entry point is built. Document this explicitly in `RoundConfigOverlay.svelte` as a top-of-file comment so the 7-5 dev agent knows where to add the `variant: 'first-round' | 'mid-session'` branch.

9. **Database migration — add `host_name` column.** [src/server/db.ts](src/server/db.ts) `initDb()` adds `host_name TEXT` (nullable) to the `CREATE TABLE IF NOT EXISTS rooms` statement for fresh databases, AND issues an idempotent `ALTER TABLE rooms ADD COLUMN host_name TEXT` guarded so it's a no-op on existing databases that already have the column. Pattern: check `PRAGMA table_info(rooms)` for the column and skip if present. The `Room` interface gains `host_name: string | null`.

10. **Server: `POST /api/rooms/:code/round` writes `host_name`.** In [src/server/rooms.ts](src/server/rooms.ts) the round-config route reads `hostName` from the body (validation: `typeof === 'string'`, trimmed length 1–30 when present; optional — missing/undefined is accepted on **second and later rounds** but rejected on the **first round if `room.host_name` is null** with a 400 `{ message: 'hostName required' }`). When present and valid, call a new `setRoomHostName(code, hostName)` helper in `db.ts` that runs `UPDATE rooms SET host_name = ? WHERE code = ?`. Existing validation of `playlistId`, `clipDuration`, `titleRevealDelay` is unchanged.

11. **Server: `GET /api/rooms` returns `host_name`.** `getRoomsByHost` already returns `SELECT *`, so the new column surfaces automatically in the JSON response. The client-side `RoomSummary` type in [src/client/lib/api.ts](src/client/lib/api.ts) gains `host_name: string | null` and the `CreateRoomResponse` type gains the same field (though it will always be `null` at room-creation time in this story). No new endpoint is added.

12. **Client API update.** `StartRoundPayload` in [src/client/lib/api.ts](src/client/lib/api.ts) gains optional `hostName?: string`. `startRound(code, payload)` serialises it as-is. `RoomSummary.host_name` exposed. [src/client/pages/DashboardPage.svelte](src/client/pages/DashboardPage.svelte) requires no display changes for `host_name` in this story — the row rendering stays code + timestamp + trash.

13. **Lobby wiring.** LobbyPage gains an async `onMount` step to fetch the current room via the listing: call `getRooms()`, find the row matching `code` prop, read `host_name`. If fetch fails or room not in list, proceed as if `host_name === null` (fall-through safe default). Store in `$state`. Pass `initialHostName={roomHostName}` into the overlay. After Start Round closes the overlay, LobbyPage updates its local `roomHostName` state to whatever the user submitted so a re-open within the same lobby mount doesn't re-show the name field. No new WS messages, no polling.

14. **Tests.**
    - (a) **Server** — extend [src/server/**tests**/rooms.test.ts](src/server/__tests__/rooms.test.ts) (or `ws.test.ts`, whichever hosts the round-config integration test today): (i) first-round POST with valid `hostName` returns 200 and `rooms.host_name` column is set; (ii) first-round POST without `hostName` when `host_name IS NULL` returns 400; (iii) second-round POST without `hostName` when `host_name` already set returns 200 unchanged; (iv) `hostName` with trimmed length 0 or >30 returns 400; (v) `GET /api/rooms` returns the `host_name` field on the row after it's been set.
    - (b) **Server** — extend the db init/migration path to be exercised by an existing test file opening an empty in-memory db AND a pre-existing db without the column (simulate by creating the old-shape table first, then calling `initDb()` → assert no throw and column now present).
    - (c) **Client** — add [src/client/**tests**/RoundConfigOverlay.test.ts](src/client/__tests__/RoundConfigOverlay.test.ts) using vitest + svelte testing library: (i) renders name field when `initialHostName === null`, hides it when set; (ii) Start Round disabled / error when name field empty and visible; (iii) Start Round submits `hostName` in payload when visible, omits it when hidden; (iv) close button + Esc both call `onClose` without calling `startRound`. Use the existing vitest harness pattern; mock the `startRound` import.
    - (d) Do **NOT** add a visual-diff / snapshot test for the overlay — locale-fragile and brittle per 7-2 guidance.

15. **Regression.** `npm run lint` (tsc --noEmit) clean. `npm test` green (existing 251 tests plus new ones). Existing lobby → round-config → hostroom flow still works end-to-end via the new overlay path. Guest flow unchanged (nothing in 7-3 modifies guest WS handshake or card generation).

## Tasks / Subtasks

- [x] **Server: DB migration for host_name column** (AC #9)
  - [x] Update `initDb()` in [src/server/db.ts](src/server/db.ts): add `host_name TEXT` to the `rooms` CREATE TABLE, then after `db.exec(...)` run a `PRAGMA table_info(rooms)` check and conditionally `ALTER TABLE rooms ADD COLUMN host_name TEXT` if the column is missing (idempotent on fresh + existing dbs).
  - [x] Extend `Room` interface with `host_name: string | null`.
  - [x] Add `setRoomHostName(code: string, hostName: string): void` export that runs `UPDATE rooms SET host_name = ? WHERE code = ?`.

- [x] **Server: round-config route persists host_name** (AC #10, #3)
  - [x] In [src/server/rooms.ts](src/server/rooms.ts) `POST /rooms/:code/round`: after the existing body-shape validation, read `hostName`. If `room.host_name === null` AND `hostName` is missing/empty/whitespace or > 30 chars trimmed → 400 with specific messages. If `hostName` present and valid, call `setRoomHostName(code, hostName.trim())` BEFORE building the round (before the Spotify fetch) so a Spotify failure still preserves the name.
  - [x] On `room.host_name` already set: `hostName` in body is ignored (do not overwrite — spec is capture-once per session).

- [x] **Client: API type + function updates** (AC #11, #12)
  - [x] Extend `RoomSummary` and `CreateRoomResponse` with `host_name: string | null` in [src/client/lib/api.ts](src/client/lib/api.ts).
  - [x] Extend `StartRoundPayload` with `hostName?: string`.
  - [x] No new exports — `getRooms()` already returns the richer shape.

- [x] **Client: RoundConfigOverlay component** (AC #1, #2, #6, #7)
  - [x] Create [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte). Props: `{ code: string; initialHostName: string | null; onClose: () => void; onStarted: (submittedHostName: string | null) => void }`.
  - [x] Port ALL tab / preset / search / clip / reveal / Start-Round logic verbatim from `RoundConfigPage.svelte`. Remove the header `copyRoomCode` element — that's a page concern and the overlay is a modal over the existing lobby (which already shows the code).
  - [x] Add name-field block at the top, rendered only when `initialHostName === null`. `maxlength="30"`, `required`, `aria-label="Your name"`. Maintain `hostNameInput = $state('')` and on Start Round: trim, validate 1–30 chars, include in `startRound` payload.
  - [x] Modal chrome: fixed backdrop (`rgba(0,0,0,0.6)`), content panel reuses `.config-panel` styles from the old page, ✕ close button top-right (44×44 min tap target), Esc handler via `window.addEventListener('keydown', …)` mounted/unmounted with `onMount`/`onDestroy`, backdrop click calls `onClose`. Inner-panel click `stopPropagation` so clicks inside don't close.
  - [x] Top-of-file comment documenting the 7-5 extension point: `// 7-5 will add prop `variant: 'first-round' | 'mid-session'` and render a warning banner + confirmation dialog for the End Round entry point.`

- [x] **Client: App.svelte routing cleanup** (AC #1, #6)
  - [x] Remove `roundconfig` from the `Page` union in [src/client/lib/ws.ts](src/client/lib/ws.ts).
  - [x] Remove the `RoundConfigPage` import + render branch from [src/client/App.svelte](src/client/App.svelte).
  - [x] Remove `handleConfigureRound` handler.
  - [x] Rename `LobbyPage`'s outgoing callback from `onConfigureRound` to `onRoundStarted` so App.svelte reads `onRoundStarted={handleRoundStarted}` (already present) with no intermediate page transition.
  - [x] Delete [src/client/pages/RoundConfigPage.svelte](src/client/pages/RoundConfigPage.svelte).

- [x] **Client: LobbyPage hosts the overlay** (AC #4, #5, #13)
  - [x] In [src/client/pages/LobbyPage.svelte](src/client/pages/LobbyPage.svelte) import `RoundConfigOverlay`, `getRooms` from api.
  - [x] Add `$state`: `isConfigOpen: boolean`, `roomHostName: string | null`, `hasEverOpenedConfig: boolean` (module-local; resets on component remount — between-rounds remount is fine).
  - [x] In `onMount`, after existing WS connection setup, call `getRooms()` (catch/ignore) → find row matching `code` prop → set `roomHostName` from `row.host_name ?? null`. If `roomHostName === null` AND `!hasEverOpenedConfig`, set `isConfigOpen = true` (auto-open for first-time entry).
  - [x] Configure Round button `onclick={() => isConfigOpen = true}`.
  - [x] Pass `initialHostName={roomHostName}` + `onClose={() => isConfigOpen = false}` + `onStarted={(name) => { if (name) roomHostName = name; isConfigOpen = false; onRoundStarted() }}` into the overlay.
  - [x] Rename the outgoing prop `onConfigureRound` → `onRoundStarted` to match App.svelte.

- [x] **Tests** (AC #14)
  - [x] Server: extend existing round-config test block with the 5 cases in AC #14a.
  - [x] Server: add a migration test — open a sqlite db, create a minimal `rooms` table WITHOUT `host_name`, then call `initDb()` against the same path, then `PRAGMA table_info(rooms)` must include `host_name`. Assert no throw.
  - [x] Client: new `RoundConfigOverlay.test.ts` with 4 cases from AC #14c. Mock `startRound` (and the `/api/music/presets` fetch to a resolved stub) to isolate the overlay logic.

- [ ] **Manual verification** (for Philip to run)
  - [x] Log in → Host Management → Start New Session → lobby mounts → overlay auto-opens with name field visible. Enter name + pick genre preset + clip + reveal → Start Round → host lands on game page, first song plays.
  - [x] End the round (use the existing in-game "End Round" surface today — HostRoomPage's round-end control) → back to lobby → tap Configure Round → overlay opens WITHOUT name field → Start Round with new playlist → host lands on game page again.
  - [x] Click backdrop / ✕ / Esc on the overlay → overlay closes cleanly, lobby visible, no API calls made, no state drift (verify DevTools Network).
  - [x] Verify `host_name` column populated in sqlite (`sqlite3 bangerbingo.db 'select code,host_name from rooms'`) after first Start Round.
  - [x] Delete the session from Host Management → create a new one → name field reappears on the fresh room. Confirm name is per-room, not globally cached client-side.

## Dev Notes

### Scope boundaries — what NOT to touch in 7-3

- **Do NOT** add `hostName` to the `session:connect` WS payload. That's Story 7-4 (where the guest Waiting Room renders `Sarah [host]` in the player list).
- **Do NOT** build the Host Controls Overlay or the gear-icon mini-player → End Round entry point. That's Story 7-5.
- **Do NOT** add the mid-session warning banner ("Starting a new round will clear everyone's cards") or confirmation dialog. No current entry point actively interrupts a live round in 7-3 — between-rounds opens after `round:end` already fired. Scaffold the `variant` prop comment only.
- **Do NOT** replace Lobby with "Guest Waiting Room" or "Between-Rounds component". Lobby still exists as the host's between-rounds surface; full Lobby → waiting-room / between-rounds split happens in 7-4 / 7-5.
- **Do NOT** change guest flow. Guests still join → RoomPage unchanged. No guest-side UI or WS changes.
- **Do NOT** create a client-side cookie for host name. Persistence is DB-only on `rooms.host_name`. The spec's "httpOnly cookie" wording is superseded by per-room DB storage — simpler, and aligns with how `rooms.host_name` needs to be available to the server for 7-4's `session:connect` broadcast.
- **Do NOT** persist overlay form state across closes (e.g. name typed + ✕ clicked → typed text is discarded on re-open). Over-engineering for MVP.

### Migration pattern for `rooms.host_name`

SQLite does not support `ADD COLUMN IF NOT EXISTS` directly. Safe idempotent pattern:

```ts
const cols = db.prepare("PRAGMA table_info(rooms)").all() as Array<{
  name: string;
}>;
if (!cols.some((c) => c.name === "host_name")) {
  db.exec("ALTER TABLE rooms ADD COLUMN host_name TEXT");
}
```

Run this **after** the `CREATE TABLE IF NOT EXISTS` block inside `initDb()` so both fresh and pre-existing databases converge on the same schema. The CREATE TABLE statement should also include `host_name TEXT` so freshly created tables have the column from the start.

### Overlay + LobbyPage wiring sketch

```
LobbyPage
 ├── connectAsHost WS
 ├── onMount: getRooms() → set roomHostName
 ├── if roomHostName===null && !hasEverOpenedConfig → isConfigOpen=true; hasEverOpenedConfig=true
 ├── Configure Round button → isConfigOpen=true; hasEverOpenedConfig=true
 └── {#if isConfigOpen}
        <RoundConfigOverlay
          {code}
          initialHostName={roomHostName}
          onClose={() => isConfigOpen = false}
          onStarted={(name) => {
             if (name) roomHostName = name
             isConfigOpen = false
             onRoundStarted()       // App.svelte → page = 'hostroom'
          }}
        />
      {/if}
```

### Why persist `host_name` server-side (not client cookie)

- Story 7-4 needs `hostName` available at WS-upgrade time to stamp it into the `session:connect` payload broadcast to guests. The server has no reliable access to client cookies beyond the existing `session` cookie. Putting `host_name` on the `rooms` row lets 7-4 simply join it on the `getRoomByCode(code)` lookup that already happens in every WS upgrade.
- Per-room storage (vs. per-host-user globally) is correct: a host running two concurrent games may want different names (e.g. play-test vs. real session). MVP treats this as an edge case but storage shape doesn't preclude it.
- Cookie-based storage would require the client to send the value back on every API call AND mirror-read from the WS handshake, adding complexity for zero MVP benefit.

### Existing round-config behavior to preserve

- First round: `roundNumber: 1`; host's card rendered on the `round:start` broadcast; all connected guests get blank cards.
- Between rounds: `POST /rooms/:code/round/end` fires `round:end` broadcast (no card clear on server — just `currentRound = undefined`). Second call to `POST /rooms/:code/round` gets `roundNumber: 2`.
- The existing `pendingRound` / `currentRound` / `roundNumber` bookkeeping in [src/server/rooms.ts:212-218](src/server/rooms.ts#L212-L218) is untouched — the new code path is only the `hostName` read + `setRoomHostName` call at the top of the route.

### Validation constants

- Name: trimmed length 1–30 chars. No character allowlist in MVP (matches guest-name freedom). Server side: reject only on empty trimmed OR > 30 char trimmed length.
- The 30-char cap matches the guest-name cap in [src/client/pages/JoinPage.svelte](src/client/pages/JoinPage.svelte) (verify actual value in code; if different, align this story to match whatever guest-name uses so the two paths are consistent).

### Svelte 5 runes + component patterns to reuse

- `$props()`, `$state()`, `$derived()` per existing pages (DashboardPage, RoundConfigPage).
- Modal backdrop click handler: wrap content in `<div class="backdrop" onclick={onClose}><div class="panel" onclick={(e) => e.stopPropagation()}>...` (standard Svelte modal idiom).
- Esc key: `onMount` attaches `window.addEventListener('keydown', …)` — **remember** to remove it in `onDestroy` to avoid leaks across re-opens. Check for `e.key === 'Escape'`.
- Focus trap: **NOT required** for MVP — the overlay contains all interactive elements but default tab order is fine. Accessibility polish is a deferred concern (note: AC #7 only requires close-on-Esc, not trapping).

### Tests — practical reuse

- Server tests: the existing test file that exercises `POST /rooms/:code/round` is likely [src/server/**tests**/rooms.test.ts](src/server/__tests__/rooms.test.ts) — add a describe block there. If the round-config test currently lives in `ws.test.ts` (7-2 added server-side tests there for symmetry), follow the same pattern.
- Client tests: [src/client/**tests**/](src/client/__tests__/) uses vitest + jsdom. Existing tests in the suite (e.g. [formatSessionTimestamp.test.ts](src/client/__tests__/formatSessionTimestamp.test.ts)) are the canonical style. For Svelte component tests, check whether `@testing-library/svelte` is already a dep (it should be, per prior stories' UI tests — if missing, use the existing harness and skip DOM-render tests, isolating logic via plain Svelte mounting).

### References

- Sprint Change Proposal: [\_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md §4.2 Change U3](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — Round Config overlay spec + both entry points + mid-session variant (for 7-5 deferral context)
- Sprint Change Proposal: [\_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md §Proposed Epic 7 sequencing](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — story 7-3 scope definition
- Sprint Change Proposal: [\_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md §4.1 Change P2](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — PRD Journey 1 updated flow (confirms host name captured in overlay)
- Previous story: [7-2-host-management-session-list-and-delete.md](7-2-host-management-session-list-and-delete.md) — conservative scope pattern, test-placement conventions, migration-avoidance (this is the first story touching schema — adopt the idempotent PRAGMA pattern)
- Current round-config route: [src/server/rooms.ts:192-297](src/server/rooms.ts#L192-L297) — the route this story modifies
- Current round-config page: [src/client/pages/RoundConfigPage.svelte](src/client/pages/RoundConfigPage.svelte) — source of the overlay port
- Current lobby page: [src/client/pages/LobbyPage.svelte](src/client/pages/LobbyPage.svelte) — the new overlay host
- Current App routing: [src/client/App.svelte:47-53](src/client/App.svelte#L47-L53) — handlers to prune

### Review Findings

- [x] [Review][Patch] Add @testing-library/svelte + jsdom and ship the 4 AC #14c DOM-render tests (conditional name-field render, disabled/error state, payload shape, Esc/close calling onClose) [src/client/__tests__/RoundConfigOverlay.test.ts + package.json]
- [x] [Review][Patch] AC #10 deviation — hostName validation runs before ignore-check [src/server/rooms.ts:193-205]
- [x] [Review][Patch] Migration test leaks DB state via module-level db singleton [src/server/__tests__/db.test.ts]
- [x] [Review][Patch] Migration test unlinks DB file while handle still open [src/server/__tests__/db.test.ts]
- [x] [Review][Patch] LobbyPage auto-open overlay race conditions (no cancellation on unmount, missing-row defaults to null→auto-open) [src/client/pages/LobbyPage.svelte]
- [x] [Review][Patch] Overlay close handlers fire during in-flight submit (backdrop/Esc/✕ don't check submitting) [src/client/components/RoundConfigOverlay.svelte]
- [x] [Review][Patch] Start Round double-submit guard missing at top of handler [src/client/components/RoundConfigOverlay.svelte]
- [x] [Review][Patch] Server 400 tests don't assert which error message fires [src/server/__tests__/rooms.test.ts]
- [x] [Review][Patch] `second-round POST without hostName` test doesn't assert roundNumber=2 [src/server/__tests__/rooms.test.ts]
- [x] [Review][Patch] Failed `startRound` after host_name persisted leaves stale roomHostName — overlay re-opens with name field, second name silently ignored [src/client/pages/LobbyPage.svelte + src/client/components/RoundConfigOverlay.svelte]
- [x] [Review][Defer] Concurrent first-round POSTs can both pass host_name IS NULL check — deferred, pre-existing (5-user personal app)
- [x] [Review][Defer] Unicode/emoji length handling (.length vs grapheme count, control chars, zero-width) — deferred, pre-existing (personal/friends context)
- [x] [Review][Defer] `getRooms()` fetches all rooms to read one row — deferred, pre-existing (no GET /api/rooms/:code endpoint)
- [x] [Review][Defer] a11y gaps: no focus trap, svelte-ignore comments, no keyboard backdrop dismiss, focus not moved into modal — deferred, pre-existing (noted in Dev Notes)
- [x] [Review][Defer] No CSRF protection on /api/rooms/:code/round — deferred, pre-existing architectural concern
- [x] [Review][Defer] Search tab out-of-order response race + selectedPlaylistId inconsistency — deferred, pre-existing (ported verbatim from RoundConfigPage.svelte)

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- `npm run lint` — clean (tsc --noEmit).
- `npm test` — 269 passed (previous 251 plus 18 new: 6 server rooms hostName cases, 2 db rooms.host_name cases, 1 db migration case, 9 client overlay helper cases).

### Completion Notes List

- DB schema extended with nullable `host_name` column; idempotent `PRAGMA table_info` migration added so pre-existing databases gain the column without throwing. `Room` interface now carries `host_name: string | null`.
- `POST /api/rooms/:code/round` accepts optional `hostName` (trimmed 1–30 chars). First-round call when `room.host_name IS NULL` returns 400 `{ message: 'hostName required' }` if missing; otherwise persists via new `setRoomHostName()` BEFORE the Spotify fetch (so transient Spotify failures still preserve the name). Capture-once semantics: `hostName` on the body is ignored once `room.host_name` is set.
- `POST /api/rooms` now surfaces `host_name` on the create response (always `null` at creation time). `GET /api/rooms` surfaces it automatically via `SELECT *`.
- Client `RoundConfigOverlay.svelte` component added; replaces `RoundConfigPage.svelte` which has been deleted. Overlay is a fixed backdrop + centered panel modal with Esc / ✕ / backdrop-click close. A top-of-file comment documents the 7-5 extension point (`variant` prop + mid-session warning banner).
- Validation + payload-building logic extracted to `src/client/lib/roundConfig.ts` (`validateHostName`, `buildStartRoundPayload`) — kept pure so the vitest `node` environment (no jsdom) can exercise them. Per story Dev Notes: skip DOM-render tests when `@testing-library/svelte` is absent; isolate the overlay's observable behaviour at helper level.
- `LobbyPage.svelte` now hosts the overlay: `onMount` calls `getRooms()` to read the row's `host_name`; if `null` AND `hasEverOpenedConfig` is false, auto-opens the overlay. The Configure Round button simply toggles `isConfigOpen`. The outgoing callback was renamed `onConfigureRound` → `onRoundStarted` so App.svelte routes straight from lobby → hostroom with no intermediate page.
- `App.svelte` routing cleanup: removed `RoundConfigPage` import, `handleConfigureRound`, and the `'roundconfig'` `Page` variant in `src/client/lib/ws.ts`.
- Existing server tests that call `POST /round` were updated to include `hostName: 'Host'` since those rooms are freshly seeded (host_name IS NULL).

### File List

- src/server/db.ts — added `host_name` column, `Room.host_name`, migration PRAGMA, `setRoomHostName()`.
- src/server/rooms.ts — round route reads + validates + persists `hostName`; POST /rooms response includes `host_name`.
- src/server/**tests**/db.test.ts — new migration test + `rooms.host_name` tests.
- src/server/**tests**/rooms.test.ts — updated payloads to include `hostName`; 6 new hostName-case tests.
- src/server/**tests**/ws.test.ts — updated `POST /round` bodies with `hostName: 'Host'`.
- src/client/lib/api.ts — `RoomSummary.host_name`, `CreateRoomResponse.host_name`, `StartRoundPayload.hostName?`.
- src/client/lib/ws.ts — removed `'roundconfig'` from `Page` union.
- src/client/lib/roundConfig.ts — NEW: pure helpers.
- src/client/components/RoundConfigOverlay.svelte — NEW: overlay component.
- src/client/pages/LobbyPage.svelte — hosts overlay; renamed outgoing callback.
- src/client/pages/RoundConfigPage.svelte — DELETED.
- src/client/App.svelte — routing cleanup.
- src/client/**tests**/RoundConfigOverlay.test.ts — NEW: helper tests.

### Change Log

- 2026-04-05: Implemented Story 7-3 — Round Config as overlay + host-name capture per-room.
