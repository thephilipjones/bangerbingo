# Research: Can guests' Spotify accounts "listen along" in sync remotely? (incl. mobile host)

## Context
Bangerbingo currently has the host authenticate once with Spotify; guests never touch Spotify. Audio plays only on the host's device (Web Playback SDK in desktop browser, or via Spotify Connect on the host's phone with the new mobile-host support). Question: can *remote* guests hear the same track in sync on their own Spotify accounts?

## TL;DR
**Not cleanly, and not via the Web API.** There are three paths — all are dead ends for bangerbingo's constraints.

---

## Path A — Spotify Jam (the official feature)
- Jam = Spotify's native listen-along. As of **Jan 2026** remote Jam via "Request to Jam" in Messages is GA.
- **Every remote guest needs Spotify Premium.** Free accounts cannot join remotely.
- **Zero Web API surface.** No endpoint to start a Jam, fetch the join link, add tracks, or end it. This is an open, explicitly-declined developer request. So bangerbingo cannot:
  - Start a Jam from the server when the host opens a room.
  - Queue the random 30s snippet the game picks next.
  - Seek to the in-track offset the game uses.
- Jam is also tied to whatever is currently playing on Spotify, not to our gameplay loop. The host can't have the game's Web Playback SDK player *and* a Jam both running — Jam hijacks the host's active device.
- **Verdict:** manual, out-of-band, and incompatible with our "game picks a random 30s slice per round" flow.

## Path B — Each guest authenticates + we mirror playback to their device
Approach: guest OAuths with Spotify, server calls `PUT /me/player/play` with the same `uri` + `position_ms` on their account; server polls and re-seeks to stay aligned.
- **Blocker 1 — dev-mode 5-user cap.** Since Feb 2026, one dev-mode Client ID allows only 5 authorized users total (including the host). Bangerbingo's memory explicitly codifies "Only the host authenticates — guests never touch Spotify auth." Extending quota requires full Spotify Extended Access approval, which is a high bar for a hobby app.
- **Blocker 2 — Premium required for every guest.** `PUT /me/player/play` is Premium-only. Free-tier guests are filtered out entirely.
- **Blocker 3 — sync precision.** `progress_ms` has documented 0.5–1.5s jitter and `timestamp` updates are sporadic. For 30s banger snippets, that drift is audibly bad (intro/drop misalignment).
- **Blocker 4 — host's Web Playback SDK would no longer be the "current device" for guests.** You'd be orchestrating N+1 independent Spotify Connect sessions.
- **Verdict:** technically possible for a tiny Premium-only friend group, but the 5-user cap kills it as a general feature.

## Path C — Host streams decoded audio to guests (WebRTC/HLS)
- Violates Spotify Developer ToS (no re-streaming/rebroadcasting of Spotify audio).
- Also blocked technically: Web Playback SDK uses EME/DRM so the audio tag cannot be captured.
- **Verdict:** don't.

---

## Mobile host angle (the new wrinkle)
- Mobile host support uses Spotify Connect to drive playback on the host's phone (since Web Playback SDK is broken on iOS Safari — memory confirms).
- This does **not** change the listen-along question. A mobile host still has exactly one active Spotify device (their phone). Remote guests face the same Path-A / Path-B / Path-C constraints.
- One small risk worth flagging: if a mobile host tries to start a Jam manually (Path A out-of-band), the Jam will take over their phone's Spotify app and fight our game's Connect control. Worth a docs note but not a code change.

## Recommendation (to discuss)
Don't build in-app remote listen-along. Options for remote play:
1. **Ship as host-only audio + Zoom/Discord/FaceTime screenshare-with-audio.** Zero code, works today, no Premium requirement for guests. This is the de-facto "remote bangerbingo" path.
2. **Document a "Start a Spotify Jam alongside the game" escape hatch** in the UI for all-Premium friend groups who want their own audio. Purely a copy change — we don't integrate with it, we just tell the host how.
3. **Revisit if/when Spotify opens Jam to the Web API.** No timeline; treat as "not coming."

## Sources
- [Listening Activity & Request to Jam in Messages — Spotify Newsroom, Jan 2026](https://newsroom.spotify.com/2026-01-07/listening-activity-request-to-jam-messages-updates/)
- [Start or join a Jam — Spotify Support](https://support.spotify.com/us/article/jam/)
- [Give the Spotify Web API Access to Jams — Community idea (declined status)](https://community.spotify.com/t5/Live-Ideas/Give-the-Spotify-Web-API-Access-to-Jams/idi-p/5643719)
- [Create Spotify Jam link via Web API — Community idea](https://community.spotify.com/t5/Live-Ideas/Create-Spotify-Jam-link-via-Web-API/idi-p/7161416)
- [Remote Jam not in sync — Community](https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Remote-Jam-not-in-sync/td-p/7027327)
- [February 2026 Web API Dev Mode Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify tightens dev mode — TechCrunch, Feb 2026](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/)
- [Transfer Playback — Web API Reference](https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback)
- [Collaborative listening using Connect endpoints — José M. Pérez](https://jmperezperez.medium.com/collaborative-listening-on-spotify-using-connect-endpoints-7695603e17d1)
- [Web API precise playback progress — Community](https://community.spotify.com/t5/Spotify-for-Developers/Web-API-precise-playback-progress/td-p/6130785)
