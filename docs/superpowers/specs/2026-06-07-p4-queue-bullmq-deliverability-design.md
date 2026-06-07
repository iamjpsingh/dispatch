# P4 — BullMQ/Valkey Queue + Deliverability Teeth: Design

- **Date:** 2026-06-07 · **Status:** design, pending user review.
- **Parent:** docs/superpowers/specs/2026-06-06-dispatch-saas-replatform.md §P4.

## Goal

Replace the custom sqlite-backed queue (`queueDatabase` 627L + `queueEngine` 187L +
`queueWorker` 439L + `schedulerService` 380L = 1,633L on `data/queue.db`) with **BullMQ on
Valkey**, run sending in a **separate worker process**, and give deliverability real
**send-time enforcement** (suppression / frequency caps / graymail). This also retires the
last bun:sqlite users so the test shim + sqlite can finally be removed.

## Resolved architecture decisions (2026-06-07)

1. **Live queue = BullMQ/Valkey; history = Postgres.** BullMQ owns enqueue, retry/backoff,
   concurrency, and the dead-letter (failed) set in Valkey. Completed/failed jobs + dead
   letters are **mirrored into the P2.4 Postgres tables** (`jobs`, `dead_letters`,
   `scheduled_jobs`) for durable history, the existing stats/queue UI, and reporting that
   outlives a Valkey flush.
2. **Enforcement runs at send time, in the worker processor**, immediately before the
   provider call — the last gate, reflecting suppression/unsubscribe/cap changes that
   happened after enqueue. A skipped recipient is recorded (status + reason) and never sent.

## Decomposition (each sub-stage ships green + committed)

### P4.1 — Queue infrastructure (BullMQ/Valkey behind the existing interface)
- Add `bullmq` + `ioredis`. A shared Redis/Valkey connection module (`REDIS_URL`).
- Define the send queue(s): a `campaign-send` queue whose jobs are **per-batch or
  per-recipient** send units (preserve the current campaign→contacts fan-out; one BullMQ job
  per recipient batch, with `attempts` + exponential `backoff`, `removeOnComplete`/`removeOnFail`
  tuned so the PG mirror is the durable record).
- Rewrite `queueEngine` so its **public surface is unchanged** (callers in app.ts,
  routes/{campaigns,dashboard,send,queue}.ts, bounceProcessor, validationService keep working):
  `enqueue`, `pause`/`resume`/`cancel`, `getJob`/`getJobs`/`getStats`, `getDeadLetters`,
  `updateProgress`, `getActiveJobCount`/`getActiveJobIds`, `setMaxConcurrent`,
  `recoverInterruptedJobs` (BullMQ recovers stalled jobs natively → becomes a near no-op),
  `cleanup`. Map each to BullMQ (`Queue`, `Job`, `QueueEvents`, `Worker` concurrency) +
  the PG mirror for queries/stats. Suppression methods (`isSuppressed`/`suppress`/
  `unsuppress`/`getSuppressionList`) move to the **PG `suppression_list`** (org-scoped, from
  P2.4) — drop the sqlite copy.
- **Separate worker process:** a `worker.ts` entrypoint that constructs the BullMQ `Worker`
  (the compose `worker` service `command` switches from `index.ts` to it). The api process
  only enqueues; it does not process. Guard so tests never start a real worker.

### P4.2 — Deliverability teeth (send-time enforcement)
- In the job processor, before sending to a recipient, check in order: **suppression_list**
  (hard skip), **frequency cap** (per-org/contact window — `frequency_log`/`frequency_config`
  from P2.4), **graymail** (graymail_tracker/config). On block: record skip + reason
  (campaign analytics / job result), do not send, do not count as a failure.
- On hard bounce / complaint / unsubscribe events (bounceProcessor, tracking) → **add to
  suppression_list** so future sends are gated. (Wire the suppression write that P2.4 left as
  schema-only.)

### P4.3 — Scheduler → BullMQ repeatable jobs
- Replace `schedulerService` (sqlite `scheduled_jobs` + setInterval) with BullMQ
  **repeatable/delayed jobs** (scheduled campaigns, bounce polling, warmup advance, RSS
  checks). Mirror schedule state into PG `scheduled_jobs` for the UI.

### P4.4 — apikeys migration + final sqlite cutover
- Migrate `routes/apikeys.ts` (own `data/apikeys.db`, argon2-hashed keys with `dsp_` prefix)
  to a Postgres `api_keys` table (Drizzle schema + migration; hashes stay argon2).
- Remove the last bun:sqlite usages → delete the **vitest bun:sqlite shim** + alias, the
  sqlite queue/scheduler/apikeys files, and `data/*.db`. Flip CI typecheck/test gates to
  required where green.

## Testing strategy (net-first)
- **Enforcement logic** (P4.2) is pure-ish → PGlite integration nets: suppressed recipient is
  skipped + recorded; frequency cap blocks the Nth send in the window; graymail gate; a hard
  bounce adds to suppression_list and the next send is gated. These are the highest-value nets
  and don't need Valkey.
- **queueEngine interface** (P4.1): BullMQ requires a real Redis → use the **dev Valkey on a
  dedicated test DB index** (or `ioredis` in-memory mock for unit-level). Cover enqueue→process,
  retry/backoff, pause/resume/cancel, PG history mirror rows, recover. Gate behind an env flag
  so the default `bun test` (no Valkey) still runs; document how to run the queue integration
  nets with Valkey up.
- **apikeys** (P4.4): PGlite net for the new api_keys service (create/verify/revoke, argon2).

