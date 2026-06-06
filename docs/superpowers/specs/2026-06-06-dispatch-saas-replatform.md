# Dispatch — SaaS-Grade Re-Platform: Architecture & Phase Plan

- **Date:** 2026-06-06
- **Status:** Locked (north-star). Each phase below gets its own detailed plan doc and is executed one at a time.
- **Owner:** @v9dev
- **Supersedes:** the earlier "keep stack as-is / BullMQ later" stance — we are deliberately re-platforming for scale + SaaS-grade quality.

---

## 0. Why this, in one paragraph

Dispatch must run SMTP senders (nodemailer, long-lived, pooled, rate-limited) — that **requires a real server**, so we do **not** go Cloudflare-native for the core. We keep **Vue + Hono + typed RPC** (no Next.js rewrite) and re-platform the backend onto a proper, horizontally-scalable server stack. Direction was chosen after benchmarking against production OSS SaaS (Listmonk, Cal.com, Dub, Documenso, Ghost, Postal, Twenty, Formbricks, Plane) and verifying every claim against Dispatch's actual source.

## 1. Locked stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Bun** (API + worker) | one runtime everywhere |
| Package mgr / monorepo | **Bun workspaces + Turborepo** | no `turbo prune` in Docker (known lockfile bug) |
| API | **Hono + `hono/client` RPC** (internal); REST+OpenAPI only for a future public API | no gRPC, no GraphQL |
| Auth | **better-auth** (`organization` + `admin` + `apiKey` plugins) | replaces hand-rolled auth; keep existing RBAC layer on top |
| DB | **Postgres + Drizzle** (+ drizzle-kit) via `Bun.sql` | consolidates ~14 SQLite files into one FK schema |
| Queue | **BullMQ + Valkey** over **ioredis** (not `Bun.redis`) | worker = separate container; **Bull Board** dashboard |
| Object store | **R2 / S3-compatible** via `Bun.s3` | attachments, large payloads, exports |
| Edge | **Cloudflare worker — tracking only** (open/click/unsubscribe → D1) | deployed via wrangler, **not** in docker-compose |
| Encryption | **AES-256-GCM via WebCrypto** | random IV + auth tag, versioned envelope, `ENCRYPTION_KEY` + `FALLBACK_ENCRYPTION_KEY` for rotation |
| Frontend | Vue 3 SPA + Vue Router + TanStack Vue Query + **Pinia** + **VueUse**; UI = **shadcn-vue** (R3); forms = **VeeValidate + zod** (shared schemas) | |
| Config | env-only app config (zod-validated, fail-fast) + per-tenant creds via UI, encrypted | **nothing hardcoded** (R2 + R9) |
| Testing | Vitest + Vue Test Utils + **Playwright** e2e; coverage wired into CI | |
| Deploy | multi-stage Dockerfile + docker-compose (+ Caddy auto-HTTPS); multi-arch image on `v*` tags | |
| Observability | **pino** + `/health` + `/metrics` (prom-client) + Sentry (DSN-gated) | |

```
   Browser (Vue SPA, shadcn-vue) ──hono/client RPC──► API container (Bun+Hono, better-auth)
                                                          │            │            │
                                              enqueue ►  Valkey     Postgres       R2
                                              (BullMQ)    │         (Drizzle)    (Bun.s3)
                                                          ▼
                                              Worker container (Bun+BullMQ): send(nodemailer),
                                              bounces, automations, schedules
   Cloudflare edge worker (tracking only): open/click/unsubscribe → D1 ──POST /api/tracking/event──► API
```

## 2. Monorepo structure (target)

