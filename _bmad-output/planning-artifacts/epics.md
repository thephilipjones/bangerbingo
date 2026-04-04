---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories-in-progress]
inputDocuments:
  - _bmad-output/prd.md
  - _bmad-output/ux-spec.md
  - _bmad-output/epics.md
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

