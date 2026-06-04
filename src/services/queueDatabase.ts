// src/services/queueDatabase.ts - SQLite database layer for job queue

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'
import type { ErrorType } from './retryEngine'

// ============================================================================
// Types
// ============================================================================

export type JobType = 'direct' | 'batch' | 'scheduled' | 'automation'
export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface QueueJob {
  id: string
  campaign_id: string | null
  user_id: string
  type: JobType
  status: JobStatus
  priority: number
  config_id: string | null
  config_json: string
  contacts_json: string
  total_count: number
  sent_count: number
  failed_count: number
  last_processed_index: number
  batch_size: number
  email_delay_sec: number
  batch_delay_min: number
  scheduled_at: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
  last_error: string | null
  retry_count: number
  // Derived fields (not in DB)
  html_content?: string
  subject?: string
  from_email?: string
  from_name?: string
  config_name?: string
  notify_email?: string
}

export interface EnqueueOptions {
  campaignId?: string
  type?: JobType
  priority?: number
  batchSize?: number
  emailDelaySec?: number
  batchDelayMin?: number
  scheduledAt?: string
  htmlContent: string
  subject: string
  fromEmail: string
  fromName: string
  configId?: string
  configName?: string
  notifyEmail?: string
}

export interface DeadLetter {
  id: string
  job_id: string
  recipient_email: string
  recipient_name: string | null
  error_message: string | null
  error_code: string | null
  error_type: string | null
  attempts: number
  created_at: string
  last_attempt_at: string | null
}

export interface QueueStats {
  pending: number
  running: number
  paused: number
  completed: number
  failed: number
  cancelled: number
  total_sent: number
  total_failed: number
  dead_letters: number
}

// ============================================================================
// Queue Database
// ============================================================================

export class QueueDatabase {
  db: Database

  constructor(dbPath = './data/queue.db') {
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
  }

