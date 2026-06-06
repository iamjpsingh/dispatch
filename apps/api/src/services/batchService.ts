// src/services/batchService.ts - COMPLETE FIX WITH NOTIFICATION + TRACKING SUPPORT
import { emailService } from './emailService'
import { logService } from './logService'
import { FileService } from './fileService'
import { d1Service } from './d1Service'
import { logger } from '../utils/logger'
import type { BatchJob, BatchConfig, EmailJob, Contact, BatchStatusInfo } from '../types/index'

class BatchService {
  private currentJob: BatchJob | null = null
  private isRunning = false
  private timeoutId: NodeJS.Timeout | null = null
  private totalJobs = 0
  private completedJobs = 0

  // UPDATED: Accept notification settings parameter
  async startBatchJob(
    emailJob: EmailJob,
    batchConfig: BatchConfig,
    notificationSettings?: {
      email: string
      userId: string
      configName?: string
    }
  ): Promise<string> {
    if (this.isRunning) {
      throw new Error('A batch job is already running')
    }

    const jobId = `batch_${Date.now()}`
    const totalBatches = Math.ceil(emailJob.contacts.length / batchConfig.batchSize)

    // Create batch job with notification settings
    this.currentJob = {
      id: jobId,
      totalContacts: emailJob.contacts.length,
      currentBatch: 0,
      totalBatches,
      emailsSent: 0,
      emailsFailed: 0,
      status: 'Running',
      startTime: new Date().toISOString(),
      config: batchConfig,
      emailJob,
      notificationSettings, // NEW
      userId: notificationSettings?.userId, // NEW
      configName: notificationSettings?.configName, // NEW
    }

    this.isRunning = true
    this.totalJobs++

    logger.info(
      `Starting batch job ${jobId} for user ${notificationSettings?.userId || 'unknown'}: ${emailJob.contacts.length} contacts → ${totalBatches} batches of ${batchConfig.batchSize}, ${batchConfig.emailDelay}s between emails, ${batchConfig.batchDelay}min between batches`
    )

    // Configure email service
    emailService.createTransport(emailJob.config)

    // Start processing first batch
    this.processNextBatch()

    return jobId
  }

  async pauseCurrentJob(): Promise<void> {
    if (this.currentJob && this.isRunning) {
      this.currentJob.status = 'Paused'
      this.isRunning = false

      if (this.timeoutId) {
        clearTimeout(this.timeoutId)
        this.timeoutId = null
      }

      logger.info(`Batch job ${this.currentJob.id} paused`)
    }
  }

  async resumeCurrentJob(): Promise<void> {
    if (this.currentJob && this.currentJob.status === 'Paused') {
      this.currentJob.status = 'Running'
      this.isRunning = true

      logger.info(`Batch job ${this.currentJob.id} resumed`)

      // Continue processing
      this.processNextBatch()
    }
  }

  async cancelCurrentJob(): Promise<void> {
    if (this.currentJob) {
      this.currentJob.status = 'Failed'
      this.isRunning = false

      if (this.timeoutId) {
        clearTimeout(this.timeoutId)
        this.timeoutId = null
      }

      logger.info(`Batch job ${this.currentJob.id} cancelled`)
      this.completedJobs++
      this.currentJob = null
    }
  }

  getBatchStatus(): BatchStatusInfo {
    return {
      isRunning: this.isRunning,
      currentJob: this.currentJob,
      totalJobs: this.totalJobs,
      completedJobs: this.completedJobs,
    }
  }

  private async processNextBatch(): Promise<void> {
    if (!this.currentJob || !this.isRunning) {
      return
    }

    const job = this.currentJob
    const { contacts } = job.emailJob
    const { batchSize } = job.config

    // Check if we've processed all batches
    if (job.currentBatch >= job.totalBatches) {
      await this.completeBatchJob()
      return
    }

    // Get contacts for current batch
    const startIndex = job.currentBatch * batchSize
    const endIndex = Math.min(startIndex + batchSize, contacts.length)
    const batchContacts = contacts.slice(startIndex, endIndex)

    job.currentBatch++

    logger.debug(`Processing batch ${job.currentBatch}/${job.totalBatches} (${batchContacts.length} contacts)`)

    try {
      // Process current batch
      await this.processBatch(batchContacts, job)

      // Schedule next batch if there are more
      if (job.currentBatch < job.totalBatches && this.isRunning) {
        await this.scheduleNextBatch(job)
      } else {
        await this.completeBatchJob()
      }
    } catch (error) {
      logger.error(`Batch ${job.currentBatch} failed:`, error)
      job.status = 'Failed'
      this.isRunning = false
      this.completedJobs++
    }
  }

