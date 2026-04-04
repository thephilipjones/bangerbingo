# Bangerbingo: Hosting & Deployment Guide

_Living document — update as infrastructure evolves._

## Overview

Bangerbingo is a Node.js app (Hono + WebSockets + Svelte 5 static frontend + SQLite). It can be deployed on any Linux server with Docker. Cloudflare Tunnel is the recommended ingress — no port-forwarding required, TLS automatic.

Domain: **bangerbingo.net**

---

## Server Requirements

Any Linux server (VPS, home server, LXC container) running:
- Docker + Docker Compose
- 1GB RAM minimum (Node app ~150MB + Docker daemon ~75MB + OS ~90MB ≈ 350MB peak; 1GB gives safe headroom)
- 4GB disk (Docker image ~200MB + app ~50MB + SQLite stays small)

---

## Cloudflare Tunnel Setup

Cloudflare Tunnel (`cloudflared`) exposes the server publicly without opening firewall ports. Home IP is never exposed; TLS is provisioned automatically.

### Install cloudflared
```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main' | tee /etc/apt/sources.list.d/cloudflared.list
apt update && apt install -y cloudflared
```

### Create tunnel (one-time)
```bash
cloudflared tunnel login
cloudflared tunnel create bangerbingo
```

### Tunnel config (`~/.cloudflared/config.yml`)
```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: bangerbingo.net
    service: http://localhost:3000
  - hostname: pre.bangerbingo.net
    service: http://localhost:3001
  - service: http_status:404
```

### Register DNS routes (one-time)
```bash
cloudflared tunnel route dns bangerbingo bangerbingo.net
cloudflared tunnel route dns bangerbingo pre.bangerbingo.net
```

### Run as system service
```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
```

**WebSocket note**: Cloudflare Tunnel passes `Connection: Upgrade` headers natively. No extra config needed.

---

## Cloudflare Access (staging gate, optional)

1. Cloudflare Zero Trust dashboard → Access → Applications → Add
2. Subdomain: `pre.bangerbingo.net`
3. Policy: Allow — email OTP — add your email + any testers
4. Free tier covers this

---

## Spotify App Registration

**Rule**: Spotify Dev Mode allows **1 Client ID per developer**. One app, multiple redirect URIs.

Register all three in your Spotify app's Redirect URI list:
- `http://127.0.0.1:5173/auth/callback` (dev)
- `https://pre.bangerbingo.net/auth/callback` (staging)
- `https://bangerbingo.net/auth/callback` (prod)

All environments share the same `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Only `REDIRECT_URI` differs per env file.

---

## Environment Variables

`.env.example` (keep in repo — no secrets):
```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
REDIRECT_URI=http://127.0.0.1:5173/auth/callback
SESSION_SECRET=
PORT=3000
NODE_ENV=development
DATABASE_PATH=./bangerbingo.db
```

| Env | `REDIRECT_URI` | `PORT` | `NODE_ENV` | `DATABASE_PATH` |
|-----|----------------|--------|------------|-----------------|
| Dev | `http://127.0.0.1:5173/auth/callback` | 3000 | development | `./bangerbingo.db` |
| Staging | `https://pre.bangerbingo.net/auth/callback` | 3001 | production | `/app/data/bangerbingo.db` |
| Prod | `https://bangerbingo.net/auth/callback` | 3000 | production | `/app/data/bangerbingo.db` |

Actual `.env.staging` and `.env.prod` files live on the server only, never in the repo.

---

## Docker

### Dockerfile
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
ENV NODE_ENV=production
CMD ["node", "dist/server/index.js"]
```

### docker-compose.staging.yml
```yaml
services:
  app:
    build: .
    ports:
      - "3001:3001"
    env_file: .env.staging
    volumes:
      - bangerbingo_staging_data:/app/data
    restart: unless-stopped

volumes:
  bangerbingo_staging_data:
```

### docker-compose.prod.yml
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env.prod
    volumes:
      - bangerbingo_prod_data:/app/data
    restart: unless-stopped

volumes:
  bangerbingo_prod_data:
```

---

## Deployment

### Build
```bash
npm run build
# outputs: dist/client/ (static assets) + dist/server/ (node entrypoint)
```

### Deploy staging
```bash
git pull
npm run build
docker compose -f docker-compose.staging.yml up -d --build
```

### Deploy prod
```bash
git pull
npm run build
docker compose -f docker-compose.prod.yml up -d --build
```

`DATABASE_PATH` points to `/app/data/bangerbingo.db` in staging/prod — inside the named Docker volume, so the database survives container rebuilds.

---

## Dev Environment (laptop)

No Docker needed for local development.

```bash
npm run dev   # tsx watch (server on :3000) + Vite HMR (client on :5173) in parallel
```

Spotify OAuth redirect must be `http://127.0.0.1:5173/auth/callback` (not `localhost` — Spotify removed localhost redirects Nov 2025).

For OAuth testing against a live Spotify callback without a full deploy:
```bash
cloudflared tunnel --url http://127.0.0.1:5173
# Cloudflare prints a temporary *.trycloudflare.com URL
# Add it temporarily as a redirect URI on your Spotify app
```

---

## Philip's Setup: Proxmox + Ansible

_This is one way to run the above. Skip if deploying elsewhere._

**Infrastructure**: Dedicated Debian 12 LXC container on a Proxmox hypervisor (1 vCPU, 1GB RAM, 4GB disk). Isolated from existing services on the host. cloudflared runs natively in the LXC; the app runs in Docker inside it.

**Automation**: Infrastructure is managed via Ansible (separate repo). The process is phased because `cloudflared tunnel login/create` requires a one-time interactive browser step.

### Phase 1 — Ansible (provision)
- Create LXC on Proxmox (`community.general.proxmox`)
- Install Docker + cloudflared

### Phase 2 — Manual (one-time, on the LXC)
- `cloudflared tunnel login` + `cloudflared tunnel create bangerbingo`
- Store credentials JSON in Ansible vault; record tunnel ID in Ansible vars

### Phase 3 — Ansible (configure + deploy)
- Template `~/.cloudflared/config.yml` from vault + vars
- Enable + start cloudflared systemd service
- Register DNS routes via Cloudflare API
- First app deploy via docker compose

---

## Epic 6 Pre-Deploy Checklist

**Server provisioning**
- [ ] Provision server (or: run Ansible phase 1 — create LXC, install Docker + cloudflared)

**One-time manual steps**
- [ ] `cloudflared tunnel login` + `cloudflared tunnel create bangerbingo`
- [ ] Register Spotify redirect URIs in Spotify app dashboard (all three)

**Configure + deploy**
- [ ] Deploy cloudflared config, start service, register DNS routes
- [ ] Set up Cloudflare Access policy for `pre.bangerbingo.net`
- [ ] Create `.env.staging` and `.env.prod` on server

**Code changes (Epic 6 stories)**
- [ ] Fix `getPlaylistTracks()` URL: `/tracks` → `/items` (src/server/music/spotify.ts:82)
- [ ] Fix `SpotifySearchResponse` interface: `tracks` → `items` (src/server/music/spotify.ts:33)
- [ ] Make SQLite path env-configurable in `src/server/db.ts`
- [ ] Write `Dockerfile`
- [ ] Write `docker-compose.staging.yml` + `docker-compose.prod.yml`
- [ ] Write `.env.example`

**Verification**
- [ ] Smoke test: host auth → create room → guest join → round → bingo
