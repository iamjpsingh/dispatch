// src/services/queueEngine.ts - Queue facade over BullMQ (live queue) + Postgres
// (durable history mirror). The public surface is unchanged in shape but ASYNC
// (sqlite was synchronous; PG/BullMQ are not). Enqueue writes the PG job row and
// adds per-batch BullMQ jobs; reads come from PG; sending runs in the worker process.

import { d1Service } from './d1Service'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'
import { queueStore } from './queue/queueStore'
import { enqueueCampaign, getSendQueue } from './queue/sendQueue'
import { suppressionStore } from './queue/suppressionStore'
import type { EmailConfig, Contact } from '../types/index'
import type { EnqueueOptions } from './queue/types'

// Re-export the queue types for backward compatibility (callers import from here).
export type { JobType, JobStatus, QueueJob, EnqueueOptions, DeadLetter, QueueStats } from './queue/types'
export type { ErrorType } from './retryEngine'

class QueueEngine {
  // --------------------------------------------------------------------------
  // Enqueue
  // --------------------------------------------------------------------------

  async enqueue(userId: string, emailConfig: EmailConfig, contacts: Contact[], options: EnqueueOptions): Promise<string> {
    const jobId = generateId('job')
    const campaignId = options.campaignId || d1Service.generateCampaignId()
    const batchSize = options.batchSize ?? 20

    await enqueueCampaign(
      {
        id: jobId,
        campaign_id: campaignId,
        org_id: options.orgId ?? null,
        user_id: userId,
        type: options.type || 'batch',
        status: 'pending',
        priority: options.priority ?? 5,
        config_id: options.configId ?? null,
        config_json: JSON.stringify(emailConfig),
        contacts_json: JSON.stringify(contacts),
        html_content: options.htmlContent,
        subject: options.subject,
        from_email: options.fromEmail,
        from_name: options.fromName,
        config_name: options.configName ?? null,
        notify_email: options.notifyEmail ?? null,
        total_count: contacts.length,
        batch_size: batchSize,
        email_delay_sec: options.emailDelaySec ?? 45,
        batch_delay_min: options.batchDelayMin ?? 60,
        scheduled_at: options.scheduledAt ?? null,
      },
      batchSize
    )

    logger.info(`Job enqueued: ${jobId} (${contacts.length} contacts, priority ${options.priority ?? 5})`)
    return jobId
  }

  // --------------------------------------------------------------------------
  // Job control (status flags the worker honors at batch start)
  // --------------------------------------------------------------------------

  async pause(jobId: string): Promise<boolean> {
    const ok = await queueStore.transition(jobId, ['pending', 'running'], 'paused')
    if (ok) logger.info(`Job paused: ${jobId}`)
    return ok
  }

  async resume(jobId: string): Promise<boolean> {
    const ok = await queueStore.transition(jobId, ['paused'], 'pending')
    if (ok) logger.info(`Job resumed: ${jobId}`)
    return ok
  }

  async cancel(jobId: string): Promise<boolean> {
    const ok = await queueStore.transition(jobId, ['pending', 'running', 'paused'], 'cancelled')
    if (ok) logger.info(`Job cancelled: ${jobId}`)
    return ok
  }

  // --------------------------------------------------------------------------
  // Queries (read the Postgres mirror)
  // --------------------------------------------------------------------------

  async getJob(jobId: string) {
    return queueStore.getJob(jobId)
  }

  async getJobs(userId: string, status?: import('./queue/types').JobStatus, limit = 20, offset = 0) {
    return queueStore.getJobs(userId, status, limit, offset)
  }

  async getStats(userId: string) {
    return queueStore.getStats(userId)
  }

  async getDeadLetters(jobId?: string, limit = 50, offset = 0) {
    return queueStore.getDeadLetters(jobId, limit, offset)
  }

  // --------------------------------------------------------------------------
  // Suppression list (PG-backed, org/user-scoped)
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Worker introspection (BullMQ-backed)
  // --------------------------------------------------------------------------

  async getActiveJobIds(): Promise<string[]> {
    const active = await getSendQueue().getActive()
    return active.map((j) => j.id ?? '').filter(Boolean)
  }

  /** BullMQ recovers stalled jobs natively; nothing to recover at boot. */
  async recoverInterruptedJobs(): Promise<number> {
    return 0
  }
}

export const queueEngine = new QueueEngine()
