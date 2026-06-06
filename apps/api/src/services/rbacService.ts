// src/services/rbacService.ts — Role-Based Access Control

import { db } from '../db/connection'
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
// Prepared statements (created lazily, cached for the process lifetime)
// ---------------------------------------------------------------------------

let stmts: ReturnType<typeof buildStatements> | null = null

function getStmts() {
  if (!stmts) stmts = buildStatements()
  return stmts
}

function buildStatements() {
  return {
    getUser: db.prepare<{ is_platform_admin: number }, [string]>(
      'SELECT is_platform_admin FROM users WHERE id = ?',
    ),
    getMemberRole: db.prepare<{ role: string }, [string, string, string]>(
      'SELECT role FROM org_members WHERE org_id = ? AND user_id = ? AND status = ?',
    ),
    getSystemRolePerms: db.prepare<{ permissions: string }, [string]>(
      'SELECT permissions FROM roles WHERE name = ? AND is_system = 1',
    ),
    getOverride: db.prepare<{ granted: number }, [string, string, string]>(
      'SELECT granted FROM user_permissions WHERE org_id = ? AND user_id = ? AND permission = ?',
    ),
    getAllOverrides: db.prepare<{ permission: string; granted: number }, [string, string]>(
      'SELECT permission, granted FROM user_permissions WHERE org_id = ? AND user_id = ?',
    ),
    isMember: db.prepare<{ ok: number }, [string, string, string]>(
      'SELECT 1 AS ok FROM org_members WHERE org_id = ? AND user_id = ? AND status = ?',
    ),
    upsertPermission: db.prepare(
      `INSERT INTO user_permissions (id, org_id, user_id, permission, granted, granted_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, user_id, permission) DO UPDATE SET granted = excluded.granted, granted_by = excluded.granted_by`,
    ),
    deleteOverride: db.prepare(
      'DELETE FROM user_permissions WHERE org_id = ? AND user_id = ? AND permission = ?',
    ),
    listSystemRoles: db.prepare<
      { id: string; name: string; description: string | null; permissions: string }, []
    >('SELECT id, name, description, permissions FROM roles WHERE is_system = 1 ORDER BY name'),
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class RbacService {
  /** Check if a user has a specific permission in an org. Platform admins always pass. */
  hasPermission(userId: string, orgId: string, permission: Permission): boolean {
    const s = getStmts()
    const user = s.getUser.get(userId)
    if (!user) return false
    if (user.is_platform_admin === 1) return true

    const rolePerms = this.getUserRolePermissions(userId, orgId)
    if (rolePerms.includes('*')) return true

    // User-level override takes precedence over role
    const override = s.getOverride.get(orgId, userId, permission)
    if (override) return override.granted === 1

    return rolePerms.includes(permission)
  }

  /** Check multiple permissions — ALL must pass. */
  hasAllPermissions(userId: string, orgId: string, permissions: Permission[]): boolean {
    return permissions.every((p) => this.hasPermission(userId, orgId, p))
  }

  /** Check multiple permissions — ANY must pass. */
  hasAnyPermission(userId: string, orgId: string, permissions: Permission[]): boolean {
    return permissions.some((p) => this.hasPermission(userId, orgId, p))
  }

  /** Get every effective permission for a user in an org (role + overrides merged). */
  getEffectivePermissions(userId: string, orgId: string): string[] {
    const s = getStmts()
    const user = s.getUser.get(userId)
    if (!user) return []
    if (user.is_platform_admin === 1) return ['*']

    const rolePerms = this.getUserRolePermissions(userId, orgId)
    const permSet = new Set(rolePerms)

    for (const row of s.getAllOverrides.all(orgId, userId)) {
      if (row.granted === 1) {
        permSet.add(row.permission)
      } else {
        permSet.delete(row.permission)
      }
    }

    return Array.from(permSet)
  }

  /** Check if user is a platform super admin. */
  isPlatformAdmin(userId: string): boolean {
    const user = getStmts().getUser.get(userId)
    return user?.is_platform_admin === 1
  }

  /** Get user's role string in an org (e.g. "admin"), or null if not a member. */
  getUserRole(userId: string, orgId: string): string | null {
    const member = getStmts().getMemberRole.get(orgId, userId, 'active')
    return member?.role ?? null
  }

  /** Check if an actor outranks a target user in the role hierarchy. */
  canManageUser(actorId: string, targetId: string, orgId: string): boolean {
    if (this.isPlatformAdmin(actorId)) return true

    const actorRole = this.getUserRole(actorId, orgId)
    const targetRole = this.getUserRole(targetId, orgId)
    if (!actorRole || !targetRole) return false

    const actorLevel = ROLE_HIERARCHY[actorRole] ?? -1
    const targetLevel = ROLE_HIERARCHY[targetRole] ?? -1
    return actorLevel > targetLevel
  }

  /** Check if user is an active member of an org. */
  isMember(userId: string, orgId: string): boolean {
    return !!getStmts().isMember.get(orgId, userId, 'active')
  }

  /** Grant a permission override to a user. */
  grantPermission(orgId: string, userId: string, permission: string, grantedBy: string): void {
    getStmts().upsertPermission.run(generateId('up'), orgId, userId, permission, 1, grantedBy)
  }

  /** Revoke a permission from a user (explicit deny overriding role). */
  revokePermission(orgId: string, userId: string, permission: string, revokedBy: string): void {
    getStmts().upsertPermission.run(generateId('up'), orgId, userId, permission, 0, revokedBy)
  }

  /** Remove a permission override entirely (revert to role default). */
  removePermissionOverride(orgId: string, userId: string, permission: string): void {
    getStmts().deleteOverride.run(orgId, userId, permission)
  }

  /** List all system roles with parsed permission arrays. */
  listSystemRoles(): { id: string; name: string; description: string; permissions: string[] }[] {
    return getStmts().listSystemRoles.all().map((r) => ({
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
  private getUserRolePermissions(userId: string, orgId: string): string[] {
    const s = getStmts()
    const member = s.getMemberRole.get(orgId, userId, 'active')
    if (!member) return []

    const systemRoleName = ROLE_TO_SYSTEM[member.role] ?? member.role
    const role = s.getSystemRolePerms.get(systemRoleName)
    if (!role) return []

    return JSON.parse(role.permissions) as string[]
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const rbacService = new RbacService()
