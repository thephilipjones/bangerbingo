# Bangerbingo — UX Specification

**Author:** UX Design Review (Party Mode session 2026-04-03)
**Status:** Ready for implementation
**PRD ref:** `_bmad-output/prd.md`

---

## Contents

1. [Design Principles](#design-principles)
2. [Global Patterns](#global-patterns)
3. [Screen: Join (`/`)](#screen-join)
4. [Screen: Guest Card View (`/room/:code`)](#screen-guest-card-view)
5. [Screen: Host Card View (`/room/:code` — host session)](#screen-host-card-view)
6. [Screen: Guest Waiting Room](#screen-guest-waiting-room)
7. [Component: Between-Rounds State (in-game)](#component-between-rounds-state-in-game)
8. [Overlay: Round Config (Host)](#overlay-round-config-host)
9. [Screen: Win Moment](#screen-win-moment)
10. [Screen: Host Management (`/host`)](#screen-host-management)
11. [Component: Song History Drawer](#component-song-history-drawer)
12. [Component: Players Overlay](#component-players-overlay)
13. [Component: Host Mini-Player](#component-host-mini-player)
14. [Component: Host Controls Overlay](#component-host-controls-overlay)
15. [Component: SDK Failure Banner](#component-sdk-failure-banner)
16. [WebSocket Event Contracts](#websocket-event-contracts)
17. [Tile State Reference](#tile-state-reference)
18. [Decision Log](#decision-log)

---

## Design Principles

1. **Guest friction = zero.** Join in under 30 seconds, no account, no app.
2. **Host plays too.** Controls are always reachable without leaving the card.
3. **Server is truth.** Win detection, game state, and song sequencing live server-side. UI reflects, never leads.
4. **Degrade gracefully.** SDK failure is a fallback mode, not an error state. The game continues.
5. **Simple > clever.** The best UX is invisible. Delight comes after clarity.

---

## Global Patterns

### Typography scale (mobile baseline 375px)

| Use | Size | Notes |
|---|---|---|
| Room code display | 32px, monospace, bold | Must be shout-across-room legible |
| Card tile title | 11–12px | 2-line max, ellipsis overflow |
| Card tile artist | 10px, muted | Secondary, shown when revealed |
| Body / UI labels | 14–16px | Standard |
| Win headline | 48px+ | Full-screen moment |

### Touch targets

All interactive elements ≥ 44×44px (WCAG AA). Card tiles at 375px viewport: target ~60×60px with minimal gaps.

### Colour states (tile)

| State | Background | Border | Text |
|---|---|---|---|
| Unmarked | White / surface | Subtle | Full opacity |
| Marked | Brand fill | None | White |
| Win path | Gold/amber outline | 2px | White |
| FREE space | Brand fill, lighter | None | White, italic |

Contrast ratio ≥ 4.5:1 for all text on tile backgrounds (WCAG AA).

### Masked title effect

When `titleRevealAt` is set and not yet reached:
- Tile shows blurred text (CSS `filter: blur(4px)`) over the actual title string
- Label overlay: `"Song N"` (where N = song number in round) in small caps, centred
- Implies content exists and will be revealed — not a bug, not empty
- On reveal: blur animates out over 300ms, label fades, title snaps into focus

### Waiting state (between rounds / lobby)

- Centred spinning vinyl record SVG (CSS animation, ~80px)
- Below vinyl: random music trivia fact, cycling every 12 seconds with a fade transition
- Facts sourced from static JSON array (~50 facts) bundled with frontend
- Below fact: contextual status line ("Waiting for host to start the next round…" / "Round 2 of the night — get ready")

---

## Screen: Join

**Route:** `/` (root) and `/room/:code` (pre-filled variant)  
**Users:** All — guests and hosts arriving via link or shouted code

### Layout

```
┌─[Host Login]─────────────┐  ← small ghost button, top-right, low contrast
│                         │
│     🎵 Bangerbingo      │  ← wordmark, centred
│                         │
│   Your name             │
│   ┌─────────────────┐   │
│   │  Marcus         │   │  ← prefilled from localStorage if present; autofocus
│   └─────────────────┘   │
│                         │
│   Room code             │
│   ┌─────────────────┐   │
│   │  KXJM           │   │  ← monospace, ALL-CAPS auto-transform; never persisted
│   └─────────────────┘   │
│                         │
│   ┌─────────────────┐   │
│   │      Join       │   │  ← primary CTA
│   └─────────────────┘   │
│                         │
└─────────────────────────┘
```

**Host Login button** is visually recessive (text-only or ghost style), top-right, positioned away from the primary Join CTA to prevent mis-taps. Routes to `/host` (Host Management). No additional auth gate beyond Spotify OAuth.

**Guest name persistence:** on successful join, the guest's name is saved to `localStorage` under key `bangerbingo.guestName`. On subsequent visits to `/`, the name field is prefilled from localStorage (user can edit/overwrite). Room code is **never** persisted.

### Behaviour

**URL variant (pre-filled from `/room/:code`):**
- Room code field populated from URL param
- Field is `readonly` (not `disabled`) — styled with a subtle lock icon or distinct bg
- Name field prefilled from localStorage (if present), otherwise autofocuses — it's the only thing they need to fill in
- Host Login button still present

**Root URL variant:**
- Name field prefilled from localStorage (if present), otherwise empty + autofocused
- Room code field: empty, monospace input, auto-uppercases on input, strips spaces

**Submission:**
- Validates name (non-empty, ≤ 30 chars) and code (4–6 chars, alphanumeric)
- On success: name written to localStorage (`bangerbingo.guestName`); redirect to `/room/:code` as guest (WebSocket handshake with `role: guest, name`)
- Host arriving at root URL: they use the Host Login button — not this form

### Error states

| Condition | Message |
|---|---|
| Room code not found | "No room found for that code — double-check it?" |
| Room exists but no active session | "That room isn't running a session right now." |
| Name taken in session | "Someone named [X] is already here. Try a nickname." |
| Name empty | Inline: "What should we call you?" |
| Code malformed | Inline: "Room codes are 4–6 letters." |

### Room code character set

Room codes are **uppercase letters only, A–Z, excluding O and I** (visually ambiguous with 0 and 1 in any font). Generation and validation both apply this constraint. The input field auto-uppercases and strips any non-conforming character on input.

---

## Screen: Guest Card View

**Route:** `/room/:code` (guest WebSocket session)  
**Users:** Guests during an active round

### Layout (mobile, 375px)

```
┌─────────────────────────┐
│ [4 Players]  KXJM  [3rd Song] │  ← status-indicator header
├─────────────────────────┤
│                         │
│  ┌───┬───┬───┬───┬───┐  │
│  │   │   │   │   │   │  │
│  ├───┼───┼───┼───┼───┤  │
│  │   │   │ F │   │   │  │  ← F = FREE (centre, auto-marked)
│  ├───┼───┼───┼───┼───┤  │
│  │   │   │   │   │   │  │
│  ├───┼───┼───┼───┼───┤  │
│  │   │   │   │   │   │  │
│  └───┴───┴───┴───┴───┘  │
│                         │
└─────────────────────────┘
```

### Status-indicator header

The header replaces the wordmark with two live status-carrying buttons and a muted room code:

| Element | Content | Behaviour |
|---|---|---|
| Left button | `[N Players]` (live count + label) | Opens Players Overlay; updates on `player:joined`/`player:left` |
| Center | Room code (monospace, muted/lower-contrast) | Tap-to-copy; persistent throughout session |
| Right button | `[Nth Song]` (ordinal for current song in round) | Opens History drawer; updates on each `song:start`. Pre-round fallback: `History` |

Same header applies to Host Card View and Guest Waiting Room (Waiting Room omits the History button — no songs played yet).

The in-card status line (`"Song 3 of this round"`) is removed — the header now carries that information.

### Tile interaction

- **Tap:** toggle marked / unmarked
- **Long-press / hover (desktop):** reveal full title if truncated (tooltip or expand)
- No "Claim Bingo" button — server auto-detects win when marked tiles form a valid pattern
- Win is surfaced automatically as a full-screen overlay (see Win Moment screen)

### Tile content

**Pre-reveal (masked):**
```
┌───────────┐
│  Song 3   │  ← label, small caps, centred
│ ░░░░░░░░  │  ← blurred title text underneath
│ ░░░░░░    │
└───────────┘
```

**Post-reveal:**
```
┌───────────┐
│ Don't Stop│  ← 2-line max, 11px, ellipsis
│ Believin' │
│ Journey   │  ← artist, 10px, muted
└───────────┘
```

**Marked state** overlays brand fill colour; text remains visible in white.

### Status line

Below the card grid — one line, small, muted:
- During round: `"Song 4 of this round"`
- Waiting: `"Waiting for next song…"`
- Between rounds: replaced by waiting state (see Lobby screen)

---

## Screen: Host Card View

**Route:** `/room/:code` (host WebSocket session — same URL, role-aware rendering)  
**Users:** Host during active round

### Mobile layout

Identical to guest card view **plus** a persistent Host Mini-Player fixed to the bottom:

```
┌─────────────────────────┐
│ [4 Players] KXJM [3rd Song] │  ← status-indicator header
├─────────────────────────┤
│                         │
│     [5×5 bingo card]    │
│                         │
├─────────────────────────┤
│ Don't Stop — Journey    │  ← Host Mini-Player
│ [▶/‖]   [⏭ Next]    [⚙] │  ← fixed to bottom
└─────────────────────────┘
```

The gear icon (⚙) opens the Host Controls Overlay. See Component: Host Mini-Player and Component: Host Controls Overlay.

### Desktop layout (≥768px)

Split view — no overlay needed:

```
┌───────────────┬──────────────────┐
│ [4 Players] KXJM [3rd Song]      │  ← shared header
├───────────────┼──────────────────┤
│               │  Now playing     │
│  [5×5 card]   │  Don't Stop —…   │
│               │                  │
│               │  [▶/‖]  [⏭ Next] │
│               │                  │
│               │  [⚙ Host Controls]│
└───────────────┴──────────────────┘
```

Card takes ~60% width, controls take ~40%. Players list accessed via header `[N Players]` button (same on desktop). On desktop the Host Controls Overlay can render as an inline panel section rather than a bottom sheet.

---

## Component: Host Mini-Player

**Placement:** Fixed to bottom of viewport on the host Game page. Not a sheet, not dismissable, always visible.

```
┌─────────────────────────────────────┐
│ Don't Stop Believin' — Journey      │  ← now-playing, single line
│ [▶/‖]       [⏭ Next]           [⚙] │  ← three buttons only
└─────────────────────────────────────┘
```

### Buttons

| Button | Behaviour |
|---|---|
| **▶/‖ Play/Pause** | Toggle (single button, icon reflects state) |
| **⏭ Next** | Advances to next song (broadcasts `song:start`) |
| **⚙ Gear** | Opens Host Controls Overlay |

**Prev button removed** — low-use; reverting songs mid-party isn't a needed affordance.
**Players list removed from this component** — now in the header Players Overlay.
**Round and session management actions removed** — they live in the Host Controls Overlay.

### Auto-advance behaviour

When a clip duration is set (not "Full song"), the server auto-advances to the next song when the clip ends — no host action required. The host's role during an auto-advance round is passive.

In **Full song** mode, the host advances manually using the Next button.

The Play/Pause button is present in both modes but primarily useful in Full song mode (e.g. pausing for a winner announcement). In clip mode, Play/Pause is a convenience override.

### SDK failure state

When `sdkFailed === true`, the mini-player replaces Play/Pause with a deep-link:

```
┌─────────────────────────────────────┐
│ ⚠ Audio via Spotify app — Journey   │
│ [Open in Spotify →]  [⏭ Next]  [⚙] │
└─────────────────────────────────────┘
```

Next Song still advances the server game state and broadcasts `song:start`. Gear still opens Host Controls Overlay. Host manually navigates in Spotify. The game is not blocked.

---

## Component: Host Controls Overlay

**Trigger:** Host taps ⚙ gear in Host Mini-Player
**Behaviour:** Bottom sheet, ~40% screen height; same pattern as Players/History drawers

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

### Actions

- **End Round** — closes the overlay, opens Round Config overlay (mid-session variant; confirmation required, cards will clear on confirm)
- **End Session** — confirmation dialog *"End this session for everyone? All players will be disconnected and the room will close."* → server broadcasts `session:end { reason: "host_ended" }` → host redirects to `/host` (Host Management)
- **Host Management link** — navigates host to `/host`. The active session continues running server-side; guests remain connected; host can re-enter via session row tap in Host Management.

### End Round flow

1. Host taps ⚙ gear → Host Controls Overlay opens
2. Host taps "End Round"
3. Round Config overlay opens with mid-session variant (host name hidden, warning banner visible)
4. Host picks new playlist + settings → taps Start Round
5. Confirmation dialog: *"End current round and start new? [Cancel] [Start New Round]"*
6. On confirm: server broadcasts `round:end` then `song:start` for the first song of the new round; all clients render new cards

---

## Screen: Guest Waiting Room

**Route:** `/room/:code` (guest WebSocket session, pre-round)
**Users:** Guests after joining but before the first round starts

```
┌─────────────────────────┐
│ [N Players]   KXJM      │  ← same status-indicator header, no History button yet
├─────────────────────────┤
│                         │
│  You're in!             │
│                         │
│  Players here (3)       │
│  • Sarah [host]         │  ← host always shown with host tag
│  • Marcus               │
│  • Priya                │
│  • (you)                │
│                         │
│  Waiting for host to    │
│  start the round…       │
│                         │
└─────────────────────────┘
```

- **Player names visible** — resolves the "am I alone here?" question
- **Host always listed** with `[host]` pill (small, muted brand colour)
- **Live updates** on `player:joined` / `player:left`
- **Room code** shown in header for reshare
- Host does NOT see this screen (they're on Host Management or in Configure Round overlay until Start Round fires)

On first `song:start`, all clients transition to the Game page.

---

## Component: Between-Rounds State (in-game)

**Context:** Rendered in place of the bingo card on the Game page between rounds (after `round:end`, before next `song:start`). The Game page frame (status-indicator header, Host Mini-Player) stays visible.

```
│ [N Players]   KXJM   [History] │  ← header remains
├─────────────────────────┤
│                         │
│        🎵               │  ← spinning vinyl SVG, ~80px
│                         │
│  ┌─────────────────┐    │
│  │ Did you know?   │    │
│  │ "Happy Birthday"│    │  ← trivia fact, fades every 12s
│  │ was the first   │    │
│  │ song in space.  │    │
│  └─────────────────┘    │
│                         │
│  Waiting for host to    │  ← status line
│  start the next round…  │
│                         │
├─────────────────────────┤
│ [mini-player stays]     │  ← host sees their mini-player throughout
```

The host's gear → Host Controls Overlay → "End Round" is how they start the next round from this state.

### Trivia facts

- Static JSON array, ~50 facts, bundled with frontend
- Random selection on mount, cycles every 12s with 400ms fade transition
- No repeats until full array exhausted
- Tone: surprising, music-related, mix of obscure and well-known

---

## Overlay: Round Config (Host)

**Triggers:**
1. From Host Management via "Start New Session" (first round of a new room — name field visible)
2. From the Host Controls Overlay → "End Round" action (new round within existing session — name field hidden, confirmation required)

**Layout:** Modal overlay (full-screen on mobile, centered modal on desktop). Host only — guests see Waiting Room or Between-Rounds state in-game.

```
┌─────────────────────────┐
│ ✕ Close   Round 1       │
├─────────────────────────┤
│  Your name              │  ← FIRST USE ONLY (new session)
│  ┌─────────────────┐    │
│  │ Sarah           │    │  ← required, ≤ 30 chars
│  └─────────────────┘    │
│                         │
│  Song source            │
│  ┌──────┐ ┌──────────┐  │
│  │Genre │ │ Search…  │  │  ← segmented control
│  └──────┘ └──────────┘  │
│                         │
│  [90s Pop]  [2000s R&B] │  ← genre presets as visual cards
│  [Classic Rock] [Dance] │
│  [Hip-Hop]  [Indie]     │
│                         │
│  Clip length            │
│  [20s][30s][45s][60s]   │
│  [Full song]            │
│                         │
│  Song title reveal      │
│  [Immediately]          │
│  [After 5s]             │
│  [After 10s]            │
│  [After 15s]            │
│  [Never]                │
│                         │
│  ┌─────────────────┐    │
│  │   Start Round → │    │  ← primary CTA
│  └─────────────────┘    │
└─────────────────────────┘
```

### Host name field

- **First use per session only** (when opened via "Start New Session")
- Required, ≤ 30 chars
- Persisted server-side in room state; `session:connect` payload includes `hostName` so all clients (including guests in Waiting Room) see the host listed
- On subsequent opens via End Round within the same session, the name field is hidden
- Pre-filled from host's prior session via an httpOnly cookie (`bangerbingo.hostName`) if present

### Mid-session variant (opened via End Round)

When opened from the Host Controls Overlay's "End Round":
- Name field hidden (already set)
- Warning banner at top: *"Starting a new round will clear everyone's cards."*
- Start Round CTA requires a confirmation dialog: *"End current round and start new? [Cancel] [Start New Round]"*

On confirm: server clears card state for all players, generates new cards from the selected playlist, broadcasts `song:start` for the first song of the new round.

### Genre presets

Each preset = card with:
- Genre/era name (large)
- Optional 1-line descriptor ("2000s pop bangers", "Classic 90s R&B")
- Tappable, selected state = brand fill

### Search tab (playlist/artist search)

The "Search…" tab allows the host to find a **playlist or artist** as the song source — not individual songs. The host types a query (e.g. "Taylor Swift") and receives a list of matching Spotify playlists (e.g. "Taylor Swift — All Songs", "Taylor Swift Essentials", "This Is Taylor Swift"). Selecting one uses that playlist's tracks to generate the bingo card.

```
┌─────────────────────────┐
│  Search for a playlist  │
│  ┌─────────────────┐    │
│  │ Taylor Swift    │    │  ← freeform query
│  └─────────────────┘    │
│                         │
│  Taylor Swift — All …   │  ← playlist result, tap to select
│  This Is Taylor Swift   │
│  Taylor Swift Essentials│
│  Lover Playlist         │
│                         │
└─────────────────────────┘
```

Search calls the Spotify playlist search endpoint (`/search?type=playlist`), not track search. Results show playlist name + owner + track count. Host selects one; card generation pulls tracks from that playlist. This bypasses the `limit=10` track search restriction entirely.

### Room code persistence

Displayed in the center of the status-indicator header on every Game page view (host and guest), muted/lower-contrast so it doesn't compete with the status-indicator buttons. Tap-to-copy. Always visible — never buried.

---

## Screen: Win Moment

**Trigger:** Server broadcasts `round:win` after verifying player's marked tiles  
**Users:** All connected clients simultaneously

```
┌─────────────────────────┐
│                         │
│   🎉                    │  ← confetti animation
│                         │
│      B I N G O !        │  ← 48px+, centred
│                         │
│      Marcus wins!       │  ← winner name, 24px
│                         │
│   [confetti settling]   │
│                         │
│                         │
└─────────────────────────┘
```

### Behaviour

- **All clients:** full-screen overlay, z-index above everything
- **Auto-dismisses** after 5 seconds for guests → returns to card view (round over)
- **Host sees** an additional CTA before auto-dismiss:

```
│  ┌──────────────────┐   │
│  │  Start Next Round│   │  ← appears after 1.5s, before auto-dismiss
│  └──────────────────┘   │
│  [Dismiss]              │  ← secondary, smaller
```

- Confetti: CSS-only or lightweight JS, ~2 seconds, then settles
- If host dismisses without starting next round → returns to lobby/waiting state

### Winning songs list

After the winner name, all clients see a brief list of the 5 songs that formed the winning bingo line:

```
│      Marcus wins!       │
│                         │
│  Don't Stop Believin'   │  ← the 5 winning songs
│  Bohemian Rhapsody      │
│  Sweet Child O' Mine    │
│  Hotel California       │
│  Livin' on a Prayer     │
```

These are sourced from `winPattern` (tile indices) cross-referenced with `songHistory`. No win-path tile highlight on the card — the overlay covers it anyway, and the song list is more legible at party distance.

---

## Screen: Host Management

**Route:** `/host` (post-OAuth landing; guarded by session cookie)

### Host auth: Spotify OAuth only

There is no separate username/password system. Spotify OAuth is the host identity. The Host Login button on `/` routes to `/auth/login` which begins the PKCE redirect; on return, the host lands on `/host` (this screen).

### Screen layout

```
┌─────────────────────────┐
│ Bangerbingo — Host      │
├─────────────────────────┤
│  Spotify: ✓ Connected   │  ← connection status panel
│  Signed in as Sarah J   │
│  [Disconnect]           │  ← small, muted
│                         │
│  ┌─────────────────┐    │
│  │ Start New Session│    │  ← primary CTA
│  └─────────────────┘    │
│                         │
│  Existing sessions      │
│                         │
│  KXJM  Apr 5, 14:32  🗑 │  ← tap row to resume; trash deletes
│  PZNT  Apr 3, 21:10  🗑 │
│  RQWB  Apr 1, 19:48  🗑 │
│                         │
└─────────────────────────┘
```

### Spotify connection panel

- **Connected state:** `✓ Connected` + Spotify account display name + `[Disconnect]` link
- **Degraded state** (`auth:degraded` received): `⚠ Reconnect needed` + inline `[Reconnect Spotify]` CTA that opens OAuth popup
- **Disconnect** clears tokens server-side and logs host out

### Start New Session

- Primary CTA → opens Configure Round overlay for a fresh room (generates new room code, new state)
- Host name is collected inside the Configure overlay (not on this screen)

### Existing sessions list

- **Row tap** → resume session as host (re-joins existing room; if a round is active, lands on Game page; else lands on Between-Rounds state)
- **Trash icon** 🗑 → confirmation dialog *"Delete session [CODE]? Any connected players will be disconnected. This can't be undone."* → server broadcasts `session:end { reason: "host_deleted" }`, room destroyed, list refreshes
- Rows show room code (monospace), creation timestamp (host's local timezone), trash icon
- List sorted newest first
- Empty state: list hidden; "Start New Session" CTA is the only affordance

### Browser guidance

Muted advisory below the session list: *"Use desktop Chrome or Firefox for audio. iOS Safari will work for controls but audio must play from another device."*

### Session cookie persistence

On OAuth success: server stores access + refresh tokens server-side (keyed to Spotify `user_id`), sets an httpOnly session cookie with `Max-Age: 14 days`. Returning hosts with a valid session cookie skip the OAuth redirect and land directly on `/host`.

---

## Component: Song History Drawer

**Trigger:** Tap `≡ History` in header (available to all players at all times during a round)  
**Layout:** Bottom sheet, ~70% screen height, scrollable

```
┌─────────────────────────┐
│  ── drag handle ──      │
│  Song History           │
├─────────────────────────┤
│                         │
│  3  Don't Stop Believin'│  ← song number, title
│     Journey             │  ← artist
│     [album art 40×40]   │
│                         │
│  2  Sweet Child O' Mine │
│     Guns N' Roses       │
│                         │
│  1  Bohemian Rhapsody   │
│     Queen               │
│                         │
└─────────────────────────┘
```

- **Newest first** — most recent songs at top (most relevant for catching up)
- Song number helps players map history to their card tiles
- Album art if available from provider; graceful fallback to music note icon
- Always accessible mid-round — triggered from the header `[Nth Song]` status-indicator button
- The button's label reflects the current song position live (e.g. `[3rd Song]` → `[4th Song]` on each `song:start`); falls back to `History` when no song is playing

---

## Component: Players Overlay

**Trigger:** Tap the `[N Players]` status-indicator button in the header
**Layout:** Bottom sheet, ~50% screen height, same pattern as Song History Drawer
**Availability:** All players (host + guests) at all times during waiting, between rounds, and mid-round

```
┌─────────────────────────┐
│  ── drag handle ──      │
│  Players (4)            │
├─────────────────────────┤
│                         │
│  Sarah  [host]          │  ← host tag: small brand-colour pill
│  Marcus                 │
│  Priya                  │
│  Tom  (you)             │  ← current user suffix
│                         │
└─────────────────────────┘
```

- Host always shown first, with `[host]` pill
- Current user suffixed with `(you)`
- Live updates on `player:joined` / `player:left` (list and header count update atomically)
- No actions on players in MVP (no kick, no promote)

---

## Component: SDK Failure Banner

**Trigger:** `MusicProvider` SDK init fails (primarily iOS Safari + Spotify)  
**Placement:** Non-blocking banner, top of host view — does not obscure card or controls

```
┌─────────────────────────────────────┐
│ ⚠  Audio can't play in this browser │
│ The game still runs fine.           │
│ [How to fix ▾]                      │
└─────────────────────────────────────┘
```

**Expanded state (tap "How to fix"):**

```
┌─────────────────────────────────────┐
│ ⚠  Audio can't play in this browser │
│                                     │
│ Spotify doesn't support audio in    │
│ Safari on iPhone.                   │
│                                     │
│ To play audio:                      │
│ 1. Open Spotify on your phone       │
│ 2. Find the track shown in controls │
│    [Open current track in Spotify →]│  ← spotify:track:ID deep link
│                                     │
│ Cards, sync, and bingo all work     │
│ normally. Only audio is affected.   │
│                                     │
│ [Got it]                            │
└─────────────────────────────────────┘
```

**Key framing:** "The game still runs fine" leads. The banner is informational, not an error. The deep link to the current track is dynamically populated from the active `song:start` event's `trackId`.

### Token refresh failure variant

When `auth:degraded` is received, the host sees a separate high-priority banner (replaces or stacks above the SDK failure banner):

```
┌─────────────────────────────────────┐
│ ⚠  Spotify session expired          │
│ Audio has stopped. Game still runs. │
│ [Re-authenticate →]                 │
└─────────────────────────────────────┘
```

**[Re-authenticate →]** opens a Spotify OAuth popup (not a redirect — full redirect would destroy the active game session). On successful re-auth, server updates tokens, SDK re-initializes, banner clears automatically. The game has been running in fallback mode throughout.

**Token refresh resilience (server behaviour):**
1. Proactive refresh at T−5 minutes before expiry
2. On failure: retry 3× with exponential backoff (1s → 2s → 4s)
3. If all retries fail: emit `auth:degraded`, enter degraded mode
4. Degraded mode: audio stops, game state + WebSocket continue unaffected, guests see nothing

---

## WebSocket Event Contracts

Defined here as the shared contract between server and frontend. All events are JSON.

### `song:start`

```ts
{
  event: "song:start",
  songNumber: number,          // position in this round (1-based)
  songId: string,              // internal game ID
  trackId: string,             // "spotify:track:XXXX" — used for SDK + deep links
  trackName: string,
  artistName: string,
  albumArtUrl: string | null,
  clipDuration: number,        // seconds; 0 = full song
  titleRevealAt: number | null // server timestamp (ms); null = immediate reveal
}
```

### `song:reveal`

```ts
{
  event: "song:reveal",
  songId: string,
  trackName: string,
  artistName: string
}
```

Fired by server at `titleRevealAt` time. The server is the sole trigger — clients do **not** schedule local reveals. This keeps reveal behaviour consistent regardless of client clock drift. `titleRevealAt` in `song:start` is informational only (e.g. for a countdown animation).

### `round:win`

```ts
{
  event: "round:win",
  playerName: string,
  winPattern: number[],        // indices of winning tiles (0–24)
  winningSongs: SongHistoryItem[]  // the 5 songs at those tile positions
}
```

**Tie-breaking:** if two players mark a winning pattern on the same song, the winner is determined by server-received timestamp (first tap processed wins). The losing player receives the standard `round:win` broadcast like everyone else — their win moment is covered by the winner overlay immediately anyway. No special "so close" event needed; the overlay is the outcome.

### `round:end`

```ts
{
  event: "round:end"
}
```

All clients transition to lobby/waiting state.

### `player:joined` / `player:left`

```ts
{
  event: "player:joined" | "player:left",
  playerName: string,
  playerCount: number
}
```

### `host:disconnected` / `host:reconnected`

```ts
{ event: "host:disconnected" }
{ event: "host:reconnected" }
```

Broadcast to all guests when the host WebSocket drops or re-establishes. On `host:disconnected`, guests see a non-blocking banner: **"Host disconnected — waiting for them to reconnect…"**. Game state is frozen server-side (no auto-advance). On `host:reconnected`, banner clears, game resumes from where it left off. Host reconnect uses the same `session:connect` flow as guests — session cookie re-establishes identity and room state is restored.

### `auth:degraded` (server → host only)

```ts
{
  event: "auth:degraded",
  reason: "token_refresh_failed"
}
```

Fired when all token refresh retries are exhausted. Host receives this; guests do not. Triggers the re-authentication banner (see SDK Failure Banner — re-auth variant). Game state and WebSocket continue unaffected.

### `session:connect` (server → client on WS handshake)

```ts
{
  event: "session:connect",
  role: "host" | "guest",
  playerName: string,
  hostName: string,             // always populated; host sees own, guests see host's
  roomCode: string,
  roundActive: boolean,
  songNumber?: number,          // current song ordinal (for [Nth Song] button label)
  // if roundActive:
  card?: number[][],            // 5×5 grid of songIds
  songHistory?: SongHistoryItem[],
  markedTiles?: number[]        // tile indices already marked
}
```

This payload drives the role-aware rendering split. Host gets host view; guest gets guest view. Same URL, same component tree entry point, branched on `role`. `hostName` populates the `[host]` tag in the Players Overlay and Guest Waiting Room.

### `session:end` (server → all clients in room)

```ts
{
  event: "session:end",
  reason: "host_ended" | "host_deleted" | "host_timeout"
}
```

Fired when a host ends a session in-game (Host Controls Overlay → End Session, reason: `host_ended`), deletes a session from Host Management (trash icon, reason: `host_deleted`), or the server times out an abandoned session (reason: `host_timeout`). All connected clients disconnect; guests redirect to `/` with a banner *"Session ended by host."* (dismissible after 5s). Host returns to `/host`.

---

## Tile State Reference

| State | Trigger | Visual |
|---|---|---|
| `unmarked` | Default | White bg, title (blurred if masked) |
| `marked` | Player tap | Brand fill, white text, checkmark |
| `win-path` | `round:win` received, tile in `winPattern` | Gold/amber outline, 2px |
| `free` | Centre tile, auto-marked on card load | Brand fill lighter, "FREE" label |
| `masked` | `titleRevealAt` not yet reached | Blurred text, "Song N" overlay |
| `revealed` | `song:reveal` received or `titleRevealAt` passed | Normal text, blur animates out |

States are composable: a tile can be `marked` + `revealed`, or `marked` + `win-path`.

---

## Decision Log

| Topic | Decision | Rationale |
|---|---|---|
| Join form consistency | Single form; URL pre-fills code as `readonly` | Fewer flows, same mental model |
| `readonly` not `disabled` | `readonly` styled with lock icon | `disabled` looks broken; `readonly` participates in form |
| Tile interaction | Tap toggles mark/unmark | Accidental taps are recoverable |
| Song title masked state | Blurred text + "Song N" label | Implies reveal is coming; not a bug |
| `titleRevealAt` | Server timestamp in `song:start` payload | Client schedules reveal locally; no second round-trip |
| Host/guest routing | Single `/room/:code`; role from WS handshake | No URL to guess or type; role-aware rendering in Svelte |
| Win detection | Server auto-detects; no "Claim Bingo" button | Eliminates false claims and accidental taps |
| Win button appearance | Button only surfaces when win is detected | Removes "do I press it?" confusion |
| SDK failure fallback | `trackId` in `song:start`; one-tap "Open in Spotify" | One tap, not a search; game continues unblocked |
| Token refresh | Server-side `setInterval`, SDK-independent | SDK may not be running in fallback mode |
| Token refresh resilience | Proactive refresh T−5min, 3× retry w/ backoff, degraded mode, popup re-auth | Never block the game; popup preserves active session |
| Host auth | Spotify OAuth only (PKCE), httpOnly session cookie, no username/password | Spotify identity is sufficient for personal/friends use; eliminates password management scope |
| Host disconnect | Server freezes game state, guests see banner, host reconnects via session cookie | Same reconnect model as guests; seamless resumption |
| Room code charset | Uppercase A–Z, excluding O and I | Eliminate visual ambiguity when codes are shouted across a room |
| Song title reveal | Server fires `song:reveal`; clients do not schedule locally | Eliminates clock drift race condition; `titleRevealAt` is informational only |
| Tie-breaking | First server-received tap wins | Deterministic; loser's screen is covered by winner overlay before confusion can occur |
| Win display | Winner name + 5 winning songs list | More legible than win-pattern tile highlight; overlay covers card anyway |
| Search tab | Playlist/artist search only, not track search | Bypasses `limit=10` track search cap; card generation pulls from selected playlist |
| Auto-advance | Server advances to next song when clip ends | Host is passive in clip mode; manual advance reserved for Full song mode |
| Waiting state | Spinning vinyl + cycling music trivia (static JSON) | Sets tone; low implementation cost; no API dependency |
| End Round placement | Small, tucked, low-prominence | Prevent accidental game-ending during party |
| End Round confirmation | Dialog → 2-second cancellable toast | Two-step; reversible up to last moment |
| History drawer order | Newest first | Late joiners care about recent songs |
| Host controls (mobile) | Partial bottom sheet, ~50% peek | Card remains visible; host-as-player preserved |
| Host controls handle | Persistent "Controls ▲" label | No hidden gesture discovery |
| Desktop host layout | Card 60% / controls 40% inline | No context switching ever |
| Genre presets UI | Visual cards, not dropdown | Scannable; matches party-time browsing behaviour |
| Room code display | Muted, centered, monospace, tappable to copy; flanked by status-indicator buttons | Persistent without competing for attention |
| Late arrival | No toast; history drawer always accessible | Trust players; reduce noise |
| Root page audience | Guest-first; host entry is a small recessive button, not primary CTA | Prevents mis-taps; 90% flow is guest join |
| Guest name persistence | Guest name stored in localStorage; prefilled on return visits | Returning guests shouldn't retype; room code never stored |
| Host Management as landing | After OAuth, host lands on Host Management (Spotify status + New Session CTA + session list with timestamps/trash icons) | One admin surface for account + session lifecycle |
| Round Config as overlay | Modal instead of standalone screen; same component for first-round and mid-session new-round | Single component, lighter navigation |
| Host is a named player | Host provides name at session start; appears in players list with `[host]` pill | Matches "host plays too" principle; eliminates 0-players display |
| Mini-player minimal | Three buttons only (play/pause, next, gear); no round/session controls exposed directly | Bar is for playback; management is one tap away |
| Host Controls Overlay | Bottom sheet reached via gear icon; contains End Round, End Session, Host Management link | Groups lifecycle + navigation actions away from playback |
| Header status-indicator buttons | Players button shows "N Players", History button shows "Nth Song" | Buttons carry live status + afford their overlays; doubles up UI work |
| End Session dual entry | Available in-game (Host Controls Overlay) and as trash icon in Host Management | In-game for natural end, admin for housekeeping — same server behaviour |
| End Round naming | "End Round" instead of "Configure" | Changing playlist always clears the round; honest naming |
| Host session cookie lifetime | Extended to 14 days (previously session-only) | Host re-auth friction; refresh token continues as long as cookie valid |