```
dispatch/
  apps/
    api/              # Bun + Hono backend; also the worker entrypoint; Drizzle schema + migrations live here
    web/              # Vue 3 SPA (shadcn-vue, Pinia, VueUse, TanStack Query, Vue Router)
    tracking-worker/  # Cloudflare Worker + D1 (edge only) — deployed via wrangler, NOT in compose
  packages/
    shared/           # shared zod schemas + inferred types (consumed by api RPC + web)
    tsconfig/         # shared tsconfig presets (optional)
  turbo.json
  package.json        # workspaces
  Dockerfile          # multi-stage; entrypoints: api | worker
  docker-compose.yml  # api, worker, postgres, valkey, minio, caddy
```

## 3. Rules alignment (CLAUDE.md R1–R9)

- **R1 TypeScript-only** — entire monorepo is `.ts`/`.tsx`; `any` only with a stated reason.
- **R2 data-driven** — things currently hardcoded as enums/unions become **DB-backed, read at runtime**: provider types & rate limits, preference types, roles & permissions, automation step types, campaign statuses, tags. Program structure (zod schemas, handlers) stays code.
- **R3 shadcn-vue** — all UI from shadcn primitives (shadcn-vue MCP available); no hand-rolled styled elements.
- **R4 migrations** — schema only via Drizzle file → `bunx drizzle-kit generate` from `apps/api/`; never hand-edit migrations.
- **R5 prove-it** — `bun typecheck` + `bun lint` (≤200 LOC enforced) clean before any "done".
- **R6 no fabrication** — verify via git/grep before claiming prior work exists.
- **R7 simplicity / R8 surgical** — minimum code; touch only what the task needs; flag (don't silently delete) pre-existing dead code.
- **R9 security structural** — every read/write tenant-scoped server-side; secrets encrypted at rest, never sent to the browser; validate at every boundary (zod).

## 4. Prioritized phases (the list)

> Order reflects: **foundation first** (the app is on an unmerged branch, not deployed, so live-vuln urgency is low). Security/compliance fixes are **folded into each phase as that slice is rebuilt** (R9 makes them structural), plus a dedicated audit gate before GA — we do not waste effort patching old code we're about to replace.

### P1 — Monorepo + Turborepo foundation `[next]`
Stand up `apps/api`, `apps/web`, `apps/tracking-worker`, `packages/shared`; Bun workspaces + Turborepo; multi-stage Dockerfile + docker-compose (Postgres + Valkey + MinIO + Caddy); Drizzle + drizzle-kit scaffold; **pino**, `/health`, `/metrics`, **zod-validated env (fail-fast)**; shadcn-vue + Pinia + VueUse in web; CI split into lint/typecheck/test/e2e/build with coverage gating + CodeQL/Trivy/gitleaks/Renovate; changesets + multi-arch release on `v*`. **No behavior change.**
**Exit:** repo builds & boots via compose; `bun typecheck`/`bun lint` green; CI green; nothing migrated yet.

### P2 — Data layer → Postgres + Drizzle
One unified, **data-driven** FK schema; migrate each domain behind existing service interfaces; SQLite→PG data-migration scripts; CI "pending-migrations" drift check; backup/restore + pool-tunable docs. **Folds in the unsubscribe/suppression key unification** (one suppression model, FK-scoped).
**Exit:** app runs on Postgres; tests green; backups documented.

### P3 — Auth → better-auth + AES-256-GCM encryption
better-auth (org/admin/apiKey) replacing `authLocalService`/`orgService`/custom api-keys, keeping the RBAC permission layer; migrate users/sessions/orgs; **AES-256-GCM (WebCrypto) field encryption** for SMTP passwords + OAuth/provider tokens with key + fallback-key rotation; `*_FILE` secret support; CSP/HSTS hardening; fail-fast on missing secrets.
**Exit:** all secrets encrypted at rest; auth on better-auth; no plaintext creds anywhere.

### P4 — Queue → BullMQ + Valkey + deliverability teeth
BullMQ + Valkey (ioredis); separate worker container; Bull Board; port proven patterns (deterministic-jobId single-flight, DLQ, per-job timeouts, limiter, missed-window catch-up, graceful shutdown, fan-out, progress→DB, admin alerts). **Deliverability blockers:** real `node:dns` domain verification + **hard send-gate** (no send from unauthenticated domain — Gmail/Yahoo bulk rules); **enforce warmup caps in the send path**; **Valkey atomic rate limiter**; bounce thresholds; webhook auto-disable + delivery history; **per-org send quotas / new-tenant quarantine**; spam-scanner → block decision.
**Exit:** durable restart-safe sending at scale; can't send from unverified domains; abuse controls live.

### P5 — R2 object storage
Uploads/attachments + large recipient payloads off local disk → R2 via `Bun.s3`; signed URLs.
**Exit:** API containers fully stateless.

### P6 — RPC + API surface + frontend types
`hono/client` RPC; shared zod schemas in `packages/shared`; refactor `web` API client; frontend component/store tests; OpenAPI drift check (generation later); `/api/v1` versioning.
**Exit:** end-to-end type safety; no hand-duplicated types.

### P7 — Admin panel + audit UI + GDPR/i18n
shadcn-vue admin views; wire `auditService` into all mutating routes + surface in admin; **GDPR/CAN-SPAM**: recipient export/erasure, tracking-event retention, enforced physical-address footer; vue-i18n base + key-drift CI (deferred, optional pre-GA).
**Exit:** admin usable; compliance basics in place.

### P8 — Security & compliance audit gate
Dedicated pass before GA: SSRF (SNS `SubscribeURL`), fail-closed webhook verification (+ confirm Mailgun/SendGrid verifiers are called everywhere, + `eventBus` import bug), preference IDOR, open redirect, constant-time secret compares, hardcoded-value scan, dependency/secret scans must pass.
**Exit:** clean security review; abuse + compliance items closed.

### P9 — Cleanup, governance & docs
Remove dead/decorative code (plugins stubs, unused services) and repo cruft; add `LICENSE` (MIT, matching package.json), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`; structured self-hosting + deliverability ops docs; publish OpenAPI as Swagger.
**Exit:** lean tree; governance complete; docs published.

## 5. SaaS-grade checklist — highlights (verified vs source)

**Confirmed release-blockers:** zero encryption at rest (P3) · console-wrapper logging, no metrics/Sentry (P1) · SQLite sprawl → Postgres (P2) · no LICENSE (P9).

**Email-specific gaps (the real "sender vs side-project" line):**
- `verifyDomain()` is fake (no DNS lookup) → must couple real DNS verify with a hard send-gate (P4).
- Open `/register` + in-memory rate limit + no CAPTCHA = spam-relay risk → CAPTCHA + per-org quotas + new-tenant quarantine (P3/P4).
- `queueWorker` `List-Unsubscribe` is non-compliant (`mailto:` + One-Click POST) → use the worker `/u/` endpoint (P4).
- Warmup computed but **never enforced** in the send path (P4).
- GDPR/CAN-SPAM: retention/erasure/export + physical-address footer (P7).

**Don't rebuild (already strong):** `rbacService` (~50 granular perms, org-scoped), `apikeys` (Argon2 + `dsp_` prefix), `bounceProcessor` (5 providers), signed outbound webhooks, configured coverage thresholds (just wire them into CI), Mailgun/SendGrid inbound verifiers (just confirm they're called).

**Do NOT build (verified over-engineering):** Stripe billing in core · schema-per-tenant · ClickHouse/Tinybird analytics · OpenTelemetry (pre pino/metrics/Sentry) · RFC-7807 migration · PR-preview infra · pre-GA i18n · self-hosting the CF tracking worker · own MTA/DKIM/IP-pool.

## 6. How we work each phase

1. Write a **detailed plan doc** for the phase (`docs/superpowers/specs/`), reviewed before coding.
2. Implement with TDD where it fits; **R5** gate (`bun typecheck` + `bun lint` clean) before "done".
3. App stays working throughout (strangler pattern) — old code is replaced slice-by-slice, never bulk-deleted upfront.
