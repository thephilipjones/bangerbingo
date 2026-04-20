---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories]
inputDocuments:
  - _bmad-output/prd.md
  - _bmad-output/ux-spec.md
  - _bmad-output/epics.md
  - .claude/plans/we-don-t-support-hosts-linear-kazoo.md
---

# Bangerbingo - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Bangerbingo, decomposing the requirements from the PRD, UX Design spec, and existing epic structure into implementable stories.

---

## Requirements Inventory

### Functional Requirements

**Host Account & Authentication**
- FR1: A host can register an account with a display name and password
- FR2: A host can connect their Spotify Premium account via OAuth after registering
- FR3: A host can log in and access their room history
- FR4: A host's Spotify access token refreshes silently before expiry without interrupting an active round
- FR5: A host can disconnect and reconnect their Spotify account from account settings

**Room Management**
- FR6: A host can create a new room, generating a persistent room code and shareable URL
- FR7: A host can start a new round, selecting song source (genre preset or keyword search) fresh per round
- FR8: A host can configure clip length per round: short clip (20–60 seconds, starting at chorus position) or full song mode
- FR9: The system generates a short, memorable room code (4–6 characters) per room
- FR10: A host can end the current round and return to the lobby to configure the next
- FR11: A host can close a room session entirely

**Guest Join & Identity**
- FR12: A guest can join a session by entering their name at a direct room URL
- FR13: A guest can join from the root URL by entering their name and room code
- FR14: A guest is identified by name only — no account or registration required
- FR15: A guest who loses connection can rejoin by name and resume with card state intact
- FR16: A guest can join or leave at any point — before, during, or between rounds — without disrupting the session
- FR17: The host can see a live list of present players at any time

**Music Playback**
- FR18: The host can browse and select from curated genre/era playlist presets per round
- FR19: The host can search for a playlist or artist by keyword per round
- FR20: The system plays a song clip starting at the chorus position through the host's browser
- FR21: The host can play, pause, and advance to the next song during a round
- FR22: Audio playback routes through the host's browser to connected Bluetooth or AirPlay speakers
- FR23: If music provider SDK initialisation fails, the host receives a clear error with actionable fallback guidance
- FR24: The music playback layer is implemented behind a provider interface supporting future alternative providers

**Bingo Card & Round Mechanics**
- FR25: Each player receives a uniquely generated 5×5 bingo card at the start of each round
- FR26: Cards are generated from a pool of more than 24 songs, randomly sampled without replacement per player
- FR27: A player can tap a tile to mark it
- FR28: Song titles are masked when a song begins; host configures reveal behaviour per room: show immediately, show after a set delay (5s / 10s / 15s), or never reveal
- FR29: Win detection is performed server-side when a player claims bingo
- FR30: All players see a full-screen win notification when a valid bingo is verified
- FR31: Songs played in earlier rounds of the same session are down-ranked when generating the pool for subsequent rounds
- FR32: Songs played in previous sessions in the same room are down-ranked when generating pools for future sessions

**Song History & Late Join**
- FR33: A player can open a song history drawer at any time during a round showing all songs played so far
- FR34: A player who joins mid-round receives a blank card and can consult the history drawer to self-mark songs they recognise
- FR35: The song history drawer displays sufficient song information for a player to identify a tile on their card

**Host-as-Player**
- FR36: The host receives a bingo card and participates as a player in each round
- FR37: The host can access playback controls and round management without leaving their bingo card view
- FR38: On mobile, host controls are accessible via a slide-up panel overlay; on larger screens controls surface inline

**Settings**
- FR39: The host can configure room settings (clip length, title reveal behaviour) before and between rounds
- FR40: Guests can access a settings overlay for personal preferences during a session

**Deployment & Operations**
- FR41: The application deploys via Docker Compose with a single command
- FR42: Spotify app credentials and other secrets are supplied via environment variables
- FR43: Host accounts authenticate with their own Spotify Premium via OAuth; Spotify app credentials are shared across the deployment, configured by the operator at deploy time
- FR44: The application supports a first-run host registration flow for new deployments

**Continuous Mode**
- FR-CM1: Host can toggle Continuous Mode on/off at any time, positioned near playback controls with a visible on/off indicator
- FR-CM2: When Continuous Mode is on and a round ends, the next round starts automatically with the same configuration after a 10-second countdown
- FR-CM3: Playlist cursor advances server-side across rounds within a session — no reshuffling, no song duplication
- FR-CM4: Win screen holds until manually cleared; the 10-second countdown begins only after manual clear

**Win Moment & Audio Presets**
- FR-WM1: Host selects an audio personality preset for the session: Hype, Deadpan, or Minimal
- FR-WM2: The Bingo win screen holds until manually dismissed (no auto-dismiss timer)
- FR-WM3: After win screen is manually cleared, a visible 10-second countdown fires before the next round begins (Continuous Mode only)

**Casual Mode**
- FR-CSM1: Host can enable or disable Casual Mode permission per round via an on/off toggle in Round Config
- FR-CSM2: When permitted, players see and can toggle their own Casual Mode on or off
- FR-CSM3: Players with Casual Mode on have squares auto-marked on any track_changed event (natural or skip), sweeping played_history for all songs other than current_song
- FR-CSM4: Any track change — natural progression or host skip — triggers the Casual Mode auto-mark sweep
- FR-CSM5: Players joining mid-session with Casual Mode on receive a toast: "Caught up on X songs"
- FR-CSM6: Players List shows a subtle ☕ indicator next to players who have Casual Mode enabled

**Session Statistics**
- FR-SS1: System tracks win count per player for the current session (in-memory only; resets on session end)
- FR-SS2: Players List surfaces each player's win count and a "Won last round" indicator
- FR-SS3: Only wins are tracked — no loss counts

### Non-Functional Requirements

**Performance**
- NFR1: Host playback control actions (play, pause, advance) respond within 500ms
- NFR2: WebSocket game events (song start, title reveal, win notification) broadcast to all clients within 200ms on a typical home network
- NFR3: Guest bingo card loads within 2 seconds of joining, including WebSocket handshake
- NFR4: Spotify token refresh completes in the background with no perceptible interruption to playback or game state
- NFR5: The application remains responsive during a 2-hour session with up to 10 concurrent players

**Security**
- NFR6: All client–server communication uses HTTPS/WSS in production
- NFR7: Spotify OAuth tokens are stored server-side only — never exposed to the client
- NFR8: Host passwords are stored as hashed values — never plaintext
- NFR9: Spotify app credentials are never embedded in client-side code or committed to the repository
- NFR10: Guest names are held in memory only for session duration — not persisted

**Reliability**
- NFR11: WebSocket connections automatically reconnect after a client drop; reconnect completes within 5 seconds on a typical mobile network
- NFR12: A reconnecting guest resumes with card state identical to how they left
- NFR13: A single server restart must not cause permanent loss of active game state; in-progress round state is recoverable
- NFR14: Token refresh failure is surfaced to the host with a clear recovery action before playback is interrupted

**Maintainability**
- NFR15: Server core logic fits within ~200 lines, excluding configuration and type definitions
- NFR16: All Spotify-specific code is isolated behind the `MusicProvider` interface — no Spotify SDK calls outside the provider implementation
- NFR17: The project runs locally without Docker via a single setup command

### Additional Requirements

*(Technical decisions from PRD architecture section and existing epics.md)*

- `MusicProvider` interface isolates all music provider calls: `play()`, `pause()`, `seek()`, `search()`, `getPlaylistTracks()`, `refreshToken()` — Spotify is the sole MVP implementation; Apple Music MusicKit JS slots in post-MVP
- SQLite for host accounts, room metadata, cross-session song dedup log; in-memory `Map<roomId, GameState>` for active room state
- Native WebSockets using `Map<roomId, Set<WebSocket>>` — ~40 lines of room management code; no external pub/sub
- Room codes: uppercase A–Z, excluding O and I (visually ambiguous), 4 characters
- Stack: Svelte 5 SPA frontend, Hono backend, SQLite — no Redis, no Postgres, no Docker required for local dev
- Epic 2 is explicitly a **throwaway spike** — a standalone HTML proof-of-concept with a hardcoded token; no Svelte, no server. Its outputs inform Epic 5 but its code is discarded.
- `song:start` / `song:reveal` / `round:win` / `round:end` / `session:connect` / `player:joined` / `player:left` / `host:disconnected` / `host:reconnected` / `auth:degraded` WebSocket event contracts are defined in the UX spec and must be implemented exactly as specified
- Server-side auto-advance: server schedules `song:start` progression in clip mode; clients do **not** schedule locally
- Server fires `song:reveal` at `titleRevealAt` time — clients do not schedule local reveals
- Tie-breaking: first server-received tap timestamp wins (no client-side determination)
- Genre presets = curated Spotify playlist IDs (the `/recommendations` endpoint is deprecated for new apps)
- Cross-session dedup: songs played in previous sessions per room stored in SQLite; down-ranked (not excluded) in future round generation

### UX Design Requirements

- UX-DR1: Join screen — single form handles both root URL (both fields empty) and `/room/:code` (code pre-filled as `readonly` with subtle lock icon); name field autofocuses on mount; room code auto-uppercases, strips spaces and non-conforming chars on input
- UX-DR2: Join error states — five specific inline messages: room not found, room exists but no active session, name taken, name empty, code malformed
- UX-DR3: Guest card view — minimal header with `≡ History` button right-aligned; 5×5 grid; FREE space auto-marked at centre; status line below card ("Song N of this round" / "Waiting for next song…")
- UX-DR4: Tile states (composable) — `unmarked` (white bg), `marked` (brand fill + white text), `win-path` (gold/amber 2px outline), `free` (lighter brand fill + "FREE"), `masked` (CSS blur(4px) + "Song N" overlay), `revealed` (blur animates out 300ms + label fades)
- UX-DR5: Host card view mobile — identical to guest card + persistent "Controls ▲" handle at bottom (explicit label, no hidden gesture)
- UX-DR6: Host card view desktop (≥768px) — split view: card ~60% left / controls ~40% right, always visible simultaneously; no overlay, no context switching
- UX-DR7: Host Controls Panel (mobile) — partial bottom sheet with ~40% card peek; track name + artist; Prev / Play/Pause / Next buttons (Next largest); player list; End Round button (small, low-prominence, right-aligned)
- UX-DR8: End Round flow — confirmation dialog → 2-second cancellable toast at screen top → `round:end` broadcast if not cancelled
- UX-DR9: Auto-advance behaviour — clip mode: server auto-advances, host is passive; full song mode: host taps Next manually; Play/Pause available in both modes
- UX-DR10: SDK failure state in controls panel — playback controls replaced with "Audio playing via Spotify app" banner + `spotify:track:ID` deep link for current track + Next Song still functional
- UX-DR11: Lobby / waiting state — spinning vinyl SVG (~80px, CSS animation); music trivia cycling every 12s (400ms fade, no repeats until exhausted, static JSON ~50 facts); contextual status line; live player count; host additionally sees "Configure Round" CTA
- UX-DR12: Round Config screen — segmented control (Genre / Search); genre presets as visual cards (name + 1-line descriptor, tappable, selected = brand fill); clip duration pill toggles (20s / 30s / 45s / 60s / Full song); song title reveal radio group (Immediately / After 5s / 10s / 15s / Never); "Start Round →" primary CTA
- UX-DR13: Playlist/artist search tab — freeform query; results from `/search?type=playlist`; display playlist name + owner + track count; selecting one uses its tracks for card generation
- UX-DR14: Win Moment overlay — full-screen, z-index above everything; confetti animation (~2s, CSS-only or lightweight JS); winner name (24px); 5 winning songs list; auto-dismisses after 5s for guests → returns to card; host sees "Start Next Round" CTA (appears after 1.5s) + secondary "Dismiss"
- UX-DR15: Song History drawer — bottom sheet ~70% height, scrollable; newest first; each item: song number + title + artist + album art (40×40, fallback music note icon); accessible at all times via `≡ History` button in header
- UX-DR16: Login / setup screen — Spotify OAuth only ("Connect Spotify" button + PKCE redirect); iOS/desktop disclaimer (small, muted: "Use desktop Chrome or Firefox for audio"); returning hosts with valid session cookie skip this screen entirely
- UX-DR17: SDK Failure Banner — non-blocking top banner (does not obscure card or controls); "The game still runs fine" leads; expandable "How to fix ▾" section with step-by-step fallback and `spotify:track:ID` deep link to current track
- UX-DR18: Auth Degraded Banner — separate high-priority banner stacking above SDK banner if both active; "Re-authenticate →" opens Spotify OAuth in a popup (not a redirect — full redirect would destroy active game session); on success: server updates tokens, SDK re-initializes, banner clears automatically
- UX-DR19: Host disconnect — guests see non-blocking "Host disconnected — waiting for them to reconnect…" banner; game state frozen server-side (no auto-advance); banner clears on `host:reconnected`; host reconnects via session cookie (same flow as guests)
- UX-DR20: Typography scale — room code: 32px monospace bold; tile title: 11–12px, 2-line max, ellipsis; tile artist: 10px muted; body/labels: 14–16px; win headline: 48px+
- UX-DR21: Touch targets — all interactive elements ≥ 44×44px (WCAG AA); card tiles ~60×60px at 375px viewport with minimal gaps
- UX-DR22: WCAG AA contrast — ≥ 4.5:1 for all text on tile backgrounds; no formal audit for MVP but must be met by design
- UX-DR23: Room code display — large, monospace, persistent and accessible throughout session (header or info icon); copyable; never buried
- UX-DR24: Tile long-press / hover (desktop) — reveals full title if truncated (tooltip or expand)

