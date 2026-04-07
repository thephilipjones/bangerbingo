# Smoke Test Runbook

Manual verification checklist for BangerBingo after deployment.

## Prerequisites

- Staging (or prod) is deployed and reachable over HTTPS
- Two browsers or devices available (host + guest)
- Host has a Spotify Premium account registered in the Spotify developer app
- Both devices can reach the deployment (tailnet or public DNS)

## Happy Path (8 steps)

### 1. Host registers and connects Spotify

- Open the app URL in Browser A (desktop Chrome recommended)
- Click **Connect Spotify** and complete the OAuth flow
- Verify: dashboard loads, Spotify display name appears

### 2. Host creates a room

- Click **Create Room**
- Verify: room code (4-6 chars) appears on the host dashboard

### 3. Guest joins from second browser

- Open the app URL in Browser B (different browser or device)
- Enter a guest name and the room code
- Click **Join**
- Verify: guest sees the waiting room / lobby, host sees guest in player list

### 4. Host starts round

- Select a genre preset (or keyword search) for the track pool
- Choose a short clip length (e.g. 10s) for faster testing
- Click **Start Round**
- Verify: bingo cards generate and appear for both host and guest

### 5. First song plays and tiles enter masked state

- Verify: music plays through the host's browser (Spotify Web Playback SDK)
- Verify: the currently playing song's tile enters masked/highlighted state on all cards
- Verify: song title is hidden on guest cards until revealed

### 6. Guest marks tiles and claims bingo

- On the guest card, tap tiles that match songs heard
- Continue through enough songs for a bingo line to be possible
- When a line is complete, verify: **Bingo!** button appears (or auto-detects)
- Click **Bingo!**

### 7. Win overlay fires on both screens

- Verify: win overlay / celebration appears on the guest's screen
- Verify: host screen also shows the win notification with winner's name
- Verify: game pauses or enters post-round state

### 8. Host taps "Start Next Round"

- Click **Start Next Round** on host controls
- Verify: round configuration screen appears
- Select track pool and start another round
- Verify: new cards generate, new songs play

## Restart-Recovery Variant (validates Story 6-4)

Run this after completing steps 1-5 above to verify server restart state recovery.

### R1. Restart the app container

```sh
docker compose -p bb-staging restart app
```

### R2. Reconnect both browsers

- Refresh Browser A (host) and Browser B (guest)
- Verify: both reconnect via WebSocket automatically (or after a brief reload)

### R3. Resume playback

- On the host, press **Play** to resume
- Verify: round resumes from the same `currentSongIndex`
- Verify: `songHistory` is intact (previously played songs still shown)
- Verify: guest card state is preserved (previously marked tiles still marked)
- Verify: no duplicate songs play

## Performance Eyeball Checkpoints

These are not automated assertions. Just notice whether performance feels acceptable during the smoke test.

| ID | What to watch | Target |
|---|---|---|
| NFR1 | Host control actions (play/pause/skip) | < 500ms response |
| NFR2 | WebSocket broadcast (tile updates, song changes) | < 200ms to all clients |
| NFR3 | Bingo card initial load | < 2s |

If any of these feel noticeably slow, note it for investigation but don't block the smoke test.

## Common Failure Modes

| Symptom | Likely cause |
|---|---|
| Spotify login fails with `redirect_uri_mismatch` | `SPOTIFY_REDIRECT_URI` in `.env` doesn't match the URI registered in the Spotify app |
| Music doesn't play | Spotify Premium required; check browser autoplay policy; try clicking play manually |
| Guest can't join | Room code typo; room expired; WebSocket connection blocked by proxy |
| Cards don't generate | Track pool too small; Spotify API rate limit; check server logs |
| Win not detected | Fewer songs played than needed for a line; check bingo validation logic |
| State lost after restart | `bangerbingo-data` volume not mounted; DB path misconfigured |
