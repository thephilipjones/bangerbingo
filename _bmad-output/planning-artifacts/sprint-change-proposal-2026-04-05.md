# Sprint Change Proposal — UX Flow Restructure

**Date:** 2026-04-05
**Author:** Philip (+ Scrum Master navigation)
**Mode:** Batch review
**Scope classification:** **Moderate** (backlog reorganisation + new epic; no PRD goal changes)

---

## Section 1 — Issue Summary

### Problem statement

After living with the shipped end-to-end game (Epics 1–5 complete, Epic 6 in progress), the **host entry and game-page flows feel heavier than they should** for a friends-only music bingo app. Several things surfaced at once:

1. **The root URL mixes two audiences.** Guests need friction-zero join; hosts don't need to be on the same page. A host-login link sitting next to the Join CTA adds visual noise to the 90% flow and invites wrong-button taps.
2. **Dashboard + Lobby + Round Config are three screens where one overlay would do.** A host goes Dashboard → Create Room → Lobby → Configure Round → Start — four clicks before a round starts. For a personal-use app, this is over-scoped.
3. **Guests get no pre-round presence.** When they join, they land on a bingo-card page waiting for the round. They can't see who else has joined. The "waiting room with other players" expectation is missing.
4. **Host controls bottom sheet is over-built.** It combines now-playing, prev/play/next, players list, and End Round. A minimal mini-player with play/pause + next would match actual usage; the players list should be a separate overlay like the history drawer.
5. **Host is not listed as a player.** The PRD principle "host plays too" is spec'd but the host is never named or shown in the players list, so sessions can technically show "0 players" from a guest's view.
6. **Room code is not visible during the game.** Late arrivals require the host to re-share the code manually.
7. **Spotify auth doesn't persist long enough.** Host re-authenticates more often than is acceptable for a friends-only tool.

### Context

No single story triggered this. The list was surfaced holistically during review of the shipped UI ([src/client/pages/](../../src/client/pages/)) against real usage expectations for Story 6-1 (local-dev / multi-device testing). None of these are bugs in shipped code — they are design decisions that should change before Epic 6 hardens the deployed UX.

### Evidence

- Shipped pages: `DashboardPage.svelte`, `LobbyPage.svelte`, `RoundConfigPage.svelte`, `HostRoomPage.svelte`, `RoomPage.svelte` all exist; the flow is what was spec'd, but the spec itself is what needs revision.
- UX Spec [`_bmad-output/ux-spec.md`](../ux-spec.md) §Host Controls Panel (Mobile) describes a heavy bottom sheet combining 4 concerns.
- PRD §Terminology defines Session (evening) and Round (one bingo instance); the UI currently only supports ending a Round, not a Session.

---

## Section 2 — Impact Analysis

### Epic Impact

| Epic | Status | Impact |
|---|---|---|
| Epic 1 — Spotify Auth | ✅ done | **Minor:** session-cookie lifetime extension only |
| Epic 2 — Web Playback SDK | ✅ done | No impact |
| Epic 3 — Server Skeleton + Room Model | ✅ done | **Moderate:** Dashboard removed; guest waiting room replaces Lobby for pre-round; host-as-named-player requires WS handshake field change |
| Epic 4 — Bingo Card Generation | ✅ done | **Minor:** Round Config screen becomes an overlay; same inputs |
| Epic 5 — Game Loop | ✅ done | **Moderate:** Host controls rebuilt as mini-player + separate Players overlay; room code persistence in header; new "End Session" concept |
| Epic 6 — Deploy & Harden | in-progress (6-1) | **No scope change**, but depends on the new UX being in place before hosting/smoke tests |

### Story Impact (completed stories requiring revisions)

- [3-3 guest-join-screen](../../_bmad-output/implementation-artifacts/3-3-guest-join-screen.md) — remove "Hosting? Log in →" link visual tuning notes; keep link but spec it as a small top-right or footer "Host Login" button
- [3-4 login-and-lobby-screens](../../_bmad-output/implementation-artifacts/3-4-login-and-lobby-screens.md) — Dashboard/room-list concept removed; Lobby repurposed as Guest Waiting Room and between-rounds screen
- [4-2 round-configuration-screen](../../_bmad-output/implementation-artifacts/4-2-round-configuration-screen.md) — becomes an overlay launched from the game page (or from host-login on session start); removed as a standalone route
- [5-1 song-scheduling-and-host-playback-controls](../../_bmad-output/implementation-artifacts/5-1-song-scheduling-and-host-playback-controls.md) — drop Prev button; shrink to play/pause + next
- [5-3 host-card-view-and-controls-panel](../../_bmad-output/implementation-artifacts/5-3-host-card-view-and-controls-panel.md) — restructure: mini-player + Players overlay + Configure button + End Session

