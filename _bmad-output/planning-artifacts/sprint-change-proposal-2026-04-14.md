---
date: 2026-04-14
project: bangerbingo
change_type: new-epic-addition
scope: moderate
status: pending-approval
---

# Sprint Change Proposal — Relaxed Play (Epic 8)

## Section 1: Issue Summary

**Trigger:** Product design session (party mode) on 2026-04-14 produced a fully-specified new feature cluster: *Relaxed Play*, covering Continuous Mode, Win Moment enhancements, Casual Mode, and Session Statistics.

**Context:** This is purely additive — no existing behavior changes, no corrections. The design was confirmed by Philip through a multi-agent review session. All UX and interaction decisions were locked in during that session.

**Correction to spec:** Host skip *does* trigger Casual Mode auto-mark. Any `track_changed` event (natural or skip) triggers the sweep.

---

## Section 2: Impact Analysis

### Epic Impact

| Epic | Status | Impact |
|------|--------|--------|
| Epic 6: Deploy & Harden | in-progress (6-6 in review) | No impact |
| Epic 7: UX Flow Restructure | All stories done, retro done | Status should be corrected to `done` in sprint-status.yaml |
| **Epic 8: Relaxed Play** | **New — add as `backlog`** | 5 new stories |

### Dependency
Epic 8 → Epic 7 (Round Config Overlay from 7-3 is the UI insertion point for the Casual Mode toggle, but no modification of the 7-3 story is needed — Epic 8 adds a new story that extends that screen)

### Artifact Conflicts

**epics.md** — requires:
- New FRs appended to Requirements Inventory (FR-CM1 → FR-SS3)
- New UX-DRs appended (UX-DR25 → UX-DR33)
- New FR Coverage Map rows
- Epic 8 added to Epic List
- Full Epic 8 story detail appended at bottom

**sprint-status.yaml** — requires:
- `epic-7` status: `in-progress` → `done`
- Epic 8 block added with all stories as `backlog`

**Architecture impact (not a doc update, but implementation note):**
- `GameState` needs: `playlistCursor`, `continuousMode`, `audioPreset`, `sessionStats` (win counts + lastRoundWinner)
- Player state needs: `casualMode: boolean`
- New WS events: `round:countdown`, `round:autostart`, `square:auto-marked`, `stats:updated`

---

## Section 3: Recommended Approach

**Option 1 — Direct Adjustment** ✅

Add Epic 8 as a new backlog epic. No rollback, no MVP reduction. All 5 stories are cleanly additive, with clear dependencies on existing done stories.

**Effort:** Medium (5 stories, new server state, 2 new UI surfaces)
**Risk:** Low (no changes to shipped behavior, purely additive)
**Timeline impact:** Minimal — Epic 6 completion (6-6) is independent; Epic 8 enters queue after

---

## Section 4: Detailed Change Proposals

### 4A — New Functional Requirements (append to epics.md)

```
**Continuous Mode**
FR-CM1: Host can toggle Continuous Mode on/off at any time, positioned near playback controls with visible on/off indicator
FR-CM2: When Continuous Mode is on and a round ends, the next round starts automatically with the same configuration after a 10-second countdown
FR-CM3: Playlist cursor advances server-side across rounds within a session — no reshuffling, no song duplication
FR-CM4: Win screen holds until manually cleared; the 10-second countdown begins only after manual clear

**Win Moment & Audio Presets**
FR-WM1: Host selects an audio personality preset for the session: Hype, Deadpan, or Minimal
FR-WM2: The Bingo win screen holds until manually dismissed (no auto-dismiss timer)
FR-WM3: After win screen is manually cleared, a visible 10-second countdown fires before the next round begins (Continuous Mode only)

**Casual Mode**
FR-CSM1: Host can enable or disable Casual Mode permission per round via an on/off toggle in Round Config
FR-CSM2: When permitted, players see and can toggle their own Casual Mode on or off
FR-CSM3: Players with Casual Mode on have squares auto-marked on any track_changed event (natural or skip), sweeping played_history for all songs other than current_song
FR-CSM4: Any track change (natural progression or host skip) triggers the Casual Mode auto-mark sweep
FR-CSM5: Players joining mid-session with Casual Mode on receive a toast: "Caught up on X songs"
FR-CSM6: Players List shows a subtle ☕ indicator next to players who have Casual Mode enabled

**Session Statistics**
FR-SS1: System tracks win count per player for the current session (in-memory only; resets on session end)
FR-SS2: Players List surfaces each player's win count and a "Won last round" indicator
FR-SS3: Only wins are tracked — no loss counts
```

