// src/services/rbacService.ts — Role-Based Access Control (Postgres/Drizzle, async)

import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { users, org_members, roles, user_permissions } from '../db/pg/schema'
import { generateId } from '../utils/id'

// ---------------------------------------------------------------------------
// Permission constants
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  ORG_VIEW: 'org.view', ORG_MANAGE: 'org.manage', ORG_DELETE: 'org.delete',
  USERS_VIEW: 'users.view', USERS_MANAGE: 'users.manage', USERS_INVITE: 'users.invite', USERS_REMOVE: 'users.remove',
  TEAMS_VIEW: 'teams.view', TEAMS_MANAGE: 'teams.manage',
  ROLES_VIEW: 'roles.view', ROLES_MANAGE: 'roles.manage',
  PERMISSIONS_VIEW: 'permissions.view', PERMISSIONS_MANAGE: 'permissions.manage',
  SETTINGS_VIEW: 'settings.view', SETTINGS_MANAGE: 'settings.manage',
  SMTP_VIEW: 'smtp.view', SMTP_MANAGE: 'smtp.manage',
  CAMPAIGNS_VIEW: 'campaigns.view', CAMPAIGNS_MANAGE: 'campaigns.manage', CAMPAIGNS_DELETE: 'campaigns.delete',
  CONTACTS_VIEW: 'contacts.view', CONTACTS_MANAGE: 'contacts.manage', CONTACTS_IMPORT: 'contacts.import', CONTACTS_EXPORT: 'contacts.export',
  TEMPLATES_VIEW: 'templates.view', TEMPLATES_MANAGE: 'templates.manage',
  AUTOMATIONS_VIEW: 'automations.view', AUTOMATIONS_MANAGE: 'automations.manage',
  SEGMENTS_VIEW: 'segments.view', SEGMENTS_MANAGE: 'segments.manage',
  ANALYTICS_VIEW: 'analytics.view', ANALYTICS_EXPORT: 'analytics.export',
  REPORTS_VIEW: 'reports.view', REPORTS_EXPORT: 'reports.export',
  WEBHOOKS_VIEW: 'webhooks.view', WEBHOOKS_MANAGE: 'webhooks.manage',
  APIKEYS_VIEW: 'apikeys.view', APIKEYS_MANAGE: 'apikeys.manage',
  AUDIT_VIEW: 'audit.view', LOGS_VIEW: 'logs.view',
  BILLING_VIEW: 'billing.view', BILLING_MANAGE: 'billing.manage',
  WHATSAPP_VIEW: 'whatsapp.view', WHATSAPP_MANAGE: 'whatsapp.manage',
  GDPR_MANAGE: 'gdpr.manage',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

// Role hierarchy — higher number = more authority
const ROLE_HIERARCHY: Record<string, number> = {
  readonly: 0, member: 1, manager: 2, admin: 3, owner: 4,
}

