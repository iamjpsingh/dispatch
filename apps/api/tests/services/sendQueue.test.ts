// P4.C net — sendQueue producer (BullMQ + Valkey). GATED behind RUN_QUEUE_IT=1
// (requires a reachable Valkey on REDIS_URL / localhost:6379). The default
// `bun test` skips this so CI without Valkey stays green. Run with:
//   RUN_QUEUE_IT=1 bunx vitest run tests/services/sendQueue.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { queueStore } from '../../src/services/queue/queueStore'
import { getSendQueue, closeSendQueue, enqueueCampaign } from '../../src/services/queue/sendQueue'

const RUN = !!process.env.RUN_QUEUE_IT

function makeRow(over: Partial<Parameters<typeof queueStore.insertJob>[0]>) {
  return {
    id: 'job_1',
    user_id: 'user-1',
    config_json: '{}',
    contacts_json: '[]',
    total_count: 1,
    ...over,
  }
}

describe.skipIf(!RUN)('P4.C — sendQueue producer (BullMQ + Valkey)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await getSendQueue().obliterate({ force: true })
  }, 30_000)
  afterAll(async () => {
    const q = getSendQueue()
    await q.obliterate({ force: true })
    await closeSendQueue()
    __setTestDb(null)
  })

  it('persists the PG job row and enqueues one BullMQ job per batch', async () => {
    await enqueueCampaign(makeRow({ id: 'jb', total_count: 250 }), 100)

    // PG mirror row exists
    const job = await queueStore.getJob('jb')
    expect(job!.total_count).toBe(250)

    // ceil(250/100) = 3 batch jobs, deterministic ids
    const waiting = await getSendQueue().getWaiting()
    const ids = waiting.map((j) => j.id).sort()
    expect(ids).toEqual(['jb-b0', 'jb-b1', 'jb-b2'])
    expect(waiting.find((j) => j.id === 'jb-b1')!.data).toEqual({ jobId: 'jb', batchIndex: 1 })
  })

  it('is idempotent on re-enqueue (deterministic jobId dedupes)', async () => {
    await enqueueCampaign(makeRow({ id: 'jc', total_count: 150 }), 100)
    await getSendQueue().addBulk([
      { name: 'send', data: { jobId: 'jc', batchIndex: 0 }, opts: { jobId: 'jc-b0' } },
    ])
    const counts = await getSendQueue().getJobCounts('waiting')
    expect(counts.waiting).toBe(2) // jc-b0, jc-b1 — the duplicate jc-b0 add did not create a 3rd
  })
})