### 4B — New UX Design Requirements (append to epics.md)

```
UX-DR25: Continuous Mode — on/off toggle near host playback controls area; persistent visible indicator; accessible at all times during session
UX-DR26: Win screen modified — "Dismiss" replaces auto-dismiss timer; screen holds until host or winner taps Dismiss
UX-DR27: Post-dismiss countdown — 10-second timer displayed in song-info area with "Next game starts in..." label; visually prominent
UX-DR28: Audio preset selector — session-level setting (Hype / Deadpan / Minimal); default Hype; accessible in host session setup area
UX-DR29: Round Config form — Casual Mode on/off toggle, same visual style as other round config toggles; labeled "Allow Casual Mode"
UX-DR30: Player Casual Mode toggle — available in player's settings area when host permits; labeled "Casual Mode"
UX-DR31: Players List — ☕ icon next to player names who have Casual Mode on; subtle, non-judgmental; visible to all players
UX-DR32: Catch-up toast — brief non-blocking "Caught up on X songs" notification shown to player enabling Casual Mode mid-session or joining with it on
UX-DR33: Players List — win count badge and "Last round ✓" indicator per player; session-scoped only
```

### 4C — Epic List Addition (append to Epic List in epics.md)

```
### Epic 8: Relaxed Play
*Host can enable Continuous Mode for back-to-back games on the same playlist; players can opt into Casual Mode for automatic square marking; session win stats appear in the Players List.*
**FRs covered:** FR-CM1, FR-CM2, FR-CM3, FR-CM4, FR-WM1, FR-WM2, FR-WM3, FR-CSM1, FR-CSM2, FR-CSM3, FR-CSM4, FR-CSM5, FR-CSM6, FR-SS1, FR-SS2, FR-SS3
**UX-DRs:** UX-DR25, UX-DR26, UX-DR27, UX-DR28, UX-DR29, UX-DR30, UX-DR31, UX-DR32, UX-DR33
**Depends on:** Epic 5 (game loop, win overlay), Epic 7 (Round Config overlay, Players overlay, playback controls)
**Stories:** 8-1 Win Moment Hold & Audio Presets, 8-2 Session Statistics, 8-3 Continuous Mode, 8-4 Casual Mode Permission & Player Toggle, 8-5 Casual Mode Auto-Mark Engine
```

### 4D — sprint-status.yaml Updates

```yaml
# Change epic-7 status:
epic-7: done   # was: in-progress (all stories and retro are done)

# Add Epic 8 block:
  # Epic 8: Relaxed Play
  epic-8: backlog
  8-1-win-moment-hold-and-audio-presets: backlog
  8-2-session-statistics: backlog
  8-3-continuous-mode: backlog
  8-4-casual-mode-permission-and-player-toggle: backlog
  8-5-casual-mode-auto-mark-engine: backlog
  epic-8-retrospective: optional
```

---

## Section 5: Implementation Handoff

**Scope Classification:** Moderate — new epic with 5 stories; requires epics.md and sprint-status.yaml updates before dev picks up stories

**Handoff plan:**
1. SM (Bob) creates story files for Epic 8 stories when Epic 6 wraps up
2. Dev (Amelia/Barry) picks up 8-1 first — win moment hold is the foundation Continuous Mode depends on
3. Story sequence: 8-1 → 8-2 → 8-3 → 8-4 → 8-5

**Success criteria:**
- Host can toggle Continuous Mode and back-to-back games run without reshuffling
- Win screen holds; 10-second countdown fires cleanly
- Players opting into Casual Mode have squares auto-marked on every track change
- Players List shows ☕, win counts, and "Won last round" correctly
- No regressions in existing game loop, win detection, or Round Config

---

*Review complete proposal. Approve [yes] or revise [e]?*
