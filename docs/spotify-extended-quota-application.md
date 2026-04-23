# Spotify Extended Quota Mode — application draft

**Status:** Draft, not submitted. Update + submit when the 5-user Development Mode cap becomes a practical blocker.

Extended Quota Mode is Spotify's reviewed tier that lifts the Development Mode 5-user cap. Approval is manual; Spotify reviews the materials below before granting. Plan for weeks, not days.

---

## 1. App description (~100 words)

Bangerbingo is a music bingo party game for friend groups. One person (the **host**) signs in with Spotify, picks a playlist, and streams from their account via the Spotify Web Playback SDK. Guests join from their phones by entering a short room code — they don't sign in to Spotify at all. Each guest gets a randomly-generated 5×5 bingo card of song titles drawn from the playlist. When a song plays, guests mark matching tiles; the first to hit a line wins. The host controls playback (play / pause / skip) from the host screen. Fun for 2–30 guests, in-person or video call.

## 2. Use-case justification — why Spotify API access is essential

- **Playlist discovery + track fetch** — hosts search their own Spotify playlists (`GET /v1/me/playlists`, `GET /v1/search`) and the app pulls track lists (`GET /v1/playlists/{id}/items`) to generate bingo cards. There is no substitute: users want their *own* playlists, not curated lists.
- **Web Playback SDK for audio** — hosts stream the actual track through Spotify's official SDK (requires `streaming` scope + Premium). This is the only legal path to play full tracks from Spotify. Preview URLs are unavailable for apps registered after Nov 2024.
- **Playback control** — the host screen exposes play/pause/skip via `PUT /me/player/play`, `PUT /me/player/pause`. Standard player controls.
- **User identity** — `GET /v1/me` fetches the host's Spotify user ID (primary key in our `hosts` table) and display name (shown in the UI).

Without Spotify API access, the app cannot function — music selection, playback, and identity all flow through it.

## 3. Data usage statement

**What we read from Spotify:**

- `/v1/me` — user id, display name, email (email is optional / may be empty per 2026 API changes).
- `/v1/me/playlists`, `/v1/search`, `/v1/playlists/{id}/items` — playlist metadata + track lists (title, artist, duration, album cover).
- `/v1/me/player/*` — device list + playback control (host-initiated only).

**What we store (SQLite, self-hosted):**

| Field              | Source                            | Retention                                             |
|--------------------|-----------------------------------|-------------------------------------------------------|
| `user_id`          | `/v1/me.id`                       | Until host deletes their account / logs out          |
| `display_name`     | `/v1/me.display_name`             | Same                                                  |
| `email`            | `/v1/me.email`                    | Same (may be empty string)                            |
| `access_token`     | OAuth token exchange              | Cleared on logout; auto-refreshed while active        |
| `refresh_token`    | OAuth token exchange              | Cleared on logout                                     |
| `token_expires_at` | Computed from `expires_in`        | Cleared on logout                                     |

Tokens never leave the server. The frontend gets short-lived access tokens on demand via `/auth/token` for the Web Playback SDK only. We do not share, sell, or analyze any Spotify data.

## 4. Demo video outline (2–3 min)

Record when the app is in a submission-ready state.

1. **0:00–0:15** — Landing page, click "Connect Spotify", pass through OAuth, land on host page.
2. **0:15–0:45** — Create a room (4-char code), pick a playlist, show round config.
3. **0:45–1:15** — Two guests join on phones with the room code + a name, show bingo cards populate.
4. **1:15–2:15** — Start round, song plays via Web Playback SDK, guests mark tiles, host pauses, host resumes, a guest hits bingo.
5. **2:15–2:45** — Win overlay, end of round, play again or end session.

## 5. Privacy statement

The data handling in section 3 is the full scope. Hosts log out at any time via the app, which clears their tokens server-side.

**Blocker for submission:** Spotify's Extended Quota form may require a public privacy URL. This app does not currently publish one. Add a `/privacy` route before submitting; link to it from the landing page footer.

## 6. Submission checklist

- [ ] **Polished landing page** — looks like a real product, not a dev build. Currently: single Connect-Spotify button. Probably needs a tagline, screenshot, and a "what is this" blurb.
- [ ] **Public privacy page** — add `/privacy` route serving the content in section 5. Link from the footer.
- [ ] **Demo video** — record per section 4 outline. Upload to YouTube (unlisted is fine for the form).
- [ ] **App description finalized** — section 1 above, tightened to match Spotify's word limit.
- [ ] **Scopes justification** — confirm every OAuth scope currently requested (`streaming`, `user-read-email`, `user-read-private`, `playlist-read-private`, `playlist-read-collaborative`, `user-read-playback-state`, `user-modify-playback-state`) is still used and justified in the form.
- [ ] **Quota request form** — Spotify Developer Dashboard → app → Extensions / Extended Quota Mode → submit.

---

## Reference

- Bangerbingo OAuth flow: [src/server/auth.ts:82-202](../src/server/auth.ts#L82)
- Tokens table: [src/server/db.ts:12-17](../src/server/db.ts#L12)
- Web Playback SDK integration: [src/client/pages/HostRoomPage.svelte:303-305](../src/client/pages/HostRoomPage.svelte#L303)
- Spotify Extended Quota documentation: [https://developer.spotify.com/documentation/web-api/concepts/quota-modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) (verify URL before submitting — Spotify reorganizes docs periodically).
