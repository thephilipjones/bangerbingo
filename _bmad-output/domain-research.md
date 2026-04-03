# Domain Intelligence Report: Bangerbingo — Spotify Music Bingo Party App

**Research Date:** 2026-04-03
**Depth:** deep
**Focus:** all
**Sources:** 3 parallel research agents, 76 combined tool uses, primary sources from Spotify developer blog, GitHub, TechCrunch, Jindo/Muzingo/Singo/Bingofy product analysis

---

## Executive Summary

Bangerbingo is a real-time Spotify-powered music bingo party game — host authenticates with Spotify Premium, guests join by URL and name (zero Spotify dependency). The OSS space is a graveyard: no project combines Spotify host-only auth, zero-friction guest join, and real-time WebSocket sync. Build from scratch. The Spotify API landscape has been materially restricted in three waves (Nov 2024, May 2025, Feb 2026), eliminating preview URLs, the recommendations endpoint, and tightening the dev mode user cap to 5 — none of which block bangerbingo's architecture, but all require intentional design responses. The recommended stack is Hono + native WebSockets + Svelte 5 + Railway/Hetzner, with the entire game server under ~200 lines. The biggest risk is not technical complexity — it's the Spotify API cliff-edge where any growth beyond ~5 Spotify-authed users hits a wall that's now structurally impossible for individuals to cross.

---

## OSS Landscape

### Verdict: Build Fresh

No existing project is worth forking. The auth model gap alone (host-only Spotify Premium, guests need nothing) disqualifies every candidate. The field is almost entirely weekend projects abandoned since 2021-2023.

### Projects Found

