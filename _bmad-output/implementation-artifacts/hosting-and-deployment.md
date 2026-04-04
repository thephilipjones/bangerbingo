# Bangerbingo: Hosting & Deployment Guide

_Living document — update as infrastructure evolves._

## Overview

Personal-use app hosted on a home Proxmox hypervisor. Three environments: dev (laptop), staging (LXC), prod (LXC). Cloudflare Tunnel handles ingress — no router port-forwarding, home IP hidden, TLS automatic.

Domain: **bangerbingo.net**

---

## Infrastructure

### Proxmox Setup
- Existing VM: other Docker services via Traefik + Cloudflare DNS (philipjones.app) — **do not touch**
- Bangerbingo: dedicated LXC container (isolated from existing stack)

### LXC Specs
```
OS: Debian 12 (consistent with existing Ansible repo)
CPU: 1 vCPU
RAM: 1GB  (OS ~90MB + Docker daemon ~75MB + Node app ~150MB ≈ 350MB peak; 1GB gives safe headroom)
Disk: 4GB (Node image ~160MB + app ~50MB + SQLite stays small)
Packages: node 22, git, docker, cloudflared
```

### Ports (inside LXC)
| Env | Port |
|-----|------|
| Prod | 3000 |
| Staging | 3001 |

---

## Domains (bangerbingo.net → Cloudflare)

| Env | Hostname |
|-----|----------|
| Prod | `bangerbingo.net` |
| Staging | `pre.bangerbingo.net` |

Both routes defined in cloudflared tunnel config (YAML on the LXC, not in repo).

---

## Cloudflare Tunnel Setup

### Install cloudflared (on the LXC)
```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main' | tee /etc/apt/sources.list.d/cloudflared.list
apt update && apt install -y cloudflared
cloudflared tunnel login
cloudflared tunnel create bangerbingo
```

### Tunnel config (`~/.cloudflared/config.yml` on LXC)
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

### DNS (run once to register routes)
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

**WebSocket note**: Cloudflare Tunnel passes `Connection: Upgrade` headers natively. No extra proxy config needed for WebSockets.

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

Actual `.env.staging` and `.env.prod` files live on the LXC only, never in the repo.

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

### Deploy staging (on LXC)
```bash
git pull
npm run build
docker compose -f docker-compose.staging.yml up -d --build
```

### Deploy prod (on LXC)
```bash
git pull
npm run build
docker compose -f docker-compose.prod.yml up -d --build
```

### SQLite persistence
`DATABASE_PATH` env var is read in `src/server/db.ts`. For staging/prod it points to `/app/data/bangerbingo.db` — inside the named Docker volume, so the database survives container rebuilds.

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

## Automation (Ansible)

Infrastructure setup is scripted via Ansible (separate repo). The process is phased — not all steps are automatable without manual prerequisites in the middle.

### Phase 1 — Ansible (initial provisioning)
- Create LXC on Proxmox (`community.general.proxmox`)
- Install Node 22 + git + Docker + cloudflared

### Phase 2 — Manual (one-time, on the LXC)
- `cloudflared tunnel login` — browser OAuth; produces a credentials JSON file
- `cloudflared tunnel create bangerbingo` — produces the tunnel ID
- Store credentials file in Ansible vault; record tunnel ID in Ansible vars

### Phase 3 — Ansible (configure + deploy)
- Template `~/.cloudflared/config.yml` from vault credentials + tunnel ID var
- Enable + start cloudflared systemd service
- Register DNS routes via Cloudflare API
- Deploy app: git clone + build + docker compose up

### What stays manual (not worth scripting)
- Spotify redirect URIs — no Spotify API for Dev Mode app management
- Cloudflare Access policy — configure once in Zero Trust dashboard

---

## Epic 6 Pre-Deploy Checklist

**Ansible phase 1 (provisioning)**
- [ ] Run Ansible: create LXC, install Node 22 + git + Docker + cloudflared

**Manual (on the LXC)**
- [ ] `cloudflared tunnel login` (browser OAuth)
- [ ] `cloudflared tunnel create bangerbingo` — note the tunnel ID
- [ ] Add credentials file to Ansible vault; set tunnel ID in Ansible vars
- [ ] Register Spotify redirect URIs in Spotify app dashboard (all three)

**Ansible phase 2 (configure + deploy)**
- [ ] Run Ansible: deploy cloudflared config, start service, register DNS routes
- [ ] Run Ansible: first app deploy (docker compose up)

**Manual (Cloudflare dashboard)**
- [ ] Set up Cloudflare Access policy for `pre.bangerbingo.net`
- [ ] Create `.env.staging` and `.env.prod` on LXC

**Code changes (Epic 6 stories)**
- [ ] Fix `getPlaylistTracks()` URL: `/tracks` → `/items` (src/server/music/spotify.ts:82)
- [ ] Fix `SpotifySearchResponse` interface: `tracks` → `items` (src/server/music/spotify.ts:33)
- [ ] Make SQLite path env-configurable in `src/server/db.ts`
- [ ] Write `Dockerfile`
- [ ] Write `docker-compose.staging.yml` + `docker-compose.prod.yml`
- [ ] Write `.env.example`

**Verification**
- [ ] Smoke test: host auth → create room → guest join → round → bingo
