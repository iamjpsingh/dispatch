// src/services/queue/queueStore.ts - PG-backed job + dead-letter history mirror (async).
// Replaces QueueDatabase's job CRUD. BullMQ owns the live queue; Postgres is the
// durable record + the source for the stats/queue UI. Mirrors the sqlite encoding.
import { and, eq, desc, sql, notInArray } from 'drizzle-orm'
import { getDb } from '../../db/pg/client'
import { jobs, dead_letters, type JobRow, type DeadLetterRow } from '../../db/pg/schema'
import { generateId } from '../../utils/id'
import type { JobStatus, QueueStats } from '../queueDatabase'

type NewJobRow = typeof jobs.$inferInsert

export const queueStore = {
  async insertJob(row: NewJobRow): Promise<void> {
    await getDb().insert(jobs).values(row)
  },

  async getJob(jobId: string): Promise<JobRow | null> {
    const [row] = await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
    return row ?? null
  },

  async getJobs(userId: string, status?: JobStatus, limit = 20, offset = 0): Promise<JobRow[]> {
    const where = status ? and(eq(jobs.user_id, userId), eq(jobs.status, status)) : eq(jobs.user_id, userId)
    return getDb().select().from(jobs).where(where).orderBy(desc(jobs.created_at)).limit(limit).offset(offset)
  },

  async markRunning(jobId: string): Promise<void> {
    // Guarded: never resurrect a terminal job (a straggler batch must not flip
    // a completed/cancelled job back to running).
    await getDb()
      .update(jobs)
      .set({ status: 'running', started_at: sql`coalesce(${jobs.started_at}, now())`, updated_at: new Date().toISOString() })
      .where(and(eq(jobs.id, jobId), notInArray(jobs.status, ['completed', 'failed', 'cancelled'])))
  },

  async updateProgress(
    jobId: string,
    lastProcessedIndex: number,
    sentCount: number,
    failedCount: number,
    lastError?: string
  ): Promise<void> {
    await getDb()
      .update(jobs)
      .set({
        last_processed_index: lastProcessedIndex,
        sent_count: sentCount,
        failed_count: failedCount,
        last_error: lastError ?? null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(jobs.id, jobId))
  },

  /** Atomically add to the progress counters (for concurrent per-batch processing). Returns the new processed index. */
  async advanceProgress(jobId: string, processedDelta: number, sentDelta: number, failedDelta: number): Promise<number> {
    const [r] = await getDb()
      .update(jobs)
      .set({
        last_processed_index: sql`${jobs.last_processed_index} + ${processedDelta}`,
        sent_count: sql`${jobs.sent_count} + ${sentDelta}`,
        failed_count: sql`${jobs.failed_count} + ${failedDelta}`,
        updated_at: new Date().toISOString(),
      })
      .where(eq(jobs.id, jobId))
      .returning({ idx: jobs.last_processed_index })
    return r?.idx ?? 0
  },

  async completeJob(jobId: string): Promise<void> {
    const now = new Date().toISOString()
    await getDb().update(jobs).set({ status: 'completed', completed_at: now, updated_at: now }).where(eq(jobs.id, jobId))
  },

  async failJob(jobId: string, error: string): Promise<void> {
    const now = new Date().toISOString()
    await getDb()
      .update(jobs)
      .set({ status: 'failed', last_error: error, completed_at: now, updated_at: now })
      .where(eq(jobs.id, jobId))
  },

  /** Generic status transition (pause/resume/cancel logic lives in the facade). */
  async setStatus(jobId: string, status: JobStatus): Promise<boolean> {
    const changed = await getDb()
      .update(jobs)
      .set({ status, updated_at: new Date().toISOString() })
      .where(eq(jobs.id, jobId))
      .returning({ id: jobs.id })
    return changed.length > 0
  },

  async addToDeadLetter(
    jobId: string,
    recipientEmail: string,
    recipientName: string | null,
    errorMessage: string,
    errorType: string,
    attempts: number
  ): Promise<void> {
    await getDb().insert(dead_letters).values({
      id: generateId('dl'),
      job_id: jobId,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      error_message: errorMessage,
      error_type: errorType,
      attempts,
      last_attempt_at: new Date().toISOString(),
    })
  },

  async getDeadLetters(jobId?: string, limit = 50, offset = 0): Promise<DeadLetterRow[]> {
    const q = getDb().select().from(dead_letters)
    const rows = jobId
      ? await q.where(eq(dead_letters.job_id, jobId)).orderBy(desc(dead_letters.created_at)).limit(limit).offset(offset)
      : await q.orderBy(desc(dead_letters.created_at)).limit(limit).offset(offset)
    return rows
  },

  async getStats(userId: string): Promise<QueueStats> {
    const [agg] = await getDb()
      .select({
        pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending')`,
        running: sql<number>`count(*) filter (where ${jobs.status} = 'running')`,
        paused: sql<number>`count(*) filter (where ${jobs.status} = 'paused')`,
        completed: sql<number>`count(*) filter (where ${jobs.status} = 'completed')`,
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')`,
        cancelled: sql<number>`count(*) filter (where ${jobs.status} = 'cancelled')`,
        total_sent: sql<number>`coalesce(sum(${jobs.sent_count}), 0)`,
        total_failed: sql<number>`coalesce(sum(${jobs.failed_count}), 0)`,
      })
      .from(jobs)
      .where(eq(jobs.user_id, userId))

    const [dl] = await getDb()
      .select({ c: sql<number>`count(*)` })
      .from(dead_letters)
      .innerJoin(jobs, eq(dead_letters.job_id, jobs.id))
      .where(eq(jobs.user_id, userId))

    return {
      pending: Number(agg?.pending ?? 0),
      running: Number(agg?.running ?? 0),
      paused: Number(agg?.paused ?? 0),
      completed: Number(agg?.completed ?? 0),
      failed: Number(agg?.failed ?? 0),
      cancelled: Number(agg?.cancelled ?? 0),
      total_sent: Number(agg?.total_sent ?? 0),
      total_failed: Number(agg?.total_failed ?? 0),
      dead_letters: Number(dl?.c ?? 0),
    }
  },
}
