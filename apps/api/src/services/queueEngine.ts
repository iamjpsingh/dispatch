// src/services/queueEngine.ts - SQLite-backed Persistent Job Queue (facade)

import { d1Service } from './d1Service'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'
import { QueueDatabase } from './queueDatabase'
import { QueueWorker } from './queueWorker'
import { suppressionStore } from './queue/suppressionStore'
import type { EmailConfig, Contact } from '../types/index'

// Re-export types from queueDatabase for backward compatibility
export type { JobType, JobStatus, QueueJob, EnqueueOptions, DeadLetter, QueueStats } from './queueDatabase'
export type { ErrorType } from './retryEngine'

// ============================================================================
// Queue Engine (facade over QueueDatabase + QueueWorker)
// ============================================================================

class QueueEngine {
  private queueDb: QueueDatabase
  private worker: QueueWorker

  constructor() {
    this.queueDb = new QueueDatabase()
    this.worker = new QueueWorker(this.queueDb)
  }

  // --------------------------------------------------------------------------
  // Enqueue / Dequeue
  // --------------------------------------------------------------------------

  /**
   * Add a new job to the queue
   */
  enqueue(
    userId: string,
    emailConfig: EmailConfig,
    contacts: Contact[],
    options: import('./queueDatabase').EnqueueOptions
  ): string {
    const jobId = generateId('job')
    const campaignId = options.campaignId || d1Service.generateCampaignId()

    this.queueDb.insertJob(
      jobId,
      campaignId,
      userId,
      JSON.stringify(emailConfig),
      JSON.stringify(contacts),
      contacts.length,
      options
    )

    logger.info(`Job enqueued: ${jobId} (${contacts.length} contacts, priority ${options.priority ?? 5})`)
    return jobId
  }

  // --------------------------------------------------------------------------
  // Job Control (delegates to DB + signals worker)
  // --------------------------------------------------------------------------

  /**
   * Pause a running job
   */
  pause(jobId: string): boolean {
    const result = this.queueDb.pause(jobId)
    if (result) {
      this.worker.signalPause(jobId)
      logger.info(`Job paused: ${jobId}`)
    }
    return result
  }

  /**
   * Resume a paused job
   */
  resume(jobId: string): boolean {
    const result = this.queueDb.resume(jobId)
    if (result) {
      logger.info(`Job resumed: ${jobId}`)
    }
    return result
  }

  /**
   * Cancel a job (pending, running, or paused)
   */
  cancel(jobId: string): boolean {
    const result = this.queueDb.cancel(jobId)
    if (result) {
      this.worker.signalCancel(jobId)
      logger.info(`Job cancelled: ${jobId}`)
    }
    return result
  }

  // --------------------------------------------------------------------------
  // Query Methods (delegates to DB)
  // --------------------------------------------------------------------------

  getJob(jobId: string) {
    return this.queueDb.getJob(jobId)
  }

  getJobs(userId: string, status?: import('./queueDatabase').JobStatus, limit = 20, offset = 0) {
    return this.queueDb.getJobs(userId, status, limit, offset)
  }

  getStats(userId: string) {
    return this.queueDb.getStats(userId)
  }

  getDeadLetters(jobId?: string, limit = 50, offset = 0) {
    return this.queueDb.getDeadLetters(jobId, limit, offset)
  }

  // --------------------------------------------------------------------------
  // Suppression List (delegates to DB)
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
  // Worker Control (delegates to worker)
  // --------------------------------------------------------------------------

  startWorker(intervalMs = 5000) {
    this.worker.startWorker(intervalMs)
  }

  stopWorker() {
    this.worker.stopWorker()
  }

  setMaxConcurrent(max: number) {
    this.worker.setMaxConcurrent(max)
  }

  getActiveJobCount(): number {
    return this.worker.getActiveJobCount()
  }

  getActiveJobIds(): string[] {
    return this.worker.getActiveJobIds()
  }

  // --------------------------------------------------------------------------
  // Recovery & Cleanup (delegates to DB)
  // --------------------------------------------------------------------------

  recoverInterruptedJobs(): number {
    return this.queueDb.recoverInterruptedJobs()
  }

  cleanup(olderThanDays = 30): number {
    return this.queueDb.cleanup(olderThanDays)
  }

  // --------------------------------------------------------------------------
  // Progress Tracking (delegates to DB)
  // --------------------------------------------------------------------------

  updateProgress(
    jobId: string,
    lastProcessedIndex: number,
    sentCount: number,
    failedCount: number,
    lastError?: string
  ) {
    this.queueDb.updateProgress(jobId, lastProcessedIndex, sentCount, failedCount, lastError)
  }
}

export const queueEngine = new QueueEngine()
