// src/services/schedulerService.ts - scheduled campaigns on Postgres + BullMQ.
// Replaces the data/scheduler.db sqlite store + setInterval poller. scheduleJob writes
// a scheduled_jobs row and a BullMQ delayed job; when it fires, schedulerProcessor
// routes the send through the unified send queue. Public surface preserved (now async).
import { schedulerStore } from './queue/schedulerStore'
import { addScheduledRun, removeScheduledRun } from './queue/schedulerQueue'
import { logger } from '../utils/logger'
import type { EmailJob, BatchConfig } from '../types/index'

class SchedulerService {
  async scheduleJob(
    userId: string,
    emailJob: EmailJob,
    batchConfig: BatchConfig | null,
    scheduledTime: Date,
    configName: string,
    notifyEmail?: string,
    notifyBrowser?: boolean
  ): Promise<string> {
    const jobId = `sched_${Date.now()}`

    await schedulerStore.create({
      id: jobId,
      user_id: userId,
      email_job: JSON.stringify(emailJob),
      batch_config: batchConfig ? JSON.stringify(batchConfig) : null,
      scheduled_time: scheduledTime.toISOString(),
      notify_email: notifyEmail || null,
      notify_browser: notifyBrowser ? 1 : 0,
      contact_count: emailJob.contacts.length,
      subject: emailJob.subject,
      use_batch: batchConfig ? 1 : 0,
      config_name: configName || 'Default Config',
    })

    await addScheduledRun(jobId, scheduledTime)

    logger.info(`Job scheduled: ${jobId} for user ${userId} at ${scheduledTime.toISOString()}`)
    return jobId
  }

  async getScheduledJobs() {
    return schedulerStore.getActive()
  }

  async cancelScheduledJob(jobId: string): Promise<boolean> {
    const cancelled = await schedulerStore.cancel(jobId)
    if (cancelled) await removeScheduledRun(jobId)
    return cancelled
  }
}

export const schedulerService = new SchedulerService()
