/**
 * Permission composable
 * Checks user permissions for UI gating
 */
import { computed } from 'vue'
import { useAuth } from '../stores/auth'

// Mirror of backend PERMISSIONS constants
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

// Role-to-permissions mapping (client-side mirror for instant UI checks)
const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: [
    'org.view', 'users.view', 'users.manage', 'users.invite',
    'teams.view', 'teams.manage', 'roles.view', 'roles.manage',
    'permissions.view', 'permissions.manage',
    'settings.view', 'settings.manage', 'smtp.view', 'smtp.manage',
    'campaigns.view', 'campaigns.manage', 'campaigns.delete',
    'contacts.view', 'contacts.manage', 'contacts.import', 'contacts.export',
    'templates.view', 'templates.manage',
    'automations.view', 'automations.manage',
    'segments.view', 'segments.manage',
    'analytics.view', 'analytics.export', 'reports.view', 'reports.export',
    'webhooks.view', 'webhooks.manage', 'apikeys.view', 'apikeys.manage',
    'audit.view', 'logs.view',
  ],
  manager: [
    'org.view', 'users.view', 'teams.view', 'settings.view', 'smtp.view',
    'campaigns.view', 'campaigns.manage',
    'contacts.view', 'contacts.manage', 'contacts.import',
    'templates.view', 'templates.manage',
    'automations.view', 'automations.manage',
    'segments.view', 'segments.manage',
    'analytics.view', 'reports.view', 'logs.view',
  ],
  member: [
    'org.view', 'users.view', 'teams.view',
    'settings.view', 'smtp.view',
    'campaigns.view', 'campaigns.manage',
    'contacts.view', 'contacts.manage',
    'templates.view', 'segments.view',
    'analytics.view', 'reports.view',
  ],
  readonly: [
    'org.view', 'users.view', 'teams.view',
    'campaigns.view', 'contacts.view', 'templates.view',
    'segments.view', 'analytics.view', 'reports.view', 'logs.view',
  ],
}

export function usePermissions() {
  const { role, isPlatformAdmin } = useAuth()

  const permissions = computed(() => {
    if (isPlatformAdmin.value) return ['*']
    const r = role.value
    if (!r) return []
    return ROLE_PERMISSIONS[r] || []
  })

  function can(permission: string): boolean {
    if (isPlatformAdmin.value) return true
    const perms = permissions.value
    if (perms.includes('*')) return true
    return perms.includes(permission)
  }

  function canAny(...perms: string[]): boolean {
    return perms.some(p => can(p))
  }

  function canAll(...perms: string[]): boolean {
    return perms.every(p => can(p))
  }

  const isOwner = computed(() => role.value === 'owner' || isPlatformAdmin.value)
  const isAdmin = computed(() => ['owner', 'admin'].includes(role.value || '') || isPlatformAdmin.value)
  const isManager = computed(() => ['owner', 'admin', 'manager'].includes(role.value || '') || isPlatformAdmin.value)

  return {
    permissions,
    can,
    canAny,
    canAll,
    isOwner,
    isAdmin,
    isManager,
    isPlatformAdmin,
  }
}
