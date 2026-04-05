---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish, step-12-complete]
inputDocuments:
  - _bmad-output/brainstorming/brainstorming-session-2026-04-02-1500.md
  - _bmad-output/domain-research.md
workflowType: 'prd'
briefCount: 0
researchCount: 1
brainstormingCount: 1
projectDocsCount: 0
classification:
  projectType: web_app
  domain: general
  complexity: medium
  projectContext: greenfield
---

# Product Requirements Document — Bangerbingo

**Author:** Philip
**Date:** 2026-04-02

---

## Terminology

- **Session** — the whole evening of continuous play; one room, one group, multiple rounds
- **Round** — a single bingo instance within a session; one song pool, one set of cards, one winner
- **Room** — the persistent space identified by a code and URL; hosts sessions and maintains dedup history across sessions
- **Player** — anyone with a bingo card (host or guest)
- **Host** — the player who also controls playback and manages rounds
- **Guest** — a player with no account; ephemeral identity within a session

---

## Executive Summary

Bangerbingo is a self-hosted, Spotify-powered music bingo platform for personal use among friends and family. Hosts register an account, authenticate with Spotify Premium, and run game sessions via a shareable room URL and short room code. Guests join with no account and no Spotify dependency — name only. The platform runs indefinitely without subscription cost beyond hosting; any host who discovers it can run independent sessions.

Guest join supports two flows: direct link (shareable URL → enter name) and Jackbox-style join (root URL → enter name + room code → redirect to session). The code flow handles the "someone shouts the code across the room" party scenario.

### What Makes This Special

Commercial music bingo products (Jindo, Muzingo, Singo) charge recurring subscriptions for a solved problem. Bangerbingo removes that tax as self-owned infrastructure. The critical architectural decision: only the host authenticates with Spotify. Guests need nothing — no account, no app, no Premium. This is both a UX choice and a structural requirement: it's the only model compatible with Spotify's dev-mode 5-user cap (which applies to Spotify-authing users only, not players).

The host-as-player feature — host gets a bingo card and manages the game via a responsive control panel — is the single clearest differentiator versus every existing product, commercial or OSS. Every competitor treats the host as a pure operator.

Bangerbingo bets on Spotify playlist quality over algorithmic selection: genre presets are curated Spotify playlist IDs (the `/recommendations` endpoint is deprecated for new apps), and hosts can search by keyword. The playlist is the game.

---

## Project Classification

- **Type:** Web application — Svelte 5 SPA, Hono backend, native WebSockets
- **Domain:** Consumer entertainment / social gaming
- **Complexity:** Medium — business logic is simple; complexity concentrates in Spotify SDK lifecycle (PKCE auth, Web Playback SDK init, token refresh, seek-to-chorus) and WebSocket room state
- **Context:** Greenfield
- **Auth model:** Host accounts (Spotify PKCE OAuth, server-side session); guests are ephemeral (name only)

---

## User Journeys

### Journey 1: Host — First Game Night (Happy Path)

*Sarah discovers Bangerbingo via GitHub, deploys via Docker Compose, creates an account, and connects Spotify Premium.*

Game night: she opens the app on her MacBook, logs in, creates a room. She picks "90s Pop Hits" from the genre presets, sets clip length to 30s, and gets a shareable link and 5-character room code. She texts the link and shouts the code. Six guests join in under two minutes — she sees them appear in the lobby. She starts the first round. Audio routes through her MacBook to the Bluetooth speaker. She has her own card and is playing too. Three songs in, someone shouts "BINGO!" — the app verifies server-side and a full-screen popup fires on every device. She starts round two without leaving the app. Zero frustrated guests, zero disputed wins.

*Requires: host registration + Spotify OAuth, room creation, genre preset selection, guest lobby, host-as-player card, BT/AirPlay playback routing, server-verified win detection, multi-round session flow.*

### Journey 2: Guest — Late Arrival and Reconnect (Edge Case)

*Marcus arrives 20 minutes late, game is three songs in.*

He goes to the root URL, enters his name and the room code he was texted, and lands on a blank bingo card. He opens the song history drawer, sees the three played songs, and self-marks the ones on his card at his own pace. Halfway through his phone locks — on unlock the WebSocket reconnects silently, card state intact.

*Requires: Jackbox-style join, blank card on join, song history drawer (always accessible), silent WS reconnect with card state preserved.*

### Journey 3: Host — Running from iPhone (Aspirational)

*Philip is at a family dinner without his laptop.*

He opens Bangerbingo in iOS Safari, logs in, creates a room. The Spotify Web Playback SDK attempts to initialise — the known risk point. If it works, audio routes to AirPlay and he controls the game from his phone. If SDK init fails, he receives a clear error with actionable fallback guidance (open Spotify natively, transfer playback); the game itself — cards, sync, win detection — continues normally.

