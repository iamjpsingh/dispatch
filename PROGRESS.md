# Dispatch — SaaS Re-platform Progress

_Branch: `feat/saas-replatform` — pushed to `origin`._
_Baseline: `bun typecheck` = 49 pre-existing errors (held flat all session), backend suite
**712 passed / 24 skipped** (4 gated Valkey nets run with `RUN_QUEUE_IT=1`), app boots on real
Postgres + Valkey. **No `bun:sqlite` anywhere — sqlite fully retired.**_

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

## 🧹 Housekeeping
- Commits from `85ea5d5` onward are **unsigned** (GPG agent timed out mid-session). Re-sign with
  `git rebase --exec 'git commit --amend --no-edit -S' <base>..HEAD` once the agent is unlocked.
- **Deferred (documented):** better-auth (OAuth/verification/plugins), `d1UserDatabase` SMTP-config
  secrets (Cloudflare D1 over HTTP, not local PG), Valkey-backed rate-limiting (opportunistic in P4).

## 🧭 Resume pointers
- Phase specs: `docs/superpowers/specs/`.
- Auto-loaded memory: `MEMORY.md` → `dispatch-p3-status.md` (P2/P3 done, P4 designed) +
  `dispatch-session-status.md`.
- Run the queue integration nets (P4) with Valkey up; default `bun test` runs without it.
