# BangerBingo

Spotify-powered music bingo for you and your friends. Self-hosted, no subscription, host plays along.

## What it is

A web app for running music bingo nights. The host connects their Spotify Premium account, picks a playlist (genre preset or keyword search), and shares a room code. Guests join from any device — no account, no app, no Spotify required, just a name. Songs play through the host's browser (routable to Bluetooth / AirPlay), cards auto-generate, and wins are verified server-side.

**What makes it different:**

- **Host plays too.** The host gets their own bingo card alongside the playback controls, instead of being a pure operator — the main differentiator vs. every commercial and OSS alternative.
- **No subscription.** Clone, add your own Spotify app credentials, run it.
- **Jackbox-style join.** Guests go to the root URL, type a name + 4–6 char room code, and they're in.
- **Playlist-driven, not algorithmic.** Spotify killed `/recommendations` for new apps — curated playlists are the game.

## Stack

- **Frontend:** Svelte 5 SPA (Vite)
- **Backend:** Hono on Node, native `ws` WebSockets, `Map<roomId, GameState>` for active rooms
- **Storage:** SQLite (`better-sqlite3`) for host accounts and cross-session song dedup
- **Auth:** Spotify PKCE OAuth only — host display name/email come from Spotify profile; no separate password. Guests are ephemeral (name in memory).
- **Playback:** Spotify Web Playback SDK, behind a `MusicProvider` interface so Apple Music (MusicKit JS) can slot in post-MVP without refactoring.

## Product docs

Full PRD, UX spec, and epics live in [_bmad-output/](./_bmad-output/):

- [prd.md](./_bmad-output/prd.md) — requirements, scope, risk register
- [ux-spec.md](./_bmad-output/ux-spec.md) — flows and screen specs
- [epics.md](./_bmad-output/epics.md) — epic/story breakdown

## Getting Started

### Prerequisites

- Node 20+
- A [Spotify Developer app](https://developer.spotify.com/dashboard)
- Spotify Premium (for the host account)

### 1. Install dependencies

```sh
npm install
```

### 2. Configure environment

```sh
cp .env.example .env
```

Fill in your Spotify app credentials in `.env`:

```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/auth/callback
SESSION_SECRET=any_long_random_string
```

**Getting `SPOTIFY_CLIENT_ID`:**

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create app**, give it any name and description.
3. Copy the **Client ID** from the app overview page — paste it as `SPOTIFY_CLIENT_ID`.

**Generating `SESSION_SECRET`:**

Used to HMAC-sign session cookies server-side. Any long random string works:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Register the redirect URI in Spotify

In your app's settings on the Spotify Developer Dashboard, under **Redirect URIs**, add:

```
http://127.0.0.1:5173/auth/callback
```

It must match `SPOTIFY_REDIRECT_URI` exactly or Spotify will refuse the login.

In dev, all traffic goes through Vite (port 5173), which proxies `/auth/*` to the Hono server (port 3000). Using 5173 ensures the post-login redirect lands back on the Svelte app.

> **Note:** Use `127.0.0.1`, not `localhost` — Spotify dropped `localhost` support in late 2025.

> **Dev-mode 5-user cap:** Spotify dev-mode apps cap at 5 authenticated users. This applies to **hosts only** — guests don't auth with Spotify, so room size is unaffected.

### 4. Run the dev server

```sh
npm run dev
```

- Server: `http://127.0.0.1:3000`
- Client (Vite): `http://127.0.0.1:5173`

Open `http://127.0.0.1:5173` and click **Connect Spotify**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Concurrent Hono server + Vite client |
| `npm run build` | Build client (Vite) + server (tsc) |
| `npm start` | Run built server |
| `npm test` | Vitest run once |
| `npm run test:watch` | Vitest watch mode |
| `npm run lint` | Typecheck (`tsc --noEmit`) |

## Browser support

| User | Target | Notes |
|---|---|---|
| Host | Chrome/Firefox desktop | Reliable Spotify Web Playback SDK |
| Host | iOS Safari | Aspirational — SDK init may fail; graceful fallback required. Apple Music (post-MVP) resolves this. |
| Guest | Any modern browser | No Spotify dependency, just WebSockets |
