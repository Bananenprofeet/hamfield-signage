# Cloud server deployment guide

This guide deploys the full Hamfield Signage platform to a single cloud Linux
server using Docker Compose, with HTTPS and automatic TLS. It is production
oriented: real secrets, no public database ports, automatic certificate renewal,
external object storage (Cloudflare R2), and backups.

For local development use the [README](../README.md) quick start instead. For the
device/player side see [device-install.md](device-install.md).

---

## 0. How configuration works (read this first)

The compose and reverse-proxy files come in two flavours:

| Committed template (in git)                       | Real file you create (git-ignored)         |
| ------------------------------------------------- | ------------------------------------------- |
| `docker-compose.example.yml`                      | `docker-compose.yml`                        |
| `infra/docker/docker-compose.prod.example.yml`    | `infra/docker/docker-compose.prod.yml`      |
| `infra/docker/Caddyfile.example`                  | `infra/docker/Caddyfile`                    |

The real files contain your secrets and host-specific values, so they are
**git-ignored** (see `.gitignore`) and never committed. You create them by
copying the templates and editing the values marked `# ❗CHANGE`. The
`git pull` in [§9](#9-updates--redeploys) updates the templates and your code,
but never touches your real files.

> Everything you must edit is marked `# ❗CHANGE` (or `# ❗R2`) inside the files.
> The single most important rule: **the Postgres password appears in two
> places** — `POSTGRES_PASSWORD` and inside `DATABASE_URL` — and they must be
> identical. A mismatch is the classic `P1000: Authentication failed` /
> `migrate exited 1` failure.

---

## 1. Architecture & topology

Everything runs as containers on one host, on a private Docker network. Only the
**reverse proxy** is exposed to the internet. Object storage is external
(Cloudflare R2), reached by browsers directly.

```
                       ┌──────────────────── your server ────────────────────┐
   Internet            │                                                      │
   ────────            │   caddy (TLS :80/:443)                               │
   dashboard ─────────▶│     └─ signage.example.com → web:80 ─┬─ SPA          │
   devices   ──HTTPS──▶│                                      └─ /api/ → api  │
             ──WSS────▶│                                          (REST + WS) │
                       │   api ─ worker ─ postgres ─ redis   (internal only)  │
                       └──────────────────────────────────────────────────────┘
                                          ▲
   media URLs ────────────────────────────┘  browsers fetch presigned objects
   (browser) ──────────────────────────▶  Cloudflare R2  (external)
```

Key points:

- The **web container already proxies `/api/` to the API**, including the device
  WebSocket upgrade. So the dashboard, the REST API, and the device connections
  are all **one domain** (`signage.example.com`). Devices are configured with
  `--server https://signage.example.com` and talk out over HTTPS + WSS only.
- Media (thumbnails, previews, logos, video) lives in **Cloudflare R2**. The
  dashboard loads it via short-lived **presigned URLs** that point at the R2
  endpoint, so browsers reach R2 directly — there is **no media domain** and no
  MinIO container to run or back up.
- Devices download media **through the API**, not from R2 directly.

Containers:

| Service    | Role                                          | Public? |
| ---------- | --------------------------------------------- | ------- |
| `caddy`    | TLS reverse proxy (from the prod override)    | **yes** |
| `web`      | nginx serving the SPA + proxying `/api/`      | no      |
| `api`      | Fastify REST API + device WebSocket           | no      |
| `worker`   | BullMQ media processing (FFmpeg)              | no      |
| `postgres` | PostgreSQL 16 database                        | no      |
| `redis`    | Redis (job queue)                             | no      |
| `migrate`  | one-shot `prisma migrate deploy` on startup   | no      |

> Using self-hosted MinIO instead of R2? See [§6](#6-object-storage-alternatives).

---

## 2. Prerequisites

- A cloud VM (Ubuntu 22.04/24.04 LTS or similar). Suggested minimum:
  **2 vCPU / 4 GB RAM / 40 GB disk**. Video transcoding is CPU-heavy — size up if
  you process many/large videos concurrently (and see `WORKER_CONCURRENCY`).
- A domain you control, with access to its DNS settings.
- A **Cloudflare R2** bucket plus an R2 API token (access key id + secret).
- Ports **80** and **443** open to the internet in your cloud firewall /
  security group. Nothing else needs to be public.
- `git`, Docker Engine, and the Docker Compose plugin installed:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in afterwards
docker compose version            # verify the plugin is present
```

---

## 3. DNS record

Point your domain at the server before requesting certificates. Replace
`signage.example.com` with your domain and `203.0.113.10` with your server's IP.

| Type | Name (host)           | Value          | TTL | Purpose                      |
| ---- | --------------------- | -------------- | --- | ---------------------------- |
| `A`  | `signage.example.com` | `203.0.113.10` | 300 | Dashboard + API + device WSS |

Notes:

- **IPv6:** if your server has a public IPv6 address, add a matching `AAAA`
  record (same name, the `2001:db8::…` address).
- **Cloudflare users:** set the record to **DNS only (grey cloud)** for the first
  certificate issuance. The orange-cloud proxy intercepts HTTP-01 validation and
  can also break the device WebSocket; only re-enable proxying after TLS works,
  and if you do, enable WebSockets and a matching SSL mode.
- Verify propagation before continuing (it can take minutes to hours):

```bash
dig +short signage.example.com   # must return your server IP
```

Certificates are issued automatically by Caddy via Let's Encrypt once this
record resolves to the server and ports 80/443 are reachable.

---

## 4. Get the code

```bash
git clone https://github.com/Bananenprofeet/hamfield-signage.git
cd hamfield-signage
```

---

## 5. Create your config from the templates

Copy the three templates to their real (git-ignored) filenames:

```bash
cp docker-compose.example.yml docker-compose.yml
cp infra/docker/docker-compose.prod.example.yml infra/docker/docker-compose.prod.yml
cp infra/docker/Caddyfile.example infra/docker/Caddyfile
```

Now edit them. **Everything you must change is marked `# ❗CHANGE` / `# ❗R2`.**

### 5a. `docker-compose.yml` (base) — remove MinIO

This deployment uses R2, so delete the bundled MinIO:

1. Delete the `minio:` and `minio-setup:` services.
2. Remove the `minio-setup:` entry from the `depends_on:` of **both** `api` and
   `worker`.
3. Remove `minio-data:` from the bottom `volumes:` list.

(If you prefer, just copy the structure of `docker-compose.yml` as already
shipped in this repo's real file — it has MinIO removed.)

### 5b. `infra/docker/docker-compose.prod.yml` (production values & secrets)

This file holds everything sensitive. Edit the two anchors at the top plus the
marked values:

```yaml
# Postgres password — appears here AND in POSTGRES_PASSWORD below; keep identical.
x-database-url: &database-url postgresql://signage:STRONG_DB_PASSWORD@postgres:5432/signage

# Cloudflare R2 — from R2 → "Manage R2 API Tokens". Region is literally "auto".
x-r2-credentials: &r2-credentials
  S3_ENDPOINT: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  S3_REGION: auto
  S3_BUCKET: signage-media
  S3_ACCESS_KEY: <R2_ACCESS_KEY_ID>
  S3_SECRET_KEY: <R2_SECRET_ACCESS_KEY>
  S3_FORCE_PATH_STYLE: "true"
```

And in the `api` / `postgres` services:

- `POSTGRES_PASSWORD` — the **same** password as in `x-database-url`.
- `API_PUBLIC_URL` and `CORS_ORIGINS` — `https://signage.example.com` (your domain).
- `JWT_SECRET` — a fresh value: `openssl rand -hex 32`.
- `S3_PUBLIC_ENDPOINT` — for R2 this is the **same** account endpoint as
  `S3_ENDPOINT`.
- `INITIAL_SUPERADMIN_EMAIL` / `INITIAL_SUPERADMIN_PASSWORD` /
  `INITIAL_SUPERADMIN_NAME` — your first login (password ≥ 12 chars; change it
  after first login).

> Why both `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT`? `S3_ENDPOINT` is used
> server-side (uploads/deletes); `S3_PUBLIC_ENDPOINT` is baked into the presigned
> URLs handed to browsers. For R2 both are the R2 account endpoint, so the
> presigned signature validates when the browser fetches the object.

### 5c. `infra/docker/Caddyfile` (TLS reverse proxy)

- Replace `app.example.com` with your real domain.
- Replace the `email` with a real address (Let's Encrypt expiry notices).

### 5d. Cloudflare R2 setup

1. Create the bucket (default name `signage-media`, or set `S3_BUCKET` to match).
2. Create an **R2 API token** (Object Read & Write) → copy the Access Key ID and
   Secret Access Key into the `x-r2-credentials` anchor.
3. Add a **CORS policy** on the bucket allowing `GET` from your dashboard origin,
   so browsers can fetch presigned object URLs:

   ```json
   [
     {
       "AllowedOrigins": ["https://signage.example.com"],
       "AllowedMethods": ["GET"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

---

## 6. Object storage alternatives

R2 is the recommended default above. Two alternatives:

- **Other managed S3** (AWS S3, Backblaze B2, …): same as R2, but set
  `S3_ENDPOINT`/`S3_PUBLIC_ENDPOINT` to the provider's endpoint and
  `S3_FORCE_PATH_STYLE` per their docs (most virtual-hosted providers use
  `false`). Ensure bucket CORS allows `GET` from the dashboard origin.
- **Self-hosted MinIO:** keep the `minio` / `minio-setup` services from
  `docker-compose.example.yml`, add a second `media.example.com` site to the
  Caddyfile that `reverse_proxy minio:9000` (Caddy preserves the `Host` header so
  presigned signatures validate), add a matching DNS `A` record, and point
  `S3_ENDPOINT=http://minio:9000` / `S3_PUBLIC_ENDPOINT=https://media.example.com`.
  Back up the `minio-data` volume.

---

## 7. Bring the stack up

Use both compose files — the base plus the production override:

```bash
docker compose \
  -f docker-compose.yml \
  -f infra/docker/docker-compose.prod.yml \
  up -d --build
```

This builds the images, starts postgres/redis, runs the `migrate` service
(`prisma migrate deploy`, applies all pending migrations), then starts the API,
worker, web, and Caddy. On first start Caddy requests a TLS certificate.

Tip: define a shell alias so you do not repeat the `-f` flags:

```bash
alias dc='docker compose -f docker-compose.yml -f infra/docker/docker-compose.prod.yml'
dc ps
dc logs -f caddy   # watch TLS issuance
```

---

## 8. Verify

```bash
# Containers healthy?
dc ps

# API health (through the public domain):
curl -fsS https://signage.example.com/api/v1/health     # -> {"status":"ok",...}

# Migrations applied?
dc exec api node packages/database/node_modules/prisma/build/index.js \
  migrate status --schema packages/database/prisma/schema.prisma
```

Then in a browser:

1. Open `https://signage.example.com` — the dashboard loads over HTTPS.
2. Log in with the `INITIAL_SUPERADMIN_*` credentials. (Public sign-up is
   disabled by design — accounts are created by a superadmin.) **Change the
   password after first login.**
3. Create an organization and a user, upload media (confirms R2 + transcoding),
   and build a playlist.
4. Add a screen to get a pairing code, then provision a device pointing at
   `https://signage.example.com` per [device-install.md](device-install.md).

If superadmin bootstrap did not run (e.g. the env vars were empty at first
start), create one over the CLI:

```bash
dc exec api node apps/api/dist/cli/create-superadmin.js admin@example.com 'StrongPass12+' 'Platform Admin'
```

---

## 9. Updates & redeploys

```bash
cd hamfield-signage
git pull                  # updates code + templates; leaves your real files alone
dc up -d --build          # rebuilds changed images; migrate applies new migrations
docker image prune -f     # optional: reclaim old image layers
```

If a `git pull` changes a template (`*.example.*`), re-check whether you need to
mirror the change into your real file.

Migrations are additive and run automatically via the one-shot `migrate` service
on every `up`. To apply them manually instead: `dc run --rm migrate`.

---

## 10. Backups

With R2, object storage durability is handled by Cloudflare — you only need to
back up **PostgreSQL** (all metadata). Also keep a copy of your three git-ignored
config files somewhere safe (they hold your secrets).

```bash
# PostgreSQL logical dump (run via cron; store off-box)
dc exec -T postgres pg_dump -U signage signage | gzip > "backup-$(date +%F).sql.gz"

# Restore into a fresh database
gunzip -c backup-YYYY-MM-DD.sql.gz | dc exec -T postgres psql -U signage signage
```

(If you self-host MinIO instead of R2, also back up the `minio-data` volume.)

---

## 11. Security hardening checklist

- [ ] `JWT_SECRET` is a fresh `openssl rand -hex 32` value.
- [ ] `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` match and are strong.
- [ ] R2 API token is scoped to the one bucket; secret stored only in the
      git-ignored prod override.
- [ ] Cloud firewall exposes **only 80/443**; the prod override removes all other
      host port mappings.
- [ ] `INITIAL_SUPERADMIN_PASSWORD` is strong (≥ 12 chars) and rotated after first
      login.
- [ ] The three real config files are `chmod 600` and never committed.
- [ ] HTTPS works and certificates auto-renew (`dc logs caddy`).
- [ ] R2 bucket CORS allows `GET` from your dashboard origin only.
- [ ] `CORS_ORIGINS` lists only your real dashboard origin(s).
- [ ] OS auto-updates enabled; backups run on a schedule and a restore tested.

---

## 12. Operations notes

- **Logs:** `dc logs -f api` (or `worker`, `web`, `caddy`). The API logs JSON in
  production.
- **Transcoding throughput:** raise `WORKER_CONCURRENCY` for more parallel FFmpeg
  jobs (needs CPU), or run the worker on a bigger box.
- **Restart policy:** the override sets `restart: unless-stopped`, so the stack
  comes back after a reboot.
- **Scaling out:** this is a single-host design. To scale, move PostgreSQL/Redis
  to managed services (object storage is already external) and run multiple
  `api`/`worker` replicas behind the proxy; the app is stateless apart from those
  backing services.

---

## 13. Troubleshooting

| Symptom                                   | Likely cause / fix                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate` exits 1, `P1000` in `dc logs migrate` | **Password mismatch.** `POSTGRES_PASSWORD` ≠ the password inside `DATABASE_URL`. Note the DB password is baked into the `postgres-data` volume on first creation — if you changed it later, either set the URL to the original password or recreate the volume (`dc down -v`, **destroys data**) on a fresh install. |
| api/web/caddy stuck in `Created`          | They `depends_on` `migrate` completing — fix the migrate failure above, then `dc up -d`.                                                                                                   |
| Caddy cannot get a certificate            | DNS not pointing at the server yet, or 80/443 blocked by the cloud firewall, or Cloudflare orange-cloud proxy on. Check `dig` and `dc logs caddy`.                                          |
| `curl` returns 521 / "web server is down" | Cloudflare can't reach the origin — Caddy/api not up yet (see above), or orange-cloud proxy before TLS works. Set the record to DNS-only until certs issue.                                |
| Dashboard loads but thumbnails are broken | `S3_PUBLIC_ENDPOINT` wrong, or R2 bucket CORS doesn't allow `GET` from the dashboard origin, or `S3_FORCE_PATH_STYLE` wrong for your provider.                                             |
| Devices connect over HTTP but not WSS     | Reverse proxy not forwarding the WebSocket upgrade. The bundled nginx + Caddyfile do this; a Cloudflare orange-cloud proxy may not — enable WebSockets or use DNS-only.                     |
| API exits immediately on first start      | `JWT_SECRET` left at the placeholder while `NODE_ENV=production` — set a real one.                                                                                                         |
| Login fails right after deploy            | No superadmin was bootstrapped — run the `create-superadmin` CLI in [§8](#8-verify).                                                                                                       |
