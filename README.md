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

## Local Development

After the one-time Getting Started above, day-to-day dev is just `npm run dev`. This starts Vite on 5173 and Hono on 3000 concurrently. Vite binds to all interfaces and Hono binds to `0.0.0.0`, so LAN and Tailscale peers can reach the dev server.

### Multi-browser host + guest testing on one Macbook

You can run a full session against your local dev server from a single machine:

- Host: open `http://127.0.0.1:5173/` in **Chrome**, click **Connect Spotify**, create a room.
- Guests: open `http://127.0.0.1:5173/<room-code>` in **Firefox** and **Safari** (different browsers, not tabs — each browser gets its own session cookie and WS connection).

This exercises host playback + guest card marking + real-time WS events end-to-end without any deploy.

### Testing from your phone over Tailscale

With your Macbook and phone on the same Tailscale tailnet, you can join a room from your phone against your local dev server:

1. From your Macbook, grab your tailnet hostname (e.g. `my-macbook.tail1234.ts.net`) via `tailscale status`.
2. On your phone, open `http://<macbook-tailnet-hostname>:5173/<room-code>`.
3. Join with a name, receive a card, tap tiles — events should roundtrip via WS to the host's browser in real time.

No extra tunnel/proxy setup is required — Vite (`server.host: true`) and Hono (`hostname: '0.0.0.0'`) already listen on all interfaces.

### Spotify auth from a Tailscale peer

Spotify requires the OAuth redirect URI to match a URI registered on the Spotify app exactly, and will reject anything else with `400 INVALID_CLIENT` / `redirect_uri_mismatch`. Your options:

- **(a) Register a second redirect URI** on your Spotify app matching your tailnet hostname, e.g. `http://<macbook-tailnet-hostname>:5173/auth/callback`, and set `SPOTIFY_REDIRECT_URI` to that when hosting from a tailnet peer; **or**
- **(b) Keep `http://127.0.0.1:5173/auth/callback`** and always host (click **Connect Spotify**) from the Macbook, using the phone/other tailnet peers as guests only. Guests don't touch Spotify, so this is the simplest path.

### Troubleshooting

- **Spotify login bounces back with `?error=missing_verifier`.** You opened the app at `http://localhost:5173` but `SPOTIFY_REDIRECT_URI` points at `http://127.0.0.1:5173/auth/callback`. The PKCE cookie is bound to the origin that set it, so `localhost` and `127.0.0.1` don't share cookies. Always open the app at `http://127.0.0.1:5173/` (Vite's terminal output now shows both `localhost` and `127.0.0.1` URLs since the dev server binds all interfaces — use the `127.0.0.1` one).
- **Port already in use (3000 or 5173).** Something else (old `npm run dev`, another app) is holding the port. Find and kill it: `lsof -i :3000` / `lsof -i :5173`, then `kill <pid>`. Or change `PORT` in `.env` (server) — Vite's 5173 is hardcoded in [vite.config.ts](vite.config.ts).
- **Phone browser warns about an insecure connection.** Expected. Dev has no TLS — you're hitting plain HTTP over Tailscale. Proceed through the warning. HTTPS lands in Epic 6 deploy stories.
- **Spotify returns `400 INVALID_CLIENT` / `redirect_uri_mismatch`.** The redirect URI you're using isn't registered on the Spotify app. Either register the tailnet URL as a second Redirect URI, or connect Spotify from the Macbook at `127.0.0.1:5173` (see Spotify auth section above).

## Deployment

### Required environment variables

Create a `.env` file on the host from `.env.example` — never commit `.env`.

| Env var | Required? | Description |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | Yes | From Spotify developer dashboard |
| `SPOTIFY_CLIENT_SECRET` | Yes | From Spotify developer dashboard |
| `SPOTIFY_REDIRECT_URI` | Yes | Must match registered redirect URI exactly |
| `SESSION_SECRET` | Yes | Long random string for cookie signing |
| `APP_DOMAIN` | Yes | Public domain or tailnet hostname — required by Caddy (e.g. `bingo.example.com` or `bingo.tail-abc123.ts.net`) |
| `PORT` | No | Defaults to 3000 |
| `DB_PATH` | No | Set by compose to `/data/bangerbingo.db`; default `./bangerbingo.db` |

### Docker Compose commands

`docker compose up -d --build` starts both the `app` container and the `caddy` reverse proxy. Caddy is the sole ingress — the app is not directly reachable on the host.

```sh
# Start (build and run in background)
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build
```

### Caddy / TLS setup

Set `APP_DOMAIN` in `.env` to your public hostname (e.g. `bingo.example.com`). The domain must resolve to the host's IP before starting the stack so Caddy can complete the Let's Encrypt HTTP-01 challenge.

**Public domain (automatic TLS):** Caddy obtains and auto-renews a Let's Encrypt certificate — no operator action required. Verify with:

