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

  /**
   * Active jobs for the UI — SAFE projection only. NEVER selects email_job /
   * batch_config: those JSON blobs hold the EmailConfig (plaintext SMTP creds) and
   * the full recipient list, which must never reach the browser (R9). Use get() for
   * the internal processor path that needs the blobs.
   * Org-scoped (R9): legacy rows with org_id IS NULL are invisible via this path.
   */
  async getActive(orgId: string) {
    return getDb()
      .select({
        id: scheduled_jobs.id,
        user_id: scheduled_jobs.user_id,
        scheduled_time: scheduled_jobs.scheduled_time,
        status: scheduled_jobs.status,
        contact_count: scheduled_jobs.contact_count,
        subject: scheduled_jobs.subject,
        use_batch: scheduled_jobs.use_batch,
        notify_email: scheduled_jobs.notify_email,
        config_name: scheduled_jobs.config_name,
        cron_pattern: scheduled_jobs.cron_pattern,
        is_repeating: scheduled_jobs.is_repeating,
        created_at: scheduled_jobs.created_at,
      })
      .from(scheduled_jobs)
      .where(and(eq(scheduled_jobs.org_id, orgId), inArray(scheduled_jobs.status, ['scheduled', 'running'])))
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

  /** Cancel only an as-yet-unrun job owned by orgId (R9). Returns whether a row changed. */
  async cancel(id: string, orgId: string): Promise<boolean> {
    const changed = await getDb()
      .update(scheduled_jobs)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(scheduled_jobs.id, id),
          eq(scheduled_jobs.org_id, orgId),
          inArray(scheduled_jobs.status, ['scheduled', 'running'])
        )
      )
      .returning({ id: scheduled_jobs.id })
    return changed.length > 0
  },
}
