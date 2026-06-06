# P1 — Stage 2: Dev Infrastructure Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends in a commit. Steps use `- [ ]`.

**Goal:** Add the backing infrastructure the later phases need — Postgres + Valkey + MinIO via `docker-compose`, a monorepo-correct multi-stage `Dockerfile` (api + worker targets), and a Drizzle/drizzle-kit scaffold in `apps/api` — **without touching app logic or breaking the 425/20 test baseline**. Purely additive + the Dockerfile/compose rewrite the restructure already necessitated.

**Architecture:** New files + config only. The Drizzle scaffold is wired to compose Postgres but **not imported by app code yet** (P2 builds the real schema on it). The app keeps running on `bun:sqlite`. Reconcile the PORT mismatch (config default 5500 vs old Docker 3000) → standardize on **5500**.

**Tech Stack:** docker-compose, Docker multi-stage (oven/bun), Postgres 17, Valkey, MinIO (S3-compatible), Caddy (prod profile), Drizzle ORM + drizzle-kit (Bun SQL driver).

**Out of scope (deferred):** pino logger swap + zod-validated env → fold into P2/P3 where config changes anyway (they touch running code + `logger.test.ts`). `/metrics` + Pinia → fold into P6/P7 (observability/frontend). Noted so they're not lost.

**Env vars introduced** (documented in compose; set in real `.env` by the operator — `.env*` is permission-blocked here): `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`.

---

## Task 1: Drizzle + drizzle-kit scaffold in `apps/api`

**Files:**
- Create: `apps/api/drizzle.config.ts`, `apps/api/src/db/pg/schema/index.ts`
- Modify: `apps/api/package.json` (add deps + `db:*` scripts)

- [ ] **Step 1: Add deps**
```bash
cd apps/api && bun add drizzle-orm && bun add -d drizzle-kit
```
Expected: both resolve; root `bun.lock` updated.

- [ ] **Step 2: `apps/api/drizzle.config.ts`**
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/pg/schema/index.ts',
  out: './src/db/pg/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://dispatch:dispatch@localhost:5432/dispatch',
  },
})
```

- [ ] **Step 3: `apps/api/src/db/pg/schema/index.ts`** (empty barrel — P2 fills it)
```ts
// Drizzle (Postgres) schema barrel. Tables land here in P2.
// Kept empty so drizzle-kit is wired but the app still runs on bun:sqlite.
export {}
```

- [ ] **Step 4: Add scripts to `apps/api/package.json`** (after `"test:coverage"` line)
```json
    "db:generate": "bunx drizzle-kit generate",
    "db:migrate": "bunx drizzle-kit migrate",
    "db:push": "bunx drizzle-kit push",
    "db:studio": "bunx drizzle-kit studio",
```

- [ ] **Step 5: Verify the toolchain resolves (no live DB needed for generate)**
```bash
cd apps/api && bunx drizzle-kit generate 2>&1 | tail -5
```
Expected: drizzle-kit runs and reports "No schema changes, nothing to migrate" (or creates an empty migration). No crash = scaffold valid.

- [ ] **Step 6: Confirm no regressions**
```bash
cd apps/api && bunx tsc --noEmit 2>&1 | grep -c "error TS"   # expect 52 (unchanged)
cd apps/api && bunx vitest run 2>&1 | tail -4                 # expect 425 passed / 20 skipped
```

- [ ] **Step 7: Commit**
```bash
git add apps/api/drizzle.config.ts apps/api/src/db/pg package.json bun.lock
git commit -m "build(p1): scaffold Drizzle + drizzle-kit in apps/api (unused until P2)"
```

---

## Task 2: Monorepo multi-stage `Dockerfile`

**Files:** Modify (rewrite): `Dockerfile`

- [ ] **Step 1: Replace `Dockerfile`** with a monorepo-aware build. One image, default CMD = api; worker overrides the command in compose.
```dockerfile
# syntax=docker/dockerfile:1
# Dispatch — multi-stage monorepo build (Bun workspaces).
# Default entrypoint = api; the worker service overrides CMD in docker-compose.

# ---- deps: install the whole workspace once (cached) ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/tracking-worker/package.json ./apps/tracking-worker/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# ---- web build (Vite SPA) ----
FROM deps AS web-build
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN cd apps/web && bunx vite build

