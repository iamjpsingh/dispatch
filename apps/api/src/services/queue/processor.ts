// src/services/queue/processor.ts - BullMQ batch processor for the campaign send queue.
// Loads the durable PG job row, processes ONLY its batch slice, enforces the
// send-time gates, sends with retry, dead-letters/suppresses permanent failures,
// mirrors progress to PG atomically, and completes the job when the last batch lands.
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/pg/client'
import { jobs } from '../../db/pg/schema'
import { queueStore } from './queueStore'
import { evaluateGates } from './gates'
import { suppressionStore } from './suppressionStore'
import { frequencyCapService } from '../frequencyCapService'
import { graymailService } from '../graymailService'
import { eventBus } from '../eventBus'
import { createTransport, configFromRecord, type EmailTransport } from '../transports'
import { FileService } from '../fileService'
import { d1Service } from '../d1Service'
import { retryEngine } from '../retryEngine'
import { logService } from '../logService'
import { htmlToText } from '../../utils/htmlToText'
import { logger } from '../../utils/logger'
import type { JobRow } from '../../db/pg/schema'
import type { Contact } from '../../types/index'

const TERMINAL = new Set(['paused', 'cancelled', 'completed'])

/**
 * Process one recipient batch of a campaign send. Safe to retry (BullMQ); per-recipient
 * at-most-once is not guaranteed (matches the legacy behaviour — no send receipts).
 */
export async function processSendBatch(jobId: string, batchIndex: number): Promise<void> {
  const job = await queueStore.getJob(jobId)
  if (!job) return
  if (TERMINAL.has(job.status)) return

  await queueStore.markRunning(jobId)

  const contacts: Contact[] = JSON.parse(job.contacts_json)
  const size = job.batch_size ?? 20
  const slice = contacts.slice(batchIndex * size, batchIndex * size + size)

  const emailConfig = JSON.parse(job.config_json)
  const transport = createTransport(configFromRecord(emailConfig))
  const providerType: string = emailConfig?.type || emailConfig?.provider_type || 'smtp'
  const configName = job.config_name || ''
  const campaignId = job.campaign_id || d1Service.generateCampaignId()

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const contact of slice) {
    const gate = await evaluateGates(job.user_id, job.org_id, contact.Email)
    if (!gate.allowed) {
      logger.debug(`[${job.id}] skip ${contact.Email} (${gate.reason})`)
      skipped++
      continue
    }

    const result = await sendOne(job, contact, campaignId, transport)

    if (result.success) {
      sent++
      if (job.org_id) {
        await frequencyCapService.logSend(job.org_id, contact.Email, campaignId)
        await graymailService.recordSend(job.org_id, contact.Email)
      }
      await eventBus.emit(
        'email_sent',
        job.user_id,
        { configId: job.config_id, providerType, configName, sendTimeMs: result.sendTimeMs },
        job.campaign_id ?? undefined,
        undefined
      )
    } else {
      failed++
      await eventBus.emit(
        'email_failed',
        job.user_id,
        { configId: job.config_id, providerType, configName, error: result.error ?? 'Unknown error' },
        job.campaign_id ?? undefined,
        undefined
      )
    }

    if (job.email_delay_sec && job.email_delay_sec > 0) {
      await new Promise((r) => setTimeout(r, job.email_delay_sec! * 1000))
    }
  }

  const processedIndex = await queueStore.advanceProgress(jobId, sent + failed + skipped, sent, failed)
  logger.debug(`[${job.id}] batch ${batchIndex}: ${sent} sent, ${failed} failed, ${skipped} skipped (${processedIndex}/${job.total_count})`)

  if (processedIndex >= job.total_count) {
    await queueStore.completeJob(jobId)
    if (job.notify_email) await notifyCompletion(jobId)
  }
}

