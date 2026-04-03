---
stepsCompleted: [1, 2, 3, 4]
session_topic: Music bingo party app powered by Spotify API for personal/friends use
session_goals: Competitive analysis of Jindo to identify MVP feature set
selected_approach: ai-recommended
techniques_used: [failure-analysis, scamper, constraint-mapping]
ideas_generated: 20
session_active: false
workflow_completed: true
context_file: ''
---

## Session Overview

**Topic:** Music bingo party app (bangerbingo) — Spotify-powered, personal use among friends
**Goals:** Competitive analysis of Jindo → identify MVP feature set and backlog
**Constraints:** Personal use (no commercial licensing), host must have Spotify Premium, friend group scale

### Session Setup

Approach: AI-Recommended — Failure Analysis → SCAMPER → Constraint Mapping
Reference app: Jindo (positive experience, solid baseline)

---

## Technique Execution

### Phase 1: Failure Analysis — Jindo Baseline

What Jindo does well (keep):
- Curated genre/theme presets (80s/90s/00s, artist themes)
- Configurable clip length
- Zero-friction guest join (URL + name)
- Auto-generated bingo card per player
- Song history list for missed songs
- Masked song title revealed after N seconds
- Full-screen win popup for all players
- Mini settings overlay for host and guest

What's missing from Jindo (opportunity):
- Spotify playlist/keyword search for custom sessions
- Host playing along with a card
- Cross-session song deduplication
- Session-level leaderboard and win streaks
- Room as a persistent primitive (multi-room support)

### Phase 2: SCAMPER

**S — Substitute**
- Replace fixed genre buckets with tiered source: presets → keyword search → playlist URL (bonus)

**C — Combine**
- Host-as-player: host gets a bingo card, host mode is a slide-up toggle during the game
- Song history as a slide-up drawer (separate from card, tap to reveal)

**A — Adapt**
- Near-bingo tension: broadcast "X and Y are 1 away" to all players
- Session streaks and leaderboard: track wins across multiple rounds in a night
- Cross-session dedup: avoid repeating songs across sessions on the same device/room

**M — Modify**
- Grid size adjustable (3x3 / 5x5) — post-MVP
- Host "reveal now" button to unmask title early — post-MVP

**P — Put to Other Uses**
- Multi-room architecture: room is the core primitive, multiple rooms can run independently

**E — Eliminate**
- No guest accounts — name only, ephemeral per session
- No chat/emoji reactions — post-MVP
- No custom card themes/skins — post-MVP

**R — Reverse**
- Consensus skip: majority of players tap skip to advance the song — post-MVP, not a priority
- Title-first reveal — rejected, kills the game mechanic

### Phase 3: Constraint Mapping

- **Spotify auth:** Host authenticates with Spotify Premium. Guests need nothing — all playback routes through host's session.
- **Clip selection:** Auto heuristic — 30s starting at ~1/3 into the track. No host preview, no manual adjustment for MVP. Iterate heuristic post-launch.
- **Real-time sync:** WebSocket room-based sync is highest priority infrastructure. All game events (song start, title reveal, win popup, skip votes) flow through it.
- **Multi-room:** Design room as core primitive from day one even if only one room is used initially.

---

## Idea Inventory

### Host Experience
| ID | Feature | MVP? |
|----|---------|------|
| Host #1 | Genre presets — 20-30 curated genre/theme buckets | Yes |
| Host #2 | Clip segment selection via auto heuristic (1/3 into track) | Yes |
| Host #3 | Tiered song source: presets → keyword search → playlist URL | Presets + search = MVP; URL = bonus |
| Host #4 | Host-as-player — bingo card + slide-up host mode toggle | Yes |
| Host #5 | Cross-session dedup — avoid replaying songs from prior sessions | Yes |
| Host #6 | Consensus skip — majority vote advances song | Post-MVP |
| Host #7 | Manual clip start point adjustment | Post-MVP |

### Guest Experience
| ID | Feature | MVP? |
|----|---------|------|
| Guest #1 | Zero-friction join — URL + name + optional room password | Yes |
| Guest #2 | Auto-generated bingo card, tap to mark | Yes |
| Guest #3 | Masked song title, revealed after N seconds | Yes |
| Guest #4 | Song history drawer — slide-up, tap to reveal | Yes |
| Guest #5 | Ephemeral identity — name only, reconnects by name if rejoining | Yes |
| Guest #6 | Shareable result card post-game | Post-MVP |

### Shared / Social
| ID | Feature | MVP? |
|----|---------|------|
| Shared #1 | Full-screen win popup for all players | Yes |
| Shared #2 | Settings overlay for host and guest | Yes |
| Social #1 | Near-bingo tension — "X and Y are 1 away" broadcast | Post-MVP |
| Social #2 | Session leaderboard + win streak across rounds in a night | Post-MVP |
| Social #3 | Emoji reactions | Post-MVP |

### Infrastructure
| ID | Feature | MVP? |
|----|---------|------|
| Infra #1 | Multi-room architecture — room as core primitive | Design now, multi-room later |
| Infra #2 | Host Spotify Premium auth — guests need no Spotify account | Yes |
| Infra #3 | WebSocket real-time sync — highest priority | Yes |

---

## MVP Feature List

**Core infrastructure:**
- WebSocket real-time room sync
- Room as core primitive (single room for MVP, architecture supports multi)
- Host Spotify Premium OAuth

**Host flow:**
- Create room → get shareable URL + optional password
- Pick genre/theme from presets OR keyword search
- Set clip length
- Start / advance game
- Host mode slide-up panel during game (host also has a bingo card)
- Cross-session dedup (songs already played flagged/excluded)

**Guest flow:**
- Join via URL + name (+ password if set)
- Receive auto-generated bingo card
- See masked song title → revealed after N seconds
- Tap tiles to mark
- Access song history via slide-up drawer
- Reconnect by name if phone dies

**Game mechanics:**
- Auto clip heuristic (30s at ~1/3 into track)
- Win detection → full-screen popup for all players
- Settings overlay for both host and guest

---

## Post-MVP Backlog

- Near-bingo tension broadcast ("X is 1 away")
- Session leaderboard + win streaks across rounds
- Consensus skip (majority vote)
- Playlist URL input
- Adjustable grid size (3x3 / 5x5)
- Host manual clip start point
- Shareable result card (Wordle-style)
- Emoji/reaction system
- Multiple simultaneous rooms
- Custom card themes/skins

---

## Session Summary

**Key decisions made:**
1. Personal use framing keeps Spotify auth simple — host Premium only, no guest accounts
2. Real-time WebSocket sync is the #1 infra priority
3. Clip selection is a heuristic problem — ship simple, iterate
4. Room primitive designed in from day one even if not exposed until later
5. Guest experience is ruthlessly simple — URL, name, play

**The differentiators vs. Jindo:**
- Spotify-native (playlist search, not just genre presets)
- Host plays too
- Cross-session dedup for regular game nights
- Foundation for social features (leaderboard, near-bingo) when ready
