// src/services/queue/schedulerProcessor.ts - fire a due scheduled job.
// When a BullMQ delayed scheduler job fires, route the send through the unified
// send queue (queueEngine.enqueue) so scheduled sends get the same gates + worker.
import { schedulerStore } from './schedulerStore'
import { queueEngine } from '../queueEngine'
import { logger } from '../../utils/logger'
import type { EmailJob, BatchConfig } from '../../types/index'

export async function processScheduledRun(scheduledJobId: string): Promise<void> {
  const row = await schedulerStore.get(scheduledJobId)
  if (!row) return
  if (row.status !== 'scheduled' && row.status !== 'running') return // cancelled / already done

  await schedulerStore.markRunning(scheduledJobId)

  try {
    const emailJob: EmailJob = JSON.parse(row.email_job)
    const batchConfig: BatchConfig | null = row.batch_config ? JSON.parse(row.batch_config) : null
    const useBatch = !!batchConfig

    await queueEngine.enqueue(row.user_id, emailJob.config, emailJob.contacts, {
      type: useBatch ? 'batch' : 'direct',
      htmlContent: emailJob.htmlContent,
      subject: emailJob.subject,
      fromEmail: emailJob.fromEmail,
      fromName: emailJob.fromName,
      configName: row.config_name ?? undefined,
      notifyEmail: row.notify_email ?? undefined,
      batchSize: useBatch ? batchConfig!.batchSize : emailJob.contacts.length,
      emailDelaySec: useBatch ? batchConfig!.emailDelay : emailJob.delay,
      batchDelayMin: useBatch ? batchConfig!.batchDelay : 0,
      priority: 5,
    })

    await schedulerStore.markCompleted(scheduledJobId)
    logger.info(`Scheduled job ${scheduledJobId} fired -> enqueued send`)
  } catch (error) {
    await schedulerStore.markFailed(scheduledJobId)
    logger.error(`Scheduled job ${scheduledJobId} failed:`, error)
  }
}
