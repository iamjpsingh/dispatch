// src/services/queue/sendQueue.ts - BullMQ producer for the campaign send queue.
// One BullMQ job per recipient BATCH (deterministic jobId `${jobId}-b${batchIndex}`
// for dedupe — BullMQ forbids ':' in custom ids). The full job row (incl.
// contacts_json) lives in Postgres; a batch job carries only { jobId, batchIndex }
// and the processor slices its batch from PG.
import { Queue } from 'bullmq'
import { createRedisConnection } from './redis'
import { queueStore } from './queueStore'
import type { jobs } from '../../db/pg/schema'

export const SEND_QUEUE = 'campaign-send'

export interface SendBatchData {
  jobId: string
  batchIndex: number
}

type NewJobRow = typeof jobs.$inferInsert

let _queue: Queue<SendBatchData> | null = null
let _conn: ReturnType<typeof createRedisConnection> | null = null

export function getSendQueue(): Queue<SendBatchData> {
  if (!_queue) {
    _conn = createRedisConnection()
    _queue = new Queue<SendBatchData>(SEND_QUEUE, { connection: _conn })
  }
  return _queue
}

export async function closeSendQueue(): Promise<void> {
  await _queue?.close()
  await _conn?.quit()
  _queue = null
  _conn = null
}

/**
 * Persist the job row to Postgres (durable mirror) and enqueue one BullMQ job per
 * recipient batch. Returns the jobId. Idempotent per batch via deterministic jobId.
 */
export async function enqueueCampaign(row: NewJobRow, batchSize: number): Promise<string> {
  await queueStore.insertJob(row)

  const size = Math.max(1, batchSize)
  const total = row.total_count ?? 0
  const batchCount = Math.ceil(total / size) || 1

  const queue = getSendQueue()
  await queue.addBulk(
    Array.from({ length: batchCount }, (_, batchIndex) => ({
      name: 'send',
      data: { jobId: row.id, batchIndex },
      opts: {
        jobId: `${row.id}-b${batchIndex}`,
        attempts: 4,
        backoff: { type: 'exponential' as const, delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }))
  )

  return row.id
}