### Artifact Conflicts

| Artifact | Sections impacted |
|---|---|
| **PRD** [`_bmad-output/prd.md`](../prd.md) | Executive Summary (host flow description); Journey 1 (host happy path — flow simplified); §Functional Requirements if they enumerate Dashboard/Lobby screens |
| **UX Spec** [`_bmad-output/ux-spec.md`](../ux-spec.md) | Join screen (remove link, add host button); **remove Dashboard mention**; Login/Setup (simpler "management screen" target); **rename/repurpose Lobby → Guest Waiting Room + Between Rounds**; Round Config (becomes overlay, launched from session start and from in-game Configure button); Host Card View (room code in header, Players button in header); **replace** Host Controls Panel (Mobile) with Host Mini-Player + new Players overlay; add End Session flow (distinct from End Round); Decision Log additions |
| **Epics doc** [`_bmad-output/epics.md`](../epics.md) | Add **Epic 7: UX Flow Restructure** (all revisions bundled); keep Epic 1–5 acceptance bars as historical record |
| **Sprint status** [`sprint-status.yaml`](../implementation-artifacts/sprint-status.yaml) | Add epic-7 + stories |
| **Deferred work log** [`deferred-work.md`](../implementation-artifacts/deferred-work.md) | Cross-reference: several earlier "nice-to-have" polish items may now land in Epic 7 |

### Technical Impact

- **Frontend:** `App.svelte` page-routing state machine simplified (fewer pages, more overlays); 1 page deleted (Dashboard), 1 renamed/repurposed (Lobby → GuestWaitingRoom), 1 converted to overlay component (RoundConfig)
- **Backend:** WS `session:connect` payload adds `hostName` (so host shows in players list); session cookie `Max-Age` extended
- **Data model:** no schema changes
- **New concept:** "End Session" broadcasts `session:end` and closes the room; currently only `round:end` exists

---

## Section 3 — Recommended Approach

### Selected path: **Direct Adjustment via new Epic 7 (Hybrid with minor PRD revision)**

**Rationale:**

- **Not a rollback.** Shipped code is correct against spec; the spec needs updating. Reverting stories would discard working code that Epic 7 will refactor anyway.
- **Not an MVP review.** Core goals (host plays too, guest friction zero, self-hosted Spotify) are unchanged. This is a UX simplification, not a scope cut.
- **A new epic is cleaner than amending Epic 3/4/5.** Those are closed with retros; modifying them retroactively muddies the historical record. Epic 7 captures the restructure as one coherent unit of work with its own acceptance bar.
- PRD changes are scoped to terminology and journey descriptions — no goal revision.