**Relaxed Play (Epic 8)**
- UX-DR25: Continuous Mode — on/off toggle near host playback controls; persistent visible indicator; accessible to host at all times during session
- UX-DR26: Win screen modified — "Dismiss" CTA replaces auto-dismiss timer; screen holds until host or winner taps Dismiss
- UX-DR27: Post-dismiss countdown — 10-second timer displayed in song-info area with "Next game starts in..." label; visually prominent
- UX-DR28: Audio preset selector — session-level setting (Hype / Deadpan / Minimal); default Hype; accessible in host session setup
- UX-DR29: Round Config form — "Allow Casual Mode" on/off toggle, same visual style as other round config toggles
- UX-DR30: Player Casual Mode toggle — available in player's settings area when host permits; labeled "Casual Mode"
- UX-DR31: Players List — ☕ icon next to player names who have Casual Mode on; subtle, non-judgmental; visible to all
- UX-DR32: Catch-up toast — brief non-blocking "Caught up on X songs" notification shown to player enabling Casual Mode mid-session or joining with it on
- UX-DR33: Players List — win count badge and "Last round ✓" indicator per player; session-scoped only

### FR Coverage Map

| FR | Epic | Description |
|---|---|---|
| FR1 | Epic 1 | Host registration via Spotify OAuth |
| FR2 | Epic 1 | Connect Spotify Premium via PKCE OAuth |
| FR3 | Epic 1 + 3 | Login/session (E1); room dashboard (E3) |
| FR4 | Epic 1 | Silent token refresh (story 1-2, done) |
| FR5 | Epic 6 | Disconnect/reconnect Spotify from account settings |
| FR6 | Epic 3 | Room creation + persistent room code |
| FR7 | Epic 4 | Start round with song source selection |
| FR8 | Epic 4 | Clip length configuration per round |
| FR9 | Epic 3 | Short memorable room code generation (A–Z excl. O/I, 4 chars) |
| FR10 | Epic 3 | End round → return to lobby |
| FR11 | Epic 3 | Close room session entirely |
| FR12 | Epic 3 | Guest join via direct room URL |
| FR13 | Epic 3 | Guest join via root URL + name + code |
| FR14 | Epic 3 | Guest identity = name only, no account required |
| FR15 | Epic 3 | Guest reconnect by name with card state intact |
| FR16 | Epic 3 | Guest join/leave without disrupting session |
| FR17 | Epic 3 | Host sees live player list |
| FR18 | Epic 4 | Browse genre/era playlist presets |
| FR19 | Epic 4 | Keyword playlist/artist search |
| FR20 | Epic 2 (spike) + 5 | Clip playback from chorus position — spike validates, E5 implements |
| FR21 | Epic 5 | Host play/pause/advance controls |
| FR22 | Epic 2 (spike) + 5 | BT/AirPlay routing — spike validates, E5 implements |
| FR23 | Epic 2 (spike) + 5 | SDK failure graceful fallback — spike defines, E5 implements banner |
| FR24 | Epic 2 (spike) + 5 | MusicProvider interface — spike designs, E5 implements |
| FR25 | Epic 4 | Unique 5×5 bingo card per player per round |
| FR26 | Epic 4 | Card generated from pool >24 songs, sampled without replacement |
| FR27 | Epic 5 | Player can tap a tile to mark it |
| FR28 | Epic 5 | Song title masking + configurable reveal behaviour |
| FR29 | Epic 5 | Server-side win detection |
| FR30 | Epic 5 | Full-screen win notification on all clients |
| FR31 | Epic 4 | Down-rank songs from earlier rounds (within session) |
| FR32 | Epic 4 | Down-rank songs from previous sessions (per room, SQLite) |
| FR33 | Epic 5 | Song history drawer accessible at all times |
| FR34 | Epic 5 | Mid-round join receives blank card + history to self-mark |
| FR35 | Epic 5 | History drawer shows enough info to identify card tiles |
| FR36 | Epic 5 | Host receives a bingo card and plays as a participant |
| FR37 | Epic 5 | Host accesses controls without leaving card view |
| FR38 | Epic 5 | Host controls: slide-up mobile, inline desktop |
| FR39 | Epic 4 | Host configures clip length + title reveal per round |
| FR40 | Epic 5 | Guest settings overlay |
| FR41 | Epic 6 | Docker Compose single-command deployment |
| FR42 | Epic 6 | Secrets via environment variables |
| FR43 | Epic 6 | Spotify credentials configured by operator at deploy time |
| FR44 | Epic 1 | First-run host registration flow |
| FR-CM1 | Epic 8 | Continuous Mode toggle near playback controls |
| FR-CM2 | Epic 8 | Auto-start next round with countdown when Continuous Mode on |
| FR-CM3 | Epic 8 | Server-side playlist cursor — no reshuffle, no duplication |
| FR-CM4 | Epic 8 | Win screen holds until manually cleared before countdown |
| FR-WM1 | Epic 8 | Audio personality preset (Hype / Deadpan / Minimal) |
| FR-WM2 | Epic 8 | Win screen holds — no auto-dismiss |
| FR-WM3 | Epic 8 | 10-second countdown after win screen dismissed (Continuous Mode) |
| FR-CSM1 | Epic 8 | Host enables Casual Mode permission per round in Round Config |
| FR-CSM2 | Epic 8 | Players toggle their own Casual Mode when permitted |
| FR-CSM3 | Epic 8 | Auto-mark on track_changed — sweeps played_history |
| FR-CSM4 | Epic 8 | Any track change (natural or skip) triggers auto-mark sweep |
| FR-CSM5 | Epic 8 | Catch-up toast for late joiners with Casual Mode on |
| FR-CSM6 | Epic 8 | ☕ indicator in Players List for Casual Mode players |
| FR-SS1 | Epic 8 | In-memory session win count per player |
| FR-SS2 | Epic 8 | Players List: win count + "Won last round" indicator |
| FR-SS3 | Epic 8 | Wins only — no loss tracking |

## Epic List

### Epic 1: Spotify Auth & Token Management ✅ DONE
*Host can authenticate with Spotify, hold a persistent session, and have tokens refreshed silently — the identity and access layer every other epic depends on.*
**FRs covered:** FR1, FR2, FR3 (session/login), FR4, FR44
**NFRs:** NFR4, NFR7, NFR8, NFR9
**Stories:** 1-1 (PKCE OAuth & Session — done), 1-2 (Token Refresh & Degraded Mode — done)

---

### Epic 2: Web Playback SDK Spike ✅ DONE
*Validate that a browser can load a Spotify track, seek to a position, play a clip, and auto-stop — de-risking the highest technical unknown before building 3 epics of game logic on top of it.*
**FRs covered (spike validation):** FR20, FR22, FR23, FR24
**NFRs:** NFR16 (MusicProvider interface contract defined here)
**Note:** Throwaway spike — standalone HTML file, hardcoded token, no Svelte, no server. Code is discarded after the spike; findings directly inform Epic 5 implementation.

---

### Epic 3: Server Skeleton + Room Model ✅ DONE
*Host can create a room and share a code; guests can join by name; all players are in sync in real time; host disconnect/reconnect is seamless.*
**FRs covered:** FR3 (room dashboard), FR6, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17
**NFRs:** NFR11, NFR12 (WS reconnect + state), NFR14 (auth:degraded banner wired here)
**UX-DRs:** UX-DR1, UX-DR2 (join screen), UX-DR11 (lobby/waiting state), UX-DR16 (login screen), UX-DR19 (host disconnect banner), UX-DR23 (room code display)
**WS events:** `session:connect`, `player:joined`, `player:left`, `host:disconnected`, `host:reconnected`, `auth:degraded` → re-auth banner
**Depends on:** Epic 1

---

### Epic 4: Bingo Card Generation
*Host can configure a round (genre preset or playlist search, clip length, title reveal) and every player receives a unique shuffled 5×5 bingo card.*
**FRs covered:** FR7, FR8, FR18, FR19, FR25, FR26, FR31, FR32, FR39
**UX-DRs:** UX-DR12 (Round Config screen), UX-DR13 (playlist/artist search tab)
**Depends on:** Epic 1 (Spotify API token), Epic 3 (room + player context)

---

### Epic 5: Game Loop
*Full round plays end-to-end: songs play and auto-advance, guests mark tiles, server detects bingo, winner overlay fires on all screens.*
**FRs covered:** FR20, FR21, FR22, FR23, FR24, FR27, FR28, FR29, FR30, FR33, FR34, FR35, FR36, FR37, FR38, FR40
**NFRs:** NFR1, NFR2, NFR3, NFR5, NFR15, NFR16
**UX-DRs:** UX-DR3, UX-DR4, UX-DR5 (guest card + tile states + title masking), UX-DR6, UX-DR7 (host card mobile/desktop), UX-DR8, UX-DR9 (controls panel + end round flow), UX-DR10 (SDK failure in panel), UX-DR14 (win moment overlay), UX-DR15 (song history drawer), UX-DR17 (SDK failure banner), UX-DR18 (auth degraded re-auth banner UI), UX-DR20, UX-DR21, UX-DR22, UX-DR24
**WS events:** `song:start`, `song:reveal`, `round:win`, `round:end`
**Depends on:** Epics 1, 2 (spike findings inform SDK integration), 3, 4

---

### Epic 6: Deploy & Harden
*A real game is playable by Philip + friends from their own devices over the internet via a single `docker compose up`.*
**FRs covered:** FR5, FR41, FR42, FR43
**NFRs:** NFR6 (HTTPS/WSS in production), NFR13 (server restart state recovery), NFR17 (local setup command)
**Includes:** Railway/VPS setup, Docker Compose config, env-based credential injection, SQLite volume mount, token refresh end-to-end test, smoke test (auth → room → round → bingo → next round)
**Depends on:** Epic 5

---

### Epic 7: UX Flow Restructure ✅ DONE
*Root cleanup, host session management, round config overlay, guest waiting room, game page header, host mini-player and controls overlay — full UX restructure shipping production-quality flows.*
**Stories:** 7-1 (Root Cleanup — done), 7-2 (Host Session List & Delete — done), 7-3 (Round Config Overlay & Host Name — done), 7-4 (Guest Waiting Room & Host-as-Player — done), 7-5 (Game Page Header & Players Overlay — done), 7-6 (Host Mini-Player & Controls Overlay — done)
**Depends on:** Epics 1–6

---

### Epic 8: Relaxed Play
*Host can enable Continuous Mode for back-to-back games on the same playlist; win moment holds for celebration; players can opt into Casual Mode for automatic square marking; session win stats surface in the Players List.*
**FRs covered:** FR-CM1, FR-CM2, FR-CM3, FR-CM4, FR-WM1, FR-WM2, FR-WM3, FR-CSM1, FR-CSM2, FR-CSM3, FR-CSM4, FR-CSM5, FR-CSM6, FR-SS1, FR-SS2, FR-SS3
**UX-DRs:** UX-DR25, UX-DR26, UX-DR27, UX-DR28, UX-DR29, UX-DR30, UX-DR31, UX-DR32, UX-DR33
**Depends on:** Epic 5 (game loop, win overlay), Epic 7 (Round Config overlay, Players overlay, playback controls)
**Stories:** 8-1 (Win Moment Hold & Audio Presets), 8-2 (Session Statistics), 8-3 (Continuous Mode), 8-4 (Casual Mode Permission & Player Toggle), 8-5 (Casual Mode Auto-Mark Engine)

---

### Epic 9: Game Over Rethink
*Replace the claim button and Win Overlay modal with an auto-triggered Game Over page state. When a player marks their 5th winning tile, the room bounces into a communal Game Over view showing the winner's card (celebratory for the winner, side-by-side toggle for everyone else) and a context-aware "Start Next Round" CTA. Also simplifies the pre-round setup overlay and makes secondary round settings live-editable from the Host Controls panel.*
**Depends on:** Epic 5 (win detection, `round:win` broadcast, `/round/claim` endpoint), Epic 7 (Round Config overlay, Host Controls overlay, Host Mini Player), Epic 8 (Continuous Mode gating for the next-round CTA)
**Stories:** 9-1 (Game Over Page State & Auto-Bingo), 9-2 (Live Round Settings & Pre-Round Simplification)
**Deferred (out of scope for this epic):** Countdown timer on Game Over screen; "songs that would have won it for you" near-miss visualization; host big-screen / TV layout; expanding `audioPreset` scope beyond the win overlay.

---

### Epic 10: Multi-Device Playback (Spotify Connect Picker)
*The host can pick any Spotify Connect device — the in-browser SDK, an iPhone, a Sonos, an Echo — as the playback target and swap live mid-round without interrupting the game. Unlocks iOS host support (the Web Playback SDK is perpetually broken on mobile Safari — autoplay, backgrounding, screen-lock, volume API all unreliable) and doubles as desktop audio routing to speakers / hi-fi / smart speakers.*
**Depends on:** Epic 1 (host Spotify token + `withFreshToken`), Epic 5 (`callSpotifyOnDevice` already device-agnostic, 404→reactivation fallback), Epic 7 (`AdvancedSettings`, `HostControlsOverlay`, `RoundConfigOverlay`, `SdkFailureBanner`, Host Mini Player structure)
**Stories:** 10-1 (Device List API & Live-Swap Endpoint), 10-2 (Device Chip + Picker UI), 10-3 (SDK Default, Preference Persistence & Failure Path)
**Deferred (out of scope for this epic):** Per-guest Spotify playback (separate future research thread); native app wrapper (Capacitor / iOS App Remote SDK); server-side audio re-streaming (Spotify ToS violation); programmatic launching of the Spotify iOS app from Safari; per-device volume control from Bangerbingo UI.

