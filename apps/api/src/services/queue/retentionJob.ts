// src/services/queue/retentionJob.ts - Daily BullMQ repeatable job for data retention purge.
// Mirrors the scheduler queue/worker pattern: createRedisConnection for each Queue/Worker,
// registration is lazy and guarded by NODE_ENV !== 'test' at call sites.
import { Queue, Worker } from 'bullmq'
import { createRedisConnection } from './redis'
import { retentionService } from '../retentionService'
import { auditService } from '../auditService'
import { logger } from '../../utils/logger'

const RETENTION_QUEUE = 'data-retention'
const windowDays = () => Number(process.env.RETENTION_DAYS ?? 730)

export async function registerRetentionJob(): Promise<void> {
  // Fire-once at boot: register the repeatable scheduler, then release the producer
  // connection. BullMQ's worker owns repeat scheduling thereafter, so nothing reuses
  // this queue (unlike the long-lived scheduler producer that routes call per send).
  const conn = createRedisConnection()
  const q = new Queue(RETENTION_QUEUE, { connection: conn })
  try {
    await q.add('purge', {}, { repeat: { pattern: '0 2 * * *' }, jobId: 'daily-retention-purge', removeOnComplete: true, removeOnFail: 100 })
  } finally {
    await q.close()
    await conn.quit()
  }
}

export function startRetentionWorker(): Worker {
  return new Worker(RETENTION_QUEUE, async () => {
    const res = await retentionService.purgeExpired(new Date(), windowDays())
    await auditService.cleanup(90)
    logger.info(`[retention] purged ${JSON.stringify(res)}`)
  }, { connection: createRedisConnection() })
}