*Requires: iOS Safari host support (aspirational), graceful SDK failure with clear fallback, game state independent of SDK init status.*

### Journey 4: Self-Hoster — Own Instance

*Jamie finds the GitHub repo and wants to run Bangerbingo for their pub quiz group.*

They clone the repo, copy `.env.example` to `.env`, add their own Spotify app credentials, run `docker compose up`. The app is live. They create an account, connect Spotify, run their first session. No shared infrastructure, no shared API keys. Their Spotify app is their own ceiling.

*Requires: Docker Compose config, env-based credential injection, first-run host registration flow, self-hosting documentation.*

---

## Domain-Specific Requirements

### Music Provider Constraints

- **Platform risk:** Spotify has restricted its API three times in 18 months (Nov 2024, May 2025, Feb 2026). Further restrictions are plausible.
- **MusicProvider abstraction (architectural requirement):** All playback, search, and track-fetching logic is encapsulated behind a `MusicProvider` interface (`play()`, `pause()`, `seek()`, `search()`, `getPlaylistTracks()`, `refreshToken()`). Spotify is the sole MVP implementation. Apple Music (MusicKit JS) slots in post-MVP without refactoring.
- **Apple Music as post-MVP target:** MusicKit JS supports iOS Safari playback — directly resolving the host-on-iPhone constraint. Requires Apple Developer Program ($99/yr) and host Apple Music subscription.
- **Spotify MVP constraints:** PKCE only (Implicit Grant removed Nov 2025); Web Playback SDK reliable on desktop Chrome/Firefox only; `preview_url` null for new apps — full-track SDK playback only; genre presets must be curated playlist IDs; token expires 1hr (refresh is P0); dev mode cap is 5 Spotify-authing users (hosts only — non-issue for personal use).

### Privacy & Data Handling

- Store minimum: host account (Spotify user ID, display name, email), room metadata, cross-session song dedup log
- No guest PII stored — ephemeral name in memory only for session duration
- No analytics, telemetry, or third-party tracking in default config
- GDPR compliance is the operator's responsibility; project ships clean defaults

### Risk Register

| Risk | Mitigation |
|---|---|
| Spotify API further restrictions | `MusicProvider` abstraction isolates blast radius; Apple Music ready to activate |
| iOS Safari Web Playback SDK failure | Graceful fallback UX; game state independent of SDK; Apple Music resolves post-MVP |
| Token expiry mid-round | Token refresh is P0, not post-MVP |
| Spotify dev mode cap | Host-only auth; cap is per Spotify app (self-hosters bring their own) |

---

## Success Criteria

### User Success

- Guests join within 30 seconds of receiving a link or room code — no account, no friction
- Bingo cards stay in sync throughout the session; no guest needs to refresh
- Reconnecting guests resume with card state intact
- Host runs a full game night — multiple rounds, song changes, win detection — from phone or laptop without leaving the app
- Pacing feels right for the crowd: clip length is configurable (20–60 seconds default range, plus a "full song" mode); host controls make advancing feel instant

### Business Success

- Zero subscription cost beyond hosting; self-hosting on a personal server is first-class
- Distributed as open source (MIT) — clone, add Spotify credentials, `docker compose up`
- Any family member or friend can host independently without developer involvement
- Codebase remains maintainable solo — no sprawl

### Technical Success

- Host playback controls respond within 500ms
- WebSocket stays connected for a 2-hour session; reconnect is automatic and transparent
- Token refresh completes silently before expiry — no mid-round audio stall
- Audio routes correctly to Bluetooth/AirPlay via Web Playback SDK
- iOS Safari host experience is a stated goal; if Spotify SDK proves unsolvable on iOS, Apple Music MusicKit JS is the resolution path
- Win detection is server-verified; no disputed outcomes
- `docker compose up` brings up the full stack

### Measurable Outcomes

- Full round (10–20 songs, 2–8 players) completes without any player needing to manually intervene
- Host setup time (login → round configured → first song playing) under 3 minutes
- Room code 4–6 characters, memorable enough to shout across a room
- Docker cold start under 30 seconds on a modest VPS

---

## Product Scope

### MVP (Phase 1)