---

## Epic 2: Web Playback SDK Spike

*Validate that a browser can load a Spotify track, seek to a position, play a timed clip, and auto-stop — de-risking the highest technical unknown before building the game loop.*

### Story 2-1: Web Playback SDK Proof-of-Concept Spike

As a developer,
I want a standalone proof-of-concept that validates the Spotify Web Playback SDK can seek to a track position and play a timed clip,
So that the game loop in Epic 5 can be built on confirmed capability rather than assumptions.

**Acceptance Criteria:**

**Given** a valid Spotify Premium access token
**When** the spike page loads in desktop Chrome or Firefox
**Then** the SDK initialises and the device appears in the Spotify Connect device list

**Given** playback is active on the SDK device
**When** `/play` is called with `position_ms: 60000`
**Then** playback begins from that position within 1 second

**Given** playback starts at a seek position
**When** the clip duration elapses
**Then** `player.pause()` fires automatically via `setTimeout`

**Given** a Spotify track URI
**When** a deep link `spotify:track:<id>` is rendered as a clickable anchor
**Then** it opens the native Spotify app on iOS

**Given** an invalid access token
**When** the SDK attempts to initialise
**Then** the `initialization_error` / `authentication_error` callback fires and a visible error message is shown

**Given** the spike is complete
**When** the `spike-sdk.html` file is reviewed
**Then** findings are documented inline: seek pattern (`position_ms` on `/play` vs. `seek()`), init latency, iOS Safari limitations, and a proposed `MusicProvider` interface sketch

---

## Epic 3: Server Skeleton + Room Model

*Host can create a room and share a code; guests can join by name; all players are in sync in real time; host disconnect/reconnect is seamless.*

### Story 3-1: Room Creation API & Code Generation

As a host,
I want to create a new room and receive a unique shareable code,
So that I can invite guests to join my bingo session.

**Acceptance Criteria:**

**Given** a host is authenticated (valid session cookie)
**When** they POST to `/api/rooms`
**Then** a new room record is created in SQLite with a unique 4-character code (uppercase A–Z, excluding O and I)
**And** the response includes the room code and shareable URL (`/room/:code`)

**Given** a room code is generated
**When** the code is inspected
**Then** it contains exactly 4 characters, all uppercase letters, with no O or I characters

**Given** two rooms are created
**When** their codes are compared
**Then** the codes are distinct (no collision)

**Given** a host has an existing room
**When** they visit their dashboard
**Then** their previous rooms are listed with their codes and creation dates

---

### Story 3-2: WebSocket Room Session & Player Presence

As a host or guest,
I want my connection to be recognised by the server and all player arrivals/departures broadcast in real time,
So that everyone in the room always sees an accurate player list.

**Acceptance Criteria:**

**Given** a host connects to the WebSocket for their room
**When** the `session:connect` message is sent with a valid session cookie
**Then** the server responds with a `session:connect` payload identifying the client as `role: "host"` and including current player list

**Given** a guest submits the join form with their name and a valid room code
**When** their WebSocket connects and sends `session:connect`
**Then** the server responds with `role: "guest"` payload and their assigned card slot
**And** all other connected clients receive a `player:joined` event with the guest's name

**Given** a guest is connected
**When** their WebSocket closes (tab close, network drop)
**Then** all other clients receive a `player:left` event within 200ms
**And** the host's player list no longer shows that guest

**Given** a guest loses connection
**When** they reconnect with the same name within the session
**Then** the server restores their slot and broadcasts `player:joined` again (not a new player)
**And** their card state is intact

**Given** up to 10 guests are connected simultaneously
**When** any game event is broadcast
**Then** all clients receive it within 200ms on a typical home network

---

### Story 3-3: Guest Join Screen

As a guest,
I want a simple form to enter my name and room code,
So that I can join a bingo session without any account or registration.

**Acceptance Criteria:**

**Given** a guest visits the root URL (`/`)
**When** the page loads
**Then** both the name field and room code field are visible and empty
**And** the name field is autofocused

**Given** a guest visits `/room/:code`
**When** the page loads
**Then** the room code field is pre-filled with the code from the URL and rendered as readonly with a subtle lock icon
**And** the name field is autofocused

**Given** a guest types in the room code field
**When** they enter characters
**Then** input is auto-uppercased and non-conforming characters (spaces, lowercase, symbols) are stripped in real time

**Given** a guest submits the form with a room code that does not exist
**When** the server responds
**Then** the inline error "Room not found" appears below the code field

**Given** a guest submits with a valid code but no active session in that room
**When** the server responds
**Then** the inline error "No active session in this room" appears

**Given** a guest submits with a name already taken in the room
**When** the server responds
**Then** the inline error "That name is already taken" appears

**Given** a guest submits with an empty name field
**When** submit is triggered
**Then** the inline error "Please enter your name" appears without a server round-trip

**Given** a guest submits with a malformed code (wrong length or invalid chars)
**When** submit is triggered
**Then** the inline error "Room code must be 4 letters" appears without a server round-trip

---

### Story 3-4: Login & Lobby Screens

As a host,
I want a login screen to connect my Spotify account and a lobby to wait in between rounds,
So that I can set up the game and let guests know a session is active.

**Acceptance Criteria:**

**Given** a new host visits the app with no session cookie
**When** the page loads
**Then** the login screen is shown with a "Connect Spotify" button and a small muted iOS/desktop disclaimer about audio

**Given** a host has a valid session cookie from a previous login
**When** they navigate to the app
**Then** the login screen is skipped entirely and they land on their room dashboard

**Given** a host completes OAuth and lands on their dashboard
**When** they create or open a room
**Then** they see the lobby/waiting state with a spinning vinyl SVG animation (~80px, CSS animation)

**Given** the lobby is active
**When** music trivia facts are displayed
**Then** a new fact cycles every 12 seconds with a 400ms fade transition, facts do not repeat until all are exhausted

**Given** the lobby is active
**When** guests join or leave
**Then** the live player count updates in real time without page refresh

**Given** the lobby is active and the host is on the lobby screen
**When** they view the screen
**Then** a "Configure Round" CTA is prominently displayed

**Given** a room is active
**When** any player views any screen
**Then** the room code is displayed large, monospace, and persistently (in header or via info icon) and is copyable

---

### Story 3-5: Host Disconnect & Reconnect

As a guest,
I want to know when the host has disconnected and have the game resume automatically when they return,
So that a brief network drop doesn't end the game.

**Acceptance Criteria:**

**Given** a host's WebSocket connection drops
**When** the server detects the disconnect
**Then** game state is frozen server-side (no auto-advance, no events emitted)
**And** all connected guests receive a `host:disconnected` event within 200ms

**Given** guests receive `host:disconnected`
**When** the event is processed by the client
**Then** a non-blocking banner "Host disconnected — waiting for them to reconnect…" appears on all guest screens
**And** the banner does not obscure the bingo card or controls

**Given** the host reconnects via their session cookie
**When** their WebSocket re-establishes and sends `session:connect`
**Then** the server emits `host:reconnected` to all clients
**And** all guest banners clear automatically
**And** game state resumes from where it was frozen

**Given** a host reconnects after disconnect
**When** they rejoin
**Then** their role is restored as host (not guest) without requiring re-authentication

---

## Epic 4: Bingo Card Generation

*Host can configure a round (genre preset or playlist search, clip length, title reveal) and every player receives a unique shuffled 5×5 bingo card.*

### Story 4-1: Track Pool API

As a host,
I want the server to fetch tracks from a genre preset or keyword-searched playlist,
So that card generation has a pool of songs to draw from.

**Acceptance Criteria:**

**Given** a host is authenticated with a valid Spotify token
**When** they GET `/api/music/presets`
**Then** the server returns a list of genre preset objects, each with a `name`, `description`, and `playlistId`

**Given** a host submits a keyword search
**When** they GET `/api/music/search?q=<query>`
**Then** the server calls the Spotify `/search?type=playlist` endpoint using the host's server-side token
**And** returns up to 10 results, each with `name`, `owner`, `trackCount`, and `playlistId`

**Given** a `playlistId` is selected
**When** the server fetches tracks from the Spotify playlist
**Then** it returns a list of tracks each containing `id`, `title`, `artist`, and `albumArtUrl`
**And** the list contains at least 25 tracks (sufficient for card generation)

**Given** the Spotify token is expired when the request is made
**When** the request hits the server
**Then** the token is refreshed inline before the Spotify call proceeds, with no error returned to the client

**Given** the Spotify API returns an error
**When** the server handles the response
**Then** a structured error is returned to the client with a human-readable message

---

### Story 4-2: Round Configuration Screen

As a host,
I want to configure the music source, clip duration, and title reveal setting before starting a round,
So that I control the game experience for each round.

**Acceptance Criteria:**

**Given** a host is in the lobby
**When** they tap "Configure Round"
**Then** the Round Config screen appears with two tabs: "Genre" and "Search"

**Given** the Genre tab is active
**When** the screen renders
**Then** genre presets from the API are displayed as visual cards, each showing a name and one-line descriptor
**And** tapping a card selects it with a brand-fill highlight; only one preset can be selected at a time

**Given** the Search tab is active
**When** the host types a query and submits
**Then** results from `/api/music/search` are displayed, each showing playlist name, owner, and track count
**And** selecting a result designates that playlist as the round's source

**Given** the host is on the Round Config screen
**When** they view the clip duration options
**Then** pill toggles for 20s, 30s, 45s, 60s, and Full Song are displayed
**And** exactly one option is selected at all times (default: 30s)

**Given** the host is on the Round Config screen
**When** they view the title reveal options
**Then** a radio group shows: Immediately, After 5s, After 10s, After 15s, Never
**And** exactly one option is selected at all times (default: After 5s)

**Given** the host has selected a music source
**When** they tap "Start Round →"
**Then** the selection (playlistId, clipDuration, titleRevealDelay) is submitted to the server
**And** the button is disabled and shows a loading state while the server responds

**Given** the host taps "Start Round →" without selecting a music source
**When** the form is submitted
**Then** an inline error appears prompting them to select a genre or search result first

---

### Story 4-3: Card Generation & Round Start Broadcast

As a player,
I want to receive a unique bingo card when the host starts a round,
So that I can play immediately without duplicate or repeated tiles.

**Acceptance Criteria:**

**Given** the host submits a valid round configuration
**When** the server processes the start-round request
**Then** it fetches the full track list for the selected playlist (via the API from Story 4-1)
**And** returns an error if the track pool contains fewer than 25 tracks

**Given** a valid track pool of ≥25 tracks
**When** cards are generated for all connected players (including the host)
**Then** each player receives a unique 5×5 card (25 tiles) sampled without replacement from the pool
**And** no two players have identical cards
**And** the centre tile (position 3,3) is always FREE

**Given** songs were played in an earlier round of the same session
**When** the pool is assembled for a new round
**Then** those songs are down-ranked (shuffled to the back of the pool) before sampling, not excluded entirely

**Given** songs were played in previous sessions for the same room
**When** the pool is assembled
**Then** those songs (looked up from SQLite) are also down-ranked before sampling

**Given** cards are generated
**When** the server broadcasts the round start
**Then** a `round:start` event is sent to every connected WebSocket client
**And** each client's payload includes their own card (array of 25 tile objects with `trackId`, `title`, `artist`, `albumArtUrl`), `clipDuration`, `titleRevealDelay`, and `roundNumber`

**Given** a guest connects after `round:start` has already been broadcast
**When** their `session:connect` completes
**Then** the server sends them a fresh blank card and the current `round:start` payload so they can begin playing

---

## Epic 5: Game Loop

*Full round plays end-to-end: songs play and auto-advance, guests mark tiles, server detects bingo, winner overlay fires on all screens.*

### Story 5-1: Song Scheduling & Host Playback Controls

As a host,
I want to start playback and have songs advance automatically,
So that the game loop runs without me manually triggering every song.

**Acceptance Criteria:**

**Given** a round has been started (`round:start` broadcast, `currentRound` populated with the ordered track pool)
**When** the host calls `POST /api/rooms/:code/round/play`
**Then** the server sets `currentSongIndex = 0`, appends the first track to `currentRound.songHistory`, and broadcasts `song:start` to all connected WebSocket clients
**And** the `song:start` payload includes: `trackId`, `title`, `artist`, `albumArtUrl`, `seekPositionMs` (fixed 60 000 ms for MVP), `clipDuration`, `titleRevealDelay`, `songIndex`, and `roundNumber`

**Given** `titleRevealDelay` is greater than 0
**When** the server broadcasts `song:start`
**Then** the server schedules a `setTimeout` for `titleRevealDelay` milliseconds that broadcasts `song:reveal` with `trackId` and `songIndex` to all connected clients
**And** if the song is advanced or the round ends before the timer fires, the pending timer is cancelled

