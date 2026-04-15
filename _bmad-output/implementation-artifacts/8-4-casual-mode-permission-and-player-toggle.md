# Story 8.4: Casual Mode — Host Permission & Player Toggle

Status: done

## Story

As a host,
I want to control whether players can use Casual Mode per round,
so that I can tune engagement expectations for the group.

As a player,
I want to opt into Casual Mode,
so that I can enjoy the game socially without staring at my phone.

## Background

**What Casual Mode is:** Auto-mark squares on track changes (that's Story 8-5). This story is solely the *permission gate and toggle plumbing* — adding `allowCasualMode` to round config, exposing a toggle to players, tracking per-player opt-in state, and surfacing the ☕ indicator in the Players List.

**What this story is NOT:** No auto-marking logic lives here. Story 8-5 reads the `casualMode` player flags set up in this story to do the actual sweeping.

**Current guest WS message handling:** Guests can only send `guest:leave`. This story adds a second incoming guest message type: `player:casual-mode-changed`.

**RoundConfig is in ws.ts:** `RoundConfig` is defined in [src/server/ws.ts:16-22](src/server/ws.ts#L16-L22) and imported everywhere. Adding `allowCasualMode` here flows to `pendingRound`, `startRound` helper (Story 8-3 refactor), and continuous mode auto-start automatically.

**Players Map:** `roomSockets.guests` is `Map<string, WebSocket>` — name → socket only. Per-player casual mode state must go in a parallel `Map<string, boolean>` on `RoomState`, not on the websocket.

**"Settings area" for guests:** There is no existing guest settings panel. Add a minimal Casual Mode toggle row directly in the game page — below the status line when a round is active, and in `GuestWaitingRoom` when waiting. No new overlay needed.

**Continuous Mode carry-through (Story 8-3):** `startContinuousRound` copies all fields from `roomState.pendingRound`. Since `allowCasualMode` will be part of `RoundConfig`, it automatically carries through — no extra work needed.

## Acceptance Criteria

1. **`RoundConfig` carries `allowCasualMode`.** In [src/server/ws.ts](src/server/ws.ts):
   - Add `allowCasualMode: boolean` to `RoundConfig` interface (after `audioPreset`).
   - Existing consumers: `startRound` helper (rooms.ts), `rehydrateRooms`, `pendingRound` — all use spread/Object.assign, so the new field flows through automatically as long as the POST handler sets it (AC #3).

2. **Per-player casual mode map on `RoomState`.** In [src/server/ws.ts](src/server/ws.ts):
   - Add `playerCasualModes: Map<string, boolean>` to `RoomState` interface.
   - Initialize as `new Map()` at every `roomSockets.set(code, { ... })` call site (host WS connect ~[ws.ts:288](src/server/ws.ts#L288), guest WS connect ~[ws.ts:349](src/server/ws.ts#L349), and `rehydrateRooms` ~[ws.ts:130-154](src/server/ws.ts#L130-L154)).
   - `persistRoomState` does NOT persist this — casual mode resets between sessions. Add a one-line comment near the field explaining this.

3. **`POST /api/rooms/:code/round` accepts and stores `allowCasualMode`.** In [src/server/rooms.ts](src/server/rooms.ts):
   - The POST handler (which calls the `startRound` helper from Story 8-3) parses `allowCasualMode` from request body. Default to `false` if absent/non-boolean (boolean coercion: `typeof body.allowCasualMode === 'boolean' ? body.allowCasualMode : false`).
   - Pass it as part of `RoundConfig` into `startRound`.
   - `startRound` includes `allowCasualMode` in `roundStartPayload` broadcast (same field name, so all clients receive it).
   - **Reset `playerCasualModes`** to `new Map()` at the start of `startRound` (new round = everyone's casual mode opt-in resets). Do this before the `round:start` broadcast.

4. **Guest WS handler for `player:casual-mode-changed`.** In [src/server/ws.ts](src/server/ws.ts), in the guest `ws.on('message', ...)` handler (~[ws.ts:393-404](src/server/ws.ts#L393-L404)):
   - Add a second branch for `msg.type === 'player:casual-mode-changed'`:
     - Validate `typeof msg.enabled === 'boolean'`; silently ignore if not.
     - Set `roomState.playerCasualModes.set(name, msg.enabled)`.
     - Broadcast `{ type: 'player:casual-mode-changed', name, enabled: msg.enabled }` to ALL clients (host + all guests) so everyone's Players List updates.

5. **`session:connect` seeds casual mode state for late joiners.** In [src/server/ws.ts](src/server/ws.ts), in both the host session:connect payload (~[ws.ts:303-314](src/server/ws.ts#L303-L314)) and guest session:connect payload (~[ws.ts:363-374](src/server/ws.ts#L363-L374)):
   - Add `casualModeNames: Array.from(roomState.playerCasualModes.entries()).filter(([,v]) => v).map(([k]) => k)` to both payloads.
   - This gives late joiners the current set of players who have Casual Mode on.

6. **`StartRoundPayload` and `buildStartRoundPayload` accept `allowCasualMode`.** In [src/client/lib/api.ts](src/client/lib/api.ts):
   - Add `allowCasualMode?: boolean` to `StartRoundPayload` (optional, host may not set it).
   - In [src/client/lib/roundConfig.ts](src/client/lib/roundConfig.ts), update `buildStartRoundPayload` signature to accept `allowCasualMode: boolean` and include it in the returned payload.
   - `StartRoundResponse` does NOT need updating — response is minimal.

7. **`RoundConfigOverlay` — "Allow Casual Mode" on/off toggle.** In [src/client/components/RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte):
   - Add `let allowCasualMode = $state(false)` state variable.
   - Add a new `<section class="option-section">` after the Title Reveal section and before the Host Name section:
     ```html
     <section class="option-section">
       <h2 class="option-label">Casual Mode</h2>
       <div class="toggle-row">
         <button
           class="pill"
           class:selected={!allowCasualMode}
           onclick={() => allowCasualMode = false}
           aria-pressed={!allowCasualMode}
         >Off</button>
         <button
           class="pill"
           class:selected={allowCasualMode}
           onclick={() => allowCasualMode = true}
           aria-pressed={allowCasualMode}
         >Allow</button>
       </div>
     </section>
     ```
   - **Style:** Reuse `.pill` and `.pill.selected` (already defined in the component's `<style>`). Wrap the two buttons in a `<div class="pill-group">` (same as other option rows — no new CSS needed).
   - Pass `allowCasualMode` into `buildStartRoundPayload(selectedSource, clipDuration, titleRevealDelay, nameResult.trimmed, audioPreset, allowCasualMode)`.

8. **`gameState.svelte.ts` — Casual Mode state.** In [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts):
   - Add `let allowCasualMode = $state(false)` — sourced from `round:start` payload.
   - Add `let casualModePlayers = $state<Set<string>>(new Set())` — tracks names of players with Casual Mode on.
   - In `processWsMessage`:
     - `round:start` branch: set `allowCasualMode = (data.allowCasualMode as boolean | undefined) ?? false`; set `casualModePlayers = new Set()` (reset on new round, matches server AC #3).
     - New branch: `player:casual-mode-changed` → if `data.enabled` update `casualModePlayers = new Set([...casualModePlayers])` then `data.enabled ? casualModePlayers.add(data.name as string) : casualModePlayers.delete(data.name as string)`. (Svelte 5 reactivity: reassign to trigger update.)
   - Add `createGameState` param: `initialCasualModeNames?: string[]` (default `[]`). Initialize: `casualModePlayers = new Set(initialCasualModeNames)`.
   - Expose getters/setters:
     - `get allowCasualMode() { return allowCasualMode }`
     - `get casualModePlayers() { return casualModePlayers }`

9. **`PlayerList.svelte` — ☕ indicator.** In [src/client/components/PlayerList.svelte](src/client/components/PlayerList.svelte):
   - Add optional prop `casualModeNames?: Set<string>` (default `new Set()`).
   - In the `{#each players as playerName}` loop and the host row, render `{#if casualModeNames?.has(playerName)} <span class="casual-icon" aria-label="Casual Mode on">☕</span>{/if}` after `{playerName}` and before any pill badges.
   - For the host row, show `{#if casualModeNames?.has(hostName ?? '')} <span class="casual-icon" aria-label="Casual Mode on">☕</span>{/if}`.
   - CSS: `.casual-icon { font-size: 0.85rem; }` — no special layout needed, it sits inline in the flex row.

10. **`PlayersOverlay.svelte` — thread `casualModeNames` through.** In [src/client/components/PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte):
    - Add optional prop `casualModeNames?: Set<string>`.
    - Pass it to `<PlayerList ... {casualModeNames} />`.

11. **`RoomPage.svelte` (guest) — Casual Mode toggle + seeding.** In [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte):
    - Add `initialCasualModeNames?: string[] = []` to props.
    - Pass `initialCasualModeNames: untrack(() => initialCasualModeNames)` into `createGameState`.
    - **Casual Mode toggle placement:**
      - When game is active (tiles shown): render below the status line:
        ```html
        {#if game.allowCasualMode}
          <div class="casual-toggle-row">
            <span class="casual-label">Casual Mode</span>
            <button
              class="casual-btn"
              class:active={casualModeOn}
              onclick={handleCasualToggle}
              aria-pressed={casualModeOn}
            >{casualModeOn ? 'On' : 'Off'}</button>
          </div>
        {/if}
        ```
      - When waiting room shown: pass `allowCasualMode={game.allowCasualMode}` and `casualModeOn` + `onCasualToggle` to `<GuestWaitingRoom>`.
    - `let casualModeOn = $state(false)` — reset to false on round:start (handled by processWsMessage resetting `casualModePlayers`; but we also need to reset local `casualModeOn`). Add `round:start` branch in `handleWsData` to reset `casualModeOn = false`.
    - `function handleCasualToggle()`:
      ```ts
      function handleCasualToggle() {
        const next = !casualModeOn
        casualModeOn = next  // optimistic
        ws.send(JSON.stringify({ type: 'player:casual-mode-changed', enabled: next }))
      }
      ```
    - Pass `casualModeNames={game.casualModePlayers}` to `<PlayersOverlay>`.
    - CSS for toggle row:
      ```css
      .casual-toggle-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 12px;
      }
      .casual-label {
        font-size: 14px;
        color: #aaa;
      }
      .casual-btn {
        padding: 0.35rem 0.9rem;
        min-height: 36px;
        background: #2a2a2a;
        border: 2px solid #444;
        border-radius: 999px;
        color: #aaa;
        cursor: pointer;
        font-size: 0.85rem;
      }
      .casual-btn.active {
        background: #2a4a2a;
        border-color: #1db954;
        color: #1db954;
      }
      ```

12. **`GuestWaitingRoom.svelte` — Casual Mode toggle for waiting players.** In [src/client/components/GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte):
    - Add optional props `allowCasualMode?: boolean = false`, `casualModeOn?: boolean = false`, `onCasualToggle?: () => void`.
    - Render the same toggle row when `allowCasualMode` is true (below the player list or at the bottom of the content area — keep it visually secondary).
    - Pass `casualModeNames` to `<PlayerList>` (check if PlayerList is used inside GuestWaitingRoom — if so pass it through).

13. **`HostRoomPage.svelte` — seed `casualModeNames` from `session:connect`.** In [src/client/pages/HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte):
    - In the `session:connect` handler: set `game.casualModePlayers` from `data.casualModeNames`:
      ```ts
      const seedNames = (data.casualModeNames as string[] | undefined) ?? []
      if (seedNames.length > 0) {
        const s = new Set<string>()
        seedNames.forEach(n => s.add(n))
        // Reassign via direct mutation + re-expose won't trigger reactivity; use exposed setter or inline logic
      }
      ```
    - **Note:** `casualModePlayers` is exposed as a getter only. Add a setter `set casualModePlayers(v: Set<string>) { casualModePlayers = v }` to `createGameState` return value, OR set initial state via `initialCasualModeNames`. The host's `createGameState` call doesn't go through the `session:connect` init path the same way guests do. The simplest fix: add `set casualModePlayers(v)` setter in gameState and use it from the HostRoomPage `session:connect` handler.
    - Pass `casualModeNames={game.casualModePlayers}` to wherever `<PlayerList>` or `<PlayersOverlay>` is rendered in the host page.

14. **Guest join chain — seed `initialCasualModeNames`.** Following the exact same pattern as `continuousMode` was plumbed in Story 8-3:
    - [src/client/lib/ws.ts](src/client/lib/ws.ts) `GuestHandlers.onConnect`: add `casualModeNames: string[]` param (after `countdownRemainingMs`).
    - `connectAsGuest` `session:connect` handler: forward `data.casualModeNames ?? []`.
    - [src/client/pages/JoinPage.svelte](src/client/pages/JoinPage.svelte) `onConnect` callback: capture and forward through `onJoined(...)`.
    - [src/client/App.svelte](src/client/App.svelte) `handleJoined`: add `casualModeNames: string[]` param, store in `guestCasualModeNames = $state<string[]>([])`.
    - `<RoomPage ... initialCasualModeNames={guestCasualModeNames} />`.
    - [src/client/pages/RoomPage.svelte](src/client/pages/RoomPage.svelte): accept `initialCasualModeNames` prop and forward into `createGameState`.

15. **Tests and verification.**
    - `npm run lint` (tsc --noEmit) clean.
    - `npm test` green — no regressions.
    - **Server tests** in [src/server/__tests__/rooms.test.ts](src/server/__tests__/rooms.test.ts):
      - **`round:start includes allowCasualMode`** — POST /round with `allowCasualMode: true`, assert `round:start` broadcast contains `allowCasualMode: true`.
      - **`round:start defaults allowCasualMode to false when omitted`** — POST /round without the field, assert broadcast has `allowCasualMode: false`.
      - **`player:casual-mode-changed broadcasts to all`** — simulate guest WS message `{ type: 'player:casual-mode-changed', enabled: true }`, assert broadcast `{ type: 'player:casual-mode-changed', name, enabled: true }` observed, and `roomState.playerCasualModes.get(name) === true`.
      - **`player:casual-mode-changed ignores non-boolean enabled`** — send `{ type: 'player:casual-mode-changed', enabled: 'yes' }`, assert no broadcast and map unchanged.
      - **`new round resets playerCasualModes`** — set a player's casual mode to true, POST /round again, assert `roomState.playerCasualModes` is empty after new round starts.
      - **`session:connect seeds casualModeNames`** — set two players' casual modes, simulate a new guest connect, assert `session:connect` payload contains both names in `casualModeNames`.
    - **Client: no new unit tests.** Manual verification is the coverage for Svelte component changes.
    - **Manual verification checklist** (Philip):
      - Round Config: "Allow Casual Mode" defaults off; toggling to "Allow" and back to "Off" works. Starting a round with Allow = off → guest sees no Casual Mode toggle.
      - Starting a round with Allow = on → guest sees "Casual Mode" toggle on game page. Toggle off → toggle on → ☕ appears next to their name in everyone's Players List. Host's overlay also shows ☕.
      - Toggle Casual Mode off → ☕ disappears from Players List for all clients.
      - New round starts → guest's Casual Mode toggle resets to Off, ☕ gone from Players List.
      - Continuous Mode (Story 8-3): `allowCasualMode` carries through to the auto-started round — Casual Mode toggles should remain accessible across auto-started rounds if host had allowed it in the original config.
      - Late joiner: player joins after another player has Casual Mode on → ☕ already shown correctly without needing any further events.

## Tasks / Subtasks

- [x] **Server: extend types and state** (AC: #1, #2)
  - [x] Add `allowCasualMode: boolean` to `RoundConfig` in [ws.ts](src/server/ws.ts)
  - [x] Add `playerCasualModes: Map<string, boolean>` to `RoomState` in [ws.ts](src/server/ws.ts)
  - [x] Initialize `playerCasualModes: new Map()` at all 3 `roomSockets.set(...)` call sites
- [x] **Server: round start and reset** (AC: #3)
  - [x] Parse `allowCasualMode` in POST `/round` handler and pass to `startRound`
  - [x] Include `allowCasualMode` in `roundStartPayload` in `startRound` helper
  - [x] Reset `roomState.playerCasualModes = new Map()` at start of `startRound`
- [x] **Server: guest WS message handler** (AC: #4)
  - [x] Handle `player:casual-mode-changed` in guest `ws.on('message')` in [ws.ts](src/server/ws.ts)
  - [x] Validate `enabled` is boolean; update map; broadcast to all
- [x] **Server: session:connect seeding** (AC: #5)
  - [x] Add `casualModeNames` to host session:connect payload
  - [x] Add `casualModeNames` to guest session:connect payload
- [x] **Client: API types and roundConfig helper** (AC: #6)
  - [x] Add `allowCasualMode?: boolean` to `StartRoundPayload` in [api.ts](src/client/lib/api.ts)
  - [x] Update `buildStartRoundPayload` in [roundConfig.ts](src/client/lib/roundConfig.ts) to accept and return `allowCasualMode`
- [x] **Client: Round Config toggle** (AC: #7)
  - [x] Add `allowCasualMode` state + two-button toggle in [RoundConfigOverlay.svelte](src/client/components/RoundConfigOverlay.svelte)
  - [x] Pass `allowCasualMode` to `buildStartRoundPayload`
- [x] **Client: gameState** (AC: #8)
  - [x] Add `allowCasualMode`, `casualModePlayers`, `initialCasualModeNames` param to [gameState.svelte.ts](src/client/lib/gameState.svelte.ts)
  - [x] Handle `round:start`, `player:casual-mode-changed` in `processWsMessage`
  - [x] Expose getters (and `casualModePlayers` setter for HostRoomPage seeding)
- [x] **Client: PlayerList ☕ indicator** (AC: #9)
  - [x] Add `casualModeNames?: Set<string>` prop to [PlayerList.svelte](src/client/components/PlayerList.svelte)
  - [x] Render ☕ span for players in the set (host row + guest rows)
- [x] **Client: PlayersOverlay threading** (AC: #10)
  - [x] Add `casualModeNames` prop to [PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte); pass to PlayerList
- [x] **Client: RoomPage guest toggle** (AC: #11)
  - [x] Add `initialCasualModeNames` prop to [RoomPage.svelte](src/client/pages/RoomPage.svelte)
  - [x] Add `casualModeOn` local state; `handleCasualToggle` sends WS message
  - [x] Render toggle below status line when `game.allowCasualMode`
  - [x] Reset `casualModeOn = false` in `round:start` branch of `handleWsData`
  - [x] Pass `casualModeNames` to PlayersOverlay
- [x] **Client: GuestWaitingRoom toggle** (AC: #12)
  - [x] Add `allowCasualMode`, `casualModeOn`, `onCasualToggle` props; render toggle when allowed
- [x] **Client: HostRoomPage seeding** (AC: #13)
  - [x] Seed `game.casualModePlayers` from `session:connect` `casualModeNames` in [HostRoomPage.svelte](src/client/pages/HostRoomPage.svelte)
  - [x] Pass `casualModeNames` to PlayersOverlay where PlayerList is rendered
- [x] **Client: guest join chain** (AC: #14)
  - [x] Add `casualModeNames` to `GuestHandlers.onConnect` in [ws.ts](src/client/lib/ws.ts); forward in `connectAsGuest`
  - [x] Update `onJoined` signature in [JoinPage.svelte](src/client/pages/JoinPage.svelte) and [App.svelte](src/client/App.svelte)
  - [x] Add `guestCasualModeNames` state in App.svelte; pass to RoomPage
- [x] **Tests** (AC: #15)
  - [x] Server tests for allowCasualMode broadcast, player:casual-mode-changed, reset on new round, session:connect seeding
  - [x] `npm run lint` clean; `npm test` green
  - [ ] Manual smoke-test per checklist

### Review Findings

- [x] ~~[Review][Patch] Duplicate `class="pill"` on Allow button~~ — false positive (duplicate only existed in reviewer's prompt text, not in real source)
- [x] [Review][Patch] `casualModeOn` now seeded from `initialCasualModeNames.includes(name)` on reconnect [src/client/pages/RoomPage.svelte]
- [x] [Review][Patch] Host `session:connect` now unconditionally replaces `game.casualModePlayers` with the seed set [src/client/pages/HostRoomPage.svelte]
- [x] [Review][Patch] PlayerList host-row ☕ check now guards `hostName !== null` before `casualModeNames.has(hostName)` [src/client/components/PlayerList.svelte]
- [x] [Review][Patch] Added WS integration tests for `player:casual-mode-changed` (broadcast to host+guests, non-boolean rejected, late-join session:connect seeding) [src/server/__tests__/ws.test.ts]
- [x] [Review][Patch] Removed the weak inline-filter `session:connect` test from rooms.test.ts — coverage replaced by real WS integration test above [src/server/__tests__/rooms.test.ts]
- [x] [Review][Defer] Server accepts `player:casual-mode-changed` regardless of `allowCasualMode` flag — missing server-side permission enforcement; out of spec scope for this story [src/server/ws.ts] — deferred, pre-existing
- [x] [Review][Defer] No dedup/rate-limit on `player:casual-mode-changed` broadcast — pre-existing pattern, friends-only app [src/server/ws.ts] — deferred, pre-existing

## Dev Notes

### Key Anti-Patterns to Avoid

- **Don't add a separate endpoint** for toggling player casual mode — it goes over the existing WebSocket, same as all guest-to-server communication. The only HTTP route added is nothing; the existing `/round` POST gets a new field.
- **Don't create a new PlayerState type** for this story — a parallel `Map<string, boolean>` on `RoomState` is sufficient. Story 8-5 may evolve this further if needed.
- **Don't use CSS variables or new design tokens** for the ☕ toggle — follow the existing `.pill` pattern from RoundConfigOverlay and the existing `.you-pill`/`.host-pill` pattern from PlayerList.
- **Don't reset `allowCasualMode` on `round:end`** — it's cleared on `round:start` (new round = fresh state). No `round:end` handling needed.

### File Locations (exact paths)

- Server WS types: [src/server/ws.ts](src/server/ws.ts) — `RoundConfig`, `RoomState`, WebSocket handlers
- Server routes: [src/server/rooms.ts](src/server/rooms.ts) — `startRound` helper, POST `/round` handler, guest WS message handler is in ws.ts (not rooms.ts)
- Client API types: [src/client/lib/api.ts](src/client/lib/api.ts) — `StartRoundPayload`
- Client round config helper: [src/client/lib/roundConfig.ts](src/client/lib/roundConfig.ts) — `buildStartRoundPayload`
- Client game state: [src/client/lib/gameState.svelte.ts](src/client/lib/gameState.svelte.ts)
- Client WS utils: [src/client/lib/ws.ts](src/client/lib/ws.ts) — `GuestHandlers`, `connectAsGuest`
- Components: [src/client/components/](src/client/components/) — RoundConfigOverlay, PlayerList, PlayersOverlay, GuestWaitingRoom
- Pages: [src/client/pages/](src/client/pages/) — RoomPage, HostRoomPage, JoinPage, App.svelte

### `startRound` Helper Location (Story 8-3 Refactor)

Story 8-3 extracted `startRound` as a reusable helper in [src/server/rooms.ts](src/server/rooms.ts) (~line 284). The POST `/round` handler now calls it. The `playerCasualModes` reset should go **inside `startRound`** (not the HTTP handler) so that both the HTTP path and continuous-mode auto-start both reset it on every new round.

### Session Stats Seeding Pattern (Story 8-2 Precedent)

Story 8-2 established the pattern for seeding initial state through the guest join chain. Story 8-3 added `continuousMode`/`countdownRemainingMs` following the same chain. This story follows the same chain for `casualModeNames`:

```
ws.ts (server) session:connect payload
  → connectAsGuest (client/lib/ws.ts) GuestHandlers.onConnect
    → JoinPage.svelte onConnect → onJoined(...)
      → App.svelte handleJoined → guestCasualModeNames
        → RoomPage.svelte initialCasualModeNames prop
          → createGameState({ initialCasualModeNames })
```

### Svelte 5 Reactivity for Set State

`casualModePlayers` is a `Set<string>`. Svelte 5 `$state` tracks reassignment, not mutation. When updating:
```ts
// ✅ Correct — triggers reactivity
const s = new Set(casualModePlayers)
s.add(name)  // or s.delete(name)
casualModePlayers = s

// ❌ Wrong — no reactivity
casualModePlayers.add(name)
```

### HostRoomPage `casualModePlayers` Seeding

The host's `game` object is created via `createGameState`. Add a setter `set casualModePlayers(v: Set<string>) { casualModePlayers = v }` to the return value of `createGameState`. Then in HostRoomPage `session:connect` handler:
```ts
const names = (data.casualModeNames as string[] | undefined) ?? []
if (names.length > 0) game.casualModePlayers = new Set(names)
```

### PlayersOverlay — Check How It Uses PlayerList

Read [src/client/components/PlayersOverlay.svelte](src/client/components/PlayersOverlay.svelte) before editing. It wraps `<PlayerList>` and forwards props. The component needs a `casualModeNames` prop threaded through exactly as `winsByName` and `showStats` are already threaded.

### GuestWaitingRoom — Locate the Player List Usage

Read [src/client/components/GuestWaitingRoom.svelte](src/client/components/GuestWaitingRoom.svelte) to confirm it uses `<PlayerList>` and identify where to add the Casual Mode toggle. The toggle should be visually secondary — small and below the existing content.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

Implemented all 14 task groups for Story 8-4 Casual Mode permission & player toggle:

- **Server (ws.ts):** Added `allowCasualMode` to `RoundConfig`, `playerCasualModes: Map<string, boolean>` to `RoomState` (initialized at all 3 `roomSockets.set` call sites + rehydrateRooms). Added `player:casual-mode-changed` guest WS handler with boolean validation, map update, and broadcast to all. Added `casualModeNames` array to both host and guest `session:connect` payloads.
- **Server (rooms.ts):** POST `/round` parses `allowCasualMode` (defaults false), passes through `RoundConfig` to `startRound`. `startRound` resets `playerCasualModes` to empty Map before broadcasting `round:start` with `allowCasualMode` included. `startContinuousRound` carries `allowCasualMode` through automatically via spread from `pendingRound`.
- **Client (api.ts, roundConfig.ts):** Added `allowCasualMode?: boolean` to `StartRoundPayload`; updated `buildStartRoundPayload` to accept and include it.
- **Client (RoundConfigOverlay.svelte):** Added Off/Allow pill toggle for Casual Mode, wired to `buildStartRoundPayload`.
- **Client (gameState.svelte.ts):** Added `allowCasualMode`, `casualModePlayers` state with `initialCasualModeNames` param. `round:start` resets both; new `player:casual-mode-changed` branch updates set reactively. Exposed getters and `casualModePlayers` setter.
- **Client (PlayerList.svelte):** Added `casualModeNames?: Set<string>` prop, renders ☕ inline for host and each guest in the set.
- **Client (PlayersOverlay.svelte):** Threads `casualModeNames` through to `PlayerList`.
- **Client (GuestWaitingRoom.svelte):** Added `allowCasualMode`, `casualModeOn`, `onCasualToggle`, `casualModeNames` props; renders toggle row when allowed; passes `casualModeNames` to `PlayerList`.
- **Client (RoomPage.svelte):** Added `initialCasualModeNames` prop → `createGameState`. `casualModeOn` local state; `handleCasualToggle` sends WS message. Renders in-game toggle below status line when `game.allowCasualMode`. Resets `casualModeOn` on `round:start`. Passes `casualModeNames` to `PlayersOverlay` and all props to `GuestWaitingRoom`.
- **Client (HostRoomPage.svelte):** Seeds `game.casualModePlayers` from `session:connect` `casualModeNames`. Passes `casualModeNames` to `PlayersOverlay`.
- **Client join chain (ws.ts, JoinPage.svelte, App.svelte):** Added `casualModeNames` param to `GuestHandlers.onConnect` and forwarded through `connectAsGuest` → `onJoined` → `guestCasualModeNames` state → `RoomPage` `initialCasualModeNames` prop.
- **Tests:** Added new `describe` blocks for `allowCasualMode` broadcast, default false, reset on new round, and `session:connect` seeding. Updated 4 existing tests (join.test.ts ×2, ws.test.ts ×2) to reflect new `casualModeNames` field. All 357 tests pass.

### File List

- src/server/ws.ts
- src/server/rooms.ts
- src/client/lib/api.ts
- src/client/lib/roundConfig.ts
- src/client/lib/gameState.svelte.ts
- src/client/lib/ws.ts
- src/client/components/RoundConfigOverlay.svelte
- src/client/components/PlayerList.svelte
- src/client/components/PlayersOverlay.svelte
- src/client/components/GuestWaitingRoom.svelte
- src/client/pages/RoomPage.svelte
- src/client/pages/HostRoomPage.svelte
- src/client/pages/JoinPage.svelte
- src/client/App.svelte
- src/server/__tests__/rooms.test.ts
- src/client/__tests__/join.test.ts
- src/server/__tests__/ws.test.ts
- src/client/__tests__/RoundConfigOverlay.test.ts

## Change Log

- 2026-04-14: Story 8-4 implemented — Casual Mode host permission gate and player toggle. Added allowCasualMode to RoundConfig, playerCasualModes map to RoomState, player:casual-mode-changed WS handler, casualModeNames session:connect seeding, Off/Allow toggle in RoundConfigOverlay, ☕ indicator in PlayerList, guest toggle in RoomPage and GuestWaitingRoom, full guest join chain propagation, and HostRoomPage seeding. 357 tests pass.
