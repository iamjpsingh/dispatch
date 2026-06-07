// src/services/queue/schedulerStore.ts - PG-backed scheduled_jobs CRUD (async).
// Replaces the data/scheduler.db sqlite store. BullMQ owns the timing (delayed jobs);
// Postgres is the durable record + the source for the scheduled-jobs UI.
import { and, eq, asc, inArray } from 'drizzle-orm'
import { getDb } from '../../db/pg/client'
import { scheduled_jobs, type ScheduledJobRow } from '../../db/pg/schema'

type NewScheduledJobRow = typeof scheduled_jobs.$inferInsert

export const schedulerStore = {
  async create(row: NewScheduledJobRow): Promise<void> {
    await getDb().insert(scheduled_jobs).values(row)
  },

  async get(id: string): Promise<ScheduledJobRow | null> {
    const [r] = await getDb().select().from(scheduled_jobs).where(eq(scheduled_jobs.id, id)).limit(1)
    return r ?? null
  },

  async getActive(): Promise<ScheduledJobRow[]> {
    return getDb()
      .select()
      .from(scheduled_jobs)
      .where(inArray(scheduled_jobs.status, ['scheduled', 'running']))
      .orderBy(asc(scheduled_jobs.scheduled_time))
  },

  async markRunning(id: string): Promise<void> {
    await getDb()
      .update(scheduled_jobs)
      .set({ status: 'running', started_at: new Date().toISOString() })
      .where(eq(scheduled_jobs.id, id))
  },

  async markCompleted(id: string): Promise<void> {
    await getDb()
      .update(scheduled_jobs)
      .set({ status: 'completed', completed_at: new Date().toISOString() })
      .where(eq(scheduled_jobs.id, id))
  },

  async markFailed(id: string): Promise<void> {
    await getDb().update(scheduled_jobs).set({ status: 'failed' }).where(eq(scheduled_jobs.id, id))
  },

  /** Cancel only an as-yet-unrun job. Returns whether a row changed. */
  async cancel(id: string): Promise<boolean> {
    const changed = await getDb()
      .update(scheduled_jobs)
      .set({ status: 'cancelled' })
      .where(and(eq(scheduled_jobs.id, id), inArray(scheduled_jobs.status, ['scheduled', 'running'])))
      .returning({ id: scheduled_jobs.id })
    return changed.length > 0
  },
}
