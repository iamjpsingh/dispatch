# P4 Queue Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD is mandatory (superpowers:test-driven-development): write the failing test, watch it fail, write minimal code, watch it pass, commit.

**Goal:** Replace the SQLite-backed queue + scheduler with BullMQ on Valkey, run sending in a separate worker process, enforce deliverability at send time, and retire the last `bun:sqlite` users.

**Architecture:** The `queueEngine` singleton stays the public facade but goes **async** (SQLite was synchronous; Postgres/BullMQ are not). Enqueue writes a durable `jobs` row to Postgres (the history mirror) and adds a BullMQ job to Valkey (the live queue). A standalone `worker.ts` process runs the BullMQ `Worker`, executing the ported send loop (suppression → frequency → preferences → graymail gates, then provider send), checkpointing and mirroring results back to Postgres. The API process only enqueues; it never processes.

**Tech Stack:** Bun, Hono, Drizzle/Postgres (`drizzle-orm/bun-sql`), BullMQ + ioredis on Valkey 8, Vitest + PGlite nets, argon2id.

---

## How this plan is staged

The spec (`docs/superpowers/specs/2026-06-07-p4-queue-bullmq-deliverability-design.md`) decomposes P4 into P4.1–P4.4. The map (workflow `wvrlghhh5`) found the real work is larger than the spec assumed — most importantly **the entire 20-method `queueEngine` facade is synchronous**, so going to PG/BullMQ forces an async conversion of the facade and every caller + test mock. To keep every commit green, P4 is built as five increments:

| Increment | Scope | Maps to spec | Ships |
|---|---|---|---|
| **A — Foundation** | deps, `REDIS` config, redis connection factory, boot refactor (worker-start no longer an import side-effect) | P4.1 (infra) | green, no behavior change |
| **B — Suppression → PG** | port suppression off SQLite onto PG `suppression_list`, async; ripple the async conversion through suppression callers | P4.1 (suppression) + P4.2 (bounce→suppression) | green; suppression durable on PG |
| **C — BullMQ queue + worker + send-time gates** | PG job store, BullMQ `campaign-send` queue + producer, `worker.ts` process, ported send loop with org-scoped gates, async facade reads/control, delete SQLite queue | P4.1 (queue rewrite, worker) + P4.2 (gates) | green; sending runs on BullMQ |
| **D — Scheduler → BullMQ** | `scheduled_jobs` gains `cron_pattern`+`is_repeating`; scheduler on PG + BullMQ delayed/repeatable jobs | P4.3 | green; scheduling on BullMQ |
| **E — apikeys + final cutover** | migrate `routes/apikeys.ts` to PG `api_keys`; delete the `bun:sqlite` shim/alias; flip CI gates | P4.4 | green; no `bun:sqlite` anywhere |

**This document fully details Increments A and B** (the safe, unblocking foundation) and locks the shared contracts. Increments C, D, and E are specified at task level with their locked interfaces, schemas, and commands in the **Roadmap** section; each will be expanded into full step-by-step TDD detail in its own follow-up plan immediately before it is built, against the contracts locked here.

---

## File structure

New files:
- `apps/api/src/services/queue/redis.ts` — ioredis/Valkey connection factory (Increment A).
- `apps/api/src/services/queue/suppressionStore.ts` — PG-backed suppression list, async (Increment B).
- `apps/api/tests/services/suppressionStore.test.ts` — net for the above (Increment B).
- *(Increment C)* `apps/api/src/services/queue/queueStore.ts`, `apps/api/src/services/queue/sendQueue.ts`, `apps/api/src/services/queue/processor.ts`, `apps/api/worker.ts`.

Modified files (Increments A+B):
- `apps/api/package.json` — add `bullmq`, `ioredis`.
- `apps/api/src/config/index.ts` — add `REDIS` block.
- `apps/api/src/app.ts` — extract worker start/stop out of import-time `initialize()`.
- `apps/api/index.ts` — call the extracted worker start + shutdown registration.
- `apps/api/src/services/queueEngine.ts` — suppression methods → async, delegate to `suppressionStore`.
- `apps/api/src/services/queueWorker.ts` — suppression gate + hard-bounce write → `suppressionStore` (await).
- `apps/api/src/services/validationService.ts` — `checkSuppressed` async; awaited in `validateEmail`.
- `apps/api/src/services/bounceProcessor.ts` — `processBounce` async; awaits `suppress`.
- `apps/api/src/routes/webhooks.ts` — `await processBounce(...)` at 5 call sites.
- `apps/api/src/services/bouncePollingService.ts` — `await processBounce(...)` at 5 call sites.
- `apps/api/src/routes/queue.ts` — suppression handlers async + `await`.
- `apps/api/tests/routes/queue.test.ts` — suppression mocks resolve.

