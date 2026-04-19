---
title: 'Host Casual Mode toggle + trim per-song status line'
type: 'feature'
created: '2026-04-19'
status: 'done'
context: []
baseline_commit: '9dc232e2abd33c5a63ed760d363f648955f06b48'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The host plays along with their own bingo card but has no personal Casual Mode toggle — only guests get the in-game Off/On toggle (RoomPage), so the host can't auto-mark when "Allow Casual Mode" is on. Separately, the small "Song N of this round" status line under the board is noise during play.

**Approach:** Extend the existing Casual Mode plumbing so the host is a first-class Casual Mode player: add the same per-player toggle on HostRoomPage, accept `player:casual-mode-changed` on the host WS path keyed by `room.host_name`, and teach `runCasualModeSweep` to resolve the host's socket + card via `roomState.host` / `roomState.hostUserId`. In RoomPage, drop only the `song:start` branch that sets the status line (keep waiting + countdown messages).

## Boundaries & Constraints

**Always:**
- The host's casual-mode entry in `playerCasualModes` is keyed by `room.host_name` so the existing PlayerList ☕ indicator (already wired via `hostName`) lights up with no client changes.
- Sweep, broadcast, and catch-up semantics must behave identically to guests — including catch-up sweep on enable and clearing `autoMarkedTileIndices` on disable.
- The Casual Mode toggle on HostRoomPage renders only when `game.allowCasualMode === true` (same gate as the guest toggle) and only while tiles are visible (mid-round).
- `playerCasualModes` remains non-persisted — host must re-toggle after a server restart, same as guests.

**Ask First:**
- Any change that would make the host's Casual Mode default to ON automatically (e.g. host-implicit casual). Default must stay OFF.

