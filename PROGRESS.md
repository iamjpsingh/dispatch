# Dispatch — SaaS Re-platform Progress

_Branch: `feat/saas-replatform` — pushed to `origin`._
_Baseline: `bun typecheck` = 49 pre-existing errors (held flat all session), backend suite
**710 passed / 28 skipped** (gated nets: `RUN_QUEUE_IT=1` for Valkey, `RUN_STORAGE_IT=1` for
MinIO), app boots on real Postgres + Valkey + MinIO. **No `bun:sqlite` anywhere — sqlite fully
retired. API container is stateless — no local-disk user state (uploads parsed in memory,
send-logs in Postgres).**_

> ⚠️ This file was previously stale (it predated the re-platform decision and said "keep
> SQLite / don't use BullMQ"). That guidance is **superseded** — the locked plan is the full
> SaaS re-platform P1–P9. See `docs/superpowers/specs/` for the master + per-phase specs.

---

## ✅ Done

### P1 — Monorepo + Turborepo foundation
Workspaces (`apps/api`, `apps/web`, shared packages), Turborepo, Docker/compose scaffold.

### P2 — Data layer → Postgres + Drizzle (COMPLETE)
Every durable domain moved off bun:sqlite onto **async Drizzle / Postgres** with real FKs,
net-first (PGlite) + adversarially reviewed. Sub-stages P2.1–P2.8:
identity/auth/rbac · contacts/segments · campaigns/templates · deliverability controls ·
automations · analytics/scoring/routing/warmup/sending-domains · webhooks/plugins/forms/pages/rss ·
whatsapp/audit/teams + admin platform queries · systemSettings (cache).
- 9 migrations `0000–0006` validated on **real Postgres 17**.
- Old SQLite db layer **deleted** (`src/db/connection.ts`, `migrate.ts`, migrations 001-006);
  `src/db` is Postgres-only.
- Test infra fix: `freshDbMigrated` migrates once per file into a PGlite template + clones →
  suite **20 min → ~2 min**, no more hook-timeout flakiness.

### P3 — Secret encryption + auth hardening (COMPLETE)
Scope: **harden existing + AES-256-GCM** (better-auth **deferred** — custom argon2id auth is
already secure + tested; better-auth is a feature add, not a security fix).
- `src/utils/crypto.ts` — AES-256-GCM, versioned key-id envelope, random IV, rotation via
  `FALLBACK_ENCRYPTION_KEY`, boot fail-fast `assertEncryptionKey()`.
- **Every server-side secret encrypted at rest**: whatsapp access_token, webhook secret,
  system-mailer OAuth config, oauth_* client secrets, cloudflare_oauth, webhook signing keys.
- Auth hardening verified already present (login/register rate-limited; cookie httpOnly+secure+sameSite).
- `ENCRYPTION_KEY` (+ optional `FALLBACK_ENCRYPTION_KEY`) required in compose/env.

---

### P4 — Queue → BullMQ/Valkey + deliverability teeth (COMPLETE)
The 1,633-LOC sqlite queue + the sqlite scheduler + the sqlite apikeys store are **deleted**;
the `bun:sqlite` shim is gone. Plan: `docs/superpowers/plans/2026-06-07-p4-queue-migration.md`.
Built in green increments A–E, each net-first + committed:
- **A Foundation** — `bullmq`+`ioredis`, `REDIS` config, redis factory, boot refactor (worker
  start out of `app.ts` import).
- **B Suppression→PG** — `suppressionStore` (async); suppression path async end-to-end; bounces
  write `suppression_list`.
- **C BullMQ core** — `queueStore` (PG mirror) · `sendQueue` (per-batch producer) · `evaluateGates`
  (suppression→frequency→preferences→graymail, **org-scoped**) · `processSendBatch` · separate
  `worker.ts` process + shared `boot()` · async `queueEngine` over BullMQ/PG. **SQLite queue deleted.**
- **D Scheduler→BullMQ** — `scheduled_jobs` + `cron_pattern`/`is_repeating` (migration 0007);
  `schedulerService` on PG + BullMQ delayed jobs; scheduled sends route through the unified send queue.
- **E apikeys→PG + cutover** — `api_keys` table (migration 0008) + `apiKeyService` (argon2id, org-scoped);
  **`bun:sqlite` shim + `better-sqlite3` removed.**
- **Adversarial review** (40-agent workflow) ran over the whole change set → found + fixed 14 real
  bugs incl. release-blockers (SMTP-credential leak via scheduled-jobs, IDOR on job control,
  cross-tenant dead-letter PII, pause→resume recipient loss, stuck-job-on-failure, migration race).

Locked forks: BullMQ = live queue / Postgres = durable history mirror; enforcement runs **send-time**.
Sending runs in the `worker` compose service (`bun run worker.ts`); the api process only enqueues.
Gated Valkey nets: `RUN_QUEUE_IT=1 bunx vitest run` (sendQueue, worker-e2e, schedulerService).

---

### P5 — Object storage (R2/S3) + full statelessness (COMPLETE)
Plan: `docs/superpowers/plans/2026-06-08-p5-object-storage.md`. Built subagent-driven in green,
reviewed increments (spec + quality review each; P5.3 also adversarial R9; final whole-impl review):
- **P5.1 storageService** — `@aws-sdk/client-s3` + `s3-request-presigner`, lazy S3 client (`forcePathStyle`
  for MinIO/R2), `STORAGE` config, `put`/`get`/`getSignedDownloadUrl`/`delete`/`ensureBucket`. Gated MinIO
  net `RUN_STORAGE_IT=1`. `boot()` calls `ensureBucket()` (tolerant) so the bucket exists on a fresh stack.
- **P5.2 in-memory parsing** — `fileService.parseExcelBuffer`/`readHtmlTemplateBuffer` (`XLSX.read(buf)`);
  the `./uploads` disk round-trip + `saveUploadedFile` are gone; all 4 upload call sites pass buffers.
- **P5.3 logService → Postgres** — org-scoped `email_logs` table (migration 0009), async service
  (`addLog(orgId,…)`/`getLogs`/`getStats`/`getLogsAsCSV`/`deleteLog`/`clearLogs`), every read/write scoped
  by a server-derived `org_id` (R9 — fixes a pre-existing cross-tenant log leak). The **dead pre-BullMQ
  sender** (`batchService`, `emailService` send-methods, `notificationService.getCampaignStats`) was
  deleted (user-approved). Adversarial R9 review: **no cross-tenant leaks**.
- **P5.4 import persistence** — `import_history.file_key` (migration 0010); contact import stores the
  original to object storage (best-effort) + records the key; owner-scoped `GET /contacts/imports/:id/file`
  returns a 15-min signed URL (404s on org mismatch before signing).
- **Statelessness:** orphaned `DIRECTORIES.UPLOADS`/`LOGS` removed; boot no longer `mkdir`s user-state dirs.

Gated MinIO net: `RUN_STORAGE_IT=1 bunx vitest run tests/services/storageService.test.ts` (needs MinIO up).
- **P5.5 scheduled-send logging (the flagged follow-up — DONE)** — `scheduled_jobs.org_id` (nullable,
  migration 0011) persisted at schedule-time (`scheduleJob(userId, orgId, …)` ← `getOrgId(c)`);
  `schedulerProcessor` threads `row.org_id ?? null` into `queueEngine.enqueue`, so fired scheduled sends
  now write org-scoped `email_logs`. Nullable for legacy rows; `EnqueueOptions.orgId` widened to
  `string | null`. Adversarially reviewed: chain verified end-to-end, SHIP. Note: the service-layer
  assertion lives in the gated `RUN_QUEUE_IT` net (needs Valkey).
`contacts_json`→R2 and report/analytics exports→S3 remain deferred (spec §out-of-scope).

**⚠️ Flagged release-blocker (pre-existing, found by P5.5 adversarial review — NOT fixed):**
`GET /api/scheduled-jobs` returns ALL tenants' active scheduled jobs (`schedulerStore.getActive()` has no
user/org filter — `send.ts:347-350`) and `DELETE /api/scheduled-jobs/:id` cancels any tenant's job
(`cancel()` filters id+status only — `send.ts:352-360`): cross-tenant read + IDOR on job control.
Predates P5; must be fixed no later than the P8 security gate.