---

## Locked contracts (all increments build against these)

**`REDIS` config** (`src/config/index.ts`):
```ts
export const REDIS = {
  URL: process.env.REDIS_URL || 'redis://localhost:6379',
} as const
```

**Redis connection factory** (`src/services/queue/redis.ts`):
```ts
export function createRedisConnection(url?: string): IORedis
```
Returns `new IORedis(url ?? REDIS.URL, { maxRetriesPerRequest: null })` — `maxRetriesPerRequest: null` is required by BullMQ blocking commands. No module-level singleton (API and worker are separate processes; each constructs its own).

**Suppression store** (`src/services/queue/suppressionStore.ts`) — PG-backed, async, `user_id`-keyed (matches the existing `uq_suppress_user_email` unique; `org_id` stays nullable until org-scoped enforcement lands in C), emails lowercased:
```ts
export const suppressionStore = {
  isSuppressed(userId: string, email: string): Promise<boolean>
  suppress(userId: string, email: string, reason: string, source?: string): Promise<void>
  unsuppress(userId: string, email: string): Promise<boolean>
  getSuppressionList(userId: string, limit?: number, offset?: number): Promise<SuppressionRow[]>
}
```

**Async `queueEngine` facade** — after the full migration every method returns a Promise. Increment B converts the suppression methods; Increment C converts the rest. Signatures (final):
```ts
enqueue(userId, emailConfig, contacts, options): Promise<string>
pause(jobId): Promise<boolean>; resume(jobId): Promise<boolean>; cancel(jobId): Promise<boolean>
getJob(jobId): Promise<QueueJob | null>
getJobs(userId, status?, limit?, offset?): Promise<QueueJob[]>
getStats(userId): Promise<QueueStats>
getDeadLetters(jobId?, limit?, offset?): Promise<DeadLetter[]>
isSuppressed(userId, email): Promise<boolean>
suppress(userId, email, reason, source?): Promise<void>
unsuppress(userId, email): Promise<boolean>
getSuppressionList(userId, limit?, offset?): Promise<unknown[]>
getActiveJobIds(): Promise<string[]>
recoverInterruptedJobs(): Promise<number>
```
Type re-exports (`JobType, JobStatus, QueueJob, EnqueueOptions, DeadLetter, QueueStats`) stay exported from `queueEngine` AND `queueDatabase` (dashboard.ts imports `QueueJob` from `queueDatabase` directly). Dropped from the facade (no production callers): `setMaxConcurrent`, `getActiveJobCount`, `cleanup`, `updateProgress`, `startWorker`, `stopWorker` (worker lifecycle moves to `worker.ts`).

**Boot split** (`src/app.ts`): exports `startBackgroundWorkers(): Promise<void>` and `stopBackgroundWorkers(): void`; the default export stays the Hono `app`. Worker start is **not** an import side-effect. `index.ts` calls `startBackgroundWorkers()` (under its existing `NODE_ENV !== 'test'` guard) and registers SIGTERM/SIGINT → `stopBackgroundWorkers()`.

---

## Increment A — Foundation

> No behavior change. The SQLite queue keeps running (now started explicitly from `index.ts`). Suite stays green. This unblocks the separate worker process and the BullMQ wiring in C.

### Task A1: Add BullMQ + ioredis dependencies

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add the dependencies**

Run from `apps/api/`:
```bash
cd apps/api && bun add bullmq ioredis
```
Expected: `package.json` `dependencies` gains `bullmq` and `ioredis`; `bun.lock` updates.

- [ ] **Step 2: Verify they resolve**

Run:
```bash
cd apps/api && bun -e "import('bullmq').then(m=>console.log('bullmq', typeof m.Queue)); import('ioredis').then(m=>console.log('ioredis', typeof m.default))"
```
Expected: `bullmq function` and `ioredis function`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/bun.lock
git commit -m "build(p4): add bullmq + ioredis deps"
```

### Task A2: Add REDIS config block

**Files:**
- Modify: `apps/api/src/config/index.ts`
- Test: `apps/api/tests/config/redis-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/config/redis-config.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { REDIS } from '../../src/config'

