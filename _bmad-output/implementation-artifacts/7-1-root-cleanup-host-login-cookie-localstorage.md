# Story 7.1: Root `/` Cleanup — Host Login Button, Session Cookie, Guest Name LocalStorage

Status: done

## Story

As a guest arriving at the app's root URL,
I want the Join form as the primary landing experience with my name pre-filled from a previous visit,
So that joining a friend's session takes one tap and zero retyping.

As a host arriving at the app's root URL,
I want a small unobtrusive "Host Login" entry that doesn't compete with the guest Join CTA,
So that I can reach Host Management without cluttering the guest flow.

## Acceptance Criteria

1. **Root `/` unauthenticated shows JoinPage** (not LoginPage). Authenticated hosts continue to route to the dashboard (Host Management comes in Story 7-2). The `/room/:code` guest-prefill path continues to work unchanged.
2. **Host Login button** appears on JoinPage, top-right, visually recessive (ghost / text-only style, lower contrast than the primary Join CTA). Tapping it initiates the existing Spotify OAuth flow (same as today's LoginPage "Connect Spotify" button) — either by navigating to a dedicated login route or by triggering the OAuth redirect directly.
3. **Guest name persistence:** on successful Join, the submitted name is written to `localStorage` under key `bangerbingo.guestName`. On subsequent mounts of JoinPage (root `/` OR `/room/:code` variant), the name field is prefilled from `localStorage` if present, otherwise empty and autofocused. Name field remains editable.
4. **Room code never persisted:** `localStorage` stores name only. Room code is read only from the URL path.
5. **LocalStorage write fallback:** if `localStorage.setItem` throws (Safari private mode / ITP eviction / quota), the Join still completes successfully — write failure is swallowed silently (no user-visible error, no console noise beyond a single debug log).
6. **Session cookie lifetime:** no change. Current 30-day `maxAge` in [src/server/auth.ts:185](src/server/auth.ts#L185) is retained (resolved 2026-04-05 — see UX Spec Decision Log).
7. **Existing tests pass** (`npm run lint`, `npm test`) with no regressions.
8. **New unit tests** for (a) `determineInitialPage` returning `'join'` for root `/` unauthenticated, (b) guest name localStorage round-trip including graceful fallback on write failure.

## Tasks / Subtasks

- [x] Update routing (AC: #1)
  - [x] In [src/client/lib/ws.ts:13](src/client/lib/ws.ts#L13), change `determineInitialPage`'s unauthenticated root fallback from `{ page: 'login' }` to `{ page: 'join' }` (guest-first root URL).
  - [x] Leave the `me` → `'dashboard'` branch and the `/room/:code` → `'join'` branch unchanged.
  - [x] Update the unit tests for `determineInitialPage` to reflect the new root behaviour.

- [x] Add Host Login button to JoinPage (AC: #2)
  - [x] In [src/client/pages/JoinPage.svelte](src/client/pages/JoinPage.svelte), add a small ghost-style button positioned top-right of the viewport (outside the form container, e.g. in a header row or via absolute positioning).
  - [x] Label: `Host Login`. Button triggers the same OAuth flow as [LoginPage.svelte](src/client/pages/LoginPage.svelte) — simplest path is a page-level navigation callback that switches to the `'login'` page, preserving existing LoginPage behaviour.
  - [x] Add an `onHostLogin` prop to JoinPage callable on tap; wire it in [App.svelte:61](src/client/App.svelte#L61) to set `page = 'login'`.
  - [x] Styling: ghost button (transparent bg, muted border or text-only), noticeably lower visual weight than the primary green Join CTA. Respect existing min-height: 44px for hit target.

- [x] Guest name localStorage prefill (AC: #3, #4, #5)
  - [x] Create a tiny helper module (or co-locate in JoinPage script): `getStoredGuestName(): string` and `setStoredGuestName(name: string): void`. Both wrap `localStorage` access in try/catch and return/swallow silently on failure.
  - [x] Use a stable key: `bangerbingo.guestName`.
  - [x] On JoinPage mount (`onMount`), initialise `name = getStoredGuestName()` BEFORE focusing the input. If the stored name is present, autofocus behaviour still applies (user may edit it).
  - [x] On successful Join (inside `onConnect` in `handleSubmit`), call `setStoredGuestName(name)` before the onJoined hand-off.
  - [x] Never read/write anything for the room code.

- [x] Session cookie Max-Age: **no change** (AC: #6) — resolved 2026-04-05, keep 30 days per existing code; UX Spec updated to match.

- [x] Unit tests (AC: #8)
  - [x] `determineInitialPage`: add case for `pathname: '/'` + `me: null` → `{ page: 'join' }`. Keep existing `/room/:code` and authenticated cases.
  - [x] Guest-name localStorage helper: round-trip test + simulated throw on `setItem` to verify silent fallback. Mock localStorage in test setup (typical vitest/jsdom pattern already in use).

- [x] Manual verification (user-confirmed 2026-04-05)
  - [x] Open root `/` unauthenticated in Chrome incognito → JoinPage visible, Host Login button top-right, name field empty + focused.
  - [x] Submit a name + valid code (use a running session). Close tab, reopen root `/` → name prefilled, focus still on name field (or button, acceptable).
  - [x] Tap Host Login → existing LoginPage / Spotify OAuth flow unchanged.
  - [x] Open root `/` in Safari Private mode → no error, Join still works, localStorage writes fail silently.

### Review Findings

_Code review 2026-04-05 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor: all 8 ACs satisfied._

- [x] [Review][Patch] `.join-page` missing `position: relative` — Host Login button uses `position: absolute` but parent has no positioned ancestor; button will anchor to viewport/body instead of the page container [src/client/pages/JoinPage.svelte:131]
- [x] [Review][Patch] Stored guest name not trimmed on read/write — whitespace-padded values silently fail `validateJoin` [src/client/lib/guestName.ts:5, src/client/pages/JoinPage.svelte:57]
- [x] [Review][Patch] Host Login button lacks `:focus`/`:focus-visible` style — keyboard users get no focus indicator [src/client/pages/JoinPage.svelte:234]
- [x] [Review][Patch] Host Login click during guest connect orphans the WebSocket — clicking while `connecting === true` unmounts JoinPage mid-handshake; button disabled while connecting [src/client/pages/JoinPage.svelte:76]
- [x] [Review][Patch] `clear()` in guestName.test.ts reassigns local `store` binding but stubbed closures hold the original reference — latent bug fixed by mutating in place [src/client/__tests__/guestName.test.ts:16]
- [x] [Review][Defer] Rapid repeated clicks on Host Login fire handler multiple times [src/client/pages/JoinPage.svelte:76] — deferred, minor: no orphaning risk once mid-connect guard lands, and page transition is idempotent
- [x] [Review][Defer] Host Login button may overlap `<h1>` on narrow viewports [src/client/pages/JoinPage.svelte:215] — deferred, cosmetic: no verified overlap at current breakpoints, revisit if reported
- [x] [Review][Defer] No test for `determineInitialPage` priority ordering (authenticated + /room/:code) [src/client/__tests__/dashboard.test.ts] — deferred, pre-existing coverage gap

## Dev Notes

### Session cookie lifetime — RESOLVED

Keep 30 days (existing value at [src/server/auth.ts:185](src/server/auth.ts#L185)). UX Spec Decision Log updated to reflect reality. No server change required in this story.

### Current routing behaviour (verified)

- [src/client/lib/ws.ts:13](src/client/lib/ws.ts#L13) — `determineInitialPage` for unauthenticated root `/` returns `{ page: 'login' }`. This is the line to change.
- `/room/:code` unauthenticated path returns `{ page: 'join', prefillCode }` — **do not touch**.
- Authenticated user (any path) returns `{ page: 'dashboard' }` — **do not touch** (DashboardPage stays routed for now; Story 7-2 repurposes it as Host Management).

### JoinPage current state

- [src/client/pages/JoinPage.svelte](src/client/pages/JoinPage.svelte) has NO "Hosting? Log in →" link today — the UX spec's OLD-state description was aspirational; the link never shipped. Story 7-1 is adding the host entry point for the first time.
- Autofocus on mount is already implemented ([JoinPage.svelte:19](src/client/pages/JoinPage.svelte#L19)). Guest name prefill needs to set `name` before autofocus so the input renders populated.
- Existing validation (`validateJoin`) handles name ≤ 30 chars etc. — no change required.

### LocalStorage access pattern

- Keep it tiny. One helper file `src/client/lib/guestName.ts` OR inline in `JoinPage.svelte` is fine. A separate helper is slightly better for testability.
- `try { localStorage.getItem(...) } catch { return '' }` — both read and write wrapped. Safari private mode throws on write; some browsers throw on read when storage is disabled.
- Key: `bangerbingo.guestName` (per UX spec Change U1).

### Host Login button wiring

- Two reasonable approaches:
  - **(A) Page-switch callback** — JoinPage exposes `onHostLogin` prop; App.svelte sets `page = 'login'`. LoginPage renders; user clicks its existing "Connect Spotify" button; OAuth proceeds. **Preferred** — minimal change, uses existing flow.
  - **(B) Direct OAuth init** — JoinPage navigates straight to `/auth/login` (backend OAuth entry). Skips the intermediate LoginPage. Slightly faster UX but LoginPage has a "Use desktop Chrome or Firefox for audio" advisory that's useful to preserve.
- Go with (A). If user later wants (B), that's a Story 7-2 concern when LoginPage is repurposed.

### What NOT to touch

- Do NOT repurpose DashboardPage yet — Story 7-2's job.
- Do NOT change the `/room/:code` guest prefill route.
- Do NOT touch session cookie `maxAge` without user sign-off (see Decision block above).
- Do NOT add any host-side localStorage (host name goes in httpOnly cookie in Story 7-3, not localStorage).

### Patterns from previous stories

- Story 6-1 kept scope narrow and flagged manual verification tasks explicitly. Apply same restraint here.
- JoinPage input styling already enforces `min-height: 44px` for hit targets — follow same convention for the Host Login button.

### Testing standards

- Existing tests in `src/client/lib/__tests__/` (or equivalent) should include a `determineInitialPage` spec — update it.
- New test file for `guestName.ts` helper if created. Mock `localStorage` via jsdom (default vitest setup).
- No E2E tests required — this is a routing + presentational change.
- `npm run lint` and `npm test` must pass.

### References

- UX Spec: [_bmad-output/ux-spec.md §Screen: Join](../ux-spec.md#screen-join) — layout + Host Login button spec
- UX Spec: [_bmad-output/ux-spec.md §Decision Log — "Guest name persistence"](../ux-spec.md#decision-log) — localStorage key + behaviour
- Epic 7: [_bmad-output/epics.md §Epic 7](../epics.md#epic-7-ux-flow-restructure) — full Epic 7 scope
- Sprint Change Proposal: [_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-05.md](../planning-artifacts/sprint-change-proposal-2026-04-05.md) — full context for Epic 7

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (Claude Code / bmad-dev-story)

### Debug Log References

- `npm run lint` → clean (tsc --noEmit, no errors)
- `npm test` → 13 files, 241 tests passed (6 new in `guestName.test.ts`)

### Completion Notes List

- **AC1 — routing:** Unauthenticated fallback in `determineInitialPage` flipped from `login` to `join`. `/room/:code` prefill path and authenticated `dashboard` branch untouched. Existing tests in [src/client/__tests__/dashboard.test.ts](src/client/__tests__/dashboard.test.ts) updated — the "unknown path" test now also expects `join` (the fallback is a catch-all; there are no other route branches).
- **AC2 — Host Login button:** Added a ghost-style `<button>` (transparent bg, muted grey border/text) positioned absolutely top-right of the `.join-page` container. Tapping calls `onHostLogin` prop → `App.svelte` sets `page = 'login'`, reusing the existing `LoginPage` "Connect Spotify" flow (approach A per Dev Notes). 44px min hit target preserved.
- **AC3/4/5 — guest name persistence:** New helper [src/client/lib/guestName.ts](src/client/lib/guestName.ts) with `getStoredGuestName()` / `setStoredGuestName()`, both wrapped in try/catch. Stable key `bangerbingo.guestName`. JoinPage initialises `name` state from the helper (via `$state(untrack(() => getStoredGuestName()))`) before the `onMount` autofocus, so users see their previous name pre-populated and focused. Write happens inside `onConnect` (i.e. only after the server confirms a successful Join). Room code is never touched by the helper.
- **AC6 — cookie maxAge:** unchanged per 2026-04-05 decision.
- **AC8 — tests:** Added [src/client/__tests__/guestName.test.ts](src/client/__tests__/guestName.test.ts) with 6 cases covering round-trip, overwrite, getItem/setItem throws, and `localStorage` undefined. Updated the two `determineInitialPage` cases at [src/client/__tests__/dashboard.test.ts:10](src/client/__tests__/dashboard.test.ts#L10) to expect `'join'`.
- Manual verification steps remain for the user (require a running dev server + real browsers).

### File List

- Modified: [src/client/lib/ws.ts](src/client/lib/ws.ts)
- Modified: [src/client/pages/JoinPage.svelte](src/client/pages/JoinPage.svelte)
- Modified: [src/client/App.svelte](src/client/App.svelte)
- Modified: [src/client/__tests__/dashboard.test.ts](src/client/__tests__/dashboard.test.ts)
- Added: [src/client/lib/guestName.ts](src/client/lib/guestName.ts)
- Added: [src/client/__tests__/guestName.test.ts](src/client/__tests__/guestName.test.ts)
- Modified: [_bmad-output/implementation-artifacts/sprint-status.yaml](_bmad-output/implementation-artifacts/sprint-status.yaml)

### Change Log

| Date | Change |
|------|--------|
| 2026-04-05 | Story 7-1 implemented: root `/` now lands on JoinPage, Host Login ghost button added, guest name persists in localStorage with silent fallback. |