---

### P6 — RPC + API surface + frontend types (COMPLETE)
Strangler migration, domain-by-domain; gate held green at every commit (api tsc **49** frozen
baseline, web own-src **≤ 33**, backend **739 / 0 / 28**, web lib **41 / 0**).
- **API surface — all 25 route modules** restructured from `const app = new Hono()` + scattered
  `app.method()` statements into one fluent `new Hono().get(...).post(...)` chain, each exporting
  `export type <Domain>Routes = typeof <chain>`. **Per-domain types** (not one global `AppType`) to
  avoid the tsc perf cliff. Endpoint registration order preserved 1:1 (static-vs-`:param` matching).
- **Validation** — `validateBody(c, S)` → bare 2-arg `zValidator('json', S)` + `c.req.valid('json')`.
  Only the bare form preserves RPC request inference (wrapping it / passing a typed hook erases it).
  Secret/signature-verified endpoints (tracking sink, provider webhooks, WhatsApp/Meta) KEEP their
  manual `safeParse`-after-auth flow so validation never front-runs the fail-closed check.
- **Versioning** — every route dual-mounted under `/api` and `/api/v1` via a version-normalized auth
  middleware (`app.ts`). RPC client targets `/api/v1`.
- **Schemas** — lifted to `@dispatch/shared/<domain>` for the batch-1/2 web-backed domains; kept
  in-file for route-only domains (web imports the route *type*, not the schemas — YAGNI per R7).