**Given** `clipDuration` is set (clip mode, not full-song mode)
**When** the server broadcasts `song:start`
**Then** the server schedules a `setTimeout` for `clipDuration` milliseconds that automatically calls the next-song logic (same as `POST /round/next`)
**And** if the host manually advances before the timer fires, the pending auto-advance timer is cancelled

**Given** `clipDuration` is null (full-song mode)
**When** the server broadcasts `song:start`
**Then** no auto-advance timer is scheduled; the host must call `POST /round/next` manually

**Given** the host calls `POST /api/rooms/:code/round/next`
**When** there are more tracks remaining in `currentRound.trackPool`
**Then** `currentSongIndex` increments, the next track is appended to `songHistory`, any pending auto-advance and reveal timers for the previous song are cancelled, and a new `song:start` is broadcast

**Given** the host calls `POST /api/rooms/:code/round/pause`
**When** a song is currently playing
**Then** all pending auto-advance and reveal timers are cancelled
**And** a `song:pause` event is broadcast to all clients so they can update playback state

**Given** the host calls `POST /api/rooms/:code/round/play` while paused mid-song
**When** the server processes the request
**Then** `song:start` is rebroadcast for the current song index (no `songIndex` increment) so the SDK resumes from the same track

**Given** all tracks in the pool have been played
**When** the auto-advance timer fires on the last song
**Then** no new `song:start` is broadcast; the server broadcasts `songs:exhausted` to notify all clients the pool is empty

**Given** the host is authenticated and their room has an active round
**When** any playback control endpoint is called by a non-host client
**Then** the server returns HTTP 403

**Given** `song:start` events are broadcast
**When** timing is measured under typical home-network conditions
**Then** all connected clients receive the event within 200ms (NFR2)

---

### Story 5-2: Bingo Card UI & Tile Marking

As a player,
I want to see my bingo card and mark tiles as songs play,
So that I can track my progress and claim bingo when I complete a line.

**Acceptance Criteria:**

**Given** a player's client has received `round:start` with their card payload
**When** `RoomPage` renders
**Then** a 5×5 grid of tiles is displayed, each showing the song `title` (2-line max, ellipsis) and `artist` (10px muted)
**And** the centre tile (index 12, position 3,3) is always in `free` state: lighter brand fill with "FREE" label, auto-marked

**Given** a tile is in `unmarked` state
**When** the player taps it
**Then** the tile transitions to `marked` state: brand fill + white text
**And** tapping it again toggles it back to `unmarked`
**And** the `free` tile is not tappable and cannot be unmarked

**Given** `titleRevealDelay` is greater than 0 and the server broadcasts `song:start`
**When** the client receives `song:start`
**Then** the tile matching `trackId` transitions to `masked` state: CSS `blur(4px)` applied to the title text, overlaid with "Song N" where N = `songIndex + 1`
**And** the status line below the card updates to "Song N of this round"

**Given** `titleRevealDelay` is 0 (reveal immediately setting)
**When** the client receives `song:start`
**Then** the matching tile does NOT enter masked state; title remains visible

**Given** a tile is in `masked` state and the server broadcasts `song:reveal`
**When** the client receives `song:reveal` with matching `trackId`
**Then** the CSS blur animates off over 300ms and the "Song N" overlay label fades out, revealing the title

**Given** a player is waiting between songs
**When** no `song:start` has arrived since the last song ended
**Then** the status line reads "Waiting for next song…"

**Given** `round:win` is broadcast with a winning tile set
**When** the client receives `round:win`
**Then** all tiles in the winning line transition to `win-path` state: gold/amber 2px outline applied on top of their current state

**Given** the player is on a touch device
**When** any tile is rendered
**Then** all interactive tile elements are at least 44×44px (WCAG AA touch target, NFR5/UX-DR21)
**And** card tiles are approximately 60×60px at 375px viewport width with minimal gaps

**Given** a tile's title is truncated to 2 lines
**When** the player long-presses the tile on touch or hovers on desktop
**Then** the full title is revealed via a tooltip or inline expand

**Given** text is rendered on any tile background
**When** contrast is measured
**Then** all text meets WCAG AA ≥ 4.5:1 contrast ratio against its tile background colour

**Given** a player's `round:start` payload arrives
**When** the card renders
**Then** the card is fully interactive within 2 seconds of `session:connect` completing (NFR3)

---

### Story 5-3: Host Card View & Controls Panel

As a host,
I want to see my bingo card alongside playback controls,
So that I can play the game and manage the round without switching between views.

**Acceptance Criteria:**

**Given** the host's client receives `round:start`
**When** the host's game view renders
**Then** the host sees the same 5×5 bingo card as guests, using the identical tile component from Story 5-2
**And** the host can mark their own tiles exactly as a guest can (FR36)

**Given** the host is on a mobile viewport (< 768px)
**When** the game view renders
**Then** a persistent "Controls ▲" handle is visible at the bottom of the screen with an explicit text label (not a hidden gesture)
**And** tapping the handle opens the Controls Panel as a partial bottom sheet with approximately 40% of the card still visible above it

**Given** the Controls Panel is open on mobile
**When** it renders
**Then** it displays: current track name and artist; Prev, Play/Pause, and Next buttons (Next is the largest); a live player list; and an End Round button (small, low-prominence, right-aligned)

**Given** the host is on a desktop viewport (≥ 768px)
**When** the game view renders
**Then** the card occupies approximately 60% of the width on the left and the controls panel occupies approximately 40% on the right, always simultaneously visible with no overlay or context switching required (FR37)

**Given** the host taps Play in the Controls Panel
**When** no song is currently playing
**Then** the client calls `POST /round/play` and the button switches to a Pause icon while awaiting and after the server confirms

**Given** the host taps Next in the Controls Panel
**When** a song is playing
**Then** the client calls `POST /round/next`; any local auto-advance timer UI resets

**Given** the host taps End Round
**When** the button is tapped
**Then** a confirmation dialog appears asking the host to confirm ending the round

**Given** the host confirms ending the round in the dialog
**When** confirmation is received
**Then** a cancellable toast notification appears at the top of the screen for 2 seconds with an "Undo" action
**And** if not cancelled within 2 seconds, the client calls `POST /api/rooms/:code/round/end`

**Given** `POST /round/end` is called
**When** the server processes it
**Then** the server cancels all pending timers, clears `currentRound`, broadcasts `round:end` to all clients, and returns HTTP 200
**And** all connected clients (host and guests) receive `round:end` and navigate back to the lobby state

**Given** the host cancels the end-round toast within 2 seconds
**When** "Undo" is tapped
**Then** the toast dismisses, no `POST /round/end` is called, and the round continues normally

---

### Story 5-4: Spotify Web Playback SDK Integration

As a host,
I want music to play through my browser automatically when songs advance,
So that guests hear the correct song clip without me managing a separate Spotify app.

**Acceptance Criteria:**

**Given** the host's game view mounts
**When** the Spotify Web Playback SDK script is loaded
**Then** `SpotifySDKProvider` is instantiated, implementing the `MusicProvider` interface (interface defined by Epic 2 spike: `play(uri, positionMs)`, `pause()`, `resume()`, `onStateChange(cb)`, `onError(cb)`)
**And** the SDK is only loaded for the host role — guest clients do not load the SDK

**Given** `SpotifySDKProvider.init()` is called
**When** the SDK requires an OAuth token via its `getOAuthToken` callback
**Then** the client fetches `GET /api/auth/sdk-token` (authenticated host endpoint) and returns the access token to the SDK
**And** the access token is never stored in client-side state beyond the callback — the server holds it (NFR7)

**Given** the SDK initialises successfully
**When** `player.connect()` resolves
**Then** the device appears in the Spotify Connect device list
**And** the initialisation latency is logged for diagnostics (informed by Epic 2 spike findings)

**Given** the host's client receives `song:start`
**When** `SpotifySDKProvider.play(trackUri, seekPositionMs)` is called
**Then** `PUT /v1/me/player/play` is called with the track URI and `position_ms`
**And** playback begins from that position within 1 second (NFR1)

**Given** Spotify's SDK emits `state_changed` events in rapid burst after a seek
**When** events arrive within the first 500ms of a new `song:start`
**Then** the provider debounces or ignores state events until the playback position has advanced past the seek point before acting on state

**Given** the host's client receives `song:pause` or `round:end`
**When** the event is processed
**Then** `SpotifySDKProvider.pause()` is called and `player.pause()` rejection is handled gracefully (logged, not thrown)

**Given** the SDK emits `initialization_error` or `authentication_error`
**When** either error fires
**Then** the host sees a non-blocking SDK Failure Banner at the top of the screen (does not obscure card or controls)
**And** the banner text leads with "The game still runs fine" followed by an expandable "How to fix ▾" section with step-by-step fallback instructions
**And** the banner includes a `spotify:track:<id>` deep link for the currently playing track

**Given** the SDK Failure Banner is active
**When** the Controls Panel renders
**Then** the Prev/Play/Pause/Next buttons are replaced with "Audio playing via Spotify app" text
**And** a `spotify:track:<id>` deep link for the current track is shown in the panel

**Given** `getValidAccessToken(hostId)` is needed in any server handler
**When** token expiry is checked
**Then** a single shared `getValidAccessToken(hostId)` helper is used — no inline token-refresh blocks duplicated across handlers (addressing Epic 4 deferred item)

---

### Story 5-5: Win Detection & Win Overlay

As a player,
I want to claim bingo and have it verified instantly,
So that the winner is confirmed fairly and everyone sees the result.

**Acceptance Criteria:**

**Given** a player marks tiles on their card
**When** any marked tile completes a winning line (row, column, or either diagonal — counting the FREE centre tile)
**Then** a "Bingo!" button becomes visible and tappable on the player's card view
**And** the button is not shown before a winning line is detected client-side

**Given** the "Bingo!" button is tapped
**When** the player submits the claim
**Then** the client calls `POST /api/rooms/:code/round/claim` with the array of `trackId` values the player has marked (plus `"FREE"` for the centre tile)
**And** the button enters a disabled/loading state immediately to prevent duplicate claims

**Given** the server receives a bingo claim
**When** it validates the claim
**Then** it checks: (a) the claimed tile IDs are all present on the player's server-stored card (`currentRound.cards[playerName]`), and (b) the claimed tile IDs that are non-FREE all appear in `currentRound.songHistory` (i.e. have been played)
**And** it checks that at least one complete winning line (5 in a row/column/diagonal) exists within the claimed set

**Given** the claim is valid
**When** validation passes
**Then** the server broadcasts `round:win` to all clients with: `winnerName`, `winningTileIds` (the validated line), and `songHistory` snapshot
**And** all pending auto-advance and reveal timers are cancelled
**And** `currentRound.ended = true` is set so no further `song:start` events are emitted

**Given** the claim is invalid (tiles not played, not on card, or no complete line)
**When** validation fails
**Then** the server returns HTTP 422 to the claiming client with a brief error reason
**And** no `round:win` is broadcast; other players are unaffected
**And** the claiming player's "Bingo!" button re-enables so they can retry

**Given** all clients receive `round:win`
**When** the event is processed
**Then** a full-screen Win Overlay renders above all other content (highest z-index)
**And** it displays: a CSS confetti animation (~2 seconds), the winner's name at 24px, and a list of the 5 winning songs (title + artist)

**Given** the Win Overlay is shown on a guest's screen
**When** 5 seconds elapse
**Then** the overlay auto-dismisses and the player returns to their card view in a post-round state

**Given** the Win Overlay is shown on the host's screen
**When** 1.5 seconds elapse
**Then** a "Start Next Round" CTA appears on the overlay
**And** a secondary "Dismiss" button is also visible
**And** tapping "Start Next Round" navigates the host to the Round Config screen; tapping "Dismiss" returns to the card in post-round state

**Given** two players submit claims simultaneously
**When** both `POST /round/claim` requests reach the server
**Then** the first request to arrive (by server receipt timestamp) is validated and wins; the second receives HTTP 409 or 422 indicating the round has already ended

---

### Story 5-6: Song History, Late-Join Sync & Auth Re-auth

As a player,
I want to review all songs played so far and have the game remain accessible when I join late or when auth lapses,
So that I can catch up on missed songs and the host can recover without ending the session.

**Acceptance Criteria:**

**Given** the server broadcasts `song:start`
**When** the event is emitted
**Then** the track object (`trackId`, `title`, `artist`, `albumArtUrl`, `songIndex`) is appended to `currentRound.songHistory` on the server before broadcast

**Given** a player is in an active round
**When** they tap `≡ History` in the card view header
**Then** a Song History bottom sheet opens at approximately 70% of the screen height and is scrollable
**And** entries are listed newest-first, each showing: song number, title, artist, and 40×40px album art (with a music-note icon fallback if art is unavailable)
**And** the sheet is accessible at any time during the round — between songs and while a song is playing

**Given** a guest connects via `session:connect` while a round is already in progress
**When** the server responds
**Then** the `session:connect` response includes `currentRound.songHistory` alongside their blank card and the `round:start` payload (extending the late-join logic from Story 4-3)
**And** the guest can immediately open the History drawer to self-mark songs they recognise on their blank card (FR34)

**Given** a host reconnects mid-round via `session:connect`
**When** the server responds
**Then** the host receives the same `round:start` re-send (card + config) and `songHistory` that a late-joining guest would receive
**And** their role is restored as host (addressing Epic 4 deferred item: host reconnect mid-round receives no round:start re-send)