- Host registration + Spotify PKCE OAuth + server-side session
- Room creation → shareable URL + 4–6 char room code
- Guest join via direct link OR Jackbox-style (root URL + name + code)
- Genre presets (curated Spotify playlist IDs) + keyword search; song source selected fresh each round
- Web Playback SDK + `seek()` to chorus for clip mode; configurable clip length (20–60s) or full song mode
- Host playback controls: play, pause, advance — routable to Bluetooth/AirPlay
- Host-as-player: bingo card + responsive control panel (slide-up on mobile, inline on desktop)
- Auto-generated 5×5 bingo card per player, random per player, server-stored
- Configurable song title reveal: immediately / after N seconds (5, 10, 15) / never
- Song history drawer (accessible at any time during a round)
- Server-verified win detection → full-screen win popup for all players
- Down-ranking of previously played songs (within session and across sessions per room)
- Ephemeral guest identity + reconnect by name
- Guest and host settings overlay (clip length, title reveal config)
- Silent token refresh (P0)
- `MusicProvider` abstraction (Spotify implementation only for MVP)
- Open source repo + Docker Compose deployment

### Growth Features (Phase 2)

- Apple Music (MusicKit JS) provider — resolves iOS Safari host playback definitively
- Near-bingo tension broadcast ("X and Y are 1 away")
- Session leaderboard + win streaks across rounds
- Playlist URL input (paste any Spotify playlist)
- Adjustable grid size (3×3 / 5×5)
- Shareable result card (Wordle-style)
- Multiple simultaneous rooms

### Vision (Phase 3)

- Custom card themes/skins
- Emoji/reaction system
- Social features (invite management, recurring game night groups)
- Host manual clip start point adjustment

---

## Web Application Requirements

### Architecture Overview

Single-page application. Two view contexts: **guest view** (mobile-first, bingo card interaction) and **host view** (fully responsive — phone-first, adapts to desktop). Real-time WebSocket sync is foundational; no page navigations during active gameplay.

**Stack:**
- Svelte 5 frontend — reactive bingo card tiles, derived win state
- Hono backend — WebSocket room management, Spotify PKCE callback, host session storage
- Native WebSockets — `Map<roomId, Set<WebSocket>>`, ~40 lines of room management
- SQLite — host accounts, cross-session dedup log; in-memory `Map<roomId, GameState>` for active rooms
- `MusicProvider` interface isolates all Spotify SDK calls

### Browser Matrix

| User | Target | Notes |
|---|---|---|
| Host | iOS Safari (primary mobile) | Aspirational for Spotify SDK; graceful fallback required |
| Host | Chrome/Firefox desktop | Reliable Spotify Web Playback SDK |
| Guest | Any modern mobile browser | No Spotify dependency; standard WebSocket sufficient |
| Guest | Desktop browsers | Supported |

### Responsive Design

- **Guest view:** Mobile-first. 5×5 card legible and tappable at 375px viewport (iPhone SE baseline). Touch targets ≥ 44×44px.
- **Host view:** Responsive. Mobile: slide-up panel overlay for controls. Desktop: controls inline. Same codebase, adaptive layout.
- **Join / root URL:** Responsive — phone and desktop both primary.

### Performance Targets

- WebSocket event broadcast (song start → all clients): < 200ms on typical home network
- Host playback control response: < 500ms
- Guest card load on join (including WS handshake): < 2s
- Docker cold start: < 30s

### Accessibility

WCAG AA contrast ratios on card tiles; touch targets ≥ 44×44px; clear visual distinction between unmarked / marked / win states. No formal audit for MVP.

### SEO

Not a content product. Basic root URL meta description for discoverability. No SSR required.

---

## Project Scoping & Risk

### MVP Philosophy

Experience MVP — the product must be fun and frictionless from day one. First users are a known friend/family group. Success is a game night that runs without hiccups.

Solo developer. Architecture is deliberately minimal: ~200 lines of server core, no Redis, no Postgres, no Docker required for local dev. Complexity is isolated to Spotify integration and WebSocket room state.

### Risk Mitigation

| Risk | Mitigation |
|---|---|
| iOS Safari Spotify SDK | `MusicProvider` abstraction; Apple Music activation without rewrite; graceful fallback keeps game functional |
| Spotify API restrictions | All Spotify code behind `MusicProvider`; Apple Music is contingency |
| Scope creep | Post-MVP backlog is the first cut; none of it blocks a functional MVP |

---

## Functional Requirements

### Host Account & Authentication

- FR1: A host can register and sign in via Spotify OAuth (PKCE); display name and email are sourced from the Spotify profile. There is no separate username/password credential.
- FR2: A host's Spotify Premium account is connected as part of the OAuth flow in FR1
- FR3: A host can log in and access their room history
- FR4: A host's Spotify access token refreshes silently before expiry without interrupting an active round
- FR5: A host can disconnect and reconnect their Spotify account from account settings

### Room Management

