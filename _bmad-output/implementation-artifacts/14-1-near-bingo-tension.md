# Story 14-1: Near-Bingo Tension Broadcast

## Status: ready-for-dev

## Context

Win detection is binary today — one song someone's line is incomplete, next song they've won and the overlay slams down. There's no build-up, no "ooh, Marcus is one away" moment. Every commercial music-bingo product leans on this tension; we ship without it.

The data is already server-side: [rooms.ts:1100-1127](src/server/rooms.ts#L1100-L1127) computes `WIN_LINES` against each player's card on claim. We can compute "is anyone one tile away?" cheaply on every `song:start` / `song:reveal` / auto-mark cycle and broadcast a lightweight, once-per-player announcement when a player crosses into "close" state.

"Close" = has any `WIN_LINE` where 4 of 5 tiles are marked (or the 5th is FREE + 4 marked with a played song, etc.). Edge cases — multiple lines, multiple players, FREE tile — are all already handled by the existing win-check logic; we just stop one row short of declaring a winner.

**The announcement is transient and de-duplicated per player per round.** A player who becomes one-away gets a single quick callout; if they later acquire a second near-bingo line, nothing re-fires. Upper bound across a round = total player count.

The UX is a brief transient toast/banner in the game header, self-aware: `"You are one away!"` when the viewer is the subject, `"Marcus is one away!"` otherwise. No sound, short fade, no persistent chip.

## Story

As a **player during an active round**,
I want **a subtle signal when someone is one tile away from bingo**,
so that **the final stretch of the round has drama — I lean in, watch my own card more carefully, and the room gets loud**.

## Acceptance Criteria

**AC-1 — Server detects "first crossing" into near-bingo per player per round.**
After any event that could change a player's mark state (server auto-mark, manual mark received, `song:reveal`, casual-mode catch-up), server evaluates each player: does any `WIN_LINE` have exactly 4 of 5 effective IDs "present" (marked + on-card + either FREE or in `songHistory`)? If yes **and** the player is not in `round.announcedNearBingo: Set<playerId>`, add to that set and emit one announcement for that player. Players who have already been announced this round do not re-fire if they pick up additional near-bingo lines. Players whose current state satisfies a full line are winners, handled by existing claim path — they are not added to the near-bingo set.

**AC-2 — Server broadcasts `tension:announce` once per crossing.**
When a player crosses into near-bingo for the first time in the round, server broadcasts `{ type: 'tension:announce', playerId: string, playerName: string }` to all sockets in the room. No "exit" event, no delta updates, no periodic re-broadcast. Maximum broadcasts per round = number of players.

**AC-3 — Reconnect does not replay announcements.**
`tension:announce` is a transient signal — if you missed it, you missed it. The server's `round.announcedNearBingo` set ensures a reconnecting player who was already announced before disconnecting does not retrigger an announcement on reconnect. No reconnect replay payload field needed. On `round:start` / `round:end` / `round:win`, server resets `announcedNearBingo` to empty.

**AC-4 — Client renders a brief self-aware toast in the game header.**
On `tension:announce`, the client surfaces a transient line in the game-header status slot:
- When `playerId === gameState.selfId` → `"You are one away!"`
- Otherwise → `"{playerName} is one away!"`

Visible for ~2.5s with a 150ms opacity fade in/out, then removed. Subsequent announcements for other players during that window replace the current line (don't stack). No persistent chip when idle.

**AC-5 — No audio, no modal, no flash.**
The signal is ambient and quick. Opacity fade only. Win Overlay + win jingle remain the only "moment."

**AC-6 — No false positives from unmarked/masked tiles.**
A tile that's on a player's card but has never been played (not in `songHistory`, not FREE) does NOT count toward the 4-of-5. This mirrors the existing claim validation at [rooms.ts:1114](src/server/rooms.ts#L1114).

**AC-7 — Casual-mode players are eligible.**
Casual-mode auto-marks flow through the same state that win detection uses, so near-bingo "just works" for them. No special-case code.

**AC-8 — Win Overlay self-naming mirrors the same pattern.**
While in this story, update [WinOverlay.svelte](src/client/components/WinOverlay.svelte) so the winner-name line reads `"You win!"` when `winnerId === gameState.selfId`, otherwise `"{winnerName} wins!"` (or whatever the current copy template is). Pure display change, no message-shape change. Keeps self/other language consistent across tension + win.

## Implementation Sketch

**Server:**
- New helper in [rooms.ts](src/server/rooms.ts) near `WIN_LINES`: `isPlayerOneAway(player, round): boolean` — reuses the existing effective-marks logic, returns true if any line is 4-of-5.
- New field on `round`: `announcedNearBingo: Set<playerId>` (init empty; reset on `round:start` / `round:end` / `round:win`).
- After every mark-mutating event (auto-mark, `song:reveal`, manual mark), iterate players not already in `announcedNearBingo`; if `isPlayerOneAway` returns true, add to set and broadcast `tension:announce { playerId, playerName }`.

**Client:**
- [gameState.svelte.ts](src/client/lib/gameState.svelte.ts): new `$state<{ playerId: string; playerName: string; shownAt: number } | null>(null)` field `nearBingoToast`; reset on `round:start` / `round:end` / `round:win`; set on `tension:announce`; auto-clear via `setTimeout(..., 2500)`.
- [GameHeader.svelte](src/client/components/GameHeader.svelte): render a `<div class="tension-toast">` when the state is populated, with the self/other copy branch from AC-4.
- [WinOverlay.svelte](src/client/components/WinOverlay.svelte): update winner-name line to use `"You win!"` when `winnerId === selfId` (AC-8).

**Out of scope:**
- Per-pattern highlighting ("Marcus is one away on the diagonal")
- Who-could-win-on-the-next-song prediction
- Sound cue (explicitly rejected — AC-5)
- Persistent "who's currently close" status list — explicitly rejected in favor of transient announcements

## Risk Notes

- **Compute cost:** `players × lines × 5` per event, ~5 × 12 × 5 = 300 comparisons. Trivial.
- **Broadcast volume:** at most `N` broadcasts per round (N = player count). Order of magnitude less than per-event diff broadcasting.
- **Rapid-succession overwrites:** if two players cross into near-bingo within <2.5s of each other, the second announcement replaces the first visually — that's expected per AC-4. No queueing.
- **Reconnect:** a player who reconnects mid-round will not see any retroactive indicator of who's near bingo. This is by design (AC-3). Revisit only if playtest shows it matters.

## References

- [rooms.ts:1100-1127](src/server/rooms.ts#L1100-L1127) — existing win-detection logic (reuse shape)
- [rooms.ts:13](src/server/rooms.ts#L13) — `WIN_LINES` (reused)
- [gameState.svelte.ts:20](src/client/lib/gameState.svelte.ts#L20) — client-side `WIN_LINES` mirror
- [GameHeader.svelte](src/client/components/GameHeader.svelte) — status-line insertion point
