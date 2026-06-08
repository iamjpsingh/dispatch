import { eq, and, desc, sql } from 'drizzle-orm'
import { stringify } from 'csv-stringify/sync'
import { getDb } from '../db/pg/client'
import { email_logs, type EmailLogRow } from '../db/pg/schema'
import { logger } from '../utils/logger'
import type { EmailLog } from '../types/index'

function toEmailLog(r: EmailLogRow): EmailLog {
  return {
    id: r.id,
    email: r.email,
    status: r.status as EmailLog['status'],
    message: r.message ?? undefined,
    timestamp: r.created_at,
    messageId: r.message_id ?? undefined,
    firstName: r.first_name ?? undefined,
    company: r.company ?? undefined,
    subject: r.subject ?? undefined,
  }
}

class LogService {
  /** Append a send-log row, scoped to an org (R9). */
  async addLog(orgId: string, log: EmailLog): Promise<void> {
    try {
      await getDb().insert(email_logs).values({
        id: log.id,
        org_id: orgId,
        email: log.email,
        status: log.status,
        message: log.message ?? null,
        message_id: log.messageId ?? null,
        first_name: log.firstName ?? null,
        company: log.company ?? null,
        subject: log.subject ?? null,
        ...(log.timestamp ? { created_at: log.timestamp } : {}),
      })
    } catch (error) {
      logger.error('Error writing email log:', error)
    }
  }

  async getLogs(orgId: string, limit = 1000): Promise<EmailLog[]> {
    const rows = await getDb()
      .select()
      .from(email_logs)
      .where(eq(email_logs.org_id, orgId))
      .orderBy(desc(email_logs.created_at))
      .limit(limit)
    return rows.map(toEmailLog)
  }

  async getStats(orgId: string): Promise<{ total: number; sent: number; failed: number; errors: number }> {
    const [row] = await getDb()
      .select({
        total: sql<number>`count(*)::int`,
        sent: sql<number>`(count(*) filter (where ${email_logs.status} = 'Sent'))::int`,
        failed: sql<number>`(count(*) filter (where ${email_logs.status} = 'Failed'))::int`,
        errors: sql<number>`(count(*) filter (where ${email_logs.status} = 'Error'))::int`,
      })
      .from(email_logs)
      .where(eq(email_logs.org_id, orgId))
    return row ?? { total: 0, sent: 0, failed: 0, errors: 0 }
  }

  async getLogsAsCSV(orgId: string): Promise<string> {
    const logs = await this.getLogs(orgId)
    return stringify(logs, {
      header: true,
      columns: ['id', 'email', 'status', 'message', 'timestamp', 'messageId', 'firstName', 'company', 'subject'],
    })
  }

  async deleteLog(orgId: string, id: string): Promise<void> {
    await getDb().delete(email_logs).where(and(eq(email_logs.org_id, orgId), eq(email_logs.id, id)))
  }

  async clearLogs(orgId: string): Promise<void> {
    await getDb().delete(email_logs).where(eq(email_logs.org_id, orgId))
  }
}

export const logService = new LogService()
