import type { AuditAction } from '../../../src/services/audit/types'
export const adminAuthManifest = {
  // admin.ts — platform
  'POST /admin/platform/cleanup': { exempt: 'derived-recompute: purges already-expired sessions' },
  'PUT /admin/platform/users/:userId/status': 'user.status_changed',
  'DELETE /admin/platform/users/:userId': 'user.deleted',
  'PUT /admin/platform/orgs/:orgId/status': 'org.status_changed',
  'DELETE /admin/platform/orgs/:orgId': 'org.deleted',
  'PUT /admin/platform/settings/mailer': 'smtp.updated',
  'POST /admin/platform/settings/mailer/test': { exempt: 'preview-test-validate: mailer connection test' },
  'POST /admin/platform/settings/mailer/send-test': { exempt: 'preview-test-validate: sends a test email' },
  'DELETE /admin/platform/settings/mailer': 'smtp.deleted',
  'PUT /admin/platform/settings/oauth': 'oauth.updated',
  'PUT /admin/platform/settings/cloudflare': 'cloudflare.updated',
  'POST /admin/cloudflare/deploy': 'cloudflare.worker_deployed',
  'DELETE /admin/cloudflare/undeploy/:domain': 'cloudflare.worker_undeployed',
  // admin.ts — org
  'PUT /admin/org/slug': 'org.slug_changed',
  'PUT /admin/org/sender-identity': 'org.sender_identity_updated',
  'POST /admin/org/domains': 'domain.created',
  'POST /admin/org/domains/:id/verify': 'domain.verified',
  'DELETE /admin/org/domains/:id': 'domain.deleted',
  'POST /admin/org/sending-emails': 'sending_email.created',
  'PUT /admin/org/sending-emails/:id': 'sending_email.updated',
  'DELETE /admin/org/sending-emails/:id': 'sending_email.deleted',
  'PUT /admin/org': 'org.updated', // service (orgService self-audits)
  'POST /admin/org/members': 'member.added', // service (orgService.addMember logs member.invited)
  'PUT /admin/org/members/:userId/role': 'member.role_changed', // service (orgService.updateMemberRole)
  'DELETE /admin/org/members/:userId': 'member.removed', // service (orgService.removeMember)
  // admin.ts — teams. created (activity feed) + deleted (audit) = service (teamService).
  // updated + member_added + member_removed = ROUTE-layer (T9 found teamService did NOT
  // audit them; member_added was mis-logged as team.created — service bug flagged for P8).
  'POST /admin/teams': 'team.created', // service (activity feed)
  'PUT /admin/teams/:teamId': 'team.updated', // route
  'DELETE /admin/teams/:teamId': 'team.deleted', // service (audit)
  'POST /admin/teams/:teamId/members': 'team.member_added', // route
  'DELETE /admin/teams/:teamId/members/:userId': 'team.member_removed', // route
  // admin.ts — permissions / invitations / gdpr
  'POST /admin/permissions/:userId/grant': 'permission.granted',
  'POST /admin/permissions/:userId/revoke': 'permission.revoked',
  'DELETE /admin/permissions/:userId/:permission': 'permission.override_removed',
  'POST /admin/invitations': 'member.invited', // service (invitationService.create logs invitation.created)
  'DELETE /admin/invitations/:id': 'invitation.cancelled', // service (invitationService.cancel)
  'POST /admin/invitations/:id/resend': 'invitation.resent',
  'POST /admin/invitations/accept/:token': 'member.joined', // service (invitationService.accept logs invitation.accepted)
  'POST /admin/contacts/:id/gdpr-erase': 'contacts.erased', // service (gdprService self-audits)
  // auth.ts
  'POST /auth/register': 'user.register', // service (authLocalService self-audits)
  'POST /auth/login': 'user.login', // service
  'POST /auth/logout': 'user.logout', // service
  'POST /auth/switch-org': 'session.org_switched',
  'POST /auth/forgot-password': { exempt: 'actor-less: unauthenticated; no server-derived actor at route layer' },
  'POST /auth/reset-password': { exempt: 'actor-less: unauthenticated; token-based, no session actor' },
  'POST /auth/change-password': 'auth.password_changed', // service (authLocalService.updatePassword logs user.password_change)
  'PUT /auth/profile': 'user.profile_updated',
  'PUT /auth/profile/username': 'user.username_updated',
} satisfies Record<string, AuditAction | { exempt: string }>