- **Frontend — all 13 web modules** on `hc<…Routes>(rpcBase(), { fetch: rpcFetch })` with the
  `{success,data?}` envelope rule and typed `body.data as X` (no `(body as any)`). Multipart, file
  download, and manually-parsed (unvalidated-body) endpoints use the `rpcFetch` fallback. Pre-existing
  web↔schema type drift bridged with named `InferRequestType` casts (flagged, reconcile post-P6).
- **Teardown** — the legacy `ApiClient` class + `api` singleton retired; `lib/api/client.ts` reduced
  to shared types; obsolete ApiClient unit tests removed. **Drift guard** `tests/routes/rpc-surface.test.ts`
  asserts every route module exports a `typeof`-based `*Routes` type from a fluent chain.
- Execution: foundation + auth pilot, then batches 1–4 (config/templates/pages/forms → contacts/
  campaigns/analytics → segments/automations/apikeys/warmup/routing → send/queue/dashboard/report/
  admin/whatsapp/oauth/plugins/webhooks/tracking/events/cloudflare). Larger/late domains migrated by
  serial self-committing subagents; each verified independently (gate + commit provenance).

**Tracked P6 debt (non-blocking, carried forward):**
- **#25** web `vue-tsc -b` deep-checks api `.ts` source through the `@dispatch/api/*` path alias, so
  api's pre-existing baseline errors surface as a "leak" — the gate is therefore **web-own-src ≤ 33**
  (api-source lines excluded), consistent with the api 49-baseline model.
- **#26** `zValidator` returns the raw ZodError shape `{success:false,error}` on 400, not the friendly
  `{success,message}` envelope; validation tests assert status-only (`400` + `success:false`).
- Enum/shape drift bridged at the web boundary (campaign `type`, segment `type`, apikey scopes,
  automation/whatsapp inputs) — reconcile the web vs schema vocabularies in a later pass.
- **Pre-existing bugs surfaced by typing (NOT fixed, R8 — for P7/P8):** `admin POST /admin/teams`
  missing `await` on `teamService.create`; `webhooks.ts` inbound-reply handlers reference an
  unimported `eventBus`; web `email.ts` `sendTestEmail`/`checkSpamScore` hit dead `/send-test`·
  `/spam-check` paths.

---

## 🧹 Housekeeping
- Commits from `85ea5d5` onward are **unsigned** (GPG agent timed out mid-session). Re-sign with
  `git rebase --exec 'git commit --amend --no-edit -S' <base>..HEAD` once the agent is unlocked.
- **Deferred (documented):** better-auth (OAuth/verification/plugins), `d1UserDatabase` SMTP-config
  secrets (Cloudflare D1 over HTTP, not local PG), Valkey-backed rate-limiting (opportunistic in P4).

## 🧭 Resume pointers
- **Next phase: P7** (Admin panel + audit UI + GDPR/i18n). P1–P6 complete.
- Phase specs: `docs/superpowers/specs/`; plans: `docs/superpowers/plans/`.
- Auto-loaded memory: `MEMORY.md` → `dispatch-p5-status.md` (P5 done) + `dispatch-session-status.md`.
- Run the gated nets with the deps up: `RUN_QUEUE_IT=1` (Valkey), `RUN_STORAGE_IT=1` (MinIO);
  default `bun test` runs without them.