// Maps org_members.role to the seeded system role name in the roles table
const ROLE_TO_SYSTEM: Record<string, string> = {
  owner: 'org_owner', admin: 'org_admin', manager: 'org_manager', member: 'org_member', readonly: 'readonly',
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class RbacService {
  /** Check if a user has a specific permission in an org. Platform admins always pass. */
  async hasPermission(userId: string, orgId: string, permission: Permission): Promise<boolean> {
    const db = getDb()
    const [user] = await db
      .select({ is_platform_admin: users.is_platform_admin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!user) return false
    if (user.is_platform_admin === 1) return true

    const rolePerms = await this.getUserRolePermissions(userId, orgId)
    if (rolePerms.includes('*')) return true

    // User-level override takes precedence over role
    const [override] = await db
      .select({ granted: user_permissions.granted })
      .from(user_permissions)
      .where(and(
        eq(user_permissions.org_id, orgId),
        eq(user_permissions.user_id, userId),
        eq(user_permissions.permission, permission),
      ))
      .limit(1)
    if (override) return override.granted === 1

    return rolePerms.includes(permission)
  }

  /** Check multiple permissions — ALL must pass. */
  async hasAllPermissions(userId: string, orgId: string, permissions: Permission[]): Promise<boolean> {
    for (const p of permissions) {
      if (!(await this.hasPermission(userId, orgId, p))) return false
    }
    return true
  }

  /** Check multiple permissions — ANY must pass. */
  async hasAnyPermission(userId: string, orgId: string, permissions: Permission[]): Promise<boolean> {
    for (const p of permissions) {
      if (await this.hasPermission(userId, orgId, p)) return true
    }
    return false
  }

  /** Get every effective permission for a user in an org (role + overrides merged). */
  async getEffectivePermissions(userId: string, orgId: string): Promise<string[]> {
    const db = getDb()
    const [user] = await db
      .select({ is_platform_admin: users.is_platform_admin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!user) return []
    if (user.is_platform_admin === 1) return ['*']

    const rolePerms = await this.getUserRolePermissions(userId, orgId)
    const permSet = new Set(rolePerms)

    const overrides = await db
      .select({ permission: user_permissions.permission, granted: user_permissions.granted })
      .from(user_permissions)
      .where(and(eq(user_permissions.org_id, orgId), eq(user_permissions.user_id, userId)))

    for (const row of overrides) {
      if (row.granted === 1) {
        permSet.add(row.permission)
      } else {
        permSet.delete(row.permission)
      }
    }

    return Array.from(permSet)
  }

  /** Check if user is a platform super admin. */
  async isPlatformAdmin(userId: string): Promise<boolean> {
    const [user] = await getDb()
      .select({ is_platform_admin: users.is_platform_admin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return user?.is_platform_admin === 1
  }

  /** Get user's role string in an org (e.g. "admin"), or null if not a member. */
  async getUserRole(userId: string, orgId: string): Promise<string | null> {
    const [member] = await getDb()
      .select({ role: org_members.role })
      .from(org_members)
      .where(and(
        eq(org_members.org_id, orgId),
        eq(org_members.user_id, userId),
        eq(org_members.status, 'active'),
      ))
      .limit(1)
    return member?.role ?? null
  }

  /** Check if an actor outranks a target user in the role hierarchy. */
  async canManageUser(actorId: string, targetId: string, orgId: string): Promise<boolean> {
    if (await this.isPlatformAdmin(actorId)) return true

    const actorRole = await this.getUserRole(actorId, orgId)
    const targetRole = await this.getUserRole(targetId, orgId)
    if (!actorRole || !targetRole) return false

    const actorLevel = ROLE_HIERARCHY[actorRole] ?? -1
    const targetLevel = ROLE_HIERARCHY[targetRole] ?? -1
    return actorLevel > targetLevel
  }

  /** Check whether an actor may ASSIGN a given role — cannot grant a role above their own level. */
  async canAssignRole(actorId: string, orgId: string, role: string): Promise<boolean> {
    if (await this.isPlatformAdmin(actorId)) return true
    const actorRole = await this.getUserRole(actorId, orgId)
    if (!actorRole) return false
    const actorLevel = ROLE_HIERARCHY[actorRole] ?? -1
    const roleLevel = ROLE_HIERARCHY[role] ?? -1
    if (roleLevel < 0) return false // unknown role
    return roleLevel <= actorLevel
  }

  /** Check if user is an active member of an org. */
  async isMember(userId: string, orgId: string): Promise<boolean> {
    const [row] = await getDb()
      .select({ id: org_members.id })
      .from(org_members)
      .where(and(
        eq(org_members.org_id, orgId),
        eq(org_members.user_id, userId),
        eq(org_members.status, 'active'),
      ))
      .limit(1)
    return !!row
  }

  /** Grant a permission override to a user. */
  async grantPermission(orgId: string, userId: string, permission: string, grantedBy: string): Promise<void> {
    await this.upsertOverride(orgId, userId, permission, 1, grantedBy)
  }

  /** Revoke a permission from a user (explicit deny overriding role). */
  async revokePermission(orgId: string, userId: string, permission: string, revokedBy: string): Promise<void> {
    await this.upsertOverride(orgId, userId, permission, 0, revokedBy)
  }

  /** Remove a permission override entirely (revert to role default). */
  async removePermissionOverride(orgId: string, userId: string, permission: string): Promise<void> {
    await getDb()
      .delete(user_permissions)
      .where(and(
        eq(user_permissions.org_id, orgId),
        eq(user_permissions.user_id, userId),
        eq(user_permissions.permission, permission),
      ))
  }

  /** List all system roles with parsed permission arrays. */
  async listSystemRoles(): Promise<{ id: string; name: string; description: string; permissions: string[] }[]> {
    const rows = await getDb()
      .select({ id: roles.id, name: roles.name, description: roles.description, permissions: roles.permissions })
      .from(roles)
      .where(eq(roles.is_system, 1))
      .orderBy(roles.name)
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      permissions: JSON.parse(r.permissions) as string[],
    }))
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** Resolve role-based permissions for a user in an org. */
  private async getUserRolePermissions(userId: string, orgId: string): Promise<string[]> {
    const db = getDb()
    const [member] = await db
      .select({ role: org_members.role })
      .from(org_members)
      .where(and(
        eq(org_members.org_id, orgId),
        eq(org_members.user_id, userId),
        eq(org_members.status, 'active'),
      ))
      .limit(1)
    if (!member) return []

    const systemRoleName = ROLE_TO_SYSTEM[member.role] ?? member.role
    const [role] = await db
      .select({ permissions: roles.permissions })
      .from(roles)
      .where(and(eq(roles.name, systemRoleName), eq(roles.is_system, 1)))
      .limit(1)
    if (!role) return []

    return JSON.parse(role.permissions) as string[]
  }

  private async upsertOverride(orgId: string, userId: string, permission: string, granted: number, grantedBy: string): Promise<void> {
    await getDb()
      .insert(user_permissions)
      .values({ id: generateId('up'), org_id: orgId, user_id: userId, permission, granted, granted_by: grantedBy })
      .onConflictDoUpdate({
        target: [user_permissions.org_id, user_permissions.user_id, user_permissions.permission],
        set: { granted, granted_by: grantedBy },
      })
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const rbacService = new RbacService()
