---
title: 'BB logo as home link on JoinPage and Dashboard'
type: 'feature'
created: '2026-04-22'
status: 'done'
context: []
baseline_commit: '02810d4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A guest landing on a prefilled-code URL (e.g. `/ABCD`) with an error or no matching room has no obvious way back to the plain join screen. The BB logo looks clickable but does nothing. Hosts on the Dashboard also lack a natural "go see what a guest sees" path beyond an explicit button.

**Approach:** Make the top-of-page BB logo a clickable home link that always navigates to `/` (guest JoinPage). Apply on JoinPage (clears prefilled code) and DashboardPage (replaces the now-redundant "Join a Session" button). Logos on LoginPage, inside the game-session `GameHeader`, and the decorative hero wordmark on JoinPage stay non-interactive — those contexts either already ARE home or leaving them mid-session is destructive and needs an explicit button.

## Boundaries & Constraints

**Always:**
- Logo click always resolves to `/` (guest JoinPage). No role-dependent branching.
- Use a `<button>` element (not `<a>`) so the SPA page-state and URL stay in sync via `history.pushState`; no full page reload.
- Preserve accessibility: visible focus ring (match existing `.header-btn:focus-visible` style), `aria-label="Home"`, `min-height: 44px` hit target.
- On JoinPage, clicking the logo clears `code` and `codeError` state and updates URL to `/`. Keeps the typed `name` (cheap to retain, reduces friction).
- On JoinPage, do nothing while `connecting` is true (don't interrupt an in-flight WebSocket handshake).

**Ask First:**
- None.

**Never:**
- Do NOT make the `GameHeader` logo clickable — it is bonded to the room-code copy button and leaving mid-game is destructive. A dedicated Leave button already exists.
- Do NOT make the LoginPage logo clickable — login is already the unauthed root.
- Do NOT make the JoinPage hero wordmark clickable — it is decorative, and the top-bar mark already handles home.
- Do NOT modify `Logo.svelte`. Add interactivity at the call site.
- Do NOT introduce a router dependency; keep the existing `history.pushState` + page-state pattern.

</frozen-after-approval>

## Code Map

- `src/client/pages/JoinPage.svelte` -- wrap top-bar `<Logo>` in a button; add `handleHome()` that clears code + updates URL
- `src/client/pages/DashboardPage.svelte` -- wrap header `<Logo>` in a button wired to `onJoinAsGuest`; remove the now-redundant "Join a Session" `<Button>`
- `src/client/App.svelte` -- no changes; existing `handleJoinAsGuest()` already pushes `/` and sets page to `join`
- `src/client/lib/components/Logo.svelte` -- read-only reference; do not modify

## Tasks & Acceptance

**Execution:**
- [x] `src/client/pages/JoinPage.svelte` -- wrap `<Logo size={28} variant="mark-only" />` in a `<button class="logo-home" aria-label="Home">` that calls a new `handleHome()` which sets `code = ''`, `codeError = ''`, and calls `history.pushState(null, '', '/')`. Guard with `if (connecting) return`. Add minimal CSS: button reset + inherited color + `focus-visible` outline matching `.header-btn`.
- [x] `src/client/pages/DashboardPage.svelte` -- wrap `<Logo size={36} variant="full" />` in a `<button class="logo-home" aria-label="Home">` that calls `onJoinAsGuest`. Remove the `<Button variant="ghost" size="lg" onclick={onJoinAsGuest}>Join a Session</Button>` line and any resulting dead styles. Same button reset + focus-visible treatment.

**Acceptance Criteria:**
- Given a guest is on JoinPage with a prefilled code `/ABCD` and no submission in flight, when they tap the top-bar BB logo, then `code` becomes `''`, the URL becomes `/`, the name input retains its value, and no WebSocket request is issued.
- Given a guest is submitting a join (connecting=true), when they tap the logo, then nothing happens (no state change, no URL change).
- Given a host is on Dashboard, when they tap the BB logo, then the app navigates to `/` and shows the JoinPage — identical behavior to the previous "Join a Session" button, which is now gone.
- Given keyboard focus lands on the logo button on either page, when the user presses Enter or Space, then the same home behavior runs and a visible focus ring is shown.

## Verification

**Commands:**
- `npm run check` -- expected: Svelte + TS check passes with no new errors
- `npm run lint` -- expected: no new lint errors
- `npm test` -- expected: existing suite passes (no new tests required; dashboard.test.ts and join.test.ts exercise lib helpers, not components)

**Manual checks:**
- Start dev server; open `/WXYZ` as guest, tap BB logo: URL resets to `/`, code input clears, name retained.
- Log in as host at `/host`, tap BB logo: land on `/` JoinPage.
- Confirm "Join a Session" button is gone from Dashboard.
- Start a room, join as guest, confirm tapping the logo inside the room (GameHeader) still copies the code (unchanged).
- Tab to the logo button on each page; confirm focus ring visible and Enter activates it.

## Spec Change Log

_None — no spec amendments. One review-round patch applied directly to code: introduced `locked` local state in JoinPage so tapping the logo also clears the lock icon and readonly-code-input branch (edge-case hunter finding: `prefillCode` prop alone would leave the input stuck read-only even after `code` cleared)._

## Suggested Review Order

**Home-link wiring**

- Entry point — new `handleHome()` clears code, errors, and the lock flag before pushing `/`.
  [`JoinPage.svelte:52`](../../src/client/pages/JoinPage.svelte#L52)

- `locked` local state added so the home action actually unsticks the readonly code field (not just clears its value).
  [`JoinPage.svelte:30`](../../src/client/pages/JoinPage.svelte#L30)

- Top-bar mark wrapped in a `<button aria-label="Home">` — `connecting` guard in the handler keeps auto-rejoin safe.
  [`JoinPage.svelte:114`](../../src/client/pages/JoinPage.svelte#L114)

- Template gates flipped from `prefillCode` (prop) to `locked` (state) so the lock icon + readonly branch respond to `handleHome`.
  [`JoinPage.svelte:149`](../../src/client/pages/JoinPage.svelte#L149)

**Dashboard consolidation**

- Logo button replaces the "Join a Session" ghost button; same `onJoinAsGuest` handler, fewer CTAs.
  [`DashboardPage.svelte:156`](../../src/client/pages/DashboardPage.svelte#L156)

**Styling**

- Shared `.logo-home` reset: 44px hit target, inherited color, accent focus ring — duplicated across both pages (scoped, no shared stylesheet).
  [`JoinPage.svelte:209`](../../src/client/pages/JoinPage.svelte#L209)
  [`DashboardPage.svelte:261`](../../src/client/pages/DashboardPage.svelte#L261)
