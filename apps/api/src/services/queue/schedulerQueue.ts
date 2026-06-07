// src/services/queue/schedulerQueue.ts - BullMQ producer for scheduled campaigns.
// A scheduled campaign is a single DELAYED job (fires at scheduled_time); when it
// fires, schedulerProcessor routes the send through the main send queue.
import { Queue } from 'bullmq'
import { createRedisConnection } from './redis'

export const SCHEDULER_QUEUE = 'campaign-scheduler'

export interface ScheduledRunData {
  scheduledJobId: string
}

let _queue: Queue<ScheduledRunData> | null = null
let _conn: ReturnType<typeof createRedisConnection> | null = null

export function getSchedulerQueue(): Queue<ScheduledRunData> {
  if (!_queue) {
    _conn = createRedisConnection()
    _queue = new Queue<ScheduledRunData>(SCHEDULER_QUEUE, { connection: _conn })
  }
  return _queue
}

export async function closeSchedulerQueue(): Promise<void> {
  await _queue?.close()
  await _conn?.quit()
  _queue = null
  _conn = null
}

/** Add a delayed job that fires at `runAt` (deterministic jobId for dedupe/cancel). */
export async function addScheduledRun(scheduledJobId: string, runAt: Date): Promise<void> {
  const delay = Math.max(0, runAt.getTime() - Date.now())
  await getSchedulerQueue().add(
    'run',
    { scheduledJobId },
    { jobId: scheduledJobId, delay, removeOnComplete: true, removeOnFail: 1000 }
  )
}

/** Remove a not-yet-fired scheduled run (on cancel). */
export async function removeScheduledRun(scheduledJobId: string): Promise<void> {
  const job = await getSchedulerQueue().getJob(scheduledJobId)
  if (job) await job.remove()
}
