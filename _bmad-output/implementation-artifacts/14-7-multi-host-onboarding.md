# Story 14-7: Multi-Host Onboarding — Error UX + Docs

## Status: done

## Context

A friend tried to host a Bangerbingo game, passed through Spotify's OAuth screen, landed back on `/login`, and saw "Login failed. Try again." with no explanation and no way forward. They gave up. On investigation, two realizations:

1. **The app is already fully multi-host.** PKCE OAuth at [src/server/auth.ts:82-202](src/server/auth.ts#L82), per-host tokens in `hosts` table ([src/server/db.ts:12-17](src/server/db.ts#L12)), rooms scoped to `host_user_id` ([src/server/rooms.ts:412-433](src/server/rooms.ts#L412)). The `.env` only holds app-level OAuth identity — nothing host-specific.
2. **The real blocker is Spotify's Development Mode cap** (5 manually-allowlisted Spotify users, Feb 2026). Friends cannot self-register. When a non-allowlisted friend auths, Spotify returns `error=access_denied` → our [auth.ts:121-123](src/server/auth.ts#L121) forwards as `?error=spotify_denied` → [LoginPage.svelte:32](src/client/pages/LoginPage.svelte#L32) shows a generic message.

This story fixes the error UX so friends understand *why* and *what to do next*, writes an internal checklist so Philip can allowlist friends mechanically, and drafts Extended Quota Mode application materials so the 5-user cap can be lifted later without a scramble.

## Story

As a **friend trying to host my first Bangerbingo game**,
I want **the app to tell me why my login failed and how to request access**,
so that **I can reach out to Philip for an invite instead of giving up at a dead-end error**.

## Acceptance Criteria

**AC-1 — Error message map on LoginPage.**
[src/client/pages/LoginPage.svelte](src/client/pages/LoginPage.svelte) looks up the `?error=<code>` query param against a typed message map and renders a specific message per code. Codes come from [src/server/auth.ts](src/server/auth.ts):

- `spotify_denied` — "Bangerbingo is in private beta — Philip needs to add your Spotify account to the allowlist before you can log in." + **Request access** button (mailto).
- `missing_verifier` — "Login timed out. Click Connect Spotify to start over."
- `token_exchange_failed` — "Spotify login didn't complete. Try again."
- `me_fetch_failed` — "Couldn't reach Spotify to confirm your account. Check your connection and try again."
- `server_error` — "Something went wrong on our end. Try again in a moment."
- Unknown code — fallback: "Login failed. Try again." (existing behavior for forward compat).

**AC-2 — Request-access copy-to-clipboard.**
Only the `spotify_denied` branch renders a `Copy request message` button. Clicking writes a pre-formatted message ("Hi Philip — please add me…" + the two fields Philip needs: Spotify display name, Spotify account email) to the clipboard via `navigator.clipboard.writeText`. Button label flips to `Copied — send to Philip` for 2s as confirmation. **No email address ships in the client bundle** (scraper-safe); the user sends the copied message to Philip through whatever channel they already use (the same channel that got them the app URL). Clipboard failures are silently no-op'd — user can still reach out manually.

**AC-3 — No regression to existing login flow.**
`/login` with no `?error=` param renders unchanged. Authenticated users still redirect via `onAuthenticated()`. The "Connect Spotify" primary button still points at `/auth/login`. No server changes.

**AC-4 — Onboarding doc.**
New file `docs/add-new-host.md` walks Philip through: collecting the friend's Spotify display name + email, adding them in Spotify Dashboard → Users and Access, confirming login works, and troubleshooting character-exact email mismatches. Notes the 5-user cap and points to the Extended Quota draft as the escape hatch.

**AC-5 — Extended Quota application draft.**
New file `docs/spotify-extended-quota-application.md` contains a living draft of the materials Spotify requires for Extended Quota Mode review: app description, use-case justification, data usage statement, demo video outline, privacy statement placeholder, and a submission checklist with explicit TODOs for assets that don't exist yet (privacy URL, demo video recording).

**AC-6 — No TypeScript regression.**
`npm run build` (tsc) passes. No new type errors introduced by the error-map changes.

## Implementation Sketch

Error-map shape in LoginPage:

```ts
type ErrorInfo = { message: string; showAllowlistRequest?: boolean }
const errorMessages: Record<string, ErrorInfo> = { /* … codes above */ }
const errorCode = new URLSearchParams(window.location.search).get('error')
const errorInfo = errorCode
  ? errorMessages[errorCode] ?? { message: 'Login failed. Try again.' }
  : null
```

Markup:

```svelte
{#if errorInfo}
  <div class="error-block">
    <p class="error u-small">{errorInfo.message}</p>
    {#if errorInfo.showAllowlistRequest}
      <Button variant="ghost" size="sm" onclick={openMailto}>Request access</Button>
    {/if}
  </div>
{/if}
```

Use the existing `Button` component so styling matches the rest of the app. No new dependencies.

## Non-goals

- No server-side error code changes — the codes already emitted are sufficient.
- No in-app admin panel to view/edit the Spotify allowlist (dashboard is source of truth).
- No i18n — matches existing app single-language convention.
- No actual Extended Quota submission — materials sit dormant until user-count forces the move.
- No privacy page publication — noted as a TODO in the draft.

## Risk Notes

- **Error code drift** — if [auth.ts](src/server/auth.ts) adds a new error code, LoginPage falls back to the generic message (safe). Not a breakage, just a missed opportunity for specificity; address when adding the new code.
- **Clipboard permissions** — `navigator.clipboard.writeText` requires secure context (HTTPS or localhost) and a user gesture. The button click satisfies the gesture; localhost/Tailscale HTTPS satisfies the context. On permissions denial the `catch` is silent — acceptable because the user already knows to contact Philip through whatever channel told them about the app.

## References

- [src/client/pages/LoginPage.svelte](src/client/pages/LoginPage.svelte) — only code file touched
- [src/server/auth.ts](src/server/auth.ts) — read-only; source of the error codes
- Plan file: `/Users/Philip/.claude/plans/ok-new-top-priority-proud-karp.md`
- Related constraint memory: Spotify Dev Mode 5-user cap (Feb 2026)

## Review Findings

- [x] [Review][Decision] `/login-preview` reachable in production — resolved: deleted LoginPreviewPage.svelte and removed routing from App.svelte and ws.ts
- [x] [Review][Patch] `spotify_denied` message says "backend" instead of "allowlist" — fixed [src/client/pages/LoginPage.svelte]
- [x] [Review][Patch] `copyResetTimer` not cleared on component unmount — fixed with onDestroy [src/client/pages/LoginPage.svelte]
- [x] [Review][Patch] `copyResetTimer` not cleared on component unmount [src/client/pages/LoginPreviewPage.svelte] — moot, file deleted
- [x] [Review][Defer] Error strings and `accessRequestMessage` duplicated verbatim between `LoginPage` and `LoginPreviewPage` — strings already diverging; extract to shared module — deferred, pre-existing
- [x] [Review][Defer] `/login-preview` has no back-navigation for an authenticated host who lands on it — deferred, dev-tool-only concern
