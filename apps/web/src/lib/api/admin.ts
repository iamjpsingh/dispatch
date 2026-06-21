/**
 * Admin API — Org management, members, teams, roles, audit logs
 */
import { hc } from 'hono/client'
import type { AdminRoutes } from '@dispatch/api/src/routes/admin'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<AdminRoutes>(rpcBase(), { fetch: rpcFetch })

// ============================================================================
// Types
// ============================================================================

export interface Organization {
  id: string
  name: string
  slug: string
  status: string
  settings: string
  memberCount?: number
  created_at: string
  updated_at: string
}

export interface OrgMember {
  id: string
  org_id: string
  user_id: string
  role: string
  status: string
  email?: string
  name?: string
  invited_by: string | null
  joined_at: string
  created_at: string
}

export interface Team {
  id: string
  org_id: string
  name: string
  description: string | null
  member_count?: number
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: string
  email?: string
  name?: string
  added_at: string
}

export interface SystemRole {
  id: string
  name: string
  description: string
  permissions: string[]
}

export interface AuditLog {
  id: string
  org_id: string
  actor_id: string
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string | null
  changes: string | null
  metadata: string
  created_at: string
}

export interface Invitation {
  id: string
  org_id: string
  email: string
  role: string
  token: string
  invited_by: string
  status: string
  expires_at: string
  accepted_at: string | null
  created_at: string
  org_name?: string
  inviter_name?: string
  inviter_email?: string
}

export interface PlatformUser {
  id: string
  email: string
  name: string
  status: string
  is_platform_admin: number
  last_login_at: string | null
  created_at: string
}

export interface ActivityLog {
  id: string
  org_id: string
  actor_id: string
  actor_email: string | null
  action: string
  entity_type: string
  description: string
  metadata: string
  created_at: string
}

// ============================================================================
// Admin API
// ============================================================================

