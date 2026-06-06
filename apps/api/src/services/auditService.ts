import { logsDb } from '../db/connection'
import { generateId } from '../utils/id'

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
   * Record an audit log entry (security-sensitive actions)
   */
  log(entry: AuditEntry): void {
    const id = generateId('aud')
    logsDb.prepare(`
      INSERT INTO audit_logs (id, org_id, actor_id, actor_email, action, entity_type, entity_id, changes, ip_address, user_agent, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.orgId || null,
      entry.actorId,
      entry.actorEmail || null,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      entry.changes ? JSON.stringify(entry.changes) : null,
      entry.ipAddress || null,
      entry.userAgent || null,
      JSON.stringify(entry.metadata || {})
    )
  }

  /**
   * Record an activity log entry (product actions)
   */
  logActivity(entry: ActivityEntry): void {
    const id = generateId('act')
    logsDb.prepare(`
      INSERT INTO activity_logs (id, org_id, actor_id, actor_email, action, entity_type, entity_id, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.orgId || null,
      entry.actorId,
      entry.actorEmail || null,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      entry.description,
      JSON.stringify(entry.metadata || {})
    )
  }

  /**
   * Query audit logs with filters
   */
  queryAuditLogs(query: LogQuery): { logs: any[]; total: number } {
    const conditions: string[] = []
    const params: any[] = []
    const page = query.page || 1
    const limit = Math.min(query.limit || 50, 200)
    const offset = (page - 1) * limit

    if (query.orgId) { conditions.push('org_id = ?'); params.push(query.orgId) }
    if (query.actorId) { conditions.push('actor_id = ?'); params.push(query.actorId) }
    if (query.action) { conditions.push('action = ?'); params.push(query.action) }
    if (query.entityType) { conditions.push('entity_type = ?'); params.push(query.entityType) }
    if (query.entityId) { conditions.push('entity_id = ?'); params.push(query.entityId) }
    if (query.from) { conditions.push('created_at >= ?'); params.push(query.from) }
    if (query.to) { conditions.push('created_at <= ?'); params.push(query.to) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const total = (logsDb.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`).get(...params) as any).count

    const logs = logsDb.prepare(`
      SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    return { logs, total }
  }

  /**
   * Query activity logs with filters
   */
  queryActivityLogs(query: LogQuery): { logs: any[]; total: number } {
    const conditions: string[] = []
    const params: any[] = []
    const page = query.page || 1
    const limit = Math.min(query.limit || 50, 200)
    const offset = (page - 1) * limit

    if (query.orgId) { conditions.push('org_id = ?'); params.push(query.orgId) }
    if (query.actorId) { conditions.push('actor_id = ?'); params.push(query.actorId) }
    if (query.action) { conditions.push('action = ?'); params.push(query.action) }
    if (query.entityType) { conditions.push('entity_type = ?'); params.push(query.entityType) }
    if (query.from) { conditions.push('created_at >= ?'); params.push(query.from) }
    if (query.to) { conditions.push('created_at <= ?'); params.push(query.to) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const total = (logsDb.prepare(`SELECT COUNT(*) as count FROM activity_logs ${where}`).get(...params) as any).count

    const logs = logsDb.prepare(`
      SELECT * FROM activity_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    return { logs, total }
  }

  /**
   * Get recent activity for an org (for dashboard)
   */
  getRecentActivity(orgId: string, limit = 20): any[] {
    return logsDb.prepare(`
      SELECT * FROM activity_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(orgId, limit)
  }

  /**
   * Cleanup old logs (retention policy)
   */
  cleanup(olderThanDays = 90): { auditDeleted: number; activityDeleted: number } {
    const auditResult = logsDb.prepare(`
      DELETE FROM audit_logs WHERE created_at < datetime('now', '-' || ? || ' days')
    `).run(olderThanDays)

    const activityResult = logsDb.prepare(`
      DELETE FROM activity_logs WHERE created_at < datetime('now', '-' || ? || ' days')
    `).run(olderThanDays)

    return {
      auditDeleted: auditResult.changes,
      activityDeleted: activityResult.changes,
    }
  }
}

export const auditService = new AuditService()