| Project | Stack | Stars | Last Active | Verdict |
|---------|-------|-------|-------------|---------|
| [ChaimTW/disco-byngo](https://github.com/ChaimTW/disco-byngo) | React + Node + Socket.IO + Spotify OAuth | 4 | ~2022-23 | **Learn from** — closest analogue; has mobile WS reconnect solution |
| [BahnMiFPS/tuneteasers](https://github.com/BahnMiFPS/tuneteasers) | React + Express + Socket.IO + Spotify | ~10 | 2023 | **Learn from** — room-create/join flow, real-time scoring patterns |
| [asrashley/music-bingo](https://github.com/asrashley/music-bingo) | Python + SQLite + REST API + JS | 3 | Oct 2024 | **Learn from (architecture)** — most complete multiplayer server; no Spotify |
| [spflueger/bingo](https://github.com/spflueger/bingo) | Python + React + WebSockets | unknown | unknown | **Learn from** — clean WS bingo skeleton |
| [switchtrue/spotify-music-bingo](https://github.com/switchtrue/spotify-music-bingo) | Python CLI + Spotipy | 3 | 2021 | Skip — CLI only |
| [murdahl/music-bingo](https://github.com/murdahl/music-bingo) | JavaScript | 1 | Nov 2025 | Check manually — most recently maintained |
| All card-gen scripts | Various | 0-2 | 2020-2023 | Skip — no real-time game loop |

### Top 3 Ideas to Steal from OSS

1. **Mobile WebSocket reconnect (disco-byngo):** Detect screen-unlock, close and reopen the socket, re-hydrate full room state from server. Design the room state machine to be fully re-hydratable from a single snapshot at any time.
2. **Room state as a serializable snapshot (asrashley):** Never assume clients stay connected. Any client must be able to reconstruct its full view from one server-side state fetch.
3. **Played-song log as the source of truth (bingosync pattern):** Maintain an ordered log of all songs played. Late joiners and reconnects fetch the log and pre-mark their cards. Simple array, no complex event sourcing.

---

## Spotify API: Current Constraints (2026)

### Three Waves of Restrictions

| Date | Changes |
|------|---------|
| **Nov 27, 2024** | `preview_url` → null for new apps; `/recommendations` gone; `/audio-features`; `/audio-analysis`; Featured Playlists; Category Playlists; Related Artists removed |
| **May 2025** | Extended quota now requires: legally registered business + 250K MAU. Individuals explicitly excluded. |
| **Feb 11, 2026** | Dev mode cap: **5 users** (from 25); dev must have Premium; 1 client ID per developer; Artist Top Tracks, Browse Categories, New Releases, popularity scores, album metadata fields removed |

### Web Playback SDK (the audio architecture)

- Plays **full tracks** in the host's browser — no 30s preview limitation
- Requires **Spotify Premium** — no exceptions, no Lite/Mini tiers
- **Desktop Chrome/Firefox = safe.** iOS Safari is **broken** — `activateElement()` doesn't reliably work; autoplay is blocked by Safari. Do not design the host experience for iOS Safari.
- Android browsers reportedly work but untested; desktop is the correct host target
- `player.connect()` can silently fail (returns `true` but `ready` never fires) — must add retry + timeout guard
- Token expiry (1hr) stalls playback mid-game — token refresh is **P0, not post-MVP**
- After SDK init, must explicitly call `/me/player` transfer to move playback to the browser device

### OAuth (PKCE, mandatory)

- Implicit Grant removed **Nov 27, 2025** — PKCE is the only remaining SPA flow
- `localhost` as redirect URI: removed Nov 2025. **`http://127.0.0.1` still works** for local dev
- Required scopes: `streaming`, `user-read-email`, `user-read-private` (minimum for SDK init)
- **Recommended pattern:** server-side PKCE callback (Hono handles `/callback`, stores token server-side) — cleaner than pure client-side and avoids HTTPS complexity

### Search (post-Feb 2026)

- `/v1/search` with `genre:` filter still works — but `limit` max is now **10** (was 50)
- `/recommendations` is **gone** for new apps — genre presets cannot use dynamic recommendations
- **Genre presets must be curated Spotify playlist IDs** — pre-select playlists per genre/era and pull tracks from them at game time
- Genres in Spotify are associated with **artists, not tracks** — `genre:` search is imprecise; playlist-based sourcing is more reliable

### Dev Mode User Cap: A Hard Ceiling

- 5 authorized Spotify users in dev mode (only applies to users who need Spotify OAuth — i.e., the host)
- For bangerbingo: **only the host authenticates**. Guests have zero Spotify dependency. The 5-user cap = 5 potential hosts, not 5 players. This is a non-issue for the MVP.
- Scaling beyond ~5 Spotify-authing users is structurally impossible for individuals. This is an intentional Spotify policy decision. Accepted constraint.

### Preview URLs: Confirmed Dead

`preview_url` returns `null` for new apps registered after Nov 27, 2024. There is a GitHub workaround (`rexdotsh/spotify-preview-url-workaround`) but it uses undocumented internal behavior and violates ToS. Do not design around it.

**The audio architecture is: Web Playback SDK on the host's desktop browser. Full stop.**

---

## PRD Corrections Required

The brainstorming doc contains assumptions that are now invalid:

| Brainstorming Assumption | Reality | Fix |
|--------------------------|---------|-----|
| "30s clip starting at ~1/3 into the track" via auto heuristic | `preview_url` is null; heuristic was implicitly about preview clips | Replace with: Web Playback SDK + `seek()` to chorus position (typically 30-60s into track) |
| Genre presets as a feature | `/recommendations` is gone | Implement as curated Spotify playlist IDs per genre/era bucket |
| Token refresh as implied background task | Token expiry after 1hr kills mid-game audio | Move to P0 infrastructure |
| Guests could optionally have Spotify accounts | Dev mode cap is 5 users total | Guests must never authenticate — lock this in architecturally |

---

## Music Bingo UX Patterns (from Jindo, Muzingo, Singo, Bingofy)

### Clip Length

| Length | Use |
|--------|-----|
| 15s | Expert/challenge mode; well-known songs; Jindo offers this as an option |
| **30s** | **Standard default across all platforms** |
| 45-60s | Older/obscure tracks; accessibility |

**Start position matters more than length.** A 15s chorus clip outperforms a 30s intro clip for recognition speed. Target the chorus/hook, not the track start.

### Card Generation

- 5x5 grid (24 songs + 1 free center space) is the standard
- **Random per player, not globally seeded** — uniqueness is the goal
- Pull from a pool of N > 24 songs; randomly sample without replacement per player
- Store card state server-side; win detection must be server-verified (never trust client)

### Win Detection

- Server maintains an ordered log of all played song IDs
- When player claims bingo, server cross-references their card against the played-song log
- Multiple patterns (rows, columns, diagonals, four-corners, blackout) are common
- Server-verified wins eliminate disputes — critical for a party game

### Real-Time Sync: Late Joiners & Reconnects

- Server maintains a played-songs array (ordered log)
- Late joiner: fetch full game state snapshot (card + played songs) → pre-mark applicable tiles
- Reconnect: re-fetch snapshot, resume listening to WS stream
- Cards should show previously-played songs in a visually distinct state (greyed out vs. actively marked)

### What Makes It Fun vs. Frustrating

**Fun:** Playlist matches crowd taste/era; clips start at chorus; brisk pacing (45-90s total per song including reaction time); automated win verification; host playing along

**Frustrating:** Wrong era/genre for the crowd; clips start at intro; long pauses between songs; disputed wins without auto-verification; unclear instructions for first-timers

**The rule:** The playlist is the game. Technical polish is secondary to song selection. Spotify playlist support is the right differentiator.

---

## Recommended Stack (All Agents Synthesized)

```
Server:    Hono on Node.js (or Bun)
WS:        Native ws — Map<roomId, Set<WebSocket>>, ~40 lines of room management
Auth:      Server-side PKCE callback (Hono /auth/callback) — host only
           Redirect URI: http://127.0.0.1 for local dev
Storage:   In-memory Map<roomId, GameState> + SQLite for cross-session dedup log only
Audio:     Web Playback SDK in host's desktop browser
           → seek() to ~30-60s (chorus) before playing
           → 30s clip default, 15s expert mode
Songs:     Curated playlist IDs per genre preset → pull tracks at game-start
           (NOT /recommendations — deprecated; NOT preview_url — null)
Frontend:  Svelte 5 — reactive bingo card tiles, derived win state, tiny runtime
Deploy:    Railway (zero config, git-push) or Hetzner VPS + Caddy + pm2 (~€4/mo)
```

### Architecture Sketch

```
[Hono server]
  ├── GET  /auth/login        → initiate PKCE flow (host only)
  ├── GET  /auth/callback     → exchange code, store token server-side
  ├── POST /api/game/create   → pick playlist, generate cards, return room URL
  ├── GET  /api/game/:roomId  → guest joins, receives their card + played-song log
  └── WS   /ws/:roomId        → SONG_START | TITLE_REVEAL | BINGO_CLAIM | BINGO_WIN | SYNC

[Svelte 5 frontend]
  ├── Host view:  Web Playback SDK player + start/advance controls + slide-up host panel
  └── Guest view: 5x5 bingo card (reactive tiles) + song history drawer
```

**Server is ~200 lines. No Redis. No Postgres. No Docker for local dev.**

---

## Risks & Unknowns

### Known Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Spotify API further restrictions | High — pattern of quarterly tightening | Architecture isolates Spotify to host-only; guests have zero dependency |
| iOS Safari SDK failure | Medium — host must use desktop Chrome/Firefox | Document this as a hard requirement; don't build workarounds |
| Token expiry mid-game | High if not addressed | Build refresh logic before any game testing |
| Song pool shrinkage (tracks removed from playlists) | Low-Medium | Snapshot playlist at game-start |
| `/search` limit=10 making card generation slow | Medium | Use playlist-pull (not search) for card generation; search is only for discovery |

### Data Gaps

- **Web Playback SDK on Android Chrome:** reported as working but limited real-world testing found. If guests want audio on their own device (not just card-marking), this would need testing.
- **Exact `seek()` behavior with SDK** after a `player.connect()` retry: not fully documented; needs empirical testing
- **Whether curated playlist IDs stay stable** over time (Spotify can deprecate playlists): worth monitoring

---

## Strategic Implications

- **Bangerbingo's architecture is correct for the API environment.** Host-only Spotify auth + guest URL-join is not just a UX preference — it's the only design that works within the 5-user dev mode cap.
- **Genre presets must be playlist-based, not recommendation-based.** Ship with 10-15 curated Spotify playlist IDs (80s hits, 90s hits, 2000s hits, pop bangers, hip-hop classics, etc.). This is also higher quality than algorithmic recommendations.
- **The OSS vacuum is an opportunity, not a warning sign.** No one has shipped this because Spotify's API restrictions make commercialization impossible for individuals. For personal use among friends, those restrictions don't apply. Bangerbingo can be exactly what no commercial product can be.
- **Ship the host-plays-too flow.** Every existing product (OSS and commercial) treats the host as a pure operator. This is the single most human differentiator.
- **The server is not the hard part.** 40 lines of room management, 200 lines total. The Spotify integration (SDK init, token refresh, seek to chorus, playlist pull) is where actual debugging time will go.
