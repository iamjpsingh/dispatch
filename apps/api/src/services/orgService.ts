import { db } from '../db/connection'
import { auditService } from './auditService'
import { generateId } from '../utils/id'

export interface Organization {
  id: string
  name: string
  slug: string
  plan: string
  status: string
  settings: string
  created_at: string
  updated_at: string
}

export interface OrgMember {
  id: string
  org_id: string
  user_id: string
  role: string
  status: string
  invited_by: string | null
  invited_at: string | null
  joined_at: string
  created_at: string
  updated_at: string
  // Joined fields
  email?: string
  name?: string
}

class OrgService {
  /**
   * Create a new organization. Creator becomes owner.
   */
  create(userId: string, name: string, slug?: string): Organization {
    const orgId = generateId('org')
    const orgSlug = slug || this.generateSlug(name)

    // Check slug uniqueness
    const existing = db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(orgSlug)
    if (existing) {
      throw new Error(`Organization slug "${orgSlug}" already exists`)
    }

    db.prepare(`
      INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)
    `).run(orgId, name, orgSlug)

    // Add creator as owner
    const memberId = generateId('om')
    db.prepare(`
      INSERT INTO org_members (id, org_id, user_id, role, status) VALUES (?, ?, ?, 'owner', 'active')
    `).run(memberId, orgId, userId)

    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) as Organization

    auditService.log({
      orgId,
      actorId: userId,
      action: 'org.created',
      entityType: 'organization',
      entityId: orgId,
      metadata: { name, slug: orgSlug },
    })

    return org
  }

  get(orgId: string): Organization | null {
    return db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) as Organization | null
  }

  getBySlug(slug: string): Organization | null {
    return db.prepare('SELECT * FROM organizations WHERE slug = ?').get(slug) as Organization | null
  }

  update(orgId: string, updates: { name?: string; settings?: Record<string, unknown> }, actorId: string): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.settings !== undefined) { sets.push('settings = ?'); params.push(JSON.stringify(updates.settings)) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(orgId)

    const result = db.prepare(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    if (result.changes > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'org.updated',
        entityType: 'organization',
        entityId: orgId,
        metadata: updates,
      })
    }

    return result.changes > 0
  }

  /**
   * List user's organizations
   */
  listForUser(userId: string): (Organization & { role: string })[] {
    return db.prepare(`
      SELECT o.*, om.role FROM organizations o
      JOIN org_members om ON o.id = om.org_id
      WHERE om.user_id = ? AND om.status = 'active' AND o.status = 'active'
      ORDER BY o.name
    `).all(userId) as (Organization & { role: string })[]
  }

  /**
   * List all organizations (platform admin only)
   */
  listAll(page = 1, limit = 50): { orgs: Organization[]; total: number } {
    const offset = (page - 1) * limit
    const total = (db.prepare('SELECT COUNT(*) as count FROM organizations').get() as any).count
    const orgs = db.prepare('SELECT * FROM organizations ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Organization[]
    return { orgs, total }
  }

  // ------- Members -------

  getMembers(orgId: string): OrgMember[] {
    // Exclude platform admins from org member lists (they're invisible to orgs)
    return db.prepare(`
      SELECT om.*, u.email, u.name FROM org_members om
      JOIN users u ON om.user_id = u.id
      WHERE om.org_id = ? AND om.status IN ('active', 'invited')
        AND u.is_platform_admin = 0
      ORDER BY om.role, u.name
    `).all(orgId) as OrgMember[]
  }

  getMember(orgId: string, userId: string): OrgMember | null {
    return db.prepare(`
      SELECT om.*, u.email, u.name FROM org_members om
      JOIN users u ON om.user_id = u.id
      WHERE om.org_id = ? AND om.user_id = ?
    `).get(orgId, userId) as OrgMember | null
  }

  addMember(orgId: string, userId: string, role: string, invitedBy: string): OrgMember {
    const id = generateId('om')
    db.prepare(`
      INSERT INTO org_members (id, org_id, user_id, role, status, invited_by, invited_at)
      VALUES (?, ?, ?, ?, 'active', ?, datetime('now'))
    `).run(id, orgId, userId, role, invitedBy)

    auditService.log({
      orgId,
      actorId: invitedBy,
      action: 'member.invited',
      entityType: 'org_member',
      entityId: id,
      metadata: { userId, role },
    })

    return this.getMember(orgId, userId)!
  }

  updateMemberRole(orgId: string, userId: string, newRole: string, actorId: string): boolean {
    const current = this.getMember(orgId, userId)
    if (!current) return false

    const result = db.prepare(`
      UPDATE org_members SET role = ?, updated_at = datetime('now')
      WHERE org_id = ? AND user_id = ? AND status = 'active'
    `).run(newRole, orgId, userId)

    if (result.changes > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'member.role_changed',
        entityType: 'org_member',
        entityId: current.id,
        changes: { role: { from: current.role, to: newRole } },
      })
    }

    return result.changes > 0
  }

  removeMember(orgId: string, userId: string, actorId: string): boolean {
    const result = db.prepare(`
      UPDATE org_members SET status = 'removed', updated_at = datetime('now')
      WHERE org_id = ? AND user_id = ? AND status = 'active' AND role != 'owner'
    `).run(orgId, userId)

    if (result.changes > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'member.removed',
        entityType: 'org_member',
        entityId: userId,
      })
    }

    return result.changes > 0
  }

  getMemberCount(orgId: string): number {
    return (db.prepare(`
      SELECT COUNT(*) as count FROM org_members om
      JOIN users u ON om.user_id = u.id
      WHERE om.org_id = ? AND om.status = 'active' AND u.is_platform_admin = 0
    `).get(orgId) as any).count
  }

  checkSlugAvailability(slug: string, excludeOrgId?: string): { available: boolean; suggestions: string[] } {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 48)
    if (!normalized || normalized.length < 2) {
      return { available: false, suggestions: [] }
    }

    const query = excludeOrgId
      ? db.prepare('SELECT 1 FROM organizations WHERE slug = ? AND id != ?').get(normalized, excludeOrgId)
      : db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(normalized)

    if (!query) return { available: true, suggestions: [] }

    // Generate suggestions
    const suggestions: string[] = []
    for (let i = 1; i <= 5; i++) {
      const candidate = `${normalized}-${i}`
      const exists = db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(candidate)
      if (!exists) suggestions.push(candidate)
      if (suggestions.length >= 3) break
    }
    // Try with random suffix
    if (suggestions.length < 3) {
      const rand = `${normalized}-${Math.random().toString(36).substring(2, 6)}`
      suggestions.push(rand)
    }

    return { available: false, suggestions }
  }

  updateSlug(orgId: string, newSlug: string): boolean {
    const normalized = newSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 48)
    if (!normalized || normalized.length < 2) throw new Error('Slug must be at least 2 characters')

    const existing = db.prepare('SELECT 1 FROM organizations WHERE slug = ? AND id != ?').get(normalized, orgId)
    if (existing) throw new Error(`Slug "${normalized}" is already taken`)

    const result = db.prepare("UPDATE organizations SET slug = ?, updated_at = datetime('now') WHERE id = ?").run(normalized, orgId)
    return result.changes > 0
  }

  private generateSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 48)
  }
}

export const orgService = new OrgService()
