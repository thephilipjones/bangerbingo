---
title: 'Self-rename in the Players list'
type: 'feature'
created: '2026-04-20'
status: 'ready-for-dev'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Players cannot change the name they picked on join — typos, rude auto-fills, or wanting to match a nickname mid-session are stuck. The viewer's own row is also buried in the list, making self-identification slow.

**Approach:** In both the guest waiting room and the in-game PlayersOverlay, always render the **viewer's own row at the top**, visually marked as editable (hover affordance → click-to-edit → blur/Enter commits). Rename sends a WS `player:rename` to the server, which atomically migrates every name-keyed data structure (guests map, cards, stats, casual-mode, etc.) and broadcasts `player:renamed {oldName, newName}` to all clients. Applies to **host and guests** alike; stats and casual-mode state **carry over** under the new name.

## Boundaries & Constraints

**Always:**
- Viewer's own row renders first in `PlayerList` when `selfName` matches a row (for guests, self row comes before host row; host-viewer keeps existing host-first ordering).
- Editable affordance is visible **only on the viewer's own row**. Others' rows are unchanged.
- Server rename is atomic: all name-keyed structures migrate in a single synchronous block (no `await` between map writes) or none do.
- Validation reuses existing rules: `trim()` + non-empty + `≤ 30 chars` (matches the cap at `rooms.ts:516` for initial host_name) + not equal to any currently-connected guest name + not equal to current `host_name` (host rename: skip the self-collision check).
- Collision / empty / unchanged / over-cap: **silent revert** (input closes, no toast).
- **localStorage persistence order on self-rename:** on the renamer's client, `setStoredGuestName(newName)` is called **before** any in-memory state update — so if the WS drops between commit and in-memory update, reconnect uses the new name.
- Host rename updates `rooms.host_name` in SQLite via existing `setHostName()`.
- Stats carry over: `winsByName`, `lastRoundWinner`, `playerCasualModes`, `priorCasualModes` (Set), `autoMarkedTileIndices`, and guest `cards` all migrate `oldName → newName`. Host `cards` key (`hostUserId`) is stable — do **not** migrate.
- **Claim-race guard (architect fix):** maintain `pendingClaims: Set<string>` in `RoomState`; `/round/claim` adds on entry, removes on response; `player:rename` server-side rejects if `pendingClaims.has(oldName)`.
- `marksKey` in localStorage is card-fingerprint-keyed (not name-keyed), so it survives rename unchanged — no migration needed.

**Ask First:**
- If during implementation a name-keyed structure is discovered that this spec didn't list, HALT and confirm whether it should migrate or not.

**Never:**
- Do not add a rename button/menu. The row itself is the click target.
- Do not add per-rename validation error UI. Silent revert only.
- Do not broadcast intermediate keystrokes — only the committed new name.
- Do not allow editing while a round is mid-claim (`isClaiming === true`) — avoids identity changing during bingo-claim RPC. Revert silently if triggered.
- Do not edit the Lobby's `PlayerList` usage (`LobbyPage`) — lobby shows no self, not in scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy rename (guest) | Guest "Bob" clicks own row, types "Bobby", blurs | Server migrates all name-keyed maps; `player:renamed {old:"Bob", new:"Bobby"}` broadcast; all clients update `players`, `winsByName`, `casualModeNames`, `lastRoundWinner` (if match), self `name` prop (on renamer); localStorage updated | N/A |
| Happy rename (host) | Host "Alice" edits in their PlayersOverlay, commits "Ali" | `rooms.host_name` updated in DB; all clients update `hostName` prop + stats keys | N/A |
| Empty / whitespace submit | Input = "   " on blur | No WS sent; input closes; row reverts to old name | Silent revert |
| No change | Input unchanged on blur | No WS sent; input closes | N/A |
| Collision with another connected guest | Guest "Bob" tries "Carol" while "Carol" is connected | Server responds `player:rename-rejected {reason:"taken"}`; client reverts row; logs to console | Silent revert (no toast) |
| Collision with host_name | Guest tries host's name | Server rejects; client reverts | Silent revert |
| Escape key pressed | User presses Esc while editing | Input closes, old name restored, no WS sent | N/A |
| Enter key pressed | User presses Enter while editing | Same as blur — commit attempt | N/A |
| Rename during mid-claim | `isClaiming === true` when user tries to open edit | Edit does not open (row stays read-only) | Silent block |
| Server atomic failure | Server sees migration would create inconsistent state | Server rejects, does not mutate any map, emits `player:rename-rejected` | Silent revert |

</frozen-after-approval>

## Code Map

- `src/server/ws.ts` — add `player:rename` message handler on both host and guest branches; migrate all name-keyed structures; broadcast `player:renamed` or `player:rename-rejected`. For guests, replace `const name` closure with a mutable ref so `close`/`leave`/`casual-mode` handlers use the current name.
- `src/server/db.ts` — reuse existing `setHostName(code, hostName)` (line 117–119) for host rename; no new function needed.
- `src/client/components/PlayerList.svelte` — reorder rows so self is first when `selfName !== null`; add editable mode for self row (hover pencil → click → `<input>` autofocus → blur/Enter commit, Esc cancel); emit `onRename(newName)` callback.
- `src/client/components/PlayersOverlay.svelte` — accept `onRename` + `isClaiming` props, forward to `PlayerList`.
- `src/client/components/GuestWaitingRoom.svelte` — same forward.
- `src/client/pages/RoomPage.svelte` — wire `onRename` → WS send; handle `player:renamed` to update `name` prop-equivalent state, update localStorage; block if `game.isClaiming`.
- `src/client/pages/HostRoomPage.svelte` — wire `onRename` → WS send; handle `player:renamed` to update local `hostName`.
- `src/client/lib/gameState.svelte.ts` — handle `player:renamed` in `processWsMessage`: migrate `players` array, `winsByName` key, `lastRoundWinner`, `casualModePlayers`.
- `src/client/App.svelte` — on renamer-side `player:renamed`, update `guestName` and localStorage (via existing `setStoredGuestName`).