## Success criteria
- Campaign send runs through BullMQ in a separate worker process; api process only enqueues.
- Suppressed/over-cap/graymail recipients are never sent and are recorded with a reason.
- Hard bounces/complaints/unsubscribes populate suppression_list and gate future sends.
- Job history + stats + dead-letters readable from Postgres (survive a Valkey flush).
- No bun:sqlite anywhere; shim removed; `bun typecheck` clean, suite green (queue integration
  nets green with Valkey up), app + worker boot on real PG + Valkey.

## Out of scope / deferred
- Multi-region queue, per-tenant rate-limiting at the queue level (P4 uses per-worker
  concurrency + BullMQ rate-limiter), and Valkey-backed auth rate-limiting (move the in-memory
  authRateLimit to Valkey here opportunistically if cheap, else P-later).

## Implementation notes & resolved gaps (handoff audit 2026-06-07)

An adversarial audit reviewed this spec against the current code; the decisions below close
the gaps it found so a fresh session can implement without re-deciding.

1. **Job granularity = per-BATCH.** Chunk a campaign's recipients into batches (≈100–500) and
   add one BullMQ job per batch (`jobId = \`${campaignId}:${batchIndex}\``, deterministic for
   dedupe). Mirrors the current per-job `last_processed_index` checkpoint at batch scope and
   bounds job count. Per-recipient send-receipts inside a batch guard against double-send on retry.
2. **queueEngine → BullMQ mapping (keep the public surface):** `enqueue`→`queue.add` (one per
   batch). **Campaign-level pause/resume/cancel** = a status flag on the PG campaign/job row the
   processor checks at batch start (BullMQ's `queue.pause()` is queue-wide, not per-campaign);
   `cancel` also removes pending batches via `job.remove()`. `getJob/getJobs/getStats/
   getDeadLetters` read the **PG mirror** (not Valkey). `updateProgress`→`job.updateProgress()`
   + PG row. `getActiveJobCount/Ids`→`queue.getActive()`. `setMaxConcurrent`→`Worker({concurrency})`
   (+ runtime `worker.concurrency =`). `recoverInterruptedJobs`→near-no-op health check that
   counts BullMQ stalled recoveries. `cleanup`→`queue.clean()`.
3. **API + worker code sharing:** refactor queue access into **factory functions**
   (`createQueue(redisUrl)`, `createWorker(queue, processor)`) — NO module singleton, since api
   and worker are separate processes. Suppression/frequency/graymail services are already
   Postgres-backed (stateless via getDb) and import cleanly into both.
4. **Worker process + graceful shutdown:** `worker.ts` entrypoint (compose `worker` cmd switches
   to it). On SIGTERM: stop accepting new jobs, signal in-flight batches to abort, `await
   worker.close()` with a ~30s grace, then close Redis/DB. Resume from `last_processed_index`.
5. **Stalled-job recovery:** rely on BullMQ native (lockDuration/stalledInterval defaults ~30s);
   document the thresholds in env. The legacy manual `recoverInterruptedJobs` becomes a health
   check (subscribe `QueueEvents('stalled')`, log/count).
6. **PG history mirror:** the worker subscribes to BullMQ `QueueEvents` (completed/failed/
   progress) and upserts the PG `jobs`/`dead_letters` rows — eventually consistent; PG is the
   durable record + UI/stats source, Valkey is the live queue.
7. **Deliverability gate ORDER — match the current worker** (don't silently change behavior):
   the existing queueWorker enforces **suppression → frequency_cap → email_preferences →
   graymail** (4 gates, incl. `preferenceCenterService.canReceive`). P4.2 must preserve all
   four in that order, not the 3 originally listed. A blocked recipient is recorded with reason.
8. **Suppression wiring is a re-point, not net-new:** `bounceProcessor`/`queueWorker` already
   call `queueEngine.suppress()` (today → sqlite). P4.1 re-points `queueEngine.suppress/
   isSuppressed/unsuppress/getSuppressionList` to the PG `suppression_list` (org-scoped, P2.4);
   callers stay unchanged.
9. **Scheduler (P4.3):** single `scheduled_at` → BullMQ **delayed** job; repeating tasks (bounce
   poll, warmup advance, RSS) → BullMQ **repeatable** (cron). Add `cron_pattern` (nullable) +
   `is_repeating` to the PG `scheduled_jobs` schema (generated migration). One-time migration
   reads existing rows → adds delayed/repeatable jobs → marks them migrated.
10. **Backwards-compat (P4.4 cutover):** before deleting sqlite, run a one-time migration that
    reads any `pending`/`paused`/`running` jobs from `data/queue.db` and `queue.add`s them to
    BullMQ (idempotent via deterministic jobId), then sunset sqlite. Dev/greenfield: none needed.
11. **CI testing:** enforcement-logic nets (PGlite, no Valkey) always run and are the highest
    value. BullMQ integration nets require Valkey → gate behind an env flag (e.g.
    `RUN_QUEUE_IT=1` + `REDIS_URL`); document running them with Valkey up. Use a dedicated Valkey
    DB index + flush between tests.
12. **Multi-worker:** P4 ships a single worker process. Horizontal scaling (multiple worker
    containers) is deferred to P5; BullMQ supports it natively (per-container Worker, shared
    queue + rate-limiter).

### Also discovered during the audit (fixed pre-handoff, not P4 work)
- Webhook `secret` was returned unmasked from POST/GET-by-id (R9 leak) → masked.
- `CloudflareConnection` (accessToken/refreshToken) was stored plaintext → now encrypted via
  `setSecretJson`; `getConnection` is async.
- Several P3b-cascade missed-awaits (oauth connect handlers, mailer saveConfig/removeConfig,
  cloudflare saveConnection/deployTrackingWorker) → awaited.