**Given** the History drawer is open
**When** a new `song:start` arrives
**Then** the new entry is prepended to the list in real time without requiring the drawer to be closed and reopened

**Given** the `auth:degraded` event is received by the host client (wired in Epic 3)
**When** the Auth Degraded Banner is displayed
**Then** a "Re-authenticate →" button is present in the banner

**Given** the host taps "Re-authenticate →"
**When** the button is tapped
**Then** the Spotify OAuth authorize URL opens in a **popup window** (not a full redirect — a redirect would destroy the active game session)
**And** the main game window remains open and the game state is preserved

**Given** the OAuth popup completes successfully
**When** the server receives the new tokens via the callback
**Then** the server updates the host's tokens in the database and emits a `auth:restored` WebSocket event to the host's client
**And** the host client closes the popup (or it closes automatically), `SpotifySDKProvider` re-initialises with the fresh token, and the Auth Degraded Banner clears automatically

**Given** the OAuth popup is closed by the user without completing auth
**When** the popup closes
**Then** the Auth Degraded Banner remains visible with no change to game state

---

## Epic 6: Deploy & Harden

*Turn the working game into something Philip + friends can actually play over the internet from their own phones: single-command local dev (multi-browser + Tailscale phone testing), Dockerised deployment to a single Proxmox LXC hosting both staging and prod, HTTPS/WSS via Caddy, server-restart state recovery, host-controlled Spotify disconnect/reconnect, and Gitea Actions CI/CD with a trunk-based branching strategy.*

### Story 6-1: Local Dev & Tailscale Multi-Device Testing

As a developer,
I want to run the full stack locally with a single command and reach it from other browsers and my phone,
So that I can test host+guest flows end-to-end before deploying.

**Acceptance Criteria:**

**Given** a fresh clone of the repo on a Macbook
**When** the developer runs `cp .env.example .env`, fills in Spotify credentials, and runs `npm install && npm run dev`
**Then** Vite dev server starts on port 5173 and the Hono server starts on port 3000 concurrently (NFR17)
**And** no further setup commands are required to begin developing

**Given** the Hono server is starting up
**When** `serve()` is called from `@hono/node-server`
**Then** the server binds to `0.0.0.0` (not `127.0.0.1`) so peers on the LAN and Tailscale tailnet can reach it

**Given** the Vite dev server is starting
**When** `vite` reads `vite.config.ts`
**Then** `server.host` is set to `true` so the dev server listens on all interfaces
**And** the existing proxy entries for `/auth`, `/api`, and `/ws` continue to forward to `http://127.0.0.1:3000` unchanged

**Given** the developer is on a Macbook with multiple browsers installed
**When** they open `http://127.0.0.1:5173/` in Chrome as the host and `http://127.0.0.1:5173/room/:code` in Firefox and Safari as guests
**Then** a full host + multi-guest session can be played locally without any additional tunnelling or proxy setup

**Given** the Macbook is connected to the Tailscale tailnet
**When** the developer opens `http://<macbook-tailnet-hostname>:5173/room/:code` on a phone also on the tailnet
**Then** the phone can join as a guest, receive a card, mark tiles, and see real-time WS events from the host's Macbook browser

**Given** the developer wants to test Spotify auth from a Tailscale peer
**When** they consult the README
**Then** the README documents how to register a secondary redirect URI matching the tailnet hostname in the Spotify developer dashboard (or use the primary `http://127.0.0.1:5173/auth/callback` on the Macbook and test Spotify-dependent flows from the Macbook only)

**Given** the developer opens the README for the first time
**When** they scroll to the "Local Development" section
**Then** they find: (a) the single-command setup flow, (b) the multi-browser host+guest testing flow on Macbook, (c) the Tailscale phone testing flow with tailnet hostname example, (d) a Troubleshooting sub-section covering port collisions (3000/5173), tailnet TLS cert warnings on phone, and Spotify 400 errors from unregistered redirect URIs

**Given** `.env.example` is the source of truth for required environment variables
**When** the developer reads it
**Then** every variable consumed by [src/server/config.ts](src/server/config.ts) is listed with a brief comment explaining its purpose and a safe placeholder value

---

### Story 6-2: Production Dockerfile & Docker Compose

As an operator,
I want a single `docker compose up -d` to bring up the whole stack with secrets from env,
So that I can deploy to a Proxmox LXC without manual bootstrapping.

**Acceptance Criteria:**

**Given** a production deployment target
**When** `docker build` is run against the new `Dockerfile`
**Then** a multi-stage build executes: stage 1 (`node:20-alpine`) runs `npm ci && npm run build` producing `dist/client` and `dist/server`; stage 2 (`node:20-alpine`) copies `dist/`, `package.json`, and production-only `node_modules`, runs as a non-root user, and declares `CMD ["node", "dist/server/index.js"]`
**And** the final image size is under 300 MB

**Given** the production server starts inside the container
**When** it reads `process.env.DB_PATH`
**Then** [src/server/db.ts](src/server/db.ts) opens the SQLite database at that path, defaulting to `./bangerbingo.db` when unset, so the container can be pointed at a mounted volume

**Given** the compose stack is started on a fresh LXC with a populated `.env` file
**When** `docker compose up -d` is run
**Then** a single `app` service starts, reading env from `.env` via `env_file:`, mounting a named volume (`bangerbingo-data`) at `/data`, with `DB_PATH=/data/bangerbingo.db` exported to the container
**And** the app becomes reachable on the configured port within 60 seconds
**And** no manual migration or seeding commands are required — the `CREATE TABLE IF NOT EXISTS` pattern in `initDb()` handles fresh databases

**Given** the server starts up
**When** a client hits `GET /healthz`
**Then** the server responds with HTTP 200 and `{ "ok": true, "version": "<package.json version>" }`
**And** the compose file's healthcheck uses this endpoint with a 30-second interval

