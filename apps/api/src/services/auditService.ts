// src/services/auditService.ts - Audit & Activity Logging (Postgres/Drizzle, async)

import { and, eq, gte, lte, lt, desc, count, type SQL } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { audit_logs, activity_logs } from '../db/pg/schema'
import { generateId } from '../utils/id'
import { logger } from '../utils/logger'

export type AuditAction =
  // Auth
  | 'user.login' | 'user.logout' | 'user.register'
  // Org
  | 'org.created' | 'org.updated' | 'org.deleted' | 'org.suspended'
  // Members
  | 'member.invited' | 'member.joined' | 'member.role_changed' | 'member.removed' | 'member.suspended'
  // Teams
  | 'team.created' | 'team.updated' | 'team.deleted' | 'team.member_added' | 'team.member_removed'
  // Permissions
  | 'permission.granted' | 'permission.revoked'
  // Settings
  | 'settings.updated' | 'smtp.created' | 'smtp.updated' | 'smtp.deleted'
  // Campaigns
  | 'campaign.created' | 'campaign.launched' | 'campaign.paused' | 'campaign.cancelled' | 'campaign.deleted'
  // Contacts
  | 'contacts.imported' | 'contacts.exported' | 'contacts.deleted'
  // API keys
  | 'apikey.created' | 'apikey.revoked'

export type ActivityAction =
  | 'campaign.created' | 'campaign.updated' | 'campaign.sent'
  | 'template.created' | 'template.updated' | 'template.deleted'
  | 'contact.created' | 'contact.updated' | 'contact.deleted'
  | 'list.created' | 'list.updated' | 'list.deleted'
  | 'automation.created' | 'automation.activated' | 'automation.paused'
  | 'segment.created' | 'segment.updated'
  | 'team.created' | 'team.updated'
  | 'member.invited' | 'member.joined'
  | 'settings.updated'

interface AuditEntry {
  orgId?: string
  actorId: string
  actorEmail?: string
  action: AuditAction
  entityType: string
  entityId?: string
  changes?: Record<string, { from: unknown; to: unknown }>
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

interface ActivityEntry {
  orgId?: string
  actorId: string
  actorEmail?: string
  action: ActivityAction
  entityType: string
  entityId?: string
  description: string
  metadata?: Record<string, unknown>
}

interface LogQuery {
  orgId?: string
  actorId?: string
  action?: string
  entityType?: string
  entityId?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

class AuditService {
  /**
   * Record an audit log entry (security-sensitive actions).
   *
   * Called fire-and-forget (un-awaited) from many services — it MUST NOT throw
   * or reject, or an un-awaited call would surface as an unhandled rejection.
   * The body is wrapped in try/catch; failures are swallowed and logged.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await getDb().insert(audit_logs).values({
        id: generateId('aud'),
        org_id: entry.orgId || null,
        actor_id: entry.actorId,
        actor_email: entry.actorEmail || null,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId || null,
        changes: entry.changes ? JSON.stringify(entry.changes) : null,
        ip_address: entry.ipAddress || null,
        user_agent: entry.userAgent || null,
        metadata: JSON.stringify(entry.metadata || {}),
      })
    } catch (err) {
      logger.error('auditService.log failed', err)
    }
  }

  /**
   * Record an activity log entry (product actions).
   *
   * Fire-and-forget like log() — never throws/rejects (swallow + logger.error).
   */
  async logActivity(entry: ActivityEntry): Promise<void> {
    try {
      await getDb().insert(activity_logs).values({
        id: generateId('act'),
        org_id: entry.orgId || null,
        actor_id: entry.actorId,
        actor_email: entry.actorEmail || null,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId || null,
        description: entry.description,
        metadata: JSON.stringify(entry.metadata || {}),
      })
    } catch (err) {
      logger.error('auditService.logActivity failed', err)
    }
  }

  /**
   * Query audit logs with filters
   */
  async queryAuditLogs(query: LogQuery): Promise<{ logs: any[]; total: number }> {
    const db = getDb()
    const page = query.page || 1
    const limit = Math.min(query.limit || 50, 200)
    const offset = (page - 1) * limit

    const conditions: SQL[] = []
    if (query.orgId) conditions.push(eq(audit_logs.org_id, query.orgId))
    if (query.actorId) conditions.push(eq(audit_logs.actor_id, query.actorId))
    if (query.action) conditions.push(eq(audit_logs.action, query.action))
    if (query.entityType) conditions.push(eq(audit_logs.entity_type, query.entityType))
    if (query.entityId) conditions.push(eq(audit_logs.entity_id, query.entityId))
    if (query.from) conditions.push(gte(audit_logs.created_at, query.from))
    if (query.to) conditions.push(lte(audit_logs.created_at, query.to))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [tot] = await db.select({ value: count() }).from(audit_logs).where(where)
    const logs = await db
      .select()
      .from(audit_logs)
      .where(where)
      .orderBy(desc(audit_logs.created_at))
      .limit(limit)
      .offset(offset)

    return { logs, total: tot?.value ?? 0 }
  }

  /**
   * Query activity logs with filters
   */
  async queryActivityLogs(query: LogQuery): Promise<{ logs: any[]; total: number }> {
    const db = getDb()
    const page = query.page || 1
    const limit = Math.min(query.limit || 50, 200)
    const offset = (page - 1) * limit

    const conditions: SQL[] = []
    if (query.orgId) conditions.push(eq(activity_logs.org_id, query.orgId))
    if (query.actorId) conditions.push(eq(activity_logs.actor_id, query.actorId))
    if (query.action) conditions.push(eq(activity_logs.action, query.action))
    if (query.entityType) conditions.push(eq(activity_logs.entity_type, query.entityType))
    if (query.from) conditions.push(gte(activity_logs.created_at, query.from))
    if (query.to) conditions.push(lte(activity_logs.created_at, query.to))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [tot] = await db.select({ value: count() }).from(activity_logs).where(where)
    const logs = await db
      .select()
      .from(activity_logs)
      .where(where)
      .orderBy(desc(activity_logs.created_at))
      .limit(limit)
      .offset(offset)

    return { logs, total: tot?.value ?? 0 }
  }

  /**
   * Get recent activity for an org (for dashboard)
   */
  async getRecentActivity(orgId: string, limit = 20): Promise<any[]> {
    return getDb()
      .select()
      .from(activity_logs)
      .where(eq(activity_logs.org_id, orgId))
      .orderBy(desc(activity_logs.created_at))
      .limit(limit)
  }

  /**
   * Cleanup old logs (retention policy)
   */
  async cleanup(olderThanDays = 90): Promise<{ auditDeleted: number; activityDeleted: number }> {
    const db = getDb()
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()

    const auditResult = await db
      .delete(audit_logs)
      .where(lt(audit_logs.created_at, cutoff))
      .returning({ id: audit_logs.id })

    const activityResult = await db
      .delete(activity_logs)
      .where(lt(activity_logs.created_at, cutoff))
      .returning({ id: activity_logs.id })

    return {
      auditDeleted: auditResult.length,
      activityDeleted: activityResult.length,
    }
  }
}

export const auditService = new AuditService()