**Never:**
- Do not change the RoundConfigOverlay "Allow Casual Mode" setting, its default, or persistence.
- Do not remove the `<p class="status-line">` element — only the `song:start` case that writes "Song N of this round". Keep "Waiting for next song…", "Waiting for the host…", and the continuous-mode countdown line.
- Do not add a casual toggle for the host when `room.host_name` is null (host hasn't set a display name) — auto-mark has no player key to use.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Host enables Casual Mode mid-round | Host clicks toggle, `allowCasualMode=true`, round active | WS emits `player:casual-mode-changed {enabled:true}`; server sets `playerCasualModes[host_name]=true`, runs catch-up sweep against host card, broadcasts change; PlayerList shows ☕ on host row | Toggle stays Off if `host_name` is null (toggle not rendered) |
| Host disables Casual Mode | Toggle currently On | Server sets map to `false`, broadcasts, clears `round.autoMarkedTileIndices[host_name]` | — |
| Host reconnects with casual on | `playerCasualModes[host_name]=true`, active round | Host receives `round:start` then a catch-up `square:auto-marked` event for newly-eligible tiles | Silent no-op if round not active |
| Song starts (any client) | `song:start` WS message | No status-line text is written on this event (line is untouched by `song:start`) | — |
| Between-song state | `song:pause` / `songs:exhausted` | Status line still shows "Waiting for next song…" | — |
| Host toggles with `allowCasualMode=false` | Round disallows casual | Toggle is not rendered; no WS message sent | — |

</frozen-after-approval>

## Code Map

- `src/server/ws.ts` -- host WS path currently has no message handler; add one for `player:casual-mode-changed` that keys on `room.host_name` (from `getRoomByCode(code).host_name`). Reject when `host_name` is null.
- `src/server/rooms.ts` -- `runCasualModeSweep` currently looks up `roomState.guests.get(name)` and `round.cards.get(name)`. Branch on `name === <host_name>` → use `roomState.host` as the socket and `roomState.hostUserId` as the card key.
- `src/client/pages/HostRoomPage.svelte` -- add `casualModeOn` state, `handleCasualToggle` (mirror RoomPage L51–57), render the `.casual-toggle-row` under the BingoCard when `game.allowCasualMode` is true. Seed from `session:connect` `casualModeNames` including host name.
- `src/client/pages/RoomPage.svelte` -- remove the `else if (data.type === 'song:start')` branch that writes "Song N of this round" to `statusLine` ([L141–142](src/client/pages/RoomPage.svelte#L141-L142)). Adjust the preceding `else if` so the chain still parses.
- `src/client/lib/gameState.svelte.ts` -- already seeds `casualModePlayers` from `initialCasualModeNames`; verify host-name presence flows through unchanged (no edits expected).
- `src/server/__tests__/ws.test.ts` -- existing casual-mode WS coverage is guest-only; add host-path coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/rooms.ts` -- in `runCasualModeSweep`, resolve `(ws, cardKey)` per target name: host's name → `roomState.host` + `roomState.hostUserId`; else guest path. Use the room's `host_name` from `getRoomByCode` (import if needed) or accept it as already available via room lookup inside the function.
- [x] `src/server/ws.ts` -- in the host path, attach `ws.on('message')` that handles `player:casual-mode-changed`: require boolean `enabled`, require `room.host_name !== null`, set `roomState.playerCasualModes.set(room.host_name, enabled)`, broadcast `{type:'player:casual-mode-changed', name: room.host_name, enabled}`, and on enable call `runCasualModeSweep(code, roomState, { playerName: room.host_name, isCatchUp: true })`; on disable call `roomState.currentRound?.autoMarkedTileIndices.delete(room.host_name)`.
- [x] `src/client/pages/HostRoomPage.svelte` -- add Casual Mode toggle identical in markup/styling to RoomPage's `.casual-toggle-row`, gated by `game.allowCasualMode`, rendered under `<BingoCard>` inside the `{:else if game.tiles.length > 0}` branch. Seed `casualModeOn` from `session:connect.casualModeNames.includes(hostName)` after hostName is known.
- [x] `src/client/pages/RoomPage.svelte` -- delete the `else if (data.type === 'song:start') { statusLine = … }` branch so `song:start` no longer mutates the status line. Leave the element and other states in place.
- [x] `src/server/__tests__/ws.test.ts` -- add a test: host with non-null `host_name` sends `player:casual-mode-changed {enabled:true}`, server broadcasts `{name: host_name, enabled:true}` to guests, catch-up sweep fires, and `playerCasualModes` reflects the change. Add a second test: with `host_name === null`, the same message is ignored (no broadcast, no state change).

**Acceptance Criteria:**
- Given `allowCasualMode=true` and a named host, when the host clicks the on-card Casual Mode toggle, then their row in the Players overlay shows ☕ on every client and any previously-played tile on the host card auto-marks via `square:auto-marked`.
- Given the host has Casual Mode on, when the server advances to a new song, then the host's matching tile (if any) auto-marks with the same sweep used for guests.
- Given `room.host_name` is null, when the host attempts to toggle Casual Mode, then the toggle is not rendered and no `player:casual-mode-changed` message is sent.
- Given a round is mid-flight, when any `song:start` event arrives on a guest's RoomPage, then the `<p class="status-line">` text does not change to "Song N of this round"; other status messages (waiting, countdown) still render as before.

## Verification

**Commands:**
- `bun run typecheck` -- expected: no TS errors.
- `bun test src/server/__tests__/ws.test.ts` -- expected: new host casual-mode tests pass; existing guest tests still pass.
- `bun test` -- expected: full suite green.

**Manual checks:**
- Start a round with "Allow Casual Mode"; confirm host sees the toggle under the board, toggling it broadcasts the ☕ indicator on both host and guest clients, and auto-marks an already-played tile on the host card.
- Verify no "Song N of this round" text appears below the guest board when a new song starts; waiting/countdown messages still appear.

## Suggested Review Order

**Server — casual-mode sweep generalized to the host**

- Fork sweep targets so host uses `roomState.host` + `hostUserId` card; guests unchanged.
  [`rooms.ts:134`](../../src/server/rooms.ts#L134)

**Server — host WS accepts the toggle**

- New host-path message handler mirrors the guest handler; rejects when `host_name` is null.
  [`ws.ts:341`](../../src/server/ws.ts#L341)

**Client — host toggle UI**

- Local `casualModeOn` + toggle handler, mirrors RoomPage's pattern exactly.
  [`HostRoomPage.svelte:52`](../../src/client/pages/HostRoomPage.svelte#L52)

- Seed `casualModeOn` from `session:connect.casualModeNames`; skip the first `round:start` so reconnects don't clobber state.
  [`HostRoomPage.svelte:233`](../../src/client/pages/HostRoomPage.svelte#L233)

- Render toggle under `<BingoCard>` gated by `allowCasualMode && hostName !== null`.
  [`HostRoomPage.svelte:388`](../../src/client/pages/HostRoomPage.svelte#L388)

**Client — status line trim**

- Drop only the `song:start` branch; other waiting/countdown messages intact.
  [`RoomPage.svelte:140`](../../src/client/pages/RoomPage.svelte#L140)

**Tests**

- Host toggle broadcasts with `name = host_name`; null-host path is dropped.
  [`ws.test.ts:989`](../../src/server/__tests__/ws.test.ts#L989)
