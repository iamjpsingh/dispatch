// System role seeding (P2.1). Mirrors the seed in the old SQLite migration 001 — system
// roles have org_id = null and is_system = 1; permissions are stored as a JSON-text array.
import { roles } from './schema/identity'
import { getDb, type Db } from './client'

export interface SystemRole {
  id: string
  name: string
  description: string
  permissions: string[]
}

export const SYSTEM_ROLES: SystemRole[] = [
  {
    id: 'role_platform_admin',
    name: 'platform_super_admin',
    description: 'Full platform access - can see all orgs, users, and system data',
    permissions: ['*'],
  },
  {
    id: 'role_org_owner',
    name: 'org_owner',
    description: 'Full organization access',
    permissions: [
      'org.view', 'org.manage', 'org.delete',
      'users.view', 'users.manage', 'users.invite', 'users.remove',
      'teams.view', 'teams.manage',
      'roles.view', 'roles.manage',
      'permissions.view', 'permissions.manage',
      'settings.view', 'settings.manage',
      'smtp.view', 'smtp.manage',
      'campaigns.view', 'campaigns.manage', 'campaigns.delete',
      'contacts.view', 'contacts.manage', 'contacts.import', 'contacts.export',
      'templates.view', 'templates.manage',
      'automations.view', 'automations.manage',
      'segments.view', 'segments.manage',
      'analytics.view', 'analytics.export',
      'reports.view', 'reports.export',
      'webhooks.view', 'webhooks.manage',
      'apikeys.view', 'apikeys.manage',
      'audit.view',
      'logs.view',
      'billing.view', 'billing.manage',
    ],
  },
  {
    id: 'role_org_admin',
    name: 'org_admin',
    description: 'Admin access - everything except org deletion and billing',
    permissions: [
      'org.view',
      'users.view', 'users.manage', 'users.invite',
      'teams.view', 'teams.manage',
      'roles.view', 'roles.manage',
      'permissions.view', 'permissions.manage',
      'settings.view', 'settings.manage',
      'smtp.view', 'smtp.manage',
      'campaigns.view', 'campaigns.manage', 'campaigns.delete',
      'contacts.view', 'contacts.manage', 'contacts.import', 'contacts.export',
      'templates.view', 'templates.manage',
      'automations.view', 'automations.manage',
      'segments.view', 'segments.manage',
      'analytics.view', 'analytics.export',
      'reports.view', 'reports.export',
      'webhooks.view', 'webhooks.manage',
      'apikeys.view', 'apikeys.manage',
      'audit.view',
      'logs.view',
    ],
  },
  {
    id: 'role_org_manager',
    name: 'org_manager',
    description: 'Manager access - campaigns, contacts, templates, reports',
    permissions: [
      'org.view',
      'users.view',
      'teams.view',
      'settings.view',
      'smtp.view',
      'campaigns.view', 'campaigns.manage',
      'contacts.view', 'contacts.manage', 'contacts.import',
      'templates.view', 'templates.manage',
      'automations.view', 'automations.manage',
      'segments.view', 'segments.manage',
      'analytics.view',
      'reports.view',
      'logs.view',
    ],
  },
  {
    id: 'role_org_member',
    name: 'org_member',
    description: 'Member access - create and view own campaigns and contacts',
    permissions: [
      'org.view',
      'users.view',
      'teams.view',
      'campaigns.view', 'campaigns.manage',
      'contacts.view', 'contacts.manage',
      'templates.view',
      'segments.view',
      'analytics.view',
      'reports.view',
    ],
  },
  {
    id: 'role_readonly',
    name: 'readonly',
    description: 'Read-only access to org data',
    permissions: [
      'org.view',
      'users.view',
      'teams.view',
      'campaigns.view',
      'contacts.view',
      'templates.view',
      'segments.view',
      'analytics.view',
      'reports.view',
      'logs.view',
    ],
  },
]

/** Idempotently seed the system roles (org_id = null). Safe to call on every boot. */
export async function seedSystemRoles(db: Db = getDb()): Promise<void> {
  for (const r of SYSTEM_ROLES) {
    await db
      .insert(roles)
      .values({
        id: r.id,
        org_id: null,
        name: r.name,
        description: r.description,
        is_system: 1,
        permissions: JSON.stringify(r.permissions),
      })
      .onConflictDoNothing()
  }
}
