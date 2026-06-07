import { and, eq, ne, desc, count, inArray } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { organizations, org_members, users } from '../db/pg/schema'
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

// Columns selected when a member row needs the joined user email/name.
const memberSelect = {
  id: org_members.id,
  org_id: org_members.org_id,
  user_id: org_members.user_id,
  role: org_members.role,
  status: org_members.status,
  invited_by: org_members.invited_by,
  invited_at: org_members.invited_at,
  joined_at: org_members.joined_at,
  created_at: org_members.created_at,
  updated_at: org_members.updated_at,
  email: users.email,
  name: users.name,
}

class OrgService {
  /**
   * Create a new organization. Creator becomes owner.
   */
  async create(userId: string, name: string, slug?: string): Promise<Organization> {
    const db = getDb()
    const orgId = generateId('org')
    const orgSlug = slug || this.generateSlug(name)

    // Check slug uniqueness
    const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, orgSlug)).limit(1)
    if (existing.length > 0) {
      throw new Error(`Organization slug "${orgSlug}" already exists`)
    }

    await db.insert(organizations).values({ id: orgId, name, slug: orgSlug })

    // Add creator as owner
    await db.insert(org_members).values({ id: generateId('om'), org_id: orgId, user_id: userId, role: 'owner', status: 'active' })

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1)

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

  async get(orgId: string): Promise<Organization | null> {
    const [org] = await getDb().select().from(organizations).where(eq(organizations.id, orgId)).limit(1)
    return org ?? null
  }

  async getBySlug(slug: string): Promise<Organization | null> {
    const [org] = await getDb().select().from(organizations).where(eq(organizations.slug, slug)).limit(1)
    return org ?? null
  }

  async update(orgId: string, updates: { name?: string; settings?: Record<string, unknown> }, actorId: string): Promise<boolean> {
    const values: { name?: string; settings?: string; updated_at: string } = { updated_at: new Date().toISOString() }
    if (updates.name !== undefined) values.name = updates.name
    if (updates.settings !== undefined) values.settings = JSON.stringify(updates.settings)

    if (values.name === undefined && values.settings === undefined) return false

    const res = await getDb().update(organizations).set(values).where(eq(organizations.id, orgId)).returning({ id: organizations.id })

    if (res.length > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'org.updated',
        entityType: 'organization',
        entityId: orgId,
        metadata: updates,
      })
    }

    return res.length > 0
  }

  /**
   * List user's organizations
   */
  async listForUser(userId: string): Promise<(Organization & { role: string })[]> {
    return getDb()
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        plan: organizations.plan,
        status: organizations.status,
        settings: organizations.settings,
        created_at: organizations.created_at,
        updated_at: organizations.updated_at,
        role: org_members.role,
      })
      .from(organizations)
      .innerJoin(org_members, eq(organizations.id, org_members.org_id))
      .where(and(eq(org_members.user_id, userId), eq(org_members.status, 'active'), eq(organizations.status, 'active')))
      .orderBy(organizations.name)
  }

  /**
   * List all organizations (platform admin only)
   */
  async listAll(page = 1, limit = 50): Promise<{ orgs: Organization[]; total: number }> {
    const db = getDb()
    const offset = (page - 1) * limit
    const [totalRow] = await db.select({ value: count() }).from(organizations)
    const orgs = await db.select().from(organizations).orderBy(desc(organizations.created_at)).limit(limit).offset(offset)
    return { orgs, total: totalRow?.value ?? 0 }
  }

  // ------- Members -------

  async getMembers(orgId: string): Promise<OrgMember[]> {
    // Exclude platform admins from org member lists (they're invisible to orgs)
    const rows = await getDb()
      .select(memberSelect)
      .from(org_members)
      .innerJoin(users, eq(org_members.user_id, users.id))
      .where(and(eq(org_members.org_id, orgId), inArray(org_members.status, ['active', 'invited']), eq(users.is_platform_admin, 0)))
      .orderBy(org_members.role, users.name)
    return rows as OrgMember[]
  }

  async getMember(orgId: string, userId: string): Promise<OrgMember | null> {
    const [row] = await getDb()
      .select(memberSelect)
      .from(org_members)
      .innerJoin(users, eq(org_members.user_id, users.id))
      .where(and(eq(org_members.org_id, orgId), eq(org_members.user_id, userId)))
      .limit(1)
    return (row as OrgMember) ?? null
  }

  async addMember(orgId: string, userId: string, role: string, invitedBy: string): Promise<OrgMember> {
    await getDb().insert(org_members).values({
      id: generateId('om'),
      org_id: orgId,
      user_id: userId,
      role,
      status: 'active',
      invited_by: invitedBy,
      invited_at: new Date().toISOString(),
    })

    const member = (await this.getMember(orgId, userId))!

    auditService.log({
      orgId,
      actorId: invitedBy,
      action: 'member.invited',
      entityType: 'org_member',
      entityId: member.id,
      metadata: { userId, role },
    })

    return member
  }

  async updateMemberRole(orgId: string, userId: string, newRole: string, actorId: string): Promise<boolean> {
    const current = await this.getMember(orgId, userId)
    if (!current) return false

    const res = await getDb()
      .update(org_members)
      .set({ role: newRole, updated_at: new Date().toISOString() })
      .where(and(eq(org_members.org_id, orgId), eq(org_members.user_id, userId), eq(org_members.status, 'active')))
      .returning({ id: org_members.id })

    if (res.length > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'member.role_changed',
        entityType: 'org_member',
        entityId: current.id,
        changes: { role: { from: current.role, to: newRole } },
      })
    }

    return res.length > 0
  }

  async removeMember(orgId: string, userId: string, actorId: string): Promise<boolean> {
    const res = await getDb()
      .update(org_members)
      .set({ status: 'removed', updated_at: new Date().toISOString() })
      .where(and(
        eq(org_members.org_id, orgId),
        eq(org_members.user_id, userId),
        eq(org_members.status, 'active'),
        ne(org_members.role, 'owner'),
      ))
      .returning({ id: org_members.id })

    if (res.length > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'member.removed',
        entityType: 'org_member',
        entityId: userId,
      })
    }

    return res.length > 0
  }

  async getMemberCount(orgId: string): Promise<number> {
    const [row] = await getDb()
      .select({ value: count() })
      .from(org_members)
      .innerJoin(users, eq(org_members.user_id, users.id))
      .where(and(eq(org_members.org_id, orgId), eq(org_members.status, 'active'), eq(users.is_platform_admin, 0)))
    return row?.value ?? 0
  }

  async checkSlugAvailability(slug: string, excludeOrgId?: string): Promise<{ available: boolean; suggestions: string[] }> {
    const db = getDb()
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 48)
    if (!normalized || normalized.length < 2) {
      return { available: false, suggestions: [] }
    }

    const taken = async (s: string): Promise<boolean> => {
      const rows = excludeOrgId
        ? await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.slug, s), ne(organizations.id, excludeOrgId))).limit(1)
        : await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, s)).limit(1)
      return rows.length > 0
    }

    if (!(await taken(normalized))) return { available: true, suggestions: [] }

    // Generate suggestions
    const suggestions: string[] = []
    for (let i = 1; i <= 5; i++) {
      const candidate = `${normalized}-${i}`
      if (!(await taken(candidate))) suggestions.push(candidate)
      if (suggestions.length >= 3) break
    }
    // Try with random suffix
    if (suggestions.length < 3) {
      suggestions.push(`${normalized}-${Math.random().toString(36).substring(2, 6)}`)
    }

    return { available: false, suggestions }
  }

  async updateSlug(orgId: string, newSlug: string): Promise<boolean> {
    const db = getDb()
    const normalized = newSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 48)
    if (!normalized || normalized.length < 2) throw new Error('Slug must be at least 2 characters')

    const existing = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.slug, normalized), ne(organizations.id, orgId))).limit(1)
    if (existing.length > 0) throw new Error(`Slug "${normalized}" is already taken`)

    const res = await db.update(organizations).set({ slug: normalized, updated_at: new Date().toISOString() }).where(eq(organizations.id, orgId)).returning({ id: organizations.id })
    return res.length > 0
  }

  private generateSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 48)
  }
}

export const orgService = new OrgService()
