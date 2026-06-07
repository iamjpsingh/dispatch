// src/services/queueWorker.ts - Job processing worker with retry and notification

import { logService } from './logService'
import { d1Service } from './d1Service'
import { retryEngine } from './retryEngine'
import { frequencyCapService } from './frequencyCapService'
import { preferenceCenterService } from './preferenceCenterService'
import { graymailService } from './graymailService'
import { FileService } from './fileService'
import { logger } from '../utils/logger'
import { htmlToText } from '../utils/htmlToText'
import { createTransport, configFromRecord } from './transports'
import { eventBus } from './eventBus'
import type { EmailTransport } from './transports'
import type { QueueDatabase, QueueJob } from './queueDatabase'
import type { Contact } from '../types/index'

// ============================================================================
// Queue Worker
// ============================================================================

export class QueueWorker {
  private queueDb: QueueDatabase
  private maxConcurrent = 3
  private workerInterval: Timer | null = null
  private activeJobs: Map<string, { abort: boolean }> = new Map()

  constructor(queueDb: QueueDatabase) {
    this.queueDb = queueDb
  }

  // --------------------------------------------------------------------------
  // Worker Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the background worker that processes jobs
   */
  startWorker(intervalMs = 5000) {
    if (this.workerInterval) return

    this.workerInterval = setInterval(() => {
      this.processNextJob()
    }, intervalMs)

    logger.startup(`Queue worker started (polling every ${intervalMs / 1000}s, max ${this.maxConcurrent} concurrent)`)
  }

