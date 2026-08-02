# Self-Hosting Dispatch

Dispatch runs as four long-lived services — the **API** (Hono/Bun), a **BullMQ send-worker**, **PostgreSQL**, and **Valkey** (Redis-compatible) — plus an S3-compatible **object store** (MinIO locally, Cloudflare R2 / AWS S3 in production). The repo ships a `docker-compose.yml` that wires all of these together.

## Prerequisites

- **[Bun](https://bun.sh) ≥ 1.2** (for local, non-Docker development).
- **Docker + Docker Compose** (for the containerized deploy).
- A domain + TLS termination for production (the `prod` compose profile runs Caddy for automatic HTTPS).

## Quick start (Docker)

```bash
git clone https://github.com/iamjpsingh/bulk-email-sender dispatch
cd dispatch

# 1. Create your .env (see "Environment variables" below). At minimum set ENCRYPTION_KEY.
#    Generate a 32-byte base64 key:
bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"

# 2. Bring up api + worker + postgres + valkey + minio
docker compose up -d

# 3. (Production) also run the Caddy auto-HTTPS reverse proxy
docker compose --profile prod up -d
```

The API listens on `:5500`. Browse the interactive API reference at **`/docs`** (Swagger UI) and the raw spec at **`/openapi.yaml`**.

## Environment variables

Set these in a `.env` file at the repo root (compose reads it via `env_file`). The in-compose defaults point at the bundled Postgres/Valkey/MinIO; override them to use managed/external services.

### Required

| Variable | Purpose |
|---|---|
| `ENCRYPTION_KEY` | 32-byte **base64** key for AES-256-GCM encryption of secrets at rest (SMTP/provider keys, OAuth tokens, webhook secrets). Boot fails without it. |
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://dispatch:dispatch@postgres:5432/dispatch`. |
| `REDIS_URL` | Valkey/Redis connection string for BullMQ, e.g. `redis://valkey:6379`. |
| `SUPPRESSION_HASH_SECRET` | HMAC key for the GDPR suppression list (emails are stored only as salted hashes). Boot asserts it is set. |

### Object storage (S3 / R2 / MinIO)

| Variable | Purpose |
|---|---|
| `S3_ENDPOINT` | Endpoint URL, e.g. `http://minio:9000` locally or your R2/S3 endpoint. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Storage credentials. |
| `S3_BUCKET` | Bucket name. |
| `S3_REGION` | Region (e.g. `auto` for R2, `us-east-1` for AWS). |

### Optional / tuning

| Variable | Default | Purpose |
|---|---|---|
| `FALLBACK_ENCRYPTION_KEY` | — | Old key kept readable during **key rotation** — new writes use `ENCRYPTION_KEY`, reads fall back to this. |
| `TRUSTED_PROXY_HOPS` | `1` | Number of reverse-proxy hops in front of the API. Rate limiting reads the client IP this many entries from the right of `X-Forwarded-For`, defeating left-most spoofing. Set to the real depth of your proxy chain. |
| `RETENTION_DAYS` | `730` | Data-retention window for the purge job, which runs **daily at 02:00 regardless** — data older than this many days is deleted. Defaults to 730 (2 years) if unset; raise/lower to match your policy. |
| `PORT` | `5500` | API listen port. |
| `NODE_ENV` | — | Set to `production` in deploys. |
| `BASE_URL` / `FRONTEND_URL` | — | Public URLs used in links (tracking, unsubscribe, OAuth redirects). |
| `TRACKING_WORKER_URL` / `TRACKING_SYNC_SECRET` | — | Optional edge tracking worker (open/click pixel) + its sync auth. |
| `GOOGLE_*` / `MICROSOFT_*` (`CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`) | — | OAuth for the system mailer (configure via Platform Settings → System Mailer). |

> **SMTP / provider credentials are not environment variables.** They are entered in the app (Settings → SMTP / provider config), encrypted with `ENCRYPTION_KEY`, and stored server-side — never returned to the browser.

## Production deploy model

The bundled `docker-compose.yml` keeps `postgres`, `valkey`, and `minio` on `127.0.0.1`-only published ports (internal to the host) and exposes only the API on `:5500`. The `prod` profile adds **Caddy** (`docker/Caddyfile`) as an external reverse proxy that terminates TLS and routes your domain to `dispatch-api:5500`. For a managed setup, point `DATABASE_URL` / `REDIS_URL` / `S3_*` at your cloud Postgres, Valkey, and R2/S3, and drop those services from compose.

- **API** runs migrations at boot, then serves HTTP + `/health`.
- **Worker** waits for the API to become healthy (so migrations have landed), then processes the BullMQ send queue.

## Migrations & seeding

Migrations run automatically at API boot (`runMigrations`), followed by seeding of system roles, starter templates, and system settings. There is no manual migrate step in the container path. To generate a new migration during development (never hand-write one):

```bash
cd apps/api && bunx drizzle-kit generate   # after editing the Drizzle schema
```

## Backup & restore

- **Database:** `pg_dump` / `pg_restore` against `DATABASE_URL` (or a snapshot of the `pgdata` volume).
- **Object store:** mirror the bucket (e.g. `aws s3 sync` / `rclone`) to a backup target.

Encrypted secrets in the DB are only recoverable while you retain `ENCRYPTION_KEY` (and any `FALLBACK_ENCRYPTION_KEY`) — back the keys up separately and securely.

## Health & metrics

- `GET /health` — liveness/readiness (used by the compose healthcheck; the worker gates on it).
- The API logs structured startup + request lines to stdout.

## Network egress hardening (SSRF / DNS-rebinding)

Dispatch makes **outbound** HTTP calls for user-configured webhooks. The application already guards these (blocks private/reserved/loopback/link-local/metadata addresses, pins the resolved public IP for `http`, and refuses redirects into internal hosts). The robust defense-in-depth control is at the network layer: **firewall the API and worker containers' egress** so they cannot reach `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (incl. the `169.254.169.254` cloud metadata endpoint), or other internal ranges. This closes DNS-rebinding TOCTOU windows that an app-level guard cannot fully cover for `https` (TLS SNI prevents connection-time IP pinning).