# ---- runtime: api (also used by the worker service via CMD override) ----
FROM oven/bun:1 AS api
WORKDIR /app
ENV NODE_ENV=production PORT=5500
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock turbo.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# Serve the built SPA from the api (static assets)
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/api
RUN mkdir -p data logs uploads
EXPOSE 5500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:5500/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["bun", "run", "index.ts"]
```

- [ ] **Step 2: Validate the Dockerfile parses** (build not required here; compose validates in Task 3)
```bash
grep -q "FROM oven/bun:1 AS api" Dockerfile && echo "Dockerfile updated"
```

- [ ] **Step 3: Commit**
```bash
git add Dockerfile
git commit -m "build(p1): rewrite Dockerfile for the monorepo (api/worker, port 5500)"
```

---

## Task 3: `docker-compose` with Postgres + Valkey + MinIO (+ Caddy prod profile)

**Files:** Modify (rewrite): `docker-compose.yml`; Create: `docker/Caddyfile`

- [ ] **Step 1: Replace `docker-compose.yml`**
```yaml
# Dispatch — local/self-host stack. `docker compose up` brings up api+worker+postgres+valkey+minio.
# Caddy (auto-HTTPS reverse proxy) is in the `prod` profile: `docker compose --profile prod up`.
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: dispatch
      POSTGRES_PASSWORD: dispatch
      POSTGRES_DB: dispatch
    ports: ["127.0.0.1:5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dispatch"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  valkey:
    image: valkey/valkey:8-alpine
    command: ["valkey-server", "--save", "60", "1"]
    ports: ["127.0.0.1:6379:6379"]
    volumes: ["valkeydata:/data"]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: dispatch
      MINIO_ROOT_PASSWORD: dispatch-secret
    ports: ["127.0.0.1:9000:9000", "127.0.0.1:9001:9001"]
    volumes: ["miniodata:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  api:
    build: { context: ., dockerfile: Dockerfile, target: api }
    env_file: [.env]
    environment:
      NODE_ENV: production
      PORT: "5500"
      DATABASE_URL: postgres://dispatch:dispatch@postgres:5432/dispatch
      REDIS_URL: redis://valkey:6379
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: dispatch
      S3_SECRET_KEY: dispatch-secret
      S3_BUCKET: dispatch
    ports: ["5500:5500"]
    depends_on:
      postgres: { condition: service_healthy }
      valkey: { condition: service_healthy }
      minio: { condition: service_healthy }
    restart: unless-stopped

  worker:
    build: { context: ., dockerfile: Dockerfile, target: api }
    command: ["bun", "run", "index.ts"]   # P4 switches this to the BullMQ worker entrypoint
    env_file: [.env]
    environment:
      NODE_ENV: production
      ROLE: worker
      DATABASE_URL: postgres://dispatch:dispatch@postgres:5432/dispatch
      REDIS_URL: redis://valkey:6379
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: dispatch
      S3_SECRET_KEY: dispatch-secret
      S3_BUCKET: dispatch
    depends_on:
      postgres: { condition: service_healthy }
      valkey: { condition: service_healthy }
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    profiles: ["prod"]
    ports: ["80:80", "443:443"]
    volumes:
      - ./docker/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
    depends_on: [api]
    restart: unless-stopped

volumes:
  pgdata:
  valkeydata:
  miniodata:
  caddydata:
```

- [ ] **Step 2: Create `docker/Caddyfile`** (minimal reverse proxy; operator sets the domain)
```
# Set your domain; Caddy auto-provisions HTTPS. Replace :80 with your-domain.com for TLS.
:80 {
	reverse_proxy api:5500
}
```

- [ ] **Step 3: Validate compose syntax** (no daemon needed for `config`)
```bash
docker compose config >/dev/null 2>&1 && echo "compose OK" || docker compose config 2>&1 | tail -15
```
> If Docker isn't installed in this environment, skip — the operator validates on their host. The YAML must still be well-formed.

- [ ] **Step 4: Commit**
```bash
git add docker-compose.yml docker/Caddyfile
git commit -m "build(p1): docker-compose with postgres+valkey+minio (+caddy prod profile)"
```

---

## Self-Review
- **Additive guarantee:** Task 1 adds files the app doesn't import; Tasks 2–3 are deploy config. The 425/20 suite is re-asserted in Task 1 Step 6. No source logic touched.
- **PORT reconciled** to 5500 everywhere (compose, Dockerfile, healthchecks) — matches the app default.
- **Deferred & tracked:** pino, zod-env (→ P2/P3), `/metrics`, Pinia (→ P6/P7). Not dropped.
- **Drizzle is scaffold-only** — `drizzle-kit generate` proves the toolchain; the real schema + client land in P2.