describe('REDIS config', () => {
  it('defaults to localhost when REDIS_URL is unset', () => {
    expect(REDIS.URL).toMatch(/^redis:\/\//)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bunx vitest run tests/config/redis-config.test.ts`
Expected: FAIL — `REDIS` is not exported from `../../src/config`.

- [ ] **Step 3: Add the config block**

In `apps/api/src/config/index.ts`, after the `SERVER` block (around line 22), add:
```ts
// Redis / Valkey (BullMQ queue + worker)
export const REDIS = {
  URL: process.env.REDIS_URL || 'redis://localhost:6379',
} as const
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/api && bunx vitest run tests/config/redis-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/index.ts apps/api/tests/config/redis-config.test.ts
git commit -m "feat(p4): REDIS config block (REDIS_URL)"
```

### Task A3: Redis connection factory

**Files:**
- Create: `apps/api/src/services/queue/redis.ts`
- Test: `apps/api/tests/services/redis-factory.test.ts`

- [ ] **Step 1: Write the failing test** (constructs without needing a live server — no command is issued, the socket is disconnected immediately)

Create `apps/api/tests/services/redis-factory.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createRedisConnection } from '../../src/services/queue/redis'

describe('createRedisConnection', () => {
  it('parses the URL and sets BullMQ-required options', () => {
    const conn = createRedisConnection('redis://localhost:6379')
    expect(conn.options.host).toBe('localhost')
    expect(conn.options.port).toBe(6379)
    expect(conn.options.maxRetriesPerRequest).toBeNull()
    conn.disconnect()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/redis-factory.test.ts`
Expected: FAIL — module `../../src/services/queue/redis` not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/queue/redis.ts`:
```ts
// src/services/queue/redis.ts - Valkey/Redis connection factory for BullMQ.
// No module-level singleton: the API and worker are separate processes, each
// builds its own connection. maxRetriesPerRequest:null is required by BullMQ.
import IORedis from 'ioredis'
import { REDIS } from '../../config'

export function createRedisConnection(url?: string): IORedis {
  return new IORedis(url ?? REDIS.URL, { maxRetriesPerRequest: null })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/redis-factory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/queue/redis.ts apps/api/tests/services/redis-factory.test.ts
git commit -m "feat(p4): redis connection factory for BullMQ"
```

### Task A4: Boot refactor — worker start is no longer an import side-effect

**Files:**
- Modify: `apps/api/src/app.ts:253-304`
- Modify: `apps/api/index.ts`
- Test: `apps/api/tests/app-boot.test.ts`

**Why:** Today `app.ts` runs `await initialize()` at module top level (line 285), so importing the Hono app boots the SQLite worker + automation + warmup `setInterval`s. A separate `worker.ts` (Increment C) cannot import the app without booting the HTTP-side workers. This extracts worker start/stop into exported functions that only `index.ts` calls.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/app-boot.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import app, { startBackgroundWorkers, stopBackgroundWorkers } from '../src/app'

describe('app boot surface', () => {
  it('default export is the Hono app (has .fetch)', () => {
    expect(typeof app.fetch).toBe('function')
  })
  it('exposes worker lifecycle without starting it at import', () => {
    expect(typeof startBackgroundWorkers).toBe('function')
    expect(typeof stopBackgroundWorkers).toBe('function')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bunx vitest run tests/app-boot.test.ts`
Expected: FAIL — `startBackgroundWorkers` / `stopBackgroundWorkers` are not exported.

- [ ] **Step 3: Refactor `app.ts`**

In `apps/api/src/app.ts`, replace the `async function initialize()` declaration (line 253) with an exported name and remove the import-time invocation + handler registration. Specifically:

Change `async function initialize() {` → `export async function startBackgroundWorkers() {`

Delete the top-level call (line 285):
```ts
await initialize()
```

Change the `shutdown`/handler block (lines 291-304) to an exported stop function (drop the `process.on` registration and `process.exit` — `index.ts` owns process lifecycle):
```ts
// ============================================================================
// Background worker lifecycle (started/stopped by index.ts; never at import)
// ============================================================================

export function stopBackgroundWorkers() {
  queueEngine.stopWorker()
  automationService.stopWorker()
  warmupService.stopWorker()
  logger.info('All workers stopped.')
}
```

- [ ] **Step 4: Wire `index.ts`**

Replace `apps/api/index.ts` body so the extracted lifecycle is invoked under the existing guard:
```ts
import app, { startBackgroundWorkers, stopBackgroundWorkers } from './src/app'
import { runMigrations } from './src/db/pg/migrate'
import { seedSystemRoles } from './src/db/pg/seed'
import { templateService } from './src/services/templateService'
import { systemSettingsService } from './src/services/systemSettingsService'
import { assertEncryptionKey } from './src/utils/crypto'
import { logger } from './src/utils/logger'

if (process.env.NODE_ENV !== 'test') {
  assertEncryptionKey() // fail fast: never run with secrets unencryptable
  await runMigrations()
  await seedSystemRoles()
  await templateService.seedStarterTemplates()
  await systemSettingsService.init() // load config cache (sync reads everywhere)
  await startBackgroundWorkers()

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully...`)
    stopBackgroundWorkers()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export default app
```

- [ ] **Step 5: Run the boot test + typecheck**

Run: `cd apps/api && bunx vitest run tests/app-boot.test.ts && bun run typecheck`
Expected: boot test PASS; typecheck error count unchanged at 49 (no new errors).

- [ ] **Step 6: Run the full backend suite (regression net for the refactor)**

Run: `cd apps/api && bun run test`
Expected: same pass/skip counts as before the change (714 passed / 20 skipped), no new failures, no leaked `setInterval` open-handle warnings from importing `app`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.ts apps/api/index.ts apps/api/tests/app-boot.test.ts
git commit -m "refactor(p4): extract worker start/stop out of app import side-effect"
```

---

## Increment B — Suppression → Postgres

> Ports the suppression list off `data/queue.db` onto the PG `suppression_list` table (already migrated, P2.4) and makes the suppression path async end-to-end. This also lands the spec's P4.2 "bounces write suppression_list" wiring (the bounce path already calls `queueEngine.suppress`; it now writes PG). `user_id` stays the operative key (matching `uq_suppress_user_email`); `org_id` is left nullable until org-scoped gate enforcement in Increment C.
>
> **Transitional note:** until Increment C deletes the SQLite worker, the running send loop (`queueWorker`) also reads suppression — Step B3 repoints its two suppression call sites to `suppressionStore` so there is a single source of truth during the transition.

### Task B1: PG suppression store (net-first)

**Files:**
- Create: `apps/api/src/services/queue/suppressionStore.ts`
- Test: `apps/api/tests/services/suppressionStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/services/suppressionStore.test.ts`:
```ts
// P4.B net — suppressionStore: PG-backed suppression list (async, user-scoped,
// email lowercased, idempotent). Mirrors the retired SQLite contract.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { suppressionStore } from '../../src/services/queue/suppressionStore'

describe('P4.B — suppressionStore (Postgres)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('suppress then isSuppressed is true; lowercases the email', async () => {
    await suppressionStore.suppress('user-1', 'Bad@Example.com', 'manual')
    expect(await suppressionStore.isSuppressed('user-1', 'bad@example.com')).toBe(true)
    expect(await suppressionStore.isSuppressed('user-1', 'BAD@EXAMPLE.COM')).toBe(true)
  })

  it('is scoped to the user', async () => {
    await suppressionStore.suppress('user-1', 'x@example.com', 'manual')
    expect(await suppressionStore.isSuppressed('user-2', 'x@example.com')).toBe(false)
  })

  it('is idempotent on repeated suppress (no throw, single row)', async () => {
    await suppressionStore.suppress('user-1', 'dup@example.com', 'manual')
    await suppressionStore.suppress('user-1', 'dup@example.com', 'bounce')
    const list = await suppressionStore.getSuppressionList('user-1')
    expect(list.filter((r) => r.email === 'dup@example.com')).toHaveLength(1)
  })

  it('unsuppress removes and reports whether a row was deleted', async () => {
    await suppressionStore.suppress('user-1', 'gone@example.com', 'manual')
    expect(await suppressionStore.unsuppress('user-1', 'gone@example.com')).toBe(true)
    expect(await suppressionStore.isSuppressed('user-1', 'gone@example.com')).toBe(false)
    expect(await suppressionStore.unsuppress('user-1', 'gone@example.com')).toBe(false)
  })

  it('getSuppressionList returns the user rows', async () => {
    await suppressionStore.suppress('user-1', 'a@example.com', 'manual')
    await suppressionStore.suppress('user-1', 'b@example.com', 'manual')
    const list = await suppressionStore.getSuppressionList('user-1')
    expect(list.map((r) => r.email).sort()).toEqual(['a@example.com', 'b@example.com'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/suppressionStore.test.ts`
Expected: FAIL — module `../../src/services/queue/suppressionStore` not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/queue/suppressionStore.ts`:
```ts
// src/services/queue/suppressionStore.ts - PG-backed suppression list (async).
// Replaces the SQLite suppression methods in queueDatabase. user_id-keyed to
// match uq_suppress_user_email; emails lowercased; INSERT ... ON CONFLICT DO NOTHING.
import { and, eq, desc } from 'drizzle-orm'
import { getDb } from '../../db/pg/client'
import { suppression_list, type SuppressionRow } from '../../db/pg/schema'
import { generateId } from '../../utils/id'

export const suppressionStore = {
  async isSuppressed(userId: string, email: string): Promise<boolean> {
    const [row] = await getDb()
      .select({ id: suppression_list.id })
      .from(suppression_list)
      .where(and(eq(suppression_list.user_id, userId), eq(suppression_list.email, email.toLowerCase())))
      .limit(1)
    return !!row
  },

  async suppress(userId: string, email: string, reason: string, source?: string): Promise<void> {
    await getDb()
      .insert(suppression_list)
      .values({ id: generateId('sup'), user_id: userId, email: email.toLowerCase(), reason, source: source ?? null })
      .onConflictDoNothing({ target: [suppression_list.user_id, suppression_list.email] })
  },

  async unsuppress(userId: string, email: string): Promise<boolean> {
    const deleted = await getDb()
      .delete(suppression_list)
      .where(and(eq(suppression_list.user_id, userId), eq(suppression_list.email, email.toLowerCase())))
      .returning({ id: suppression_list.id })
    return deleted.length > 0
  },

  async getSuppressionList(userId: string, limit = 50, offset = 0): Promise<SuppressionRow[]> {
    return getDb()
      .select()
      .from(suppression_list)
      .where(eq(suppression_list.user_id, userId))
      .orderBy(desc(suppression_list.created_at))
      .limit(limit)
      .offset(offset)
  },
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/suppressionStore.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/queue/suppressionStore.ts apps/api/tests/services/suppressionStore.test.ts
git commit -m "feat(p4): PG-backed suppressionStore (net-first)"
```

### Task B2: Convert the suppression path to async (facade + all callers)

> One cohesive commit: TypeScript will not compile a half-converted async surface. The 49-baseline typecheck and the full suite are the regression net.

**Files:**
- Modify: `apps/api/src/services/queueEngine.ts:120-134`
- Modify: `apps/api/src/services/queueWorker.ts:150,347`
- Modify: `apps/api/src/services/validationService.ts:127-129,147`
- Modify: `apps/api/src/services/bounceProcessor.ts:260-288`
- Modify: `apps/api/src/routes/webhooks.ts:182,216,249,272,303`
- Modify: `apps/api/src/services/bouncePollingService.ts:69,87,113,138,164`
- Modify: `apps/api/src/routes/queue.ts:154-161,166-177,182-192`

- [ ] **Step 1: Facade → async, delegate to `suppressionStore`**

In `apps/api/src/services/queueEngine.ts`, add the import and replace the four suppression methods (lines 120-134):
```ts
import { suppressionStore } from './queue/suppressionStore'
```
```ts
  async isSuppressed(userId: string, email: string): Promise<boolean> {
    return suppressionStore.isSuppressed(userId, email)
  }

  async suppress(userId: string, email: string, reason: string, source?: string): Promise<void> {
    await suppressionStore.suppress(userId, email, reason, source)
  }

  async unsuppress(userId: string, email: string): Promise<boolean> {
    return suppressionStore.unsuppress(userId, email)
  }

  async getSuppressionList(userId: string, limit = 50, offset = 0): Promise<unknown[]> {
    return suppressionStore.getSuppressionList(userId, limit, offset)
  }
```

- [ ] **Step 2: Repoint the SQLite worker's suppression sites to `suppressionStore`** (single source of truth during transition; `executeJob`/`sendWithRetry` are already async)

In `apps/api/src/services/queueWorker.ts`, add the import:
```ts
import { suppressionStore } from './queue/suppressionStore'
```
Line 150 — change `if (this.queueDb.isSuppressed(job.user_id, contact.Email)) {` to:
```ts
      if (await suppressionStore.isSuppressed(job.user_id, contact.Email)) {
```
Line 347 — change `this.queueDb.suppress(job.user_id, contact.Email, 'bounce_hard', \`job:${job.id}\`)` to:
```ts
            await suppressionStore.suppress(job.user_id, contact.Email, 'bounce_hard', `job:${job.id}`)
```

- [ ] **Step 3: `validationService.checkSuppressed` → async**

In `apps/api/src/services/validationService.ts`, lines 127-129:
```ts
  async checkSuppressed(userId: string, email: string): Promise<boolean> {
    return queueEngine.isSuppressed(userId, email);
  }
```
Line 147 — add `await`:
```ts
        suppressed = await this.checkSuppressed(userId, normalizedEmail);
```

- [ ] **Step 4: `bounceProcessor.processBounce` → async**

In `apps/api/src/services/bounceProcessor.ts`, change the signature (line 260) to `export async function processBounce(userId: string, event: BounceEvent): Promise<void> {` and `await` each `queueEngine.suppress(...)` (lines 265, 277, 283), e.g.:
```ts
      await queueEngine.suppress(userId, email, 'hard_bounce', `${event.provider}:webhook`)
```
(Apply the same `await` to the `complaint` and `unsubscribe` cases.)

- [ ] **Step 5: `await` every `processBounce` caller**

In `apps/api/src/routes/webhooks.ts` (handlers are already `async`): change lines 182, 216, 249, 272, 303 from `processBounce(...)` to `await processBounce(...)`.

In `apps/api/src/services/bouncePollingService.ts` (poll methods are already `async`): change lines 69, 87, 113, 138, 164 from `processBounce('system', event)` to `await processBounce('system', event)`.

- [ ] **Step 6: `queue.ts` suppression handlers → async + `await`**

In `apps/api/src/routes/queue.ts`:
- GET `/queue/suppression` (line 154): make the handler `async (c) =>` and `const list = await queueEngine.getSuppressionList(user.id, limit, offset)`.
- POST `/queue/suppression` (line 166, already async): `await queueEngine.suppress(user.id, email, reason, 'manual')`.
- DELETE `/queue/suppression/:email` (line 182): make the handler `async (c) =>` and `const removed = await queueEngine.unsuppress(user.id, email)`.

- [ ] **Step 7: Typecheck**

Run: `cd apps/api && bun run typecheck`
Expected: error count stays at 49 (no new errors). If a caller of these methods was missed, tsc flags `Promise<...>` used as a value — fix by awaiting it.

- [ ] **Step 8: Run affected nets**

Run: `cd apps/api && bunx vitest run tests/routes/queue.test.ts`
Expected: PASS. `await` on the existing `vi.fn()` mocks resolves to the same values, so handlers behave identically. (If any assertion depends on a mock return value, Step B3-9 converts it.)

- [ ] **Step 9: Update suppression mocks to resolve (only if a test asserts a return value)**

In `apps/api/tests/routes/queue.test.ts`, for any test that sets a return on a converted method (`getSuppressionList`, `suppress`, `unsuppress`), change `mockReturnValue(x)` → `mockResolvedValue(x)`. Leave job/stats mocks (`getJobs`, `getJob`, `getStats`, `getDeadLetters`) unchanged — those convert in Increment C.

- [ ] **Step 10: Full suite + lint**

Run: `cd apps/api && bun run test && bun run lint`
Expected: 714 passed / 20 skipped (unchanged); lint clean.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/services/queueEngine.ts apps/api/src/services/queueWorker.ts apps/api/src/services/validationService.ts apps/api/src/services/bounceProcessor.ts apps/api/src/routes/webhooks.ts apps/api/src/services/bouncePollingService.ts apps/api/src/routes/queue.ts apps/api/tests/routes/queue.test.ts
git commit -m "feat(p4): suppression list on Postgres (async facade + callers)"
```

---

## Roadmap — Increments C, D, E (locked contracts; full TDD detail authored per-increment before build)

### Increment C — BullMQ queue + worker process + send-time gates (spec P4.1 core + P4.2)

**Locked interfaces:**

`src/services/queue/queueStore.ts` — PG job/dead-letter history mirror (async), replacing `QueueDatabase`'s job CRUD against the PG `jobs`/`dead_letters` tables:
```ts
export const queueStore = {
  insertJob(row: NewJobRow): Promise<void>
  getJob(jobId): Promise<QueueJob | null>
  getJobs(userId, status?, limit?, offset?): Promise<QueueJob[]>
  getStats(userId): Promise<QueueStats>
  markRunning(jobId): Promise<void>
  updateProgress(jobId, lastProcessedIndex, sentCount, failedCount, lastError?): Promise<void>
  completeJob(jobId): Promise<void>
  failJob(jobId, error): Promise<void>
  addToDeadLetter(jobId, recipientEmail, recipientName, errorMessage, errorType, attempts): Promise<void>
  getDeadLetters(jobId?, limit?, offset?): Promise<DeadLetter[]>
  setStatus(jobId, status): Promise<boolean>   // for pause/resume/cancel flags
}
```
Mirror the SQLite encoding exactly (snake_case, JSON-as-text in `config_json`/`contacts_json`, integer counts, ISO `timestamptz` strings). `getStats` returns the same 9-field shape. Thread `org_id` into the job row (from the enqueue caller's authenticated org) so gates can be org-scoped.

`src/services/queue/sendQueue.ts` — BullMQ producer:
```ts
export const SEND_QUEUE = 'campaign-send'
export function getSendQueue(): Queue            // lazy, built via createRedisConnection()
export interface SendBatchData { jobId: string; batchIndex: number }
```
`enqueue` writes the PG `jobs` row (mirror) then adds **one BullMQ job per recipient batch** (batch size ≈ `options.batchSize`), `jobId = \`${jobId}:${batchIndex}\`` (deterministic, dedupe-safe), with `attempts` + exponential `backoff` and `removeOnComplete`/`removeOnFail` tuned so PG is the durable record.

`src/services/queue/processor.ts` — the ported send loop as a BullMQ processor `(job: Job<SendBatchData>) => Promise<void>`. Preserves the verified gate order **suppression → frequency cap → email preferences → graymail**, now passing the job's real `org_id` to the org-scoped gates (`frequencyCapService.canSend`, `preferenceCenterService.canReceive`, `graymailService.canSend`); suppression via `suppressionStore`. Preserves post-send bookkeeping (`frequencyCapService.logSend`, `graymailService.recordSend`, `eventBus.emit('email_sent'|'email_failed')`), retry/dead-letter, hard-bounce→suppress, and completion notification. Checkpoints `last_processed_index` per recipient via `queueStore.updateProgress`. Batch-boundary throttling is replaced by BullMQ delay/rate-limiter.

`apps/api/worker.ts` — the worker entrypoint: runs the boot prerequisites (extract the `index.ts` prereq block — `assertEncryptionKey`, `runMigrations`, seeds, `systemSettingsService.init` — into a shared `boot()` reused by both entrypoints), constructs `new Worker(SEND_QUEUE, processor, { connection: createRedisConnection(), concurrency: WORKERS-derived })`, subscribes `QueueEvents` to mirror completed/failed/progress into PG, and on SIGTERM stops intake → aborts in-flight batches → `await worker.close()` (~30s grace) → closes Redis/DB.

**Tasks (each green + committed):**
- [ ] C1: `queueStore` PG CRUD — net-first PGlite (insert/get/getJobs/getStats/deadletters/progress/status). Assert tenant scoping (wrong-user reads are empty).
- [ ] C2: `sendQueue` producer + `enqueue` rewrite (PG mirror + per-batch `queue.add`) — integration net against Valkey, **gated behind `RUN_QUEUE_IT=1`** (`localhost:6379`); flush a dedicated DB index between tests.
- [ ] C3: `processor` send loop — pure gate nets (PGlite, always run): suppressed/freq/pref/graymail recipient is skipped + recorded; hard bounce adds to `suppression_list` and the next send is gated; `org_id` is the scoping key.
- [ ] C4: `worker.ts` + shared `boot()` + `QueueEvents` PG mirror — integration net (gated): enqueue → process → PG `jobs`/`dead_letters` rows; retry/backoff; graceful shutdown.
- [ ] C5: Convert the remaining facade methods to async (`enqueue`, `pause`, `resume`, `cancel`, `getJob`, `getJobs`, `getStats`, `getDeadLetters`, `getActiveJobIds`, `recoverInterruptedJobs`); drop `startWorker`/`stopWorker`/`setMaxConcurrent`/`getActiveJobCount`/`cleanup`/`updateProgress` from the facade. Update callers: `routes/queue.ts`, `routes/dashboard.ts`, `routes/send.ts`, `routes/campaigns.ts`, `app.ts` `startBackgroundWorkers` (remove SQLite queue start; keep automation/warmup — or move them to `worker.ts`). Update test mocks (`dashboard.test.ts`, `queue.test.ts`, `campaigns.test.ts`) to `mockResolvedValue`. Typecheck stays ≤49; full suite green.
- [ ] C6: Switch compose `worker` `command` → `bun run worker.ts`; delete `queueDatabase.ts`, `queueWorker.ts`, their tests + `vi.mock('bun:sqlite')` blocks, and `data/queue.db`. Document the one-time `data/queue.db` pending-job → BullMQ migration for non-greenfield (dev/greenfield: none). Full suite green; gated queue nets green with Valkey up.

### Increment D — Scheduler → BullMQ (spec P4.3)

**R4 schema change** (`src/db/pg/schema/queue.ts` → `bunx drizzle-kit generate` from `apps/api/`; never hand-write the migration): add to `scheduled_jobs`:
```ts
    cron_pattern: text('cron_pattern'),
    is_repeating: integer('is_repeating').notNull().default(0),
```

**Tasks:**
- [ ] D1: Generate + validate the `scheduled_jobs` migration on real Postgres.
- [ ] D2: Rewrite `schedulerService` onto PG (`scheduled_jobs`) + BullMQ — single `scheduled_time` → BullMQ **delayed** job; repeating tasks → BullMQ **repeatable** (cron). Net-first PGlite for the PG state + gated integration for BullMQ scheduling. **Preserve the public surface:** `scheduleJob(userId, emailJob, batchConfig, scheduledTime, configName, notifyEmail?, notifyBrowser?): Promise<string>`, `getScheduledJobs()`, `cancelScheduledJob(jobId): Promise<boolean>`, the named export `schedulerService`, AND the `require('../services/schedulerService').schedulerService` path that `dashboard.ts` lazy-loads.
- [ ] D3: One-time migration of existing `data/scheduler.db` rows → PG + BullMQ; delete the SQLite scheduler. Move the scheduler start into `worker.ts`/`startBackgroundWorkers` as appropriate.

### Increment E — apikeys → Postgres + final SQLite cutover (spec P4.4)

**R4 schema change:** new `api_keys` Drizzle table (org/user-scoped, argon2 hash, `dsp_` prefix metadata) → generated migration validated on real PG.

**Tasks:**
- [ ] E1: `api_keys` schema + migration.
- [ ] E2: Migrate `routes/apikeys.ts` (own `data/apikeys.db`) to PG via a net-first service (create/verify/revoke, argon2 hashes preserved).
- [ ] E3: Remove the last `bun:sqlite` source imports; delete `tests/helpers/bun-sqlite.ts`, the `'bun:sqlite'` vitest alias, and `data/*.db`. Flip CI typecheck/test gates to required where green (queue integration nets gated on Valkey in CI).

---

## Self-review

**Spec coverage:** P4.1 infra → A1-A3; P4.1 queue rewrite + worker → C; P4.1 suppression→PG → B + C3; P4.2 send-time gates → C3; P4.2 bounces→suppression → B (bounceProcessor) + C3; P4.3 scheduler → D; P4.4 apikeys + shim deletion → E. The async-facade conversion (the map's #1 discrepancy, not in the original spec) is explicit in B2 and C5. The org-scoping fix (map #5) is in C1/C3 (thread `org_id`). All covered.

**Placeholder scan:** Increments A and B contain complete code in every step. C/D/E are explicitly staged as "locked contracts now, full TDD steps authored per-increment before build" — not silent TODOs.

**Type consistency:** `suppressionStore` method names/signatures match between the locked-contracts section, B1 (definition), and B2 (facade delegation). `startBackgroundWorkers`/`stopBackgroundWorkers` names match between A4's `app.ts` exports, the A4 `index.ts` import, and the C5 reference. The async facade signatures in the locked-contracts section match the conversions in B2 (suppression) and C5 (rest).