```sh
curl -I https://<APP_DOMAIN>/healthz
# expect: HTTP/2 200, no -k flag needed
```

**Tailnet-only hostname (self-signed TLS):** If `APP_DOMAIN` is a Tailscale hostname (e.g. `bingo.tail-abc123.ts.net`), Let's Encrypt cannot verify it. Edit `Caddyfile` and uncomment `tls internal`:

```
{$APP_DOMAIN} {
    reverse_proxy app:3000
    tls internal   # ← uncomment for tailnet hostnames
}
```

Caddy will issue a local self-signed cert. Browsers and iOS Safari will show a "Not Secure" warning; accept it once. On iOS Safari: tap **Show Details** → **visit this website**.

**HTTP → HTTPS redirect:** Caddy automatically returns a 308 redirect on port 80 when TLS is configured — no extra config needed.

**WebSocket:** `wss://{APP_DOMAIN}/ws` works automatically — Caddy 2's `reverse_proxy` upgrades WebSocket connections without extra headers.

### Data persistence

Data persists in the `bangerbingo-data` Docker named volume across rebuilds. TLS certificates persist in `caddy_data`. To wipe everything:

```sh
docker compose down -v
```

> **Warning:** `-v` deletes the `caddy_data` volume, which holds the Let's Encrypt certificate. Let's Encrypt rate-limits issuance to 5 certificates per domain per week — avoid repeated `down -v` cycles in production.

> **Note:** Secrets are never baked into the image — they are injected at runtime via `.env`.

## Branching Strategy

Trunk-based development with a single long-lived branch:

| Branch / tag | Purpose | Deploys to |
|---|---|---|
| `main` | Always deployable trunk | Staging (auto on every push) |
| `feat/<slug>` | Feature work | — (merge via Gitea PR) |
| `fix/<slug>` | Bug fixes | — (merge via Gitea PR) |
| `prod-YYYY-MM-DD-NN` | Production release tag | Prod (auto on tag push) |

There are no long-lived `develop`, `staging`, or `release` branches. Staging deploys on every push to `main`. Production deploys when a tag matching `prod-*` is pushed.

### Creating a production tag

Tags **must** match the format `prod-YYYY-MM-DD-NN` exactly — the deploy workflow validates this and will reject anything that doesn't conform.

```sh
# First release of the day
git tag prod-2026-04-13-01
git push origin prod-2026-04-13-01

# Second release same day
git tag prod-2026-04-13-02
git push origin prod-2026-04-13-02
```

`NN` is a zero-padded two-digit sequence. The deploy workflow also accepts manual dispatch with a tag input — use the same format.

### Mobile-friendly workflow

Merging a PR from the Gitea web UI on a phone triggers the staging deploy automatically. Smoke-test from your phone over tailnet immediately after merge.

## Parallel Workstreams (git worktree)

Use `git worktree` for isolated checkouts when running separate Claude agent sessions in parallel:

```sh
# Create a worktree for a feature branch
git worktree add ../bb-feat-my-feature feat/my-feature

# Work in the isolated checkout
cd ../bb-feat-my-feature
npm install          # separate node_modules
npm run dev          # separate Vite port, separate DB file
# ... Claude agent works here independently

# When done, merge and clean up
cd ../bangerbingo
git merge feat/my-feature
git worktree remove ../bb-feat-my-feature
git branch -d feat/my-feature
```

Each worktree gets its own `node_modules`, `bangerbingo.db`, and Vite dev server port. No file clobbering between concurrent agents.

## Dual-Stack Deployment (Staging + Prod)

Run both staging and production on a single LXC using compose project-name isolation and a shared Caddy reverse proxy.

### Setup

```sh
# 1. Create shared Docker network
docker network create bangerbingo-net

# 2. Start shared Caddy (edit Caddyfile.multi with your domains first)
docker compose -f docker-compose.caddy.yml up -d

# 3. Start staging
docker compose -p bb-staging --env-file .env.staging up -d --build

# 4. Start prod
docker compose -p bb-prod --env-file .env.prod up -d --build
```

### How isolation works

The `-p` (project name) flag prefixes all Docker resources:

| Resource | Staging | Prod |
|---|---|---|
| App container | `bb-staging-app-1` | `bb-prod-app-1` |
| Data volume | `bb-staging_bangerbingo-data` | `bb-prod_bangerbingo-data` |
| Caddy volume | `bb-staging_caddy_data` | `bb-prod_caddy_data` |
| Env file | `.env.staging` | `.env.prod` |

Each env file needs its own `APP_DOMAIN`, `SPOTIFY_REDIRECT_URI`, and `SESSION_SECRET`.

The shared Caddy instance (`docker-compose.caddy.yml`) routes by hostname to the correct upstream container. Neither app stack exposes ports directly — Caddy owns 80/443.

To connect app containers to the shared network, uncomment the `networks` section at the bottom of `docker-compose.yml` and remove the `caddy` service from each app stack (the shared Caddy handles TLS instead).

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