  // --------------------------------------------------------------------------
  // Schema
  // --------------------------------------------------------------------------

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        campaign_id TEXT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'batch',
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 5,
        config_id TEXT,
        config_json TEXT NOT NULL,
        contacts_json TEXT NOT NULL,
        html_content TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        from_email TEXT NOT NULL DEFAULT '',
        from_name TEXT NOT NULL DEFAULT '',
        config_name TEXT,
        notify_email TEXT,
        total_count INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        last_processed_index INTEGER NOT NULL DEFAULT 0,
        batch_size INTEGER DEFAULT 20,
        email_delay_sec INTEGER DEFAULT 45,
        batch_delay_min INTEGER DEFAULT 60,
        scheduled_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_at);

      CREATE TABLE IF NOT EXISTS dead_letters (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT,
        error_message TEXT,
        error_code TEXT,
        error_type TEXT,
        attempts INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_attempt_at TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_dl_job ON dead_letters(job_id);

      CREATE TABLE IF NOT EXISTS suppression_list (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, email)
      );

      CREATE INDEX IF NOT EXISTS idx_suppress_user ON suppression_list(user_id);
      CREATE INDEX IF NOT EXISTS idx_suppress_email ON suppression_list(email);
    `)

    // MIGRATION: Add config_id column to existing jobs tables.
    // CREATE TABLE IF NOT EXISTS won't add columns to a pre-existing data/queue.db,
    // so add it idempotently (swallow "duplicate column" on re-run).
    try {
      this.db.exec('ALTER TABLE jobs ADD COLUMN config_id TEXT')
      logger.debug('Added config_id column to jobs table')
    } catch {
      // Column already exists, ignore
    }

    logger.info('Queue database initialized (data/queue.db)')
  }

  // --------------------------------------------------------------------------
  // Job CRUD
  // --------------------------------------------------------------------------

  /**
   * Insert a new job
   */
  insertJob(
    jobId: string,
    campaignId: string,
    userId: string,
    emailConfigJson: string,
    contactsJson: string,
    contactsLength: number,
    options: EnqueueOptions
  ) {
    this.db
      .prepare(
        `
      INSERT INTO jobs (
        id, campaign_id, user_id, type, status, priority,
        config_id, config_json, contacts_json, html_content, subject, from_email, from_name,
        config_name, notify_email,
        total_count, batch_size, email_delay_sec, batch_delay_min, scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        jobId,
        campaignId,
        userId,
        options.type || 'batch',
        options.scheduledAt ? 'pending' : 'pending',
        options.priority ?? 5,
        options.configId || null,
        emailConfigJson,
        contactsJson,
        options.htmlContent,
        options.subject,
        options.fromEmail,
        options.fromName,
        options.configName || null,
        options.notifyEmail || null,
        contactsLength,
        options.batchSize ?? 20,
        options.emailDelaySec ?? 45,
        options.batchDelayMin ?? 60,
        options.scheduledAt || null
      )
  }

  /**
   * Get the next pending job by priority
   */
  dequeue(): QueueJob | null {
    return this.db
      .prepare(
        `
      SELECT * FROM jobs
      WHERE status = 'pending'
        AND (scheduled_at IS NULL OR scheduled_at <= datetime('now'))
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `
      )
      .get() as QueueJob | null
  }

  /**
   * Get a single job by ID
   */
  getJob(jobId: string): QueueJob | null {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as QueueJob | null
  }

  /**
   * Get jobs for a user, optionally filtered by status
   */
  getJobs(userId: string, status?: JobStatus, limit = 20, offset = 0): QueueJob[] {
    if (status) {
      return this.db
        .prepare(
          `
        SELECT * FROM jobs WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
      `
        )
        .all(userId, status, limit, offset) as QueueJob[]
    }
    return this.db
      .prepare(
        `
      SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `
      )
      .all(userId, limit, offset) as QueueJob[]
  }

  // --------------------------------------------------------------------------
  // Job Status Updates
  // --------------------------------------------------------------------------

  /**
   * Mark a job as running
   */
  markRunning(jobId: string) {
    this.db
      .prepare(
        `
      UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now')
      WHERE id = ?
    `
      )
      .run(jobId)
  }

  /**
   * Pause a running job
   */
  pause(jobId: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE jobs SET status = 'paused', updated_at = datetime('now')
      WHERE id = ? AND status = 'running'
    `
      )
      .run(jobId)
    return result.changes > 0
  }

  /**
   * Resume a paused job (set back to pending)
   */
  resume(jobId: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE jobs SET status = 'pending', updated_at = datetime('now')
      WHERE id = ? AND status = 'paused'
    `
      )
      .run(jobId)
    return result.changes > 0
  }

  /**
   * Cancel a job (pending, running, or paused)
   */
  cancel(jobId: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE jobs SET status = 'cancelled', completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status IN ('pending', 'running', 'paused')
    `
      )
      .run(jobId)
    return result.changes > 0
  }

  /**
   * Update job progress
   */
  updateProgress(
    jobId: string,
    lastProcessedIndex: number,
    sentCount: number,
    failedCount: number,
    lastError?: string
  ) {
    this.db
      .prepare(
        `
      UPDATE jobs SET
        last_processed_index = ?,
        sent_count = ?,
        failed_count = ?,
        last_error = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
      )
      .run(lastProcessedIndex, sentCount, failedCount, lastError || null, jobId)
  }

  /**
   * Mark job as completed
   */
  completeJob(jobId: string) {
    this.db
      .prepare(
        `
      UPDATE jobs SET
        status = 'completed',
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `
      )
      .run(jobId)
  }

  /**
   * Mark job as failed
   */
  failJob(jobId: string, error: string) {
    this.db
      .prepare(
        `
      UPDATE jobs SET
        status = 'failed',
        last_error = ?,
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `
      )
      .run(error, jobId)
  }

  // --------------------------------------------------------------------------
  // Dead Letter Queue
  // --------------------------------------------------------------------------

  /**
   * Add a permanently failed email to dead letter queue
   */
  addToDeadLetter(
    jobId: string,
    recipientEmail: string,
    recipientName: string | null,
    errorMessage: string,
    errorType: ErrorType,
    attempts: number
  ) {
    const id = generateId('dl')
    this.db
      .prepare(
        `
      INSERT INTO dead_letters (id, job_id, recipient_email, recipient_name, error_message, error_type, attempts, last_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
      )
      .run(id, jobId, recipientEmail, recipientName, errorMessage, errorType, attempts)
  }

  /**
   * Get dead letters, optionally filtered by job
   */
  getDeadLetters(jobId?: string, limit = 50, offset = 0): DeadLetter[] {
    if (jobId) {
      return this.db
        .prepare(
          `
        SELECT * FROM dead_letters WHERE job_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
      `
        )
        .all(jobId, limit, offset) as DeadLetter[]
    }
    return this.db
      .prepare(
        `
      SELECT * FROM dead_letters ORDER BY created_at DESC LIMIT ? OFFSET ?
    `
      )
      .all(limit, offset) as DeadLetter[]
  }

  // --------------------------------------------------------------------------
  // Suppression List
  // --------------------------------------------------------------------------

  /**
   * Check if email is suppressed for a user
   */
  isSuppressed(userId: string, email: string): boolean {
    const result = this.db
      .prepare(
        `
      SELECT 1 FROM suppression_list WHERE user_id = ? AND email = ?
    `
      )
      .get(userId, email.toLowerCase())
    return !!result
  }

  /**
   * Add email to suppression list
   */
  suppress(userId: string, email: string, reason: string, source?: string) {
    const id = generateId('sup')
    try {
      this.db
        .prepare(
          `
        INSERT OR IGNORE INTO suppression_list (id, user_id, email, reason, source)
        VALUES (?, ?, ?, ?, ?)
      `
        )
        .run(id, userId, email.toLowerCase(), reason, source || null)
    } catch {
      // Already exists, ignore
    }
  }

  /**
   * Remove email from suppression list
   */
  unsuppress(userId: string, email: string): boolean {
    const result = this.db
      .prepare(
        `
      DELETE FROM suppression_list WHERE user_id = ? AND email = ?
    `
      )
      .run(userId, email.toLowerCase())
    return result.changes > 0
  }

  /**
   * Get suppression list for a user
   */
  getSuppressionList(userId: string, limit = 50, offset = 0) {
    return this.db
      .prepare(
        `
      SELECT * FROM suppression_list WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `
      )
      .all(userId, limit, offset)
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Get queue statistics for a user
   */
  getStats(userId: string): QueueStats {
    const stats = this.db
      .prepare(
        `
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        COALESCE(SUM(sent_count), 0) as total_sent,
        COALESCE(SUM(failed_count), 0) as total_failed
      FROM jobs WHERE user_id = ?
    `
      )
      .get(userId) as any

    const dlCount = this.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM dead_letters dl
      JOIN jobs j ON dl.job_id = j.id WHERE j.user_id = ?
    `
      )
      .get(userId) as any

    return {
      pending: stats.pending || 0,
      running: stats.running || 0,
      paused: stats.paused || 0,
      completed: stats.completed || 0,
      failed: stats.failed || 0,
      cancelled: stats.cancelled || 0,
      total_sent: stats.total_sent || 0,
      total_failed: stats.total_failed || 0,
      dead_letters: dlCount?.count || 0,
    }
  }

  // --------------------------------------------------------------------------
  // Recovery & Cleanup
  // --------------------------------------------------------------------------

  /**
   * Recover jobs that were running when the server was interrupted
   */
  recoverInterruptedJobs(): number {
    const interrupted = this.db
      .prepare(
        `
      SELECT id FROM jobs WHERE status = 'running'
    `
      )
      .all() as { id: string }[]

    if (interrupted.length === 0) return 0

    this.db
      .prepare(
        `
      UPDATE jobs SET status = 'pending', updated_at = datetime('now')
      WHERE status = 'running'
    `
      )
      .run()

    logger.info(`Recovered ${interrupted.length} interrupted job(s)`)
    return interrupted.length
  }

  /**
   * Delete old completed/failed/cancelled jobs
   */
  cleanup(olderThanDays = 30): number {
    const result = this.db
      .prepare(
        `
      DELETE FROM jobs
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND completed_at < datetime('now', '-' || ? || ' days')
    `
      )
      .run(olderThanDays)

    if (result.changes > 0) {
      logger.debug(`Cleaned up ${result.changes} old jobs`)
    }
    return result.changes
  }
}
