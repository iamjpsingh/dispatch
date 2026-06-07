# Dispatch — SaaS Re-platform Progress

_Branch: `feat/saas-replatform` — pushed to `origin` (HEAD `2431fd2`)._
_Baseline: `bun typecheck` = 49 pre-existing errors (held flat all session), backend suite
**714 passed / 20 skipped**, app boots on real Postgres. Suite runs in ~2 min._

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

## ▶️ Next — P4 (DESIGNED, implementation not started)

**Spec:** `docs/superpowers/specs/2026-06-07-p4-queue-bullmq-deliverability-design.md`.
Replace the 1,633-LOC sqlite queue with **BullMQ on Valkey** + a separate worker process,
add **send-time deliverability enforcement** (suppression / frequency cap / graymail), and
retire the last bun:sqlite users. Decomposed:
- **P4.1** BullMQ/Valkey infra + rewrite `queueEngine` behind its existing interface; separate worker process.
- **P4.2** Send-time teeth in the worker; bounces/complaints/unsubscribes write `suppression_list`.
- **P4.3** Scheduler → BullMQ repeatable/delayed jobs.
- **P4.4** Migrate `apikeys` (own sqlite) → Postgres, then **delete the bun:sqlite shim** (final cutover).

Locked forks: BullMQ = live queue / Postgres = durable history mirror; enforcement runs **send-time**.
Remaining bun:sqlite holdouts (expected, retired in P4): `queueDatabase`, `queueWorker`,
`schedulerService`, `routes/apikeys.ts`.

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