  /**
   * Stop the background worker
   */
  stopWorker() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval)
      this.workerInterval = null
      logger.info('Queue worker stopped')
    }
  }

  /**
   * Set max concurrent jobs
   */
  setMaxConcurrent(max: number) {
    this.maxConcurrent = Math.max(1, Math.min(max, 10))
  }

  /**
   * Get count of currently active jobs
   */
  getActiveJobCount(): number {
    return this.activeJobs.size
  }

  /**
   * Get IDs of currently active jobs
   */
  getActiveJobIds(): string[] {
    return Array.from(this.activeJobs.keys())
  }

  // --------------------------------------------------------------------------
  // Job Processing
  // --------------------------------------------------------------------------

  /**
   * Process the next available job (supports concurrency)
   */
  private async processNextJob() {
    // Check if we have capacity for more concurrent jobs
    if (this.activeJobs.size >= this.maxConcurrent) return

    const job = this.queueDb.dequeue()
    if (!job) return

    // Skip if this job is already being processed
    if (this.activeJobs.has(job.id)) return

    // Mark as running
    this.queueDb.markRunning(job.id)

    const control = { abort: false }
    this.activeJobs.set(job.id, control)

    logger.debug(
      `Processing job ${job.id}: ${job.total_count} contacts (from index ${job.last_processed_index}) [${this.activeJobs.size}/${this.maxConcurrent} slots]`
    )

    // Run in background -- don't await so worker can pick up more jobs
    this.executeJob(job, control).catch((error) => {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Job ${job.id} failed:`, msg)
      this.queueDb.failJob(job.id, msg)
      this.activeJobs.delete(job.id)
    })
  }

  /**
   * Execute a job -- send emails with retry and checkpoint
   */
  private async executeJob(job: QueueJob, control: { abort: boolean }) {
    const contacts: Contact[] = JSON.parse(job.contacts_json)
    const emailConfig = JSON.parse(job.config_json)

    // Create transport from config (supports SMTP, SES, Mailgun, SendGrid)
    const transport = createTransport(configFromRecord(emailConfig))

    // Provider attribution for routing/provider-stats events.
    // config_json holds a bare EmailConfig (no provider_type) for SMTP enqueues,
    // so default to 'smtp'; honor an explicit type if a typed transport config was stored.
    const providerType: string = emailConfig?.type || emailConfig?.provider_type || 'smtp'
    const configName = job.config_name || ''

    const campaignId = job.campaign_id || d1Service.generateCampaignId()
    let sentCount = job.sent_count
    let failedCount = job.failed_count
    let lastIndex = job.last_processed_index

    // Process from where we left off
    for (let i = lastIndex; i < contacts.length; i++) {
      // Check if paused or cancelled
      if (control.abort) {
        logger.debug(`Job ${job.id} interrupted at index ${i}`)
        this.queueDb.updateProgress(job.id, i, sentCount, failedCount)
        return
      }

      const contact = contacts[i]

      // Check suppression list
      if (this.queueDb.isSuppressed(job.user_id, contact.Email)) {
        logger.debug(`Skipping suppressed email: ${contact.Email}`)
        lastIndex = i + 1
        this.queueDb.updateProgress(job.id, lastIndex, sentCount, failedCount)
        continue
      }

      // Check frequency cap
      if (!(await frequencyCapService.canSend(job.user_id, contact.Email))) {
        logger.debug(`Skipping frequency-capped email: ${contact.Email}`)
        lastIndex = i + 1
        this.queueDb.updateProgress(job.id, lastIndex, sentCount, failedCount)
        continue
      }

      // Check email preferences (unsubscribed, paused, etc.)
      if (!(await preferenceCenterService.canReceive(job.user_id, contact.Email))) {
        logger.debug(`Skipping unsubscribed/paused email: ${contact.Email}`)
        lastIndex = i + 1
        this.queueDb.updateProgress(job.id, lastIndex, sentCount, failedCount)
        continue
      }

      // Check graymail suppression (no engagement after N sends)
      if (!(await graymailService.canSend(job.user_id, contact.Email))) {
        logger.debug(`Skipping graymail: ${contact.Email}`)
        lastIndex = i + 1
        this.queueDb.updateProgress(job.id, lastIndex, sentCount, failedCount)
        continue
      }

      // Attempt to send with retry
      const result = await this.sendWithRetry(job, contact, campaignId, transport)

      if (result.success) {
        sentCount++
        await frequencyCapService.logSend(job.user_id, contact.Email, campaignId)
        await graymailService.recordSend(job.user_id, contact.Email)

        // Emit for provider routing stats (payload.configId / payload.userId etc.)
        await eventBus.emit(
          'email_sent',
          job.user_id,
          {
            configId: job.config_id,
            providerType,
            configName,
            sendTimeMs: result.sendTimeMs,
          },
          job.campaign_id ?? undefined,
          undefined
        )
      } else {
        failedCount++

        await eventBus.emit(
          'email_failed',
          job.user_id,
          {
            configId: job.config_id,
            providerType,
            configName,
            error: result.error ?? 'Unknown error',
          },
          job.campaign_id ?? undefined,
          undefined
        )
      }

      lastIndex = i + 1

      // Checkpoint progress every email
      this.queueDb.updateProgress(job.id, lastIndex, sentCount, failedCount)

      // Delay between emails
      if (i < contacts.length - 1 && !control.abort) {
        const delaySec = job.email_delay_sec || 45

        // Check if we're at a batch boundary
        const batchSize = job.batch_size || 20
        const positionInBatch = (i - (job.last_processed_index || 0) + 1) % batchSize
        if (positionInBatch === 0 && i < contacts.length - 1) {
          // Batch boundary -- longer delay
          const batchDelayMs = (job.batch_delay_min || 1) * 60 * 1000
          logger.debug(`Batch boundary -- waiting ${job.batch_delay_min || 1} min before next batch`)
          await this.interruptibleSleep(batchDelayMs, control)
        } else {
          await this.interruptibleSleep(delaySec * 1000, control)
        }
      }
    }

    // Job completed
    this.queueDb.completeJob(job.id)
    this.activeJobs.delete(job.id)
    logger.info(`Job ${job.id} completed: ${sentCount} sent, ${failedCount} failed`)

    // Send completion notification
    if (job.notify_email) {
      await this.sendCompletionNotification(job, sentCount, failedCount)
    }
  }

  /**
   * Send a single email with retry logic
   */
  private async sendWithRetry(
    job: QueueJob,
    contact: Contact,
    campaignId: string,
    transport: EmailTransport
  ): Promise<{ success: boolean; sendTimeMs: number; error?: string }> {
    let attempts = 0
    const maxAttempts = 4 // 1 initial + 3 retries for temporary errors
    let lastError = ''

    while (attempts < maxAttempts) {
      const sendStart = Date.now()
      try {
        // Personalize content
        let personalizedContent = FileService.replacePlaceholders(job.html_content || '', contact)
        const personalizedSubject = FileService.replacePlaceholders(job.subject || '', contact)

        // Register tracking
        if (d1Service.isConfigured()) {
          const trackingResult = await d1Service.registerEmail({
            userId: job.user_id,
            campaignId,
            campaignName: `Campaign ${new Date().toLocaleDateString()}`,
            subject: personalizedSubject,
            fromEmail: job.from_email || '',
            fromName: job.from_name,
            recipientEmail: contact.Email,
            recipientName: contact.FirstName || String(contact['Name'] || ''),
            sendType: job.type === 'direct' ? 'direct' : 'batch',
            providerType: 'smtp',
            configName: job.config_name || '',
          })

          if (trackingResult) {
            personalizedContent = d1Service.injectTracking(personalizedContent, trackingResult.trackingId)
          }
        }

        // Compliance headers (CAN-SPAM, RFC 8058)
        const unsubUrl = job.from_email ? `mailto:${job.from_email}?subject=unsubscribe` : ''
        const feedbackId = `${job.id}:${Date.now()}:${job.from_email || 'noreply'}`

        const info = await transport.send({
          from: { name: job.from_name || '', email: job.from_email || '' },
          to: contact.Email,
          subject: personalizedSubject,
          html: personalizedContent,
          text: htmlToText(personalizedContent),
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            Precedence: 'bulk',
            'Feedback-ID': feedbackId,
          },
        })

        // Log success
        logService.addLog({
          id: `q_${job.id}_${Date.now()}`,
          email: contact.Email,
          status: 'Sent',
          timestamp: new Date().toISOString(),
          messageId: info.messageId,
          firstName: contact.FirstName,
          company: contact.Company,
          subject: personalizedSubject,
        })

        logger.debug(`[${job.id}] Sent to ${contact.Email} (${info.messageId})`)
        return { success: true, sendTimeMs: Date.now() - sendStart }
      } catch (error) {
        attempts++
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        lastError = errorMessage
        const errorType = retryEngine.classifyError(error instanceof Error ? error : errorMessage)

        logger.error(`[${job.id}] Failed ${contact.Email} (attempt ${attempts}, ${errorType}): ${errorMessage}`)

        if (errorType === 'permanent' || !retryEngine.shouldRetry(errorType, attempts)) {
          // Permanent failure -- dead letter queue
          this.queueDb.addToDeadLetter(
            job.id,
            contact.Email,
            contact.FirstName || null,
            errorMessage,
            errorType,
            attempts
          )

          // Suppress on hard bounce
          if (errorType === 'permanent') {
            this.queueDb.suppress(job.user_id, contact.Email, 'bounce_hard', `job:${job.id}`)
          }

          // Log failure
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

        // Wait before retry
        const delay = retryEngine.getRetryDelay(attempts, errorType)
        logger.debug(`Retrying ${contact.Email} in ${Math.round(delay / 1000)}s...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    return { success: false, sendTimeMs: 0, error: lastError || 'Unknown error' }
  }

  /**
   * Sleep that can be interrupted by pause/cancel
   */
  private async interruptibleSleep(ms: number, control: { abort: boolean }): Promise<void> {
    const interval = 1000 // Check every second
    let elapsed = 0
    while (elapsed < ms && !control.abort) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, ms - elapsed)))
      elapsed += interval
    }
  }

  /**
   * Send completion notification
   */
  private async sendCompletionNotification(job: QueueJob, sentCount: number, failedCount: number) {
    try {
      const { notificationService } = await import('./notificationService')

      await notificationService.sendJobCompletionNotification(
        job.user_id,
        job.notify_email!,
        {
          sent: sentCount,
          failed: failedCount,
          total: job.total_count,
          errors: 0,
        },
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

      logger.debug(`Completion notification sent to ${job.notify_email}`)
    } catch (error) {
      logger.error('Failed to send completion notification:', error)
    }
  }

  // --------------------------------------------------------------------------
  // Job Control (called by engine)
  // --------------------------------------------------------------------------

  /**
   * Signal a job to pause
   */
  signalPause(jobId: string) {
    const control = this.activeJobs.get(jobId)
    if (control) control.abort = true
  }

  /**
   * Signal a job to cancel
   */
  signalCancel(jobId: string) {
    const control = this.activeJobs.get(jobId)
    if (control) control.abort = true
  }
}