**Effort estimate:** Medium (single frontend-focused epic, 3–5 stories)
**Risk:** Low (no new external dependencies; touches code that's already understood)
**Timeline impact:** Epic 7 slots **before Epic 6 production hardening**. Story 6-1 (local-dev testing) can absorb new flows; 6-2 onward benefits from shipping the revised UX.

### Proposed Epic 7 sequencing

1. **Story 7-1:** Root `/` cleanup + Host Login button + session cookie lifetime extension (14 days) + guest name localStorage prefill
2. **Story 7-2:** Host Management (repurposed Dashboard) — Spotify connection panel + New Session CTA + session list with timestamps + trash icon + `session:end` broadcast
3. **Story 7-3:** Round Config as overlay — launched from New Session + End Round action; add host name field
4. **Story 7-4:** Guest Waiting Room + host-as-named-player (`session:connect` adds `hostName`; host shows with `[host]` tag)
5. **Story 7-5:** Game page chrome — status-indicator header (`[N Players]` / muted room code / `[Nth Song]`), Players Overlay, Host Mini-Player (play/pause + next + gear), Host Controls Overlay (End Round, End Session, Host Management link)

*Note: Story 7-5 is scope-heavy; SM may split into 7-5a (header + Players overlay) and 7-5b (Mini-Player + Host Controls Overlay) during story creation if beneficial.*

Epic 6 (Deploy & Harden) continues in parallel where non-conflicting; Stories 6-2 onward should wait for Epic 7 to ship.

---

## Section 4 — Detailed Change Proposals

### 4.1 — PRD Changes

**File:** [`_bmad-output/prd.md`](../prd.md)

**Change P1 — Executive Summary (flow description)**

OLD:
> Hosts register an account, authenticate with Spotify Premium, and run game sessions via a shareable room URL and short room code.

NEW:
> Hosts authenticate with Spotify Premium via a small host-login entry on the landing page, reach a lightweight Host Management screen (start new / resume existing / delete sessions; view Spotify connection status), and configure the first round of a new session in an overlay. A shareable room code and URL are generated on session start and remain visible throughout the game.

Rationale: matches the simplified flow (no Dashboard/room-list step).

**Change P2 — Journey 1 (host happy path)**

OLD (excerpt):
> she opens the app on her MacBook, logs in, creates a room. She picks "90s Pop Hits" from the genre presets, sets clip length to 30s, and gets a shareable link and 5-character room code.

NEW:
> she opens the app on her MacBook, taps the small "Host Login" link on the landing page, authenticates with Spotify, and lands on the Session Manager. She taps "Start New Session" and the Configure Round overlay opens. She picks "90s Pop Hits" from the genre presets, sets clip length to 30s, enters her name, and taps Start Round. The room code appears at the top of the game page for sharing.

Rationale: reflects removal of Dashboard + Lobby; inclusion of host name capture.

**Change P3 — Add to Terminology (optional clarification)**

ADD to Terminology section:
> - **Host Management** — host's admin view listing sessions (with create timestamps and delete icons), Spotify connection status/controls, and a Start New Session CTA. Entry point after Host Login.
> - **Host Controls Overlay** — in-game bottom-sheet (reached via the gear icon in the Host Mini-Player) containing round-level and session-level actions: End Round, End Session, and a link back to Host Management.
> - **End Round** — host action that closes the current round, opens the Round Config overlay, and clears all player cards after confirmation. Produces a new round within the same session.
> - **End Session** — host action that closes the entire session (room destruction, guests disconnected). Available from the Host Controls Overlay in-game and as a trash icon per row in Host Management.
> - **Host Login** — entry point for hosts, separate from guest Join, reached via a small link on the landing page.

Rationale: new UI concept "End Session" needs a canonical definition.

---

### 4.2 — UX Spec Changes

**File:** [`_bmad-output/ux-spec.md`](../ux-spec.md)

**Change U1 — §Screen: Join — swap "Hosting? Log in →" link for compact "Host Login" button**

OLD:
> ```
> │   ┌─────────────────┐   │
> │   │      Join       │   │  ← primary CTA
> │   └─────────────────┘   │
> │                         │
> │   Hosting? Log in →     │  ← small, low-prominence link
> ```

NEW:
> ```
> ┌─ [Host Login] ──────────┐  ← small button, top-right, low contrast
> │                         │
> │     🎵 Bangerbingo      │
> │                         │
> │   Your name             │
> │   [              ]      │
> │   Room code             │
> │   [              ]      │
> │                         │
> │   ┌─────────────────┐   │
> │   │      Join       │   │  ← primary CTA
> │   └─────────────────┘   │
> └─────────────────────────┘
> ```
> Host Login button is visually recessive (text-only or ghost-button style) and positioned away from the primary Join CTA to prevent mis-taps. No auth gate beyond Spotify OAuth is required for the MVP; the button simply routes to Host Management.

**Guest name persistence:** on successful join, the guest's name is saved to `localStorage` under a stable key (e.g. `bangerbingo.guestName`). On subsequent visits to `/`, the name field is prefilled from localStorage (user can edit/overwrite). Room code is never persisted.

Rationale: root page is guest-first; host entry is present but deliberately minimal; name prefill eliminates re-typing for returning guests across sessions.

**Change U2 — §Screen: Login / Setup — rename to "Host Management" and restructure**

OLD section describes `/login` and `/setup` with a post-login "host dashboard (room list / create room)".

NEW: Rename section to **"Screen: Host Management (`/host`)"**. After Spotify OAuth completes, host lands on Host Management:

```
┌─────────────────────────┐
│ Bangerbingo — Host      │
├─────────────────────────┤
│  Spotify: ✓ Connected   │  ← connection status
│  Signed in as [name]    │
│  [Disconnect]           │  ← small, muted
│                         │
│  ┌─────────────────┐    │
│  │ Start New Session│    │  ← primary CTA
│  └─────────────────┘    │
│                         │
│  Existing sessions      │
│                         │
│  KXJM  Apr 5, 14:32  🗑 │  ← tap row to resume; trash icon deletes
│  PZNT  Apr 3, 21:10  🗑 │
│  RQWB  Apr 1, 19:48  🗑 │
│                         │
└─────────────────────────┘
```

- **Spotify connection panel** at top: status (✓ Connected / ⚠ Reconnect needed), account name, Disconnect action
- **Start New Session** → opens Configure Round overlay for a fresh room (new code, new state)
- **Row tap** → resume session as host (host re-joins existing room)
- **Trash icon** → confirmation dialog → deletes session from server (broadcasts `session:end`)
- Timestamp shows session creation time in host's local timezone
- List sorted newest first

When Spotify connection is in a degraded state (`auth:degraded` received, reconnect required), the panel surfaces a "Reconnect Spotify" CTA inline.

Rationale: this is the host's persistent admin surface — one screen covers account/connection state AND session lifecycle. "Host Management" reflects that broader scope vs. "Session Manager".

**Change U3 — §Screen: Round Config — convert to overlay, add host name field**

OLD: Full-screen or large bottom sheet standalone page (`/round-config` equivalent).

NEW: **Round Config Overlay** — a modal opened from two entry points:
1. From Host Management via "Start New Session" (first round of a new room)
2. From the **End Round** action in the Host Controls Overlay (starts a new round within the existing session; clears current card state for all players after confirmation)

Add a **"Your name"** text field (required, ≤ 30 chars) at the top of the overlay on first use per session. Persisted via httpOnly cookie; pre-filled on subsequent opens within the same session. Start Round CTA closes the overlay and drops all connected clients into the Game page.

When opened mid-session via End Round:
- Name field hidden (already set)
- A "Starting a new round will clear everyone's cards" warning appears above Start Round
- Start Round CTA requires a confirmation dialog: "End current round and start new? [Cancel] [Start New Round]"

Rationale: overlay pattern is lighter-weight; single config component serves both first-round and new-round flows. End Round is the honest name — changing playlist always means clearing the current round.

**Change U4 — §Screen: Lobby / Between Rounds — split into two distinct states**

OLD: Single "Lobby / Between Rounds" screen with spinning vinyl, trivia, player count, and (for host) a "Configure Round" CTA.

NEW: Split into:

**Screen: Guest Waiting Room** — shown to guests between `session:connect` and the first `song:start`:
```
┌─────────────────────────┐
│ Bangerbingo    KXJM     │  ← room code in header
├─────────────────────────┤
│                         │
│  You're in!             │
│                         │
│  Players here (3)       │
│  • Marcus               │
│  • Priya                │
│  • Sarah [host]         │  ← host tag small, muted
│  • [you]                │
│                         │
│  Waiting for host to    │
│  start the round…       │
│                         │
└─────────────────────────┘
```

**Component: Between-Rounds state** — replaces the card on the Game page between rounds, not a separate screen. Shows vinyl + trivia + player count inline within the Game page frame, so the Host Mini-Player + room-code header stay visible. Host's Configure button remains active.

Rationale: waiting-room player-name visibility is a clear guest expectation; between-rounds is an in-game state, not a different screen.

**Change U5 — §Screen: Host Card View — restructure header with status-indicator buttons + muted room code**

OLD header: `Bangerbingo  [≡ History]`

NEW header:
```
│ [5 Players]      KXJM      [4th Song] │
```
- **Left button — "5 Players"** (live count + label) opens Players overlay. Button text updates on `player:joined`/`player:left`.
- **Center — room code** (monospace, muted/lower-contrast, tappable to copy)
- **Right button — "4th Song"** (ordinal for current song in round) opens History drawer. Button text updates on each `song:start`. Pre-round fallback: "History" (no active song).
- Wordmark "Bangerbingo" removed from header during gameplay — the buttons + code are higher-signal and real-estate is tight on mobile
- Same header applies to Guest Card View (same buttons, same room code, same labels)

Rationale: buttons carry live status as well as affording the overlays — fewer UI elements doing more work. Muted room code keeps it available without competing with the status buttons.

**Change U6 — Replace §Component: Host Controls Panel (Mobile) with Host Mini-Player**

OLD: Partial bottom sheet (~50% peek) with drag handle, now-playing, prev/play/next, players list, End Round button.

NEW:

**Component: Host Mini-Player**

```
┌─────────────────────────────────────┐
│ Don't Stop Believin' — Journey      │  ← now-playing, single line
│ [▶/‖]       [⏭ Next]           [⚙] │  ← fixed to bottom of viewport
└─────────────────────────────────────┘
```

- **Fixed** to bottom of viewport on host Game page; not a sheet, not dismissable
- **Play/Pause** toggle (single button, icon changes with state)
- **Next** — advances to next song
- **⚙ Gear** — opens Host Controls Overlay (see Change U11)
- **Prev button removed** — low-use (per previous size hierarchy: "Previous — small, rare use")
- **Players list** removed from this component — now in header Players overlay
- **Round and session management actions** are not direct mini-player buttons — they live in the Host Controls Overlay reached via the gear. Keeps the in-game bar focused on playback only.

In **Full song** mode: Play/Pause is primary interaction. In **Clip** mode: Next is the primary manual-override (auto-advance still applies).

**SDK failure state:** mini-player replaces Play/Pause with "[Open in Spotify →]" deep link; Next still functional. Same server game-state advance behaviour as spec'd.

Rationale: the bar is purely playback. Management actions are one tap away behind the gear — accessible but never competing for attention during play.

**Change U7 — Add new §Component: Players Overlay**

NEW section:
```
┌─────────────────────────┐
│  ── drag handle ──      │
│  Players (4)            │
├─────────────────────────┤
│                         │
│  Sarah  [host]          │  ← host tag small, brand-colour pill
│  Marcus                 │
│  Priya                  │
│  Tom                    │
│                         │
└─────────────────────────┘
```

- Bottom sheet, same pattern as History drawer
- Triggered by Players button in header
- Live updates on `player:joined` / `player:left`
- Host shown with small `[host]` pill next to name
- Current user shown with `(you)` suffix or subtle highlight

Rationale: matches History drawer mental model; extracts players from the crowded controls sheet.

**Change U8 — Add new §End Session Flow (two entry points)**

NEW section:

**End Session** can be triggered from two places:

**A. Host Controls Overlay (in-game)** — for ending the session the host is currently running:
1. Host taps ⚙ gear in Mini-Player → Host Controls Overlay opens
2. Host taps "End Session"
3. Confirmation dialog: **"End this session for everyone?"** with subcopy *"All players will be disconnected and the room will close."* → [Cancel] [End Session]
4. If confirmed: server emits `session:end { reason: "host_ended" }` to all connected clients, destroys the room, removes session record
5. Host is redirected to Host Management

**B. Host Management (admin)** — for cleaning up past or inactive sessions:
1. Host taps trash icon 🗑 on a session row
2. Confirmation dialog: **"Delete session [CODE]?"** with subcopy *"Any connected players will be disconnected. This can't be undone."* → [Cancel] [Delete]
3. If confirmed: server emits `session:end { reason: "host_deleted" }` to all connected clients in that room, destroys the room, removes session record
4. Host Management refreshes the list

**Guest-side behaviour (both paths):** guests receive `session:end`, disconnect, redirect to `/` with a banner: *"Session ended by host."* (persists for ~5s then dismissible).

Distinct from `round:end` which just moves to between-rounds state within an active session.

Rationale: in-game path for the natural "we're done playing" moment; admin path for housekeeping old rooms. Both hit the same server endpoint.

**Change U9 — WebSocket Event Contracts additions**

ADD to §WebSocket Event Contracts:

```ts
// session:end
{
  event: "session:end",
  reason: "host_deleted" | "host_timeout"
}
```

Fired when a host deletes a session via Session Manager (or server times out an abandoned session). Guests receive this, disconnect, and redirect to `/` with a "Session ended by host" banner.

MODIFY `session:connect` payload — add `hostName`:

```ts
{
  event: "session:connect",
  role: "host" | "guest",
  playerName: string,
  hostName: string,       // NEW — always populated; host sees their own, guests see host's
  roomCode: string,
  roundActive: boolean,
  // ...
}
```

Rationale: host-as-named-player requires server-side host name capture + broadcast.

**Change U10 — Decision Log additions**

ADD rows:

| Topic | Decision | Rationale |
|---|---|---|
| Root page audience | Guest-first; host entry is a small recessive button, not primary CTA | Prevents mis-taps; 90% flow is guest join |
| Guest name persistence | Guest name stored in localStorage; prefilled on return visits | Returning guests shouldn't retype; room code never stored |
| Host Management as landing | After OAuth, host lands on Host Management (Spotify status + New Session CTA + session list with timestamps/trash icons) | One admin surface for account + session lifecycle |
| Round Config as overlay | Modal instead of standalone screen; same component for first-round and mid-session new-round | Single component, lighter navigation |
| Host is a named player | Host provides name at session start; appears in players list with `[host]` pill | Matches "host plays too" principle; eliminates 0-players display |
| Mini-player minimal | Three buttons only (play/pause, next, gear); no round/session controls exposed directly | Bar is for playback; management is one tap away |
| Host Controls Overlay | Bottom sheet reached via gear icon; contains End Round, End Session, link to Host Management | Groups lifecycle + navigation actions away from playback |
| Header status-indicator buttons | Players button shows "N Players", History button shows "Nth Song" | Buttons carry live status + afford their overlays; doubles up UI work |
| Room code in header | Centered, muted/lower-contrast, tappable to copy | Persistent for late-arrival sharing without dominating the header |
| End Session dual entry | Available in-game (Host Controls Overlay) and as trash icon in Host Management | In-game for natural end, admin for housekeeping — same server behaviour |
| End Round naming | "End Round" instead of "Configure" | Changing playlist always clears the round; honest naming |
| Players in overlay | Players list is its own overlay, same pattern as History drawer | Consistent mental model; decouples from controls |
| Host session cookie lifetime | Extended to 14 days (previously session-only) | Host re-auth friction; refresh token continues to extend as long as cookie valid |

**Change U11 — Add new §Component: Host Controls Overlay**

NEW section:

**Trigger:** Host taps ⚙ gear in Host Mini-Player
**Layout:** Bottom sheet, ~40% screen height, same pattern as Players/History drawers

```
┌─────────────────────────┐
│  ── drag handle ──      │
│  Host Controls          │
├─────────────────────────┤
│                         │
│  ↻ End Round            │  ← opens Round Config overlay (new playlist + cards)
│                         │
│  ⏻ End Session          │  ← confirm → session:end broadcast
│                         │
│  ───────────────        │
│                         │
│  →  Host Management     │  ← navigate out of game to admin
│                         │
└─────────────────────────┘
```

- **End Round** — closes the overlay, opens Round Config overlay with mid-session variant (confirmation required, cards will clear)
- **End Session** — confirmation dialog → server broadcasts `session:end`, host returns to Host Management, guests redirected
- **Host Management link** — navigates host back to `/host` (session list, Spotify controls). Active session continues running server-side; guests remain connected; host can re-enter via session row tap.

Rationale: consolidates round and session lifecycle actions behind a single gear icon; keeps Mini-Player focused on playback; provides a clean escape hatch to Host Management without ending the session.

---

### 4.3 — Epics Changes

**File:** [`_bmad-output/epics.md`](../epics.md)

**Change E1 — Add Epic 7 after Epic 6**

```markdown
## Epic 7: UX Flow Restructure

*Depends on Epics 1–5 (all shipped). Runs in parallel with Epic 6 where non-conflicting; Epic 6 stories 6-2+ should wait for Epic 7 ship.*

**Scope:** Revise host/guest entry flows, repurpose Dashboard as Host Management, convert RoundConfig/Lobby to overlays + waiting room, rebuild host controls as minimal mini-player + Host Controls Overlay + status-indicator header, persist muted room code, make host a named player, add End Session dual-path.

**Frontend:**
- Root `/` cleanup: guest-first Join form + small recessive Host Login button + guest name localStorage prefill
- Repurpose Dashboard as Host Management: Spotify connection panel + New Session CTA + session list with create timestamps + trash icons
- Convert Round Config to overlay (launched from New Session + End Round action); add host name field
- Replace standalone Lobby with Guest Waiting Room (pre-round, player names visible) + in-game Between-Rounds component
- Rebuild Host Mini-Player (fixed bottom): play/pause + next + gear icon
- New Host Controls Overlay (bottom sheet): End Round, End Session, link to Host Management
- New Players Overlay (bottom sheet, same pattern as History)
- Game page header: `[N Players]` + muted room code (center) + `[Nth Song]`; same header for host and guest
- Host name capture in Round Config overlay on first use per session
- End Session confirmation → `session:end` broadcast → guest redirect with banner

**Server:**
- `session:connect` payload: add `hostName`
- `session:end { reason }` broadcast on end-session (in-game or admin delete); room destruction
- Session cookie `Max-Age` extended to 14 days

**Acceptance bar:** Host logs in, lands on Host Management (Spotify status + sessions + New Session), taps New Session → Configure overlay (enter name + playlist) → Start Round. Guests join via root URL with name prefilled from prior visit, see waiting room with all named players (host with `[host]` tag) and room code in URL. Game page header shows status-indicator buttons (`N Players`, `Nth Song`) flanking a muted room code. Host Mini-Player (fixed bottom) is play/pause + next + gear. Gear opens Host Controls Overlay with End Round, End Session, and Host Management link. Host can delete any session from Host Management; connected guests are redirected with a banner. Host stays logged in for 14 days.
```

**Change E2 — Add note to Epic 6 header**

Insert after Epic 6 title:
> **Sequencing note (2026-04-05):** Story 6-1 continues. Stories 6-2+ wait for Epic 7 ship so production hardening targets the revised UX.

---

### 4.4 — Sprint Status Changes

**File:** [`_bmad-output/implementation-artifacts/sprint-status.yaml`](../implementation-artifacts/sprint-status.yaml)

ADD under `development_status`:

```yaml
  # Epic 7: UX Flow Restructure
  epic-7: backlog
  7-1-root-cleanup-host-login-cookie-localstorage: backlog
  7-2-host-management-session-list-and-delete: backlog
  7-3-round-config-overlay-and-host-name: backlog
  7-4-guest-waiting-room-and-host-as-player: backlog
  7-5-game-page-chrome-and-host-controls-overlay: backlog
  epic-7-retrospective: optional
```

Update `last_updated` to `2026-04-05 # epic-7 added via correct-course`.

---

## Section 5 — Implementation Handoff

### Scope classification: **Moderate**

- Requires backlog reorganisation (new epic + 5 stories)
- Requires PRD + UX Spec edits
- No architectural/PM escalation required — goals unchanged

### Handoff recipients & responsibilities

| Role | Responsibility |
|---|---|
| **Philip (PM/owner)** | Approve this proposal; apply PRD + UX Spec edits (or delegate to SM); confirm Epic 7 story sequence |
| **Scrum Master** | Create Epic 7 story files (7-1 → 7-5) using `bmad-create-story` skill, one at a time as Dev completes the prior |
| **Developer (Amelia)** | Implement each Epic 7 story via `bmad-dev-story` workflow; close with code-review pass |
| **Epic 6 Dev work** | 6-1 continues unchanged; 6-2+ paused until Epic 7 stories done |

### Success criteria

1. Landing page `/` shows only Join form + small Host Login button; guest name prefilled from localStorage on return visits
2. Host login → Host Management (Spotify panel + New Session + session list with timestamps/trash)
3. New Session → Configure Round overlay (host enters name + playlist) → Start Round
4. Guest joins → Waiting Room with all players named, host shown with `[host]` tag, room code in URL
5. Game page header: `[N Players]` button (live count) + muted room code (center) + `[Nth Song]` button
6. Host Mini-Player (fixed bottom) shows only: play/pause, next, gear
7. Gear opens Host Controls Overlay with End Round, End Session, Host Management link
8. End Round confirms before clearing cards; End Session confirms before destroying room
9. Session trash icon in Host Management → same server behaviour as End Session → guests redirected with banner
10. Host stays authenticated for 14 days without re-login

### Deliverables checklist

- [ ] PRD edits applied (Changes P1–P3)
- [ ] UX Spec edits applied (Changes U1–U10)
- [ ] Epics doc updated (Changes E1–E2)
- [ ] sprint-status.yaml updated (Epic 7 added)
- [ ] Story 7-1 created and in ready-for-dev
- [ ] Epic 6 Story 6-1 note added about Epic 7 dependency

---

## Approval

**Awaiting Philip's explicit approval to proceed with artifact edits and Epic 7 creation.**

Options:
- **Approve as-is** → I apply all PRD, UX Spec, Epics, and sprint-status edits in sequence
- **Approve with revisions** → specify which sections need adjustment
- **Reject** → discuss alternative direction