**Given** the operator needs to know what to configure
**When** they read the new "Deployment" section of the README
**Then** they find: the full list of required env vars (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SESSION_SECRET`, `APP_DOMAIN`, optional `PORT`), the exact `docker compose` commands for start/stop/logs/rebuild, and the named volume path (NFR7, NFR9 — secrets via env only, never in image)

**Given** the repo root
**When** `docker build` reads `.dockerignore`
**Then** it excludes `node_modules`, `dist`, `.env`, `*.db`, `*.db-shm`, `*.db-wal`, `.claude/`, `_bmad*`, `.git`, and `_bmad-output` to keep the build context minimal

**Given** the Spotify credentials are supplied at deploy time (FR43)
**When** the operator populates `.env` on the host
**Then** `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are read only from env — never baked into the image or committed to the repo (NFR9)

---

### Story 6-3: HTTPS/WSS via Caddy Reverse Proxy

As an operator,
I want TLS termination and WebSocket upgrade handled by a reverse proxy that auto-manages certificates,
So that production traffic is HTTPS/WSS without manual cert wrangling (NFR6).

**Acceptance Criteria:**

**Given** the compose stack
**When** it starts
**Then** a second service `caddy` runs using the `caddy:2-alpine` image, with ports 80 and 443 published on the host, and named volumes `caddy_data` and `caddy_config` persisting certs across restarts

**Given** a new `Caddyfile` at the repo root
**When** Caddy reads it on startup
**Then** it declares a site block for `{$APP_DOMAIN}` that uses `reverse_proxy app:3000` with the standard WebSocket upgrade headers (Caddy 2 handles WS upgrade automatically with `reverse_proxy`, so no extra matcher is needed)

**Given** `APP_DOMAIN` resolves to a publicly reachable DNS name
**When** Caddy attempts to provision a certificate
**Then** it automatically obtains and renews a Let's Encrypt cert with no operator intervention

**Given** `APP_DOMAIN` is a tailnet-only hostname (e.g. `bingo.tail-abc123.ts.net`)
**When** Caddy cannot reach Let's Encrypt for DNS validation
**Then** the Caddyfile documentation in the README explains switching that site to `tls internal` for a self-signed cert, and the tailnet-cert-warning troubleshooting steps in the phone browser

**Given** a client makes an HTTP request to the domain
**When** Caddy receives it on port 80
**Then** Caddy returns a 308 redirect to the `https://` equivalent URL (Caddy's default behaviour when TLS is configured)

**Given** a host or guest browser connects to `wss://{APP_DOMAIN}/ws`
**When** the WebSocket upgrade request passes through Caddy
**Then** the connection is successfully upgraded and `session:connect` / `player:joined` events flow exactly as they do in local dev

**Given** deployment verification
**When** the operator runs `curl -I https://{APP_DOMAIN}/healthz`
**Then** the response is HTTP 200 with a valid TLS certificate (no `-k` flag required for public domains)

**Given** a phone on the tailnet joining a room
**When** the phone connects to `https://{APP_DOMAIN}/room/:code`
**Then** both the REST requests and the WebSocket connection complete successfully end-to-end

---

### Story 6-4: Server Restart State Recovery

As a player,
I want a single server restart mid-round to not kill our game,
So that we can resume after a deploy or crash without losing the current round (NFR13).

**Acceptance Criteria:**

**Given** the SQLite schema at boot
**When** `initDb()` runs in [src/server/db.ts](src/server/db.ts)
**Then** a new table is created: `active_rooms(room_code TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`

**Given** a new helper `persistRoomState(code)` is defined in [src/server/ws.ts](src/server/ws.ts)
**When** it is called
**Then** it reads the current `RoomState` from `roomSockets`, serializes a plain-data snapshot (omitting WebSocket refs, timer handles, and `host`/`guests` maps — keeping `hostUserId`, `pendingRound`, and the entire `currentRound` object except `timers`), and upserts it into `active_rooms` keyed by `room_code`

**Given** a round transition occurs
**When** any of the following events fires, `persistRoomState(code)` is invoked exactly once: (a) the round-start broadcast after `cards` and the initial `songHistory` are built, (b) each `song:start` broadcast in the game-loop (so `currentSongIndex` and `songHistory` are always durable), (c) a `round:win` broadcast after valid claim validation, (d) a `round:end` broadcast
**And** no per-tap or per-guest-join snapshots are written — snapshot pressure stays low

**Given** the server process starts up
**When** boot completes and before accepting WebSocket connections
**Then** a new `rehydrateRooms()` function reads every row from `active_rooms` and repopulates `roomSockets` with a reconstructed `RoomState` — `host: null`, `guests: new Map()`, `hostHasEverConnected: true`, `currentRound.timers: {}`, and `currentRound.paused: true` regardless of prior paused state

**Given** a host reconnects via `session:connect` after a server restart
**When** the server matches their session to `hostUserId`
**Then** the existing re-send logic from Story 5-6 delivers the cached `round:start` payload + `songHistory`, and the host's card view renders with the exact tile state from before the restart

**Given** a guest reconnects by name via `session:connect` after a server restart
**When** the server finds their `playerName` in `currentRound.cards`
**Then** the `session:connect` response includes their card from `currentRound.cards[playerName]` and the current `songHistory`, so their card renders identical to pre-restart

**Given** the host hits Play after reconnecting post-restart
**When** `POST /round/play` is called
**Then** the server re-broadcasts `song:start` for the current `currentSongIndex` (no index increment) and the auto-advance timer restarts from that position — mid-song timer recovery is explicitly NOT required

**Given** a round ends (either via `round:end` or via `round:win` broadcast)
**When** the corresponding `persistRoomState` snapshot is written
**Then** after the round transitions out of `active` state, the `active_rooms` row for that `room_code` is deleted so stale rows do not accumulate

**Given** a room is closed entirely (`room:close`)
**When** the room is torn down
**Then** its row in `active_rooms` is deleted

**Given** a restart-recovery verification scenario
**When** the developer: (1) starts a round with 3 songs played, (2) kills the server process, (3) restarts it, (4) reconnects as a guest, (5) opens the History drawer
**Then** the drawer shows the same 3 songs in the same order, and the guest's card tile state matches what they had marked before the kill

---

### Story 6-5: Host Spotify Disconnect/Reconnect Settings

As a host,
I want to disconnect and reconnect my Spotify account from settings,
So that I can swap accounts or recover from a stuck auth state without admin help (FR5).

**Acceptance Criteria:**

**Given** an authenticated host session
**When** the host navigates to `/account`
**Then** an Account Settings page renders showing: the current Spotify display name (from the `hosts` row), a "Disconnect Spotify" button, and a "Reconnect Spotify" button (only one of the two is enabled at a time based on whether tokens exist)

**Given** the host is not authenticated (no valid session cookie)
**When** they attempt to navigate to `/account`
**Then** they are redirected to the login screen (not a 404 — existing app convention)

**Given** the host taps "Disconnect Spotify"
**When** the button is tapped
**Then** a confirmation dialog appears with the text "This will stop music playback in any active rooms. Continue?" and Cancel / Disconnect buttons

**Given** the host confirms the disconnect dialog
**When** the client calls `POST /api/account/spotify/disconnect`
**Then** the server updates the authenticated host's row in the `hosts` table, setting `access_token`, `refresh_token`, and `token_expires_at` to NULL, and returns HTTP 200

**Given** the host has disconnected Spotify
**When** their browser is still running an active game and the SDK attempts to re-initialise (e.g. on the next `song:start` after disconnect)
**Then** `SpotifySDKProvider.init()` fails and the existing SDK Failure Banner from Story 5-4 is shown, following the same fallback path as any other init failure

**Given** the host taps "Reconnect Spotify"
**When** the button is tapped
**Then** the client initiates the existing PKCE OAuth flow from Epic 1 Story 1-1 (redirect to the Spotify authorize URL with PKCE challenge) rather than implementing a parallel flow

**Given** the OAuth callback succeeds after a reconnect
**When** the server processes the token exchange
**Then** the new `access_token`, `refresh_token`, and `token_expires_at` are written back to the authenticated host's existing row in the `hosts` table (the row is never duplicated or replaced — matched on `user_id`)
**And** the Account Settings page reflects the updated Spotify display name on next render

**Given** a non-host client calls `POST /api/account/spotify/disconnect`
**When** the server checks the session
**Then** it returns HTTP 401 Unauthorized

---

### Story 6-6: Gitea Actions CI/CD, Branching Strategy & Smoke Test

As a solo developer working across devices including mobile,
I want `main` to auto-deploy to staging and a clear tag-based promotion to prod,
So that I can ship from anywhere and verify with a repeatable smoke test.

**Acceptance Criteria:**

**Given** a new `.gitea/workflows/ci.yml` workflow
**When** any push to any branch or any PR is opened
**Then** the workflow installs Node 20, runs `npm ci`, then runs `npm run lint`, `npm test`, and `npm run build` in sequence
**And** all four must pass for the workflow to succeed

**Given** a new `.gitea/workflows/deploy-staging.yml` workflow
**When** a push to `main` completes successfully and the CI workflow has passed
**Then** the workflow SSHes to the shared Proxmox LXC (using a Gitea Actions secret for the SSH key) into `/srv/bangerbingo/staging`, runs `git pull origin main`, then `docker compose -p bb-staging --env-file .env.staging up -d --build`

**Given** a new `.gitea/workflows/deploy-prod.yml` workflow
**When** a git tag matching the pattern `prod-*` is pushed (e.g. `prod-2026-04-05-01`)
**Then** the workflow SSHes to the same LXC into `/srv/bangerbingo/prod`, runs `git fetch --tags && git checkout <tag>`, then `docker compose -p bb-prod --env-file .env.prod up -d --build`

**Given** staging and prod share one LXC
**When** both stacks are running concurrently
**Then** they use distinct compose project names (`bb-staging`, `bb-prod`), distinct named volumes (`bb-staging-data`, `bb-prod-data`, `bb-staging-caddy-data`, `bb-prod-caddy-data`), and distinct env files (`.env.staging`, `.env.prod`) each with its own `APP_DOMAIN`, `SPOTIFY_REDIRECT_URI`, and `SESSION_SECRET`
**And** a single shared Caddy service routes by `APP_DOMAIN` host-matching to the correct upstream app container, avoiding port conflicts on 443 and duplicate cert issuance

**Given** the branching strategy is documented in the README
**When** a developer reads it
**Then** the doc specifies: `main` is the one long-lived branch; feature work happens on short-lived branches named `feat/<slug>` or `fix/<slug>` merged via Gitea PR; staging deploys on every push to `main`; prod deploys on push of a tag matching `prod-YYYY-MM-DD-NN`; no long-lived `develop`/`staging`/`prod` branches exist

**Given** the developer wants multiple Claude sessions (including mobile) working in parallel
**When** they read the "Parallel Workstreams" README section
**Then** it documents using `git worktree add ../bb-<branch> <branch>` to create isolated checkouts for separate Claude agents, with an example of how to run them against the same repo without file clobbering, and how to merge/delete the worktree when done

**Given** the mobile-friendly flow
**When** the developer merges a PR from the Gitea web UI on their phone
**Then** the staging stack updates automatically within a few minutes, and the developer can smoke-test the change from their phone over the tailnet immediately — no desktop required for the full loop

**Given** a new runbook at `docs/smoke-test.md`
**When** the developer runs through it manually after any staging deploy
**Then** it walks them through: (1) host registers + connects Spotify, (2) host creates a room, (3) guest joins from a second browser using the room code, (4) host starts a round with a genre preset and a short clip length, (5) first song plays and the correct tiles enter masked state, (6) guest marks tiles and claims bingo, (7) win overlay fires on both host and guest screens, (8) host taps "Start Next Round" and a new round configures

**Given** the runbook includes a restart-recovery variant
**When** the developer executes it
**Then** they: run the smoke test to step (5), run `docker compose -p bb-staging restart app`, reconnect both browsers, press Play on the host, and verify the round resumes from the same `currentSongIndex` with the same songHistory and card state (validating Story 6-4)

**Given** the runbook notes expected timings
**When** the developer observes the smoke test
**Then** it flags NFR1 (host control actions < 500ms), NFR2 (WS broadcast < 200ms), and NFR3 (card loads < 2s) as eyeball checkpoints — not automated assertions, but things to notice


---

## Epic 8: Relaxed Play

*Host can enable Continuous Mode for back-to-back games on the same playlist; win moment holds for celebration; players can opt into Casual Mode for automatic square marking; session win stats surface in the Players List.*

---

### Story 8-1: Win Moment Hold & Audio Presets

As a host,
I want the win screen to hold until someone dismisses it and for audio feedback to match the room's vibe,
So that the celebration moment isn't steamrolled and the party tone is consistent.

**Acceptance Criteria:**

**Given** a player has won and the win overlay fires
**When** it appears
**Then** it holds indefinitely — no auto-dismiss timer — until a "Dismiss" CTA is tapped by host or the winner

**Given** the win overlay is displayed
**When** a user taps "Dismiss"
**Then** the overlay clears and the game returns to the post-round state (Continuous Mode countdown, or idle if Continuous Mode is off)

**Given** the host is configuring a session
**When** they view session-level settings
**Then** they see an audio preset selector with three options: Hype, Deadpan, Minimal; default is Hype

**Given** a win event fires
**When** the win overlay appears
**Then** the audio clip corresponding to the host's selected preset plays once, non-blocking

**Given** the Deadpan preset is selected
**When** the win audio plays
**Then** it is dry, sarcastic in tone — not celebratory, not harsh

**Given** the Minimal preset is selected
**When** the win audio plays
**Then** it is a short subtle chime only — no voice, no personality

---

### Story 8-2: Session Statistics

As a player,
I want to see who has won and how many times in the Players List,
So that the session has a sense of history without anyone feeling tracked for losses.

**Acceptance Criteria:**

**Given** a round completes with a verified winner
**When** the server processes the win
**Then** the winner's session win count increments by 1 in in-memory GameState

**Given** a round completes
**When** player state is updated
**Then** the previous "Won last round" flag is cleared for all players, then set only for the winner of the completed round

**Given** the Players List is visible
**When** a player has at least 1 session win
**Then** their win count is displayed next to their name (e.g. "×2")

**Given** the Players List is visible
**When** a player won the most recent round
**Then** a "Last round ✓" indicator appears next to their name

**Given** no player has won yet in the session
**When** the Players List is displayed
**Then** no win count or last round indicator is shown for any player

**Given** the session ends or the room resets
**When** a new session begins
**Then** all win counts and last-round flags reset to zero — stats are session-scoped only, never persisted to SQLite

**Given** a `stats:updated` WebSocket event is emitted after each win
**When** clients receive it
**Then** the Players List updates in real time without requiring a reload

---

### Story 8-3: Continuous Mode

As a host,
I want to toggle Continuous Mode to keep games rolling back-to-back on the same playlist without reshuffling,
So that the party doesn't stall between rounds.

**Acceptance Criteria:**

**Given** the host is in an active session
**When** they view the playback controls area
**Then** a Continuous Mode toggle is visible with a clear on/off indicator

**Given** Continuous Mode is toggled
**When** the change is made
**Then** it takes effect for the next round end — no impact on the currently running round

**Given** a round ends and Continuous Mode is on and the win screen has been dismissed
**When** the countdown begins
**Then** a visible 10-second countdown is displayed in the song-info area with the label "Next game starts in..."

**Given** the 10-second countdown elapses
**When** time reaches zero
**Then** the server auto-starts a new round using the same round configuration (same clip length, title reveal, Casual Mode permission, audio preset) — no host action required

**Given** a new round auto-starts via Continuous Mode
**When** the card pool is generated
**Then** songs played in any prior round of the current session are excluded from the pool first, then down-ranked if the pool would otherwise be too small — preserving cross-round variety

**Given** the host turns off Continuous Mode mid-session
**When** the current round ends
**Then** the game returns to the normal post-round idle state — no auto-start, no countdown

**Given** Continuous Mode is on and a round ends with no active winner dismiss
**When** the win screen has not been dismissed
**Then** the countdown does NOT begin — the 10-second timer waits for manual dismiss regardless

---

### Story 8-4: Casual Mode — Host Permission & Player Toggle

As a host,
I want to control whether players can use Casual Mode per round,
So that I can tune engagement expectations for the group.

As a player,
I want to opt into Casual Mode,
So that I can enjoy the game socially without staring at my phone.

**Acceptance Criteria:**

**Given** the host is on the Round Config screen
**When** they view the config form
**Then** an "Allow Casual Mode" on/off toggle is present, using the same visual style as other round config toggles; it defaults to off

**Given** "Allow Casual Mode" is on
**When** a player views their session UI
**Then** a "Casual Mode" toggle is visible and accessible in their settings area

**Given** "Allow Casual Mode" is off
**When** a player views their session UI
**Then** no Casual Mode toggle is shown

**Given** a player enables their Casual Mode toggle
**When** the change is saved
**Then** a `player:casual-mode-changed` event is emitted and the server updates that player's `casualMode` flag in GameState

**Given** a player has Casual Mode on
**When** any player views the Players List
**Then** a ☕ icon appears next to that player's name — subtle, not prominent

**Given** a player has Casual Mode off
**When** any player views the Players List
**Then** no ☕ icon is shown for that player

---

### Story 8-5: Casual Mode — Auto-Mark Engine

As a player with Casual Mode on,
I want my squares to be automatically marked whenever a track changes,
So that I'm never behind just because I looked away.

**Acceptance Criteria:**

**Given** a `track_changed` event fires on the server (natural progression or host skip)
**When** the event is processed
**Then** the server sweeps `played_history` and for each player with `casualMode: true`, marks any tile whose song is in `played_history` and is not the `current_song`

**Given** the auto-mark sweep runs
**When** one or more tiles are newly marked for a player
**Then** a `square:auto-marked` WebSocket event is emitted to that player only, with the list of newly marked tile indices

**Given** a player receives a `square:auto-marked` event
**When** their card renders
**Then** the affected tiles animate into the marked state using a visually distinct (softer/delayed) animation compared to a manual mark

**Given** a host skip triggers a track change
**When** the auto-mark sweep runs
**Then** it behaves identically to a natural track change — no special-casing for skips

**Given** a tile was already manually marked by the player
**When** the auto-mark sweep runs and that tile's song is in played_history
**Then** the tile state is unchanged — no duplicate mark event emitted

**Given** a player joins mid-session with Casual Mode already on (or enables it mid-session)
**When** they toggle Casual Mode on
**Then** the server immediately runs a catch-up sweep for that player over the full `played_history` (excluding `current_song`) and emits a `square:auto-marked` event for all unmarked matching tiles
**And** a non-blocking toast appears on their screen: "Caught up on X songs" where X is the number of tiles swept

**Given** Casual Mode auto-mark fires for a player
**When** that marking creates a winning bingo pattern
**Then** the standard win detection flow triggers — the auto-mark can produce a valid win

---

## Epic 9: Game Over Rethink

*The current `WinOverlay` is a modal dropped over a dead card view, and requires a deliberate "Bingo!" button tap to claim a win. This epic replaces both: marking the winning tile auto-claims, and the win state is a page mode of the game screen — not an overlay — with winner and loser variants that turn the end of a round into a communal scoreboard moment.*

**Design intent captured from 2026-04-14 party-mode discussion with Sally (UX), Winston (Architecture), John (PM), Amelia (Dev). Key principles:**
- The server already sees every card; a claim button is paper-bingo ceremony with no purpose here. Marking the winning tile *is* the claim.
- The Game Over view is a *page mode* of `RoomPage`/`HostRoomPage`, not a modal, because the cards are the content — they shouldn't hide behind a backdrop.
- Mobile-first, responsive down to a small host laptop. No big-screen / TV layout (the host does not want to share their card on a shared display).
- "Independent of live game state" = the Game Over page mode is a client-side view state. The server still ends the round on first valid claim (same `round.ended = true` + `round:win` broadcast as today).
- The host is always also a player in this project.

**Scope expansion (2026-04-19):** This epic also carries **Story 9-2: Live Round Settings & Pre-Round Simplification**, which targets the same round-boundary friction from the *entry* side. The pre-round overlay today front-loads six decisions before a single song plays and exposes a cryptic "Loop" button in the mini-player; 9-2 collapses those into a minimal playlist-first setup with an expandable "Advanced settings" block, and relocates live-editable versions of clip duration / title reveal / win reaction (formerly "Vibe") / casual mode / Autoplay Next Round into the in-round Host Controls panel with hover-info tooltips and ~1.5s "Saved — applies to next song" confirmations. Host preferences persist to `localStorage` so new sessions skip the configuration step. 9-2 is independent of 9-1 and can ship on its own.

---

### Story 9-1: Game Over Page State & Auto-Bingo

As a player,
I want my bingo to be auto-claimed the moment I mark my winning tile and drop the whole room into a Game Over page where everyone can see the winner's card alongside their own,
So that the end of a round is a shared scoreboard moment instead of a dismissable notification, and so no one loses because their reflexes on the Bingo button were half a second slow.

**Acceptance Criteria:**

**— Auto-Bingo (replace the claim button) —**

**Given** a player is in an active round with a card that does not yet form a winning line
**When** they mark a tile that causes `hasBingo` to flip true (i.e. `WIN_LINES.some(line => isWinningLine(tiles, line, playedTrackIds))` now passes)
**Then** the client immediately POSTs to `/api/rooms/:code/round/claim` with the full set of marked tile IDs — no user button tap required

**Given** the auto-claim POST fires
**When** it is in flight
**Then** the old `Bingo!` button is not rendered anywhere in the UI (it is deleted from `RoomPage.svelte` and `HostRoomPage.svelte`; `handleBingoClick` and `isClaiming` are removed from `gameState`)

**Given** a player's auto-claim is in flight
**When** they mark or unmark additional tiles before the server responds
**Then** the claim is guarded so it only fires once per round — a subsequent `hasBingo` re-flip does not produce a second POST

**Given** two players in the same room auto-claim on the same song (race condition)
**When** the server processes both POSTs
**Then** the first POST wins (server sets `round.ended = true`, broadcasts `round:win`); the second POST receives a non-200 response and the second client does nothing on receipt — the subsequent `round:win` broadcast is what transitions both clients into Game Over

**Given** a player unmarks a tile that was part of their winning line but the server has already accepted their claim
**When** `round:win` has been broadcast
**Then** the Game Over state persists — late unmarks do not retroactively invalidate the win

**— Game Over as a page mode (not an overlay) —**

**Given** a client receives a `round:win` broadcast
**When** the game page renders
**Then** the `WinOverlay` modal component is no longer used; instead `RoomPage`/`HostRoomPage` render a `GameOverView` branch of the page (different top-level `{#if}` branch gated on `game.winData !== null`) that fully replaces the active-round card view — no fixed-position modal, no backdrop

**Given** the Game Over page mode is rendered
**When** the round ends
**Then** the existing header, song history drawer, and players overlay remain reachable from this page mode (their buttons/affordances are still visible and functional) — only the card area changes

**Given** the Game Over page mode is rendered
**When** the user attempts to dismiss it
**Then** there is no generic "Dismiss" affordance — the page mode persists until the next round starts or the session ends (dismiss-to-peek-at-live-card is not needed because the card IS on the Game Over screen)

**— Winner variant —**

**Given** a player is the winner (the client's own player name matches `winData.winnerName`)
**When** the Game Over page mode renders
**Then** the top of the view shows a large celebratory "BINGO!" headline with the winner's name beneath (reuse existing Hype/Deadpan/Minimal preset styling from `audioPreset`)

**Given** the winner variant is rendered
**When** the card area renders
**Then** the winner sees *only their own card* (no toggle, no "their card vs your card"), with the winning line highlighted via the existing `applyWinPath` treatment and non-winning tiles dimmed to ~40% opacity

**Given** the winner variant is rendered
**When** the winning songs list renders
**Then** the 5 songs that formed the winning line are displayed in winning-line order (filtered from `winData.songHistory` by `winData.winningTileIds`)

**— Loser variant —**

**Given** a player is not the winner (non-host or host-as-player whose name does not match `winData.winnerName`)
**When** the Game Over page mode renders
**Then** the top of the view shows a smaller "{winnerName} got BINGO" headline (no confetti, no celebration styling)

**Given** the loser variant is rendered
**When** the card area renders
**Then** a segmented toggle is visible with two options: **Their card** (default) and **Your card**

**Given** the loser variant is rendered with **Their card** selected
**When** the card area renders
**Then** the winner's card is displayed with the winning line highlighted — the winner's card payload must be available on the client via the existing `round:win` broadcast (if it is not already sent, the server broadcast is extended to include `winnerCard: Tile[]`)

**Given** the loser variant is rendered with **Your card** selected
**When** the card area renders
**Then** the player's own card is displayed with their own marks, no winning-line highlight, and **any tile whose song played during the round but was not manually marked by the player is rendered in an "honest card" faded state** (visually distinct dimmed/greyed treatment — this is the "scold" cue for missed marks)

**Given** the loser variant is rendered
**When** the winning songs list renders
**Then** the 5 winning songs are displayed below the card area (same filter rule as the winner variant)

**— Start Next Round CTA (continuous-mode-aware) —**

**Given** the Game Over page mode is rendered **and** Continuous Mode is OFF
**When** the CTA area renders
**Then** *only the host* sees a "Start Next Round" CTA button; all other players (including the winner if they are not the host) see a neutral status line like "Waiting for the host to start the next round"

**Given** the Game Over page mode is rendered **and** Continuous Mode is ON
**When** the CTA area renders
**Then** *the host and the winner* both see a "Start Next Round" CTA button; all other players see the neutral waiting status line

**Given** the Game Over page mode is rendered, Continuous Mode is ON, and the host is also the winner (same human)
**When** the CTA area renders
**Then** a single "Start Next Round" CTA is shown (no duplicate — the two eligibility rules collapse to one button)

**Given** a player with a "Start Next Round" CTA taps it
**When** the request reaches the server
**Then** the server starts the next round using the same round config (genre/playlist, clip length, title reveal, Continuous Mode flag, Casual Mode permission, audio preset) and broadcasts `round:start` — identical semantics to today's host-initiated next-round flow

**— Reusable BingoCard variants —**

**Given** the `BingoCard` component is used in three contexts (active round, Game Over winner, Game Over loser "Their card" view, Game Over loser "Your card" view)
**When** the component renders in a Game Over context
**Then** it accepts a `mode` prop (or equivalent) controlling the visual treatment — a second card component is not introduced; the existing component is extended with variants

**— Mobile-first responsive —**

**Given** the Game Over page mode is viewed on a phone (primary target)
**When** the layout renders
**Then** all content (headline, card, toggle if loser, winning songs list, CTA) fits within a standard mobile viewport without horizontal scroll and without requiring the user to dismiss anything to see the card

**Given** the Game Over page mode is viewed on a small laptop display (secondary target — host device)
**When** the layout renders
**Then** the layout adapts responsively to the wider viewport but remains centered and does not assume a shared-screen / TV context

**— Out of scope (explicitly deferred) —**

- Countdown timer auto-advancing to the next round. *Deferred pending live-play feedback; may never ship.*
- "Songs that would have won it for you if you had 4-in-a-row" near-miss visualization. *Deferred — acknowledged by Philip as low-priority in the original request.*
- Big-screen / TV-shared host layout. *Out of scope indefinitely — host does not want their card visible on a shared display.*
- Non-winner keyboard/a11y handling of the Their/Your toggle beyond what the existing project-wide a11y baseline provides.

---

### Story 9-2: Live Round Settings & Pre-Round Simplification

As a host,
I want the pre-round overlay to be minimal (playlist + start) and the secondary round settings to be adjustable mid-round from the Host Controls panel with clear explanations,
So that starting a party is low-friction and I can course-correct without restarting a whole round.

**Acceptance Criteria:**

**— Pre-round overlay simplification —**

**Given** a host opens the Round Configuration overlay to start a round
**When** the overlay renders
**Then** only the playlist picker, a collapsed `<details>` titled "Advanced settings", and the Start Round button are visible by default (plus the host-name field on the first round of a session)

**Given** the host-name field is shown on the first round
**When** the input renders
**Then** its placeholder is **"Host"** (signaling the default value the server persists) and it has no info tooltip

**Given** the host expands the "Advanced settings" `<details>` block
**When** the block renders
**Then** the same four pill-group controls that exist today (Clip Duration, Title Reveal, Win Reaction, Casual Mode) render in the same visual style that the Host Controls live panel uses — shared component, identical styling

**Given** the host has previously run a session on this device
**When** the pre-round overlay mounts
**Then** the Advanced settings are seeded from `localStorage` (key `bb:host-prefs:v1`); missing or schema-mismatched data falls back to defaults `{ clipDuration: 30, titleRevealDelay: 10, audioPreset: 'minimal', allowCasualMode: false }`

**Given** a round starts successfully
**When** the start request returns 200
**Then** the current Advanced-settings values (plus `audioPreset` and `allowCasualMode`) are written to `localStorage` under `bb:host-prefs:v1` with `schemaVersion: 1`

**— Live in-round Round Settings panel —**

**Given** the host has opened the Host Controls overlay during an active round
**When** the overlay renders
**Then** a "Round Settings" section renders above the End Round / End Session actions, containing (in order): Clip Duration, Title Reveal, Win Reaction, Casual Mode, Autoplay Next Round — each with an info (ⓘ) icon and a segmented-pill or toggle control pre-populated with the current value

**Given** the host taps a different pill on any live setting row
**When** the request is in flight
**Then** the UI updates optimistically to the new value, fires `PATCH /api/rooms/:code/round-config` (or `POST /api/rooms/:code/continuous-mode` for Autoplay Next Round) with the minimal partial body

**Given** the PATCH returns 200
**When** the response is received
**Then** a "Saved — applies to next song" pill appears next to the row (or "Saved" for Casual Mode / Autoplay Next Round) for ~1.5s and then disappears; no always-on helper text is shown

**Given** the PATCH fails (network error or non-200)
**When** the response is received
**Then** the optimistic value reverts to the previous value, and a short "Couldn't save" error line appears next to the row for ~3s

**Given** the host makes rapid consecutive changes on the same row
**When** multiple requests are in flight
**Then** only the latest change's response is applied; responses for superseded clicks are ignored (via a per-row monotonic sequence counter)

**Given** the host changes Clip Duration, Title Reveal, or Win Reaction mid-round
**When** the PATCH reaches the server
**Then** the server mutates both `roomState.currentRound.config` AND `roomState.pendingRound`, broadcasts `round-config:changed` with the merged config, and the currently-playing clip is not truncated or recalculated — the new value applies on the next song draw

**Given** the host changes Casual Mode mid-round
**When** the PATCH reaches the server
**Then** `roomState.currentRound.config.allowCasualMode` is updated; players currently with Casual Mode toggled on are unaffected (their `playerCasualModes` entry does not change), but the new permission value gates future per-player toggle attempts

**Given** the host taps Autoplay Next Round in the live panel
**When** the toggle change fires
**Then** the existing `POST /api/rooms/:code/continuous-mode` endpoint is called (identical to the former Loop button wiring); on success, the `continuous-mode:changed` broadcast + countdown flow work exactly as they did before

**— Host Mini Player cleanup —**

**Given** the host is in an active round
**When** the Mini Player renders at the bottom of the screen
**Then** the standalone "Loop" button is **not** present (it has been removed); the Play/Pause, Next, countdown-text, and gear buttons are unchanged

**— Labels —**

**Given** any UI surface labels the `audioPreset` setting
**When** the label renders
**Then** it reads "Win Reaction" (replacing "Vibe"); the underlying data field name `audioPreset` and its values `'hype' | 'deadpan' | 'minimal'` are unchanged

**— Info tooltips —**

**Given** any live settings row renders
**When** the host hovers or taps its ⓘ icon
**Then** a small popover appears with the corresponding explanation copy; the popover dismisses on outside-tap, blur, `Escape`, or mouseleave (desktop)

**Given** the host-name input on the pre-round overlay renders
**When** the row is inspected
**Then** it has no ⓘ tooltip — the placeholder is self-explanatory

**— Server endpoint —**

**Given** a PATCH request to `/api/rooms/:code/round-config` arrives
**When** the handler runs
**Then** it validates each provided field against the same enums used by `POST /round` (clipDuration / titleRevealDelay / audioPreset / allowCasualMode), rejecting invalid values with 400; returns 409 if there is no active round; 503 if there is no live session; 404 / 403 / 401 on the standard access guards

**Given** a valid PATCH with a partial body arrives
**When** the handler mutates state
**Then** it updates both `roomState.currentRound.config` and `roomState.pendingRound`, broadcasts `{ type: 'round-config:changed', config: <merged> }`, and returns HTTP 200 with the merged config body

**— Out of scope —**

- Mid-clip recalculation of settings (all edits apply on the next song).
- Expanding `audioPreset` scope beyond the win overlay — a rename only.
- Persisting host prefs server-side (local device storage is enough for a friends-only app).
- Live-editing the playlist or the host name.

---

## Epic 10: Multi-Device Playback (Spotify Connect Picker)

*Bangerbingo hosts today are pinned to the Web Playback SDK — the host's browser IS the Spotify device that plays audio. On iOS Safari that stack is perpetually broken (autoplay blocks every track, backgrounding the tab kills playback, `activateElement` is flaky, volume API is non-functional, screen-lock drops audio). This epic reframes the host as a pure Spotify Connect remote: the server already sends `PUT /me/player/play?device_id=<x>` — `device_id` just stops being "the SDK device" and becomes "whichever Connect device the host picked". Unlocks iOS host support and doubles as a desktop feature for routing audio to speakers, Sonos, Echo, or a home hi-fi.*

**Design intent captured from 2026-04-19 research thread:**
- Manual toggle, available on all platforms — no UA sniffing. Desktop hosts benefit too (route to speakers), iOS users flip it once and persist the choice.
- The UX idiom matches Spotify's own "Connect to a device" chip so hosts already recognise the affordance.
- Existing server code ([src/server/rooms.ts:34-99](src/server/rooms.ts#L34-L99) `callSpotifyOnDevice`) is already device-agnostic; the only coupling to the SDK today is how `device_id` gets populated. Generalising the write endpoint completes the decoupling.
- Live mid-round swap uses `PUT /v1/me/player` (`transfer_playback`) — the same API the existing 404→reactivation fallback already uses, so no new failure-mode surface area.
- Host phones must have the Spotify iOS app installed, logged into the same Premium account, and "woken" at least once (tapped play in the native app so it appears in `/me/player/devices`). Onboarding copy handles this.
- Guest music playback is a **separate future thread** — intentionally not blocked on this epic.

---

### Story 10-1: Device List API & Live-Swap Endpoint

As a host,
I want the server to expose my available Spotify Connect devices and accept a chosen device id as the playback target (swapping audio mid-round when I change it),
So that the client UI can populate a device picker and the existing play/pause/next codepath keeps working unchanged regardless of which device is active.

**Acceptance Criteria:**

**— Device list endpoint —**

**Given** an authenticated host with a valid Spotify token
**When** the client sends `GET /api/rooms/:code/player/devices`
**Then** the server calls `GET /v1/me/player/devices` through `withFreshToken` (silent refresh if needed) and returns `{ devices: Array<{ id: string; name: string; type: string; is_active: boolean; is_restricted: boolean; volume_percent: number | null }> }` — exactly the subset of fields the client renders

**Given** the host's Spotify token has expired and cannot be refreshed
**When** `GET /api/rooms/:code/player/devices` runs
**Then** the existing `auth:degraded` path triggers (same handling as every other host-token endpoint) and the response is a non-200 that the client treats as "re-auth required" — no new error surface is added

**Given** `/me/player/devices` returns an empty device list (host has no active Spotify apps)
**When** the server forwards the response
**Then** the endpoint returns `{ devices: [] }` with HTTP 200 — the empty state is a valid response, not an error

**Given** a guest session (no host token) or an unauthenticated request
**When** the request is made
**Then** the endpoint returns the same 401/403 shape as other host-only endpoints — only the room host may list devices

**— Device-write endpoint (generalised) —**

**Given** the existing `POST /api/rooms/:code/sdk/device` endpoint accepts `{ device_id: string }` and stores it into `roomState.sdkDeviceId`
**When** this epic ships
**Then** a new endpoint `POST /api/rooms/:code/player/device` accepts the same payload (keeping the old `/sdk/device` path as a thin alias that forwards to the new handler, so the SDK `ready` callback on existing host pages keeps working during rollout)

**Given** the host posts a `device_id` that is not currently present in the room's last-known device list
**When** the handler processes the request
**Then** the id is still accepted and stored — the server does not gate on a freshness check (the id may be a perfectly valid Connect device that simply wasn't in the last GET) — Spotify's own 404 response on the subsequent play call is the authoritative check

**— Live mid-round swap —**

**Given** there is an active round and `roomState.currentRound.isPlaying === true`
**When** the host posts a new `device_id` different from the current `roomState.sdkDeviceId` / `playerDeviceId`
**Then** the server issues `PUT /v1/me/player` with `{ device_ids: [newId], play: true }` so audio seamlessly transfers with playback resumed; the new id is persisted to room state; the round's song index, timers, and player state are unaffected

**Given** there is no active round (lobby / between rounds)
**When** the host posts a new `device_id`
**Then** the server persists the id but does NOT call `transfer_playback` with `play: true` — storing the selection is enough; the next `POST /round` will use the new id when it fires its first `callSpotifyOnDevice`

**Given** the `transfer_playback` call returns 404 (device went dormant between list fetch and swap)
**When** the server handles the error
**Then** the existing `callSpotifyOnDevice` reactivation fallback logic applies — the handler returns a non-200 that the client surfaces, and the banner/picker flow (Story 10-3) re-fetches devices

**— No regression to existing play/pause/next codepaths —**

**Given** any play / pause / next / seek action during a round
**When** the server issues the Spotify API call
**Then** `callSpotifyOnDevice` is unchanged — it still reads whatever `device_id` is currently stored in room state, whether that id came from the SDK `ready` callback or from the user picker; the 404→`transfer_playback` reactivation path is unchanged

**— Out of scope —**

- Storing a history of recent devices or any analytics on device switches.
- Per-device volume control from the Bangerbingo server.
- Forcing a specific device name (Spotify exposes the Connect device name chosen by each client — we render it as-is).

---

### Story 10-2: Device Chip + Picker UI

As a host,
I want a compact device chip in my playback bar that opens a bottom-sheet list of my Spotify Connect devices (and surfaces in the same pre-round Advanced Settings row so I can pick before a round starts too),
So that I can route audio to my iPhone / Sonos / Echo / laptop browser and swap live without digging through Spotify's own app.

**Acceptance Criteria:**

**— DeviceChip in Host Mini Player —**

**Given** a host is on the game page (pre-round or active round)
**When** the Host Mini Player renders
**Then** a new `DeviceChip` component appears in the Mini Player row, showing the active device as `[icon name ▾]` (icon derived from Spotify device `type`: 📱 for Smartphone, 🔊 for Speaker, 💻 for Computer, else generic) — the chip is compact enough to sit alongside the existing Play/Pause, Next, countdown, and gear controls without pushing them off-screen on a 375px viewport

**Given** the chip shows the currently active device
**When** the host taps or clicks it
**Then** the `DevicePicker` bottom-sheet opens; on desktop (≥768px) it may render as a popover/menu anchored to the chip — either idiom is acceptable as long as the list, refresh, and empty-state are reachable

**Given** no device has been selected yet (fresh session, SDK still initialising)
**When** the chip renders
**Then** it shows a neutral "Pick a device ▾" label instead of a specific device name

**— DevicePicker bottom-sheet —**

**Given** the `DevicePicker` opens
**When** it mounts
**Then** it fires `GET /api/rooms/:code/player/devices` and renders a loading state until the response arrives; on success it lists every device with its icon, name, and a highlight/check on the currently selected id

**Given** the picker is open and the host taps a different device row
**When** the tap fires
**Then** the client optimistically updates the chip label to the new device, POSTs to `/api/rooms/:code/player/device` with the chosen `device_id`, and closes the sheet; on a non-200 response the chip reverts to the previous selection and a short "Couldn't switch device" inline error appears in the picker on next open

**Given** the picker is open
**When** the host taps a "Refresh" affordance (icon button in the sheet header)
**Then** the devices list is re-fetched and the rendered list updates; the currently selected id (if still present) remains highlighted, if absent the chip label falls back to "Pick a device ▾"

**Given** the server returns `{ devices: [] }`
**When** the picker renders
**Then** it shows an empty-state block with copy along the lines of "No Spotify devices available. Open your Spotify app and press play on any song, then Refresh." — the refresh button remains available

**Given** Spotify returns a device with `is_restricted: true`
**When** the picker renders that row
**Then** the row is visible but disabled (not tappable) with a subtle hint like "Restricted by Spotify" — tapping does nothing

**Given** the host is mid-round and swaps to a new device via the picker
**When** the server returns 200
**Then** audio transfers per Story 10-1; the UI shows a brief "Playing on {deviceName}" confirmation pill (same ~1.5s self-dismiss pattern as Story 9-2 "Saved — applies to next song") near the chip; round state is visually unaffected (card, song history, players list all unchanged)

**— AdvancedSettings row (reused in RoundConfigOverlay and HostControlsOverlay) —**

**Given** the host opens `AdvancedSettings` from `RoundConfigOverlay` (pre-round) or `HostControlsOverlay` (live, `mode="live"` per Epic 9 / Story 9-2)
**When** the component renders
**Then** a "Playback device" row appears alongside the existing `clipDuration` / `titleRevealDelay` / `audioPreset` / `allowCasualMode` rows, using the same segmented-pill / row styling as its neighbours; the row shows the active device name and an action to open the same `DevicePicker` sheet

**Given** the host changes device from the live `HostControlsOverlay` Advanced Settings row during an active round
**When** the change fires
**Then** the same POST + live-swap semantics apply as the Mini Player chip — no duplicate codepath, the picker is the only UI primitive

**— Accessibility / mobile —**

**Given** any DeviceChip / DevicePicker element is rendered
**When** it is interactive
**Then** its tap target meets the existing WCAG AA ≥44×44px baseline (UX-DR21); the sheet dismisses on outside-tap, backdrop-tap, and `Escape`; focus returns to the chip on dismiss

**— Out of scope —**

- Showing live volume indicators or scrubbing volume from the picker.
- Multi-select / "play on multiple devices" (not a Spotify Connect primitive anyway).
- A persistent device indicator anywhere other than the Mini Player chip and the Advanced Settings row.

---

### Story 10-3: SDK Default, Preference Persistence & Failure Path

As a host on any platform (desktop Chrome, desktop Firefox, or iOS Safari),
I want the app to default to the in-browser SDK device where it works, remember my last chosen device across reloads, and clearly route me to the device picker when the SDK fails to initialise,
So that desktop users keep the zero-configuration path they have today while iOS hosts (or anyone whose SDK breaks) get a coherent fallback instead of a dead-end error banner.

**Acceptance Criteria:**

**— SDK-first default on supported browsers —**

**Given** a host opens the game page on a browser where the Web Playback SDK initialises successfully
**When** the SDK `ready` callback fires with a `device_id`
**Then** the existing POST to `/api/rooms/:code/sdk/device` (now aliased to `/player/device` per Story 10-1) runs as today, and the `DeviceChip` shows "Bangerbingo (this browser)" as the active selection — no user action required to start a round

**Given** the SDK device is registered and no `preferredDeviceId` is persisted
**When** the chip and picker render
**Then** the SDK device is the active selection; the picker still lists every other Connect device the host owns so they can swap if they want to

**— Preference persistence via hostPrefs —**

**Given** `src/client/lib/hostPrefs.ts` manages host localStorage preferences (key `bb:host-prefs:v1`, Story 9-2)
**When** this epic ships
**Then** the schema adds `preferredDeviceId?: string`; missing / schema-mismatched values fall back to `undefined`

**Given** the host selects a device via the picker
**When** the POST to `/api/rooms/:code/player/device` returns 200
**Then** `preferredDeviceId` is written to `hostPrefs` with the chosen id; a subsequent reload of the host page reads it back and uses it as the initial active selection

**Given** the host page mounts with a persisted `preferredDeviceId`
**When** the initial devices fetch returns
**Then** if the persisted id is present in the device list, it is selected as active (overriding the SDK default); if it is absent, the selection falls back to the SDK device (if ready) or "Pick a device" (if not), and `preferredDeviceId` is NOT cleared — the next fetch may yet surface it

**— SDK failure path (iOS Safari primary case) —**

**Given** the SDK fires `initialization_error` or `authentication_error` (today's failure mode on iOS Safari)
**When** the host page detects the error
**Then** the chip renders "Pick a device ▾" instead of a specific device, and the `SdkFailureBanner` copy is reworked — it no longer says "Audio unavailable, use your Spotify app"; it reads along the lines of "Browser playback unavailable — pick a device to play on" with a primary action that opens the `DevicePicker`

**Given** the SDK failed but the host then picks an external device (iPhone, Sonos, etc.)
**When** the picker POST succeeds
**Then** the banner auto-dismisses (no need for a manual clear) — the room is in a valid playable state again; the chip reflects the chosen device

**Given** no devices are available after SDK failure (empty `/me/player/devices` response)
**When** the picker is opened from the banner
**Then** the existing empty-state copy from Story 10-2 appears ("Open your Spotify app and press play…") — the banner stays up until the user successfully picks a device

**Given** the SDK subsequently recovers on a different page load
**When** the SDK `ready` callback fires
**Then** the banner is not shown, and selection priority follows the Preference Persistence rule above (persisted `preferredDeviceId` wins; else SDK device)

**— No UA sniffing —**

**Given** the app must decide whether to render the banner / "Pick a device" default
**When** the decision runs
**Then** it is driven **only** by observed SDK events (`ready` / `initialization_error` / `authentication_error`) — not by user-agent string, not by `navigator.platform`, not by touch detection; iOS users who happen to have a working SDK path (unusual) are not treated differently from desktop

**— First-time iOS onboarding copy —**

**Given** a host lands on the game page on a mobile viewport AND the SDK has errored AND the devices list is empty
**When** the empty-state renders (either in the banner expansion or the picker)
**Then** the copy includes a first-time-friendly instruction block: "1. Open the Spotify app on your phone. 2. Press play on any song. 3. Come back here and tap Refresh." — no separate onboarding modal; the empty-state text is the onboarding

**— Persistence robustness —**

**Given** the stored `hostPrefs` JSON fails to parse (corruption) or is of a non-matching `schemaVersion`
**When** the host page mounts
**Then** `hostPrefs` resets to defaults (no `preferredDeviceId`) per the existing Story 9-2 fallback semantics — no separate handling for device preference alone

**— Out of scope —**

- Syncing `preferredDeviceId` across host devices / browsers (local device storage only — matches Story 9-2 scope).
- A "Forget this device" action in the picker (the host can just pick a different one).
- Auto-choosing a non-SDK device on startup based on history / heuristics (user always picks explicitly on first switch; we only persist what they picked).