  private async processBatch(contacts: Contact[], job: BatchJob): Promise<void> {
    const { emailJob, config } = job

    // Generate campaign ID for this batch job (reuse across all batches)
    const campaignId = (job as any).campaignId || d1Service.generateCampaignId()
    ;(job as any).campaignId = campaignId

    for (let i = 0; i < contacts.length; i++) {
      if (!this.isRunning) {
        break // Stop if paused or cancelled
      }

      const contact = contacts[i]

      try {
        // Replace placeholders in HTML content
        let personalizedContent = FileService.replacePlaceholders(emailJob.htmlContent, contact)
        const personalizedSubject = FileService.replacePlaceholders(emailJob.subject, contact)

        // Register with tracking service and inject tracking
        if (d1Service.isConfigured() && job.userId) {
          const trackingResult = await d1Service.registerEmail({
            userId: job.userId,
            campaignId,
            campaignName: `Batch Campaign ${new Date().toLocaleDateString()}`,
            subject: personalizedSubject,
            fromEmail: emailJob.fromEmail,
            fromName: emailJob.fromName,
            recipientEmail: contact.Email,
            recipientName: contact.FirstName || String(contact['Name'] || ''),
            sendType: 'batch',
            providerType: 'smtp',
            configName: job.configName || '',
          })

          if (trackingResult) {
            personalizedContent = d1Service.injectTracking(personalizedContent, trackingResult.trackingId)
          }
        }

        const mailOptions = {
          from: `${emailJob.fromName} <${emailJob.fromEmail}>`,
          to: contact.Email,
          subject: personalizedSubject,
          html: personalizedContent,
        }

        const info = await emailService.sendSingleEmail(mailOptions)

        logService.addLog({
          id: `batch_${job.id}_${Date.now()}_${i}`,
          email: contact.Email,
          status: 'Sent',
          timestamp: new Date().toISOString(),
          messageId: info.messageId,
          firstName: contact.FirstName,
          company: contact.Company,
          subject: personalizedSubject,
        })

        job.emailsSent++
        logger.debug(`Email sent to ${contact.Email} (${job.emailsSent}/${job.totalContacts})`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        logService.addLog({
          id: `batch_${job.id}_${Date.now()}_${i}`,
          email: contact.Email,
          status: 'Failed',
          message: errorMessage,
          timestamp: new Date().toISOString(),
          firstName: contact.FirstName,
          company: contact.Company,
          subject: emailJob.subject,
        })

        job.emailsFailed++
        logger.error(`Failed to send email to ${contact.Email}:`, errorMessage)
      }

      // Add delay between emails if not the last email in batch
      if (i < contacts.length - 1 && this.isRunning) {
        const delay = config.emailDelay * 1000
        logger.debug(`Waiting ${config.emailDelay}s before next email...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  private async scheduleNextBatch(job: BatchJob): Promise<void> {
    const delayMs = job.config.batchDelay * 60 * 1000 // Convert minutes to milliseconds
    const nextBatchTime = new Date(Date.now() + delayMs)

    job.nextBatchTime = nextBatchTime.toISOString()

    logger.debug(`Next batch scheduled for ${nextBatchTime.toLocaleString()} (${job.config.batchDelay} minutes)`)

    this.timeoutId = setTimeout(() => {
      if (this.isRunning && this.currentJob) {
        this.processNextBatch()
      }
    }, delayMs)
  }

  // UPDATED: Include notification support
  private async completeBatchJob(): Promise<void> {
    if (this.currentJob) {
      this.currentJob.status = 'Completed'
      this.currentJob.nextBatchTime = undefined
      this.isRunning = false
      this.completedJobs++

      logger.info(
        `Batch job ${this.currentJob.id} completed: ${this.currentJob.emailsSent} sent, ${this.currentJob.emailsFailed} failed`
      )

      // NEW: Send completion notification if requested
      if (this.currentJob.notificationSettings?.email) {
        await this.sendBatchCompletionNotification()
      }

      // Clean up
      if (this.timeoutId) {
        clearTimeout(this.timeoutId)
        this.timeoutId = null
      }

      // Clear current job after a delay
      setTimeout(() => {
        this.currentJob = null
      }, 30000) // Keep job info for 30 seconds
    }
  }

  // NEW: Send batch completion notification
  private async sendBatchCompletionNotification(): Promise<void> {
    if (!this.currentJob?.notificationSettings?.email) return

    try {
      const { notificationService } = await import('./notificationService')

      const jobStats = {
        sent: this.currentJob.emailsSent,
        failed: this.currentJob.emailsFailed,
        total: this.currentJob.totalContacts,
        errors: 0,
      }

      const jobDetails = {
        id: this.currentJob.id,
        subject: this.currentJob.emailJob.subject,
        startTime: this.currentJob.startTime,
        endTime: new Date().toISOString(),
        configUsed: this.currentJob.configName || 'Batch Configuration',
        batchMode: true,
      }

      logger.debug(`Sending batch completion notification to ${this.currentJob.notificationSettings.email}`)

      const success = await notificationService.sendJobCompletionNotification(
        this.currentJob.userId!,
        this.currentJob.notificationSettings.email,
        jobStats,
        jobDetails,
        jobDetails.configUsed
      )

      if (success) {
        logger.debug('Batch completion notification sent')
      } else {
        logger.error('Failed to send batch completion notification')
      }
    } catch (error) {
      logger.error('Failed to send batch completion notification:', error)
    }
  }
}

export const batchService = new BatchService()