/** Send one email with retry; dead-letter + suppress on permanent failure. */
async function sendOne(
  job: JobRow,
  contact: Contact,
  campaignId: string,
  transport: EmailTransport
): Promise<{ success: boolean; sendTimeMs: number; error?: string }> {
  const maxAttempts = 4 // 1 initial + 3 retries for temporary errors
  let attempts = 0
  let lastError = ''

  while (attempts < maxAttempts) {
    const sendStart = Date.now()
    try {
      let html = FileService.replacePlaceholders(job.html_content || '', contact)
      const subject = FileService.replacePlaceholders(job.subject || '', contact)

      if (d1Service.isConfigured()) {
        const tracking = await d1Service.registerEmail({
          userId: job.user_id,
          campaignId,
          campaignName: `Campaign ${new Date().toLocaleDateString()}`,
          subject,
          fromEmail: job.from_email || '',
          fromName: job.from_name,
          recipientEmail: contact.Email,
          recipientName: contact.FirstName || String(contact['Name'] || ''),
          sendType: job.type === 'direct' ? 'direct' : 'batch',
          providerType: 'smtp',
          configName: job.config_name || '',
        })
        if (tracking) html = d1Service.injectTracking(html, tracking.trackingId)
      }

      const unsubUrl = job.from_email ? `mailto:${job.from_email}?subject=unsubscribe` : ''
      const info = await transport.send({
        from: { name: job.from_name || '', email: job.from_email || '' },
        to: contact.Email,
        subject,
        html,
        text: htmlToText(html),
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          Precedence: 'bulk',
          'Feedback-ID': `${job.id}:${Date.now()}:${job.from_email || 'noreply'}`,
        },
      })

      logService.addLog({
        id: `q_${job.id}_${Date.now()}`,
        email: contact.Email,
        status: 'Sent',
        timestamp: new Date().toISOString(),
        messageId: info.messageId,
        firstName: contact.FirstName,
        company: contact.Company,
        subject,
      })
      return { success: true, sendTimeMs: Date.now() - sendStart }
    } catch (error) {
      attempts++
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      lastError = errorMessage
      const errorType = retryEngine.classifyError(error instanceof Error ? error : errorMessage)
      logger.error(`[${job.id}] failed ${contact.Email} (attempt ${attempts}, ${errorType}): ${errorMessage}`)

      if (errorType === 'permanent' || !retryEngine.shouldRetry(errorType, attempts)) {
        await queueStore.addToDeadLetter(job.id, contact.Email, contact.FirstName || null, errorMessage, errorType, attempts)
        if (errorType === 'permanent') {
          await suppressionStore.suppress(job.user_id, contact.Email, 'bounce_hard', `job:${job.id}`)
        }
        logService.addLog({
          id: `q_${job.id}_${Date.now()}`,
          email: contact.Email,
          status: 'Failed',
          message: `${retryEngine.describeError(errorType)} (${errorMessage})`,
          timestamp: new Date().toISOString(),
          firstName: contact.FirstName,
          company: contact.Company,
          subject: job.subject || '',
        })
        return { success: false, sendTimeMs: 0, error: lastError }
      }

      await new Promise((r) => setTimeout(r, retryEngine.getRetryDelay(attempts, errorType)))
    }
  }
  return { success: false, sendTimeMs: 0, error: lastError || 'Unknown error' }
}

/** Best-effort completion email (mirrors the legacy worker). */
async function notifyCompletion(jobId: string): Promise<void> {
  try {
    const [job] = await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
    if (!job?.notify_email) return
    const { notificationService } = await import('../notificationService')
    await notificationService.sendJobCompletionNotification(
      job.user_id,
      job.notify_email,
      { sent: job.sent_count, failed: job.failed_count, total: job.total_count, errors: 0 },
      {
        id: job.id,
        subject: job.subject || '',
        startTime: job.started_at || job.created_at,
        endTime: new Date().toISOString(),
        configUsed: job.config_name || 'Queue Job',
        batchMode: job.type === 'batch',
      },
      job.config_name || 'Queue Job'
    )
  } catch (error) {
    logger.error('Failed to send completion notification:', error)
  }
}
