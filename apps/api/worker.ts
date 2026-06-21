/**
 * Send Worker Entry Point
 * The separate BullMQ consumer process: runs the shared boot prerequisites, then a
 * BullMQ Worker that processes campaign send batches. The API process only enqueues;
 * this process does the sending. Compose runs this via `bun run worker.ts`.
 *
 * The processor writes progress/completion/dead-letters to Postgres inline, so PG is
 * the durable mirror — no separate QueueEvents mirror is needed.
 */
import { Worker, DelayedError } from 'bullmq'
import { boot } from './src/boot'
import { createRedisConnection } from './src/services/queue/redis'
import { SEND_QUEUE, type SendBatchData } from './src/services/queue/sendQueue'
import { SCHEDULER_QUEUE, type ScheduledRunData } from './src/services/queue/schedulerQueue'
import { processSendBatch } from './src/services/queue/processor'
import { processScheduledRun } from './src/services/queue/schedulerProcessor'
import { startRetentionWorker } from './src/services/queue/retentionJob'
import { queueStore } from './src/services/queue/queueStore'
import { BATCH_DEFAULTS } from './src/config'
import { logger } from './src/utils/logger'

// Migrations + seeds are owned by the API process; the worker only needs the
// encryption key + settings cache (compose gates the worker on api being healthy).
await boot({ migrate: false, seed: false })

const connection = createRedisConnection()

const sendWorker = new Worker<SendBatchData>(
  SEND_QUEUE,
  async (job, token) => {
    // Honor pause without losing recipients: defer (re-queue) the batch instead of
    // consuming it, so a resumed job processes every batch it had not yet sent.
    const row = await queueStore.getJob(job.data.jobId)
    if (row?.status === 'paused') {
      await job.moveToDelayed(Date.now() + 30_000, token)
      throw new DelayedError()
    }
    await processSendBatch(job.data.jobId, job.data.batchIndex)
  },
  { connection, concurrency: BATCH_DEFAULTS.MAX_CONCURRENT_JOBS }
)
sendWorker.on('ready', () => logger.startup(`📨 Send worker ready (concurrency ${BATCH_DEFAULTS.MAX_CONCURRENT_JOBS})`))
sendWorker.on('failed', async (job, err) => {
  if (err instanceof DelayedError) return // deferred (paused), not a real failure
  logger.error(`Send batch ${job?.id} failed: ${err.message}`)
  // A batch that exhausted all retries fails the job so it can't sit "running" forever.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await queueStore.failJob(job.data.jobId, err.message)
  }
})

const schedulerWorker = new Worker<ScheduledRunData>(
  SCHEDULER_QUEUE,
  async (job) => {
    await processScheduledRun(job.data.scheduledJobId)
  },
  { connection }
)
schedulerWorker.on('ready', () => logger.startup('⏰ Scheduler worker ready'))
schedulerWorker.on('failed', (job, err) => logger.error(`Scheduled run ${job?.id} failed: ${err.message}`))

const retentionWorker = startRetentionWorker()
retentionWorker.on('ready', () => logger.startup('🗑️  Retention worker ready'))
retentionWorker.on('failed', (job, err) => logger.error(`Retention purge ${job?.id} failed: ${err.message}`))

async function shutdown(signal: string) {
  logger.info(`${signal} received — closing workers (waiting for in-flight jobs)...`)
  await Promise.all([sendWorker.close(), schedulerWorker.close(), retentionWorker.close()]) // stop intake, finish in-flight
  connection.disconnect()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
