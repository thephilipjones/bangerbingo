# Bangerbingo — Implementation Epics

**Status:** Planning
**Last updated:** 2026-04-03
**Spec ref:** `_bmad-output/ux-spec.md`, `_bmad-output/prd.md`

Epics are sequenced by dependency. Each epic's acceptance bar is the minimum needed to unblock the next.

---

## Epic 1: Spotify Auth & Token Management ✅ DONE

*Unblocks everything. Build this first, build it right.*

**Server:**
- PKCE OAuth flow — `/auth/login` redirect, `/auth/callback` handler
- Token storage (access + refresh) keyed to Spotify `user_id`
- Proactive refresh at T−5min via `setInterval`
- 3× retry with exponential backoff on refresh failure
- `auth:degraded` event emission to host WS on total failure
- httpOnly session cookie for host identity
- `http://127.0.0.1` redirect for local dev

**Frontend (Svelte 5):**
- `/login` screen — "Connect Spotify" button + iOS disclaimer (small, muted)
- Session detection on load (cookie present → skip to dashboard)
- Re-auth popup flow triggered by `auth:degraded`

**Acceptance bar:** Host can complete OAuth, receive a session cookie, make an authenticated Spotify API call, and have the token auto-refresh without intervention.

---

## Epic 2: Web Playback SDK Spike ✅ DONE

*De-risk the highest technical unknown before building game logic around it.*

> Spike this as a throwaway HTML file with a hardcoded token — no Svelte, no server required. Prove it works (or doesn't) before building 3 epics around it.

**Frontend:**
- SDK init with valid token from Epic 1
- `seek()` proof of concept — load a track, seek to position, play N seconds, pause
- Auto-advance timer: `setTimeout` → pause → signal ready for next song
- `sdkFailed` detection (error callback, iOS Safari path)
- SDK failure banner component with deep link (`spotify:track:ID`)

**Acceptance bar:** Host can load a track, play a 30s clip from an arbitrary position, auto-stop, and the fallback deep link opens Spotify correctly on iOS. Nothing else needs to work yet.

---

## Epic 3: Server Skeleton + Room Model ✅ DONE

*Depends on Epic 1 (host identity). Can develop alongside Epic 2.*

**Server (Hono + native WebSockets):**
- Room creation → room code generation (uppercase A–Z, excluding O and I, 4 chars)
- In-memory game state: room map `code → { host, guests, round, songs }`
- `session:connect` handshake — role-aware payload (host vs. guest)
- `player:joined` / `player:left` broadcast
- `host:disconnected` / `host:reconnected` — freeze/resume game state, broadcast to guests

**Frontend (Svelte 5):**
- `/room/:code` route skeleton — role-aware rendering on `session:connect`
- Guest join form (`/`) → WS handshake
- "Host disconnected — waiting for them to reconnect…" guest banner (non-negotiable, not an afterthought)

**Acceptance bar:** Host creates a room, guests join by code, player list updates in real time, host disconnect freezes state and guests see the banner, host reconnect resumes seamlessly.

---

## Epic 4: Bingo Card Generation

*Depends on Epics 1 + 3 (Spotify API access + room context).*

**Server:**
- Genre preset map: preset name → curated Spotify playlist ID
- Playlist search: `/search?type=playlist` → return playlist options to host
- Playlist track pull: fetch tracks from selected playlist, shuffle, pick 25
- Card assignment: generate unique card per guest on round start, store in room state
- SQLite dedup log: track IDs played this session → exclude from future rounds

**Frontend:**
- Round Config screen — genre preset cards + Search tab (playlist/artist search, not track search)
- Clip duration pill toggles + title reveal radio group
- "Start Round →" CTA → triggers server-side card generation + broadcasts cards to all clients

**Acceptance bar:** Host configures a round, selects a genre or playlist, starts the round, and each connected guest receives a unique 25-song bingo card.

---

## Epic 5: Game Loop

*Depends on Epics 2, 3, 4. This is where it all comes together.*

**Server:**
- `song:start` broadcast (with `trackId`, `clipDuration`, `titleRevealAt`, `songNumber`)
- `song:reveal` fired server-side at `titleRevealAt` (clients do not schedule locally)
- Auto-advance: clip-end timer → next `song:start` (clip mode); await host Next in full song mode
- Tile mark validation + win detection (bingo pattern check server-side)
- `round:win` broadcast with `winPattern` + `winningSongs` (5 songs)
- Tie-breaking: first server-received tap timestamp wins
- `round:end` broadcast

**Frontend:**
- Guest card view — tile tap → mark event → optimistic local state, server-authoritative win
- Host controls panel (mobile bottom sheet + desktop split view)
- Play/Pause/Next/Prev wired to Web Playback SDK
- Auto-advance in clip mode (passive host)
- Song History drawer (newest first, always accessible)
- Win Moment overlay — winner name + 5 winning songs, auto-dismisses after 5s
- Lobby / between-rounds waiting state (spinning vinyl + cycling trivia)
- End Round confirmation flow (dialog → 2s cancellable toast)

**Acceptance bar:** Full game loop works end-to-end — round starts, songs play and auto-advance, guests mark tiles, server detects bingo, winner overlay fires on all screens.

---

## Epic 6: Deploy & Harden

*Depends on Epic 5.*

**Sequencing note (2026-04-05):** Story 6-1 (local-dev/Tailscale testing) continues. Stories 6-2+ wait for Epic 7 (UX Flow Restructure) to ship, so production hardening targets the revised UX.

- Proxmox LXC + Docker setup (bangerbingo.net / pre.bangerbingo.net via Cloudflare Tunnel)
- Environment config (.env.prod / .env.staging — Spotify Client ID/secret, redirect URI, session secret, DATABASE_PATH)
- Make SQLite path env-configurable in src/server/db.ts (DATABASE_PATH var)
- SQLite Docker volume mount for persistence across deploys
- Token refresh failure end-to-end test (force expiry, verify retry + degraded mode + re-auth popup)
- Smoke test: host auth → create room → guest join → round → bingo → next round

**Acceptance bar:** A real game is playable by Philip + friends from their own devices over the internet.

---

## Epic 7: UX Flow Restructure

*Depends on Epics 1–5 (all shipped). Runs in parallel with Epic 6 where non-conflicting; Epic 6 stories 6-2+ should wait for Epic 7 to ship.*

**Scope:** Revise host/guest entry flows, repurpose Dashboard as Host Management, convert RoundConfig/Lobby to overlays + waiting room, rebuild host controls as minimal Mini-Player + Host Controls Overlay + status-indicator header, persist muted room code, make host a named player, add End Session dual-path.

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
