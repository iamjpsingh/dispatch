import { lt } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { event_analytics, engagement_events, email_logs } from '../db/pg/schema'

class RetentionService {
  async purgeExpired(now: Date, windowDays: number): Promise<{ table: string; deleted: number }[]> {
    const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString()
    const db = getDb()
    const out: { table: string; deleted: number }[] = []
    for (const [table, t] of [
      ['event_analytics', event_analytics],
      ['engagement_events', engagement_events],
      ['email_logs', email_logs],
    ] as const) {
      const deleted = await db.delete(t).where(lt(t.created_at, cutoff)).returning({ id: t.id })
      out.push({ table, deleted: deleted.length })
    }
    return out
  }
}

export const retentionService = new RetentionService()
