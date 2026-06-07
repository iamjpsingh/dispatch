// P4.C net — end-to-end: enqueueCampaign -> a real BullMQ Worker -> processSendBatch
// -> Postgres completion. GATED behind RUN_QUEUE_IT=1 (needs Valkey). Proves the
// worker.ts wiring (the Worker wrapper) on top of the unit-tested producer + processor.
//   RUN_QUEUE_IT=1 bunx vitest run tests/services/worker-e2e.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { Worker } from 'bullmq'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
vi.mock('../../src/services/d1Service', () => ({
  d1Service: { isConfigured: () => false, generateCampaignId: () => 'camp_x', registerEmail: vi.fn(), injectTracking: (h: string) => h },
}))
vi.mock('../../src/services/logService', () => ({ logService: { addLog: vi.fn() } }))
const mockSend = vi.fn()
vi.mock('../../src/services/transports', () => ({ createTransport: () => ({ send: mockSend }), configFromRecord: (r: unknown) => r }))
vi.mock('../../src/services/eventBus', () => ({ eventBus: { emit: vi.fn().mockResolvedValue(undefined) } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { queueStore } from '../../src/services/queue/queueStore'
import { createRedisConnection } from '../../src/services/queue/redis'
import { SEND_QUEUE, type SendBatchData, getSendQueue, closeSendQueue, enqueueCampaign } from '../../src/services/queue/sendQueue'
import { processSendBatch } from '../../src/services/queue/processor'

const RUN = !!process.env.RUN_QUEUE_IT

async function waitFor(fn: () => Promise<boolean>, ms = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('waitFor timed out')
}

describe.skipIf(!RUN)('P4.C — worker e2e (BullMQ + Valkey + PG)', () => {
  let db: TestDb
  let worker: Worker<SendBatchData> | null = null
  let connection: ReturnType<typeof createRedisConnection> | null = null

  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ messageId: 'm' })
    await getSendQueue().obliterate({ force: true })
  }, 30_000)

  afterAll(async () => {
    if (worker) await worker.close()
    connection?.disconnect()
    const q = getSendQueue()
    await q.obliterate({ force: true })
    await closeSendQueue()
    __setTestDb(null)
  })

  it('enqueue -> worker sends every recipient -> PG job completed', async () => {
    connection = createRedisConnection()
    worker = new Worker<SendBatchData>(
      SEND_QUEUE,
      async (job) => processSendBatch(job.data.jobId, job.data.batchIndex),
      { connection }
    )

    await enqueueCampaign(
      {
        id: 'e1',
        user_id: 'u1',
        org_id: null,
        config_json: JSON.stringify({ type: 'smtp' }),
        contacts_json: JSON.stringify([{ Email: 'a@x.com' }, { Email: 'b@x.com' }]),
        total_count: 2,
        batch_size: 20,
        email_delay_sec: 0,
        subject: 'Hi',
        html_content: '<p>Hi</p>',
        from_email: 'me@x.com',
      },
      20
    )

    await waitFor(async () => (await queueStore.getJob('e1'))?.status === 'completed')

    const job = await queueStore.getJob('e1')
    expect(job!.status).toBe('completed')
    expect(job!.sent_count).toBe(2)
    expect(mockSend).toHaveBeenCalledTimes(2)
  }, 30_000)
})
