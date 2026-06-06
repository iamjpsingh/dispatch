/**
 * Admin API — Org management, members, teams, roles, audit logs
 */
import { api } from './client'

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
    const res = await api.get<Organization>('/admin/org')
    if (!res.success) throw new Error(res.message || 'Failed to load organization')
    return res.data!
  },

  updateOrg: async (updates: { name?: string; settings?: Record<string, unknown> }) => {
    const res = await api.put('/admin/org', updates)
    if (!res.success) throw new Error(res.message || 'Failed to update')
  },

  // --- Members ---
  getMembers: async (): Promise<OrgMember[]> => {
    const res = await api.get<{ members: OrgMember[] }>('/admin/org/members')
    return res.data?.members || []
  },

  addMember: async (email: string, role: string) => {
    const res = await api.post('/admin/org/members', { email, role })
    if (!res.success) throw new Error(res.message || 'Failed to add member')
    return res.data
  },

  updateMemberRole: async (userId: string, role: string) => {
    const res = await api.put(`/admin/org/members/${userId}/role`, { role })
    if (!res.success) throw new Error(res.message || 'Failed to update role')
  },

  removeMember: async (userId: string) => {
    const res = await api.delete(`/admin/org/members/${userId}`)
    if (!res.success) throw new Error(res.message || 'Failed to remove member')
  },

  // --- Teams ---
  getTeams: async (): Promise<Team[]> => {
    const res = await api.get<{ teams: Team[] }>('/admin/teams')
    return res.data?.teams || []
  },

  createTeam: async (name: string, description?: string): Promise<Team> => {
    const res = await api.post<Team>('/admin/teams', { name, description })
    if (!res.success) throw new Error(res.message || 'Failed to create team')
    return res.data!
  },

  updateTeam: async (teamId: string, updates: { name?: string; description?: string }) => {
    const res = await api.put(`/admin/teams/${teamId}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update team')
  },

  deleteTeam: async (teamId: string) => {
    const res = await api.delete(`/admin/teams/${teamId}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete team')
  },

  getTeamMembers: async (teamId: string): Promise<TeamMember[]> => {
    const res = await api.get<{ members: TeamMember[] }>(`/admin/teams/${teamId}/members`)
    return res.data?.members || []
  },

  addTeamMember: async (teamId: string, userId: string, role?: string) => {
    const res = await api.post(`/admin/teams/${teamId}/members`, { userId, role })
    if (!res.success) throw new Error(res.message || 'Failed to add team member')
  },

  removeTeamMember: async (teamId: string, userId: string) => {
    const res = await api.delete(`/admin/teams/${teamId}/members/${userId}`)
    if (!res.success) throw new Error(res.message || 'Failed to remove team member')
  },

  // --- Roles ---
  getRoles: async (): Promise<SystemRole[]> => {
    const res = await api.get<{ roles: SystemRole[] }>('/admin/roles')
    return res.data?.roles || []
  },

  getUserPermissions: async (userId: string): Promise<{ userId: string; role: string; permissions: string[] }> => {
    const res = await api.get<{ userId: string; role: string; permissions: string[] }>(`/admin/permissions/${userId}`)
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data!
  },

  grantPermission: async (userId: string, permission: string) => {
    const res = await api.post(`/admin/permissions/${userId}/grant`, { permission })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  revokePermission: async (userId: string, permission: string) => {
    const res = await api.post(`/admin/permissions/${userId}/revoke`, { permission })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  // --- Audit & Activity Logs ---
  getAuditLogs: async (params?: { action?: string; page?: number; limit?: number }): Promise<{ logs: AuditLog[]; total: number }> => {
    const qs = new URLSearchParams()
    if (params?.action) qs.set('action', params.action)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString() ? `?${qs}` : ''
    const res = await api.get<AuditLog[]>(`/admin/audit-logs${query}`)
    return { logs: res.data || [], total: res.meta?.pagination?.total as number || 0 }
  },

  getActivityLogs: async (params?: { page?: number; limit?: number }): Promise<{ logs: ActivityLog[]; total: number }> => {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString() ? `?${qs}` : ''
    const res = await api.get<ActivityLog[]>(`/admin/activity-logs${query}`)
    return { logs: res.data || [], total: res.meta?.pagination?.total as number || 0 }
  },

  getRecentActivity: async (limit = 20): Promise<ActivityLog[]> => {
    const res = await api.get<{ activity: ActivityLog[] }>(`/admin/activity/recent?limit=${limit}`)
    return res.data?.activity || []
  },

  // --- Invitations ---
  getInvitations: async (): Promise<Invitation[]> => {
    const res = await api.get<{ invitations: Invitation[] }>('/admin/invitations')
    return res.data?.invitations || []
  },

  sendInvitation: async (email: string, role: string): Promise<Invitation> => {
    const res = await api.post<Invitation>('/admin/invitations', { email, role })
    if (!res.success) throw new Error(res.message || 'Failed to send invitation')
    return res.data!
  },

  cancelInvitation: async (id: string) => {
    const res = await api.delete(`/admin/invitations/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to cancel invitation')
  },

  resendInvitation: async (id: string) => {
    const res = await api.post(`/admin/invitations/${id}/resend`)
    if (!res.success) throw new Error(res.message || 'Failed to resend invitation')
  },

  getInvitationByToken: async (token: string): Promise<{ orgName: string; inviterName: string; role: string; email: string }> => {
    const res = await api.get<{ orgName: string; inviterName: string; role: string; email: string }>(`/admin/invitations/accept/${token}`)
    if (!res.success) throw new Error(res.message || 'Invalid invitation')
    return res.data!
  },

  acceptInvitation: async (token: string): Promise<{ orgId: string; role: string }> => {
    const res = await api.post<{ orgId: string; role: string }>(`/admin/invitations/accept/${token}`)
    if (!res.success) throw new Error(res.message || 'Failed to accept invitation')
    return res.data!
  },

  getMyInvitations: async (): Promise<Invitation[]> => {
    const res = await api.get<{ invitations: Invitation[] }>('/admin/invitations/mine')
    return res.data?.invitations || []
  },

  // --- Platform Admin ---
  platformListUsers: async (page = 1, limit = 50): Promise<{ users: PlatformUser[]; total: number }> => {
    const res = await api.get<PlatformUser[]>(`/admin/platform/users?page=${page}&limit=${limit}`)
    return { users: res.data || [], total: res.meta?.pagination?.total || 0 }
  },

  platformListOrgs: async (page = 1, limit = 50): Promise<{ orgs: Organization[]; total: number }> => {
    const res = await api.get<Organization[]>(`/admin/platform/orgs?page=${page}&limit=${limit}`)
    return { orgs: res.data || [], total: res.meta?.pagination?.total || 0 }
  },

  platformUpdateUserStatus: async (userId: string, status: string) => {
    const res = await api.put(`/admin/platform/users/${userId}/status`, { status })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  platformDeleteUser: async (userId: string) => {
    const res = await api.delete(`/admin/platform/users/${userId}`)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  platformUpdateOrgStatus: async (orgId: string, status: string) => {
    const res = await api.put(`/admin/platform/orgs/${orgId}/status`, { status })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  platformDeleteOrg: async (orgId: string) => {
    const res = await api.delete(`/admin/platform/orgs/${orgId}`)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  platformCleanupSessions: async () => {
    const res = await api.post('/admin/platform/cleanup')
    if (!res.success) throw new Error(res.message || 'Cleanup failed')
    return res.data
  },

  // --- Platform Settings (System Mailer) ---
  getSystemMailer: async (): Promise<{ configured: boolean; config: SystemMailerConfig | null }> => {
    const res = await api.get<{ configured: boolean; config: SystemMailerConfig | null }>('/admin/platform/settings/mailer')
    return res.data!
  },

  saveSystemMailer: async (config: SystemMailerConfig) => {
    const res = await api.put('/admin/platform/settings/mailer', config)
    if (!res.success) throw new Error(res.message || 'Failed to save mailer config')
  },

  testSystemMailer: async (): Promise<void> => {
    const res = await api.post('/admin/platform/settings/mailer/test')
    if (!res.success) throw new Error(res.message || 'Connection test failed')
  },

  sendTestEmail: async (): Promise<void> => {
    const res = await api.post('/admin/platform/settings/mailer/send-test')
    if (!res.success) throw new Error(res.message || 'Failed to send test email')
  },

  removeSystemMailer: async () => {
    const res = await api.delete('/admin/platform/settings/mailer')
    if (!res.success) throw new Error(res.message || 'Failed to remove config')
  },

  // --- OAuth Credentials (Google/Microsoft client ID + secret) ---
  getOAuthCredentials: async (): Promise<{ google: { clientId: string; clientSecret: string } | null; microsoft: { clientId: string; clientSecret: string } | null }> => {
    const res = await api.get<any>('/admin/platform/settings/oauth')
    return res.data!
  },

  saveOAuthCredentials: async (provider: 'google' | 'microsoft', clientId: string, clientSecret: string) => {
    const res = await api.put('/admin/platform/settings/oauth', { provider, clientId, clientSecret })
    if (!res.success) throw new Error(res.message || 'Failed to save OAuth credentials')
  },

  // --- OAuth Connect (Gmail/Outlook for system mailer) ---
  getOAuthConnectUrl: async (provider: 'gmail' | 'outlook'): Promise<string> => {
    const res = await api.get<{ authUrl: string }>(`/admin/platform/settings/mailer/oauth/${provider}/connect`)
    if (!res.success) throw new Error(res.message || 'Failed to get auth URL')
    return res.data!.authUrl
  },

  // --- Webhook Registration Status ---
  getWebhookStatus: async (): Promise<{ registered: boolean; status: any }> => {
    const res = await api.get<any>('/admin/platform/settings/webhook-status')
    return res.data!
  },

  // --- Org Slug ---
  checkSlug: async (slug: string): Promise<{ available: boolean; suggestions: string[] }> => {
    const res = await api.get<any>(`/admin/org/check-slug?slug=${encodeURIComponent(slug)}`)
    return res.data!
  },

  updateSlug: async (slug: string) => {
    const res = await api.put('/admin/org/slug', { slug })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  // --- Sending Domains ---
  getDomains: async (): Promise<SendingDomain[]> => {
    const res = await api.get<{ domains: SendingDomain[] }>('/admin/org/domains')
    return res.data?.domains || []
  },

  addDomain: async (domain: string): Promise<{ domain: SendingDomain; dnsRecords: DnsRecord[] }> => {
    const res = await api.post<{ domain: SendingDomain; dnsRecords: DnsRecord[] }>('/admin/org/domains', { domain })
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data!
  },

  getDnsRecords: async (domainId: string): Promise<DnsRecord[]> => {
    const res = await api.get<{ dnsRecords: DnsRecord[] }>(`/admin/org/domains/${domainId}/dns`)
    return res.data?.dnsRecords || []
  },

  verifyDomain: async (domainId: string) => {
    const res = await api.post(`/admin/org/domains/${domainId}/verify`)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  deleteDomain: async (domainId: string) => {
    const res = await api.delete(`/admin/org/domains/${domainId}`)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  // --- Sending Emails ---
  getSendingEmails: async (domainId?: string): Promise<SendingEmailRecord[]> => {
    const qs = domainId ? `?domain_id=${domainId}` : ''
    const res = await api.get<{ emails: SendingEmailRecord[] }>(`/admin/org/sending-emails${qs}`)
    return res.data?.emails || []
  },

  getMySendingEmails: async (): Promise<SendingEmailRecord[]> => {
    const res = await api.get<{ emails: SendingEmailRecord[] }>('/admin/org/sending-emails/mine')
    return res.data?.emails || []
  },

  addSendingEmail: async (domainId: string, email: string, displayName?: string, assignedTo?: string): Promise<SendingEmailRecord> => {
    const res = await api.post<SendingEmailRecord>('/admin/org/sending-emails', { domain_id: domainId, email, display_name: displayName, assigned_to: assignedTo })
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data!
  },

  updateSendingEmail: async (emailId: string, updates: { display_name?: string; assigned_to?: string | null; is_default?: boolean }) => {
    const res = await api.put(`/admin/org/sending-emails/${emailId}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  deleteSendingEmail: async (emailId: string) => {
    const res = await api.delete(`/admin/org/sending-emails/${emailId}`)
    if (!res.success) throw new Error(res.message || 'Failed')
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