## Tasks & Acceptance

**Execution:**
- [ ] `src/server/ws.ts` -- Add `pendingClaims: Set<string>` to `RoomState`; add `player:rename` handler on guest branch: validate trim/non-empty/≤30/collision against `host_name` and connected guests; reject if `pendingClaims.has(oldName)`; atomically migrate `guests`, `cards`, `autoMarkedTileIndices`, `playerCasualModes`, `priorCasualModes`, `winsByName`, `lastRoundWinner`; update closure's current-name ref; broadcast `player:renamed {oldName, newName}`; emit `player:rename-rejected {reason}` to sender on failure. Call `persistRoomState(code)` after.
- [ ] `src/server/ws.ts` -- Add `player:rename` handler on host branch: validate trim/non-empty/≤30; update `rooms.host_name` via `setHostName`; migrate `playerCasualModes`, `priorCasualModes`, `winsByName`, `lastRoundWinner` keys; broadcast `player:renamed {oldName, newName, isHost:true}`. Reject if `pendingClaims.has(oldName)`.
- [ ] `src/server/rooms.ts` -- In `/round/claim` route (~line 685): `pendingClaims.add(playerName)` on entry; `pendingClaims.delete(playerName)` in `finally`.
- [ ] `src/server/__tests__/ws.test.ts` -- Unit tests covering all I/O matrix scenarios (happy guest, happy host, collision with host, collision with guest, empty, unchanged-no-op, concurrent rename, atomic failure).
- [ ] `src/client/components/PlayerList.svelte` -- Reorder: self row first when `selfName` equals a row; implement editable-self-row with hover affordance, click-to-edit input, blur/Enter/Esc handling; emit `onRename(newName)`; respect `disabled={isClaiming}` to block edit.
- [ ] `src/client/components/PlayersOverlay.svelte` -- Accept and forward `onRename`, `isClaiming` props.
- [ ] `src/client/components/GuestWaitingRoom.svelte` -- Accept and forward `onRename`, `isClaiming` props.
- [ ] `src/client/pages/RoomPage.svelte` -- Pass `onRename={(n) => ws.send(...)}` and `isClaiming={game.isClaiming}`; handle `player:renamed` update of local `name` when `oldName === name`; on self-rename persist via `setStoredGuestName`.
- [ ] `src/client/pages/HostRoomPage.svelte` -- Same wiring for host.
- [ ] `src/client/lib/gameState.svelte.ts` -- In `processWsMessage`, handle `player:renamed`: rewrite `players` array, `winsByName` key, `lastRoundWinner` if match, `casualModePlayers` Set member.
- [ ] `src/client/App.svelte` -- On guest renamer's `player:renamed`, update `guestName` state + call `setStoredGuestName`.
- [ ] `src/client/__tests__/*` -- PlayerList test: self-at-top ordering; editable enters/commits/cancels/validates.

**Acceptance Criteria:**
- Given a guest viewing the PlayersOverlay mid-game, when they click their own row and type a new name and blur, then the server migrates all maps atomically and every client (including their own) sees the new name in `players`, `winsByName`, and any other stats keyed by it.
- Given a host viewing PlayersOverlay, when they rename themselves, then `rooms.host_name` is updated, the hostName prop updates across all clients, and host casual-mode/stats entries migrate keys.
- Given any viewer with `selfName !== null`, when `PlayerList` renders, then their own row is the first visible row.
- Given the viewer is mid-claim (`isClaiming === true`), when they click their row, then the input does not open.
- Given an empty-after-trim, unchanged, or colliding submission, when the input blurs, then no WS message is sent (or the server rejects) and the row silently reverts.

## Design Notes

**Host identity gotcha:** host `cards` key is `hostUserId` (stable) — do **not** migrate on host rename. But host `playerCasualModes` / `winsByName` keys **are** `host_name` — they **must** migrate.

**Guest WS handler closure:** `handleConnection` binds `const name` at connect time; `close`/`leave`/`casual-mode` handlers reference it. Replace with a `{ current: string }` ref updated on successful rename so subsequent handler events key off the new name.

**Atomic migration order:** validate first (trim, non-empty, collision against connected guests + host_name), then migrate all keys under one synchronous function — no `await` between map writes.

## Verification

**Commands:**
- `npm run test -- src/server/__tests__/ws.test.ts` — expected: all new rename tests pass
- `npm run test` — expected: full suite green
- `npm run typecheck` — expected: no errors

**Manual checks:**
- Two browsers joined as "Bob" and "Carol". Bob renames to "Bobby"; Carol's PlayersOverlay updates within ~100ms.
- Win a round as "Bob", rename to "Bobby", verify "Last round ✓" pill stays on the renamed row; `×1` win count survives.
- Host renames mid-round; guests see updated host row; casual-mode ☕ indicator (if on) stays lit.
- Mid-claim guard: click bingo → before response lands, try rename → input doesn't open.