export const adminApi = {
  // --- Organization ---
  getOrg: async (): Promise<Organization> => {
    const res = await client.admin.org.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load organization')
    return body.data as Organization
  },

  updateOrg: async (updates: { name?: string; settings?: Record<string, unknown> }) => {
    const res = await client.admin.org.$put({ json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update')
  },

  // --- Members ---
  getMembers: async (): Promise<OrgMember[]> => {
    const res = await client.admin.org.members.$get()
    const body = await res.json()
    return (body.data as { members: OrgMember[] } | undefined)?.members || []
  },

  addMember: async (email: string, role: string) => {
    const res = await client.admin.org.members.$post({ json: { email, role } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to add member')
    return body.data
  },

  updateMemberRole: async (userId: string, role: string) => {
    const res = await client.admin.org.members[':userId'].role.$put({ param: { userId }, json: { role } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update role')
  },

  removeMember: async (userId: string) => {
    const res = await client.admin.org.members[':userId'].$delete({ param: { userId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to remove member')
  },

  // --- Teams ---
  getTeams: async (): Promise<Team[]> => {
    const res = await client.admin.teams.$get()
    const body = await res.json()
    return (body.data as { teams: Team[] } | undefined)?.teams || []
  },

  createTeam: async (name: string, description?: string): Promise<Team> => {
    const res = await client.admin.teams.$post({ json: { name, description } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create team')
    // Pre-existing drift: the POST /admin/teams handler does not await
    // teamService.create, so the RPC-inferred data is a Promise shape. Bridge
    // through unknown; reconcile (add the await server-side) post-P6.
    return body.data as unknown as Team
  },

  updateTeam: async (teamId: string, updates: { name?: string; description?: string }) => {
    const res = await client.admin.teams[':teamId'].$put({ param: { teamId }, json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update team')
  },

  deleteTeam: async (teamId: string) => {
    const res = await client.admin.teams[':teamId'].$delete({ param: { teamId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete team')
  },

  getTeamMembers: async (teamId: string): Promise<TeamMember[]> => {
    const res = await client.admin.teams[':teamId'].members.$get({ param: { teamId } })
    const body = await res.json()
    return (body.data as { members: TeamMember[] } | undefined)?.members || []
  },

  addTeamMember: async (teamId: string, userId: string, role?: string) => {
    const res = await client.admin.teams[':teamId'].members.$post({ param: { teamId }, json: { userId, role } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to add team member')
  },

  removeTeamMember: async (teamId: string, userId: string) => {
    const res = await client.admin.teams[':teamId'].members[':userId'].$delete({ param: { teamId, userId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to remove team member')
  },

  // --- Roles ---
  getRoles: async (): Promise<SystemRole[]> => {
    const res = await client.admin.roles.$get()
    const body = await res.json()
    return (body.data as { roles: SystemRole[] } | undefined)?.roles || []
  },

  getUserPermissions: async (userId: string): Promise<{ userId: string; role: string; permissions: string[] }> => {
    const res = await client.admin.permissions[':userId'].$get({ param: { userId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data as { userId: string; role: string; permissions: string[] }
  },

  grantPermission: async (userId: string, permission: string) => {
    const res = await client.admin.permissions[':userId'].grant.$post({ param: { userId }, json: { permission } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  revokePermission: async (userId: string, permission: string) => {
    const res = await client.admin.permissions[':userId'].revoke.$post({ param: { userId }, json: { permission } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  // --- Audit & Activity Logs ---
  getAuditLogs: async (params?: { action?: string; page?: number; limit?: number }): Promise<{ logs: AuditLog[]; total: number }> => {
    const query: Record<string, string> = {}
    if (params?.action) query.action = params.action
    if (params?.page) query.page = String(params.page)
    if (params?.limit) query.limit = String(params.limit)
    const res = await client.admin['audit-logs'].$get({ query })
    const body = await res.json()
    return { logs: (body.data as AuditLog[]) || [], total: (body.meta?.pagination?.total as number) || 0 }
  },

  getActivityLogs: async (params?: { page?: number; limit?: number }): Promise<{ logs: ActivityLog[]; total: number }> => {
    const query: Record<string, string> = {}
    if (params?.page) query.page = String(params.page)
    if (params?.limit) query.limit = String(params.limit)
    const res = await client.admin['activity-logs'].$get({ query })
    const body = await res.json()
    return { logs: (body.data as ActivityLog[]) || [], total: (body.meta?.pagination?.total as number) || 0 }
  },

  getRecentActivity: async (limit = 20): Promise<ActivityLog[]> => {
    const res = await client.admin.activity.recent.$get({ query: { limit: String(limit) } })
    const body = await res.json()
    return (body.data as { activity: ActivityLog[] } | undefined)?.activity || []
  },

  // --- Invitations ---
  getInvitations: async (): Promise<Invitation[]> => {
    const res = await client.admin.invitations.$get()
    const body = await res.json()
    return (body.data as { invitations: Invitation[] } | undefined)?.invitations || []
  },

  sendInvitation: async (email: string, role: string): Promise<Invitation> => {
    const res = await client.admin.invitations.$post({ json: { email, role: role as 'admin' | 'manager' | 'member' | 'readonly' } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to send invitation')
    return body.data as Invitation
  },

  cancelInvitation: async (id: string) => {
    const res = await client.admin.invitations[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to cancel invitation')
  },

  resendInvitation: async (id: string) => {
    const res = await client.admin.invitations[':id'].resend.$post({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to resend invitation')
  },

  getInvitationByToken: async (token: string): Promise<{ orgName: string; inviterName: string; role: string; email: string }> => {
    const res = await client.admin.invitations.accept[':token'].$get({ param: { token } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Invalid invitation')
    return body.data as { orgName: string; inviterName: string; role: string; email: string }
  },

  acceptInvitation: async (token: string): Promise<{ orgId: string; role: string }> => {
    const res = await client.admin.invitations.accept[':token'].$post({ param: { token } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to accept invitation')
    return body.data as { orgId: string; role: string }
  },

  getMyInvitations: async (): Promise<Invitation[]> => {
    const res = await client.admin.invitations.mine.$get()
    const body = await res.json()
    return (body.data as { invitations: Invitation[] } | undefined)?.invitations || []
  },

  // --- Platform Admin ---
  platformListUsers: async (page = 1, limit = 50): Promise<{ users: PlatformUser[]; total: number }> => {
    const res = await client.admin.platform.users.$get({ query: { page: String(page), limit: String(limit) } })
    const body = await res.json()
    return { users: (body.data as PlatformUser[]) || [], total: (body.meta?.pagination?.total as number) || 0 }
  },

  platformListOrgs: async (page = 1, limit = 50): Promise<{ orgs: Organization[]; total: number }> => {
    const res = await client.admin.platform.orgs.$get({ query: { page: String(page), limit: String(limit) } })
    const body = await res.json()
    return { orgs: (body.data as Organization[]) || [], total: (body.meta?.pagination?.total as number) || 0 }
  },

  platformUpdateUserStatus: async (userId: string, status: string) => {
    // Route reads c.req.json() manually (no zValidator) → typed client has no
    // json input; use the rpcFetch fallback with a JSON body.
    const res = await rpcFetch(`${rpcBase()}/admin/platform/users/${userId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  platformDeleteUser: async (userId: string) => {
    const res = await client.admin.platform.users[':userId'].$delete({ param: { userId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  platformUpdateOrgStatus: async (orgId: string, status: string) => {
    // Route reads c.req.json() manually (no zValidator) → typed client has no
    // json input; use the rpcFetch fallback with a JSON body.
    const res = await rpcFetch(`${rpcBase()}/admin/platform/orgs/${orgId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  platformDeleteOrg: async (orgId: string) => {
    const res = await client.admin.platform.orgs[':orgId'].$delete({ param: { orgId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  platformCleanupSessions: async () => {
    const res = await client.admin.platform.cleanup.$post()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Cleanup failed')
    return body.data
  },

  // --- Platform Settings (System Mailer) ---
  getSystemMailer: async (): Promise<{ configured: boolean; config: SystemMailerConfig | null }> => {
    const res = await client.admin.platform.settings.mailer.$get()
    const body = await res.json()
    return body.data as { configured: boolean; config: SystemMailerConfig | null }
  },

  saveSystemMailer: async (config: SystemMailerConfig) => {
    const res = await client.admin.platform.settings.mailer.$put({ json: config })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to save mailer config')
  },

  testSystemMailer: async (): Promise<void> => {
    const res = await client.admin.platform.settings.mailer.test.$post()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Connection test failed')
  },

  sendTestEmail: async (): Promise<void> => {
    const res = await client.admin.platform.settings.mailer['send-test'].$post()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to send test email')
  },

  removeSystemMailer: async () => {
    const res = await client.admin.platform.settings.mailer.$delete()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to remove config')
  },

  // --- OAuth Credentials (Google/Microsoft client ID + secret) ---
  getOAuthCredentials: async (): Promise<{ google: { clientId: string; clientSecret: string } | null; microsoft: { clientId: string; clientSecret: string } | null }> => {
    const res = await client.admin.platform.settings.oauth.$get()
    const body = await res.json()
    return body.data as { google: { clientId: string; clientSecret: string } | null; microsoft: { clientId: string; clientSecret: string } | null }
  },

  saveOAuthCredentials: async (provider: 'google' | 'microsoft', clientId: string, clientSecret: string) => {
    const res = await client.admin.platform.settings.oauth.$put({ json: { provider, clientId, clientSecret } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to save OAuth credentials')
  },

  // --- OAuth Connect (Gmail/Outlook for system mailer) ---
  getOAuthConnectUrl: async (provider: 'gmail' | 'outlook'): Promise<string> => {
    const res = await client.admin.platform.settings.mailer.oauth[':provider'].connect.$get({ param: { provider } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to get auth URL')
    return (body.data as { authUrl: string }).authUrl
  },

  // --- Webhook Registration Status ---
  getWebhookStatus: async (): Promise<{ registered: boolean; status: any }> => {
    const res = await client.admin.platform.settings['webhook-status'].$get()
    const body = await res.json()
    return body.data as { registered: boolean; status: any }
  },

  // --- Sender Identity ---
  getSenderIdentity: async (): Promise<{ sender_company_name: string | null; postal_address: string | null; postal_address_set_at: string | null }> => {
    const res = await client.admin.org['sender-identity'].$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load sender identity')
    return body.data as { sender_company_name: string | null; postal_address: string | null; postal_address_set_at: string | null }
  },
  updateSenderIdentity: async (input: { sender_company_name?: string; postal_address?: string }) => {
    const res = await client.admin.org['sender-identity'].$put({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update sender identity')
  },

  // --- Org Slug ---
  checkSlug: async (slug: string): Promise<{ available: boolean; suggestions: string[] }> => {
    const res = await client.admin.org['check-slug'].$get({ query: { slug } })
    const body = await res.json()
    return body.data as { available: boolean; suggestions: string[] }
  },

  updateSlug: async (slug: string) => {
    const res = await client.admin.org.slug.$put({ json: { slug } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  // --- Sending Domains ---
  getDomains: async (): Promise<SendingDomain[]> => {
    const res = await client.admin.org.domains.$get()
    const body = await res.json()
    return (body.data as { domains: SendingDomain[] } | undefined)?.domains || []
  },

  addDomain: async (domain: string): Promise<{ domain: SendingDomain; dnsRecords: DnsRecord[] }> => {
    const res = await client.admin.org.domains.$post({ json: { domain } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data as { domain: SendingDomain; dnsRecords: DnsRecord[] }
  },

  getDnsRecords: async (domainId: string): Promise<DnsRecord[]> => {
    const res = await client.admin.org.domains[':id'].dns.$get({ param: { id: domainId } })
    const body = await res.json()
    return (body.data as { dnsRecords: DnsRecord[] } | undefined)?.dnsRecords || []
  },

  verifyDomain: async (domainId: string) => {
    const res = await client.admin.org.domains[':id'].verify.$post({ param: { id: domainId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  deleteDomain: async (domainId: string) => {
    const res = await client.admin.org.domains[':id'].$delete({ param: { id: domainId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  // --- Sending Emails ---
  getSendingEmails: async (domainId?: string): Promise<SendingEmailRecord[]> => {
    const query: Record<string, string> = {}
    if (domainId) query.domain_id = domainId
    const res = await client.admin.org['sending-emails'].$get({ query })
    const body = await res.json()
    return (body.data as { emails: SendingEmailRecord[] } | undefined)?.emails || []
  },

  getMySendingEmails: async (): Promise<SendingEmailRecord[]> => {
    const res = await client.admin.org['sending-emails'].mine.$get()
    const body = await res.json()
    return (body.data as { emails: SendingEmailRecord[] } | undefined)?.emails || []
  },

  addSendingEmail: async (domainId: string, email: string, displayName?: string, assignedTo?: string): Promise<SendingEmailRecord> => {
    const res = await client.admin.org['sending-emails'].$post({ json: { domain_id: domainId, email, display_name: displayName, assigned_to: assignedTo } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data as SendingEmailRecord
  },

  updateSendingEmail: async (emailId: string, updates: { display_name?: string; assigned_to?: string | null; is_default?: boolean }) => {
    // Route reads c.req.json() manually (no zValidator) → typed client has no
    // json input; use the rpcFetch fallback with a JSON body.
    const res = await rpcFetch(`${rpcBase()}/admin/org/sending-emails/${emailId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  deleteSendingEmail: async (emailId: string) => {
    const res = await client.admin.org['sending-emails'][':id'].$delete({ param: { id: emailId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },
}

export interface SendingDomain {
  id: string
  org_id: string
  domain: string
  verification_status: 'pending' | 'verified' | 'failed'
  dkim_selector: string | null
  dkim_record: string | null
  return_path: string | null
  verified_at: string | null
  created_at: string
}

export interface DnsRecord {
  type: string
  name: string
  value: string
  purpose: string
}

export interface SendingEmailRecord {
  id: string
  org_id: string
  domain_id: string
  email: string
  display_name: string | null
  is_default: number
  assigned_to: string | null
  status: string
  domain?: string
  verification_status?: string
}

export type ProviderType = 'smtp' | 'ses' | 'sendgrid' | 'mailgun' | 'postmark' | 'sparkpost' | 'gmail' | 'outlook'

export interface SystemMailerConfig {
  fromName: string
  fromEmail: string
  providerConfig: {
    provider: ProviderType
    [key: string]: any
  }
}
