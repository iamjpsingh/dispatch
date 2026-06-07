/**
 * Send Worker Entry Point
 * The separate BullMQ consumer process: runs the shared boot prerequisites, then a
 * BullMQ Worker that processes campaign send batches. The API process only enqueues;
 * this process does the sending. Compose runs this via `bun run worker.ts`.
 *
 * The processor writes progress/completion/dead-letters to Postgres inline, so PG is
 * the durable mirror — no separate QueueEvents mirror is needed.
 */
import { Worker } from 'bullmq'
import { boot } from './src/boot'
import { createRedisConnection } from './src/services/queue/redis'
import { SEND_QUEUE, type SendBatchData } from './src/services/queue/sendQueue'
import { processSendBatch } from './src/services/queue/processor'
import { BATCH_DEFAULTS } from './src/config'
import { logger } from './src/utils/logger'

await boot()

const connection = createRedisConnection()
const worker = new Worker<SendBatchData>(
  SEND_QUEUE,
  async (job) => {
    await processSendBatch(job.data.jobId, job.data.batchIndex)
  },
  { connection, concurrency: BATCH_DEFAULTS.MAX_CONCURRENT_JOBS }
)

worker.on('ready', () => logger.startup(`📨 Send worker ready (concurrency ${BATCH_DEFAULTS.MAX_CONCURRENT_JOBS})`))
worker.on('failed', (job, err) => logger.error(`Send batch ${job?.id} failed: ${err.message}`))

async function shutdown(signal: string) {
  logger.info(`${signal} received — closing send worker (waiting for in-flight batches)...`)
  await worker.close() // stop accepting new jobs, finish in-flight, then close
  connection.disconnect()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