- FR6: A host can create a new room, generating a persistent room code and shareable URL
- FR7: A host can start a new round, selecting song source (genre preset or keyword search) fresh per round
- FR8: A host can configure clip length per round: short clip (20–60 seconds, starting at chorus position) or full song mode
- FR9: The system generates a short, memorable room code (4–6 characters) per room
- FR10: A host can end the current round and return to the lobby to configure the next
- FR11: A host can close a room session entirely

### Guest Join & Identity

- FR12: A guest can join a session by entering their name at a direct room URL
- FR13: A guest can join from the root URL by entering their name and room code
- FR14: A guest is identified by name only — no account or registration required
- FR15: A guest who loses connection can rejoin by name and resume with card state intact
- FR16: A guest can join or leave at any point — before, during, or between rounds — without disrupting the session
- FR17: The host can see a live list of present players at any time

### Music Playback

- FR18: The host can browse and select from curated genre/era playlist presets per round
- FR19: The host can search for a playlist or artist by keyword per round
- FR20: The system plays a song clip starting at the chorus position through the host's browser
- FR21: The host can play, pause, and advance to the next song during a round
- FR22: Audio playback routes through the host's browser to connected Bluetooth or AirPlay speakers
- FR23: If music provider SDK initialisation fails, the host receives a clear error with actionable fallback guidance
- FR24: The music playback layer is implemented behind a provider interface supporting future alternative providers

### Bingo Card & Round Mechanics

- FR25: Each player receives a uniquely generated 5×5 bingo card at the start of each round
- FR26: Cards are generated from a pool of more than 24 songs, randomly sampled without replacement per player
- FR27: A player can tap a tile to mark it
- FR28: Song titles are masked when a song begins; host configures reveal behaviour per room: show immediately, show after a set delay (5s / 10s / 15s), or never reveal
- FR29: Win detection is performed server-side when a player claims bingo
- FR30: All players see a full-screen win notification when a valid bingo is verified
- FR31: Songs played in earlier rounds of the same session are down-ranked when generating the pool for subsequent rounds
- FR32: Songs played in previous sessions in the same room are down-ranked when generating pools for future sessions

### Song History & Late Join

- FR33: A player can open a song history drawer at any time during a round showing all songs played so far
- FR34: A player who joins mid-round receives a blank card and can consult the history drawer to self-mark songs they recognise
- FR35: The song history drawer displays sufficient song information for a player to identify a tile on their card

### Host-as-Player

- FR36: The host receives a bingo card and participates as a player in each round
- FR37: The host can access playback controls and round management without leaving their bingo card view
- FR38: On mobile, host controls are accessible via a slide-up panel overlay; on larger screens controls surface inline

### Settings

- FR39: The host can configure room settings (clip length, title reveal behaviour) before and between rounds
- FR40: Guests can access a settings overlay for personal preferences during a session

### Deployment & Operations

- FR41: The application deploys via Docker Compose with a single command
- FR42: Spotify app credentials and other secrets are supplied via environment variables
- FR43: Host accounts authenticate with their own Spotify Premium via OAuth; Spotify app credentials are shared across the deployment, configured by the operator at deploy time
- FR44: The application supports a first-run host registration flow for new deployments

---

## Non-Functional Requirements

### Performance

- NFR1: Host playback control actions (play, pause, advance) respond within 500ms
- NFR2: WebSocket game events (song start, title reveal, win notification) broadcast to all clients within 200ms on a typical home network
- NFR3: Guest bingo card loads within 2 seconds of joining, including WebSocket handshake
- NFR4: Spotify token refresh completes in the background with no perceptible interruption to playback or game state
- NFR5: The application remains responsive during a 2-hour session with up to 10 concurrent players

### Security

- NFR6: All client–server communication uses HTTPS/WSS in production
- NFR7: Spotify OAuth tokens are stored server-side only — never exposed to the client
- NFR8: No host passwords are stored (Spotify OAuth is the sole credential); session cookies are HMAC-signed with a server-side secret
- NFR9: Spotify app credentials are never embedded in client-side code or committed to the repository
- NFR10: Guest names are held in memory only for session duration — not persisted

### Reliability

- NFR11: WebSocket connections automatically reconnect after a client drop; reconnect completes within 5 seconds on a typical mobile network
- NFR12: A reconnecting guest resumes with card state identical to how they left
- NFR13: A single server restart must not cause permanent loss of active game state; in-progress round state is recoverable
- NFR14: Token refresh failure is surfaced to the host with a clear recovery action before playback is interrupted

### Maintainability

- NFR15: Server core logic fits within ~200 lines, excluding configuration and type definitions
- NFR16: All Spotify-specific code is isolated behind the `MusicProvider` interface — no Spotify SDK calls outside the provider implementation
- NFR17: The project runs locally without Docker via a single setup command
