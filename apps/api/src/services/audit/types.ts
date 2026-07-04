// src/services/audit/types.ts - Audit & Activity taxonomy + entry shapes (R1 extraction).
// Program structure (a developer-defined event taxonomy), R2-exempt.

export type AuditAction =
  // Auth / session / user
  | 'user.login' | 'user.logout' | 'user.register' | 'session.org_switched'
  | 'auth.password_changed' | 'user.profile_updated' | 'user.username_updated'
  | 'user.status_changed' | 'user.deleted'
  // Org
  | 'org.created' | 'org.updated' | 'org.deleted' | 'org.suspended'
  | 'org.status_changed' | 'org.slug_changed' | 'org.sender_identity_updated'
  // Sending domains / identities
  | 'domain.created' | 'domain.verified' | 'domain.deleted'
  | 'sending_email.created' | 'sending_email.updated' | 'sending_email.deleted'
  // Members / teams / permissions / invitations
  | 'member.invited' | 'member.joined' | 'member.role_changed' | 'member.removed'
  | 'member.suspended' | 'member.added'
  | 'team.created' | 'team.updated' | 'team.deleted' | 'team.member_added' | 'team.member_removed'
  | 'permission.granted' | 'permission.revoked' | 'permission.override_removed'
  | 'invitation.cancelled' | 'invitation.resent'
  // Settings / SMTP / OAuth / provider / infra
  | 'settings.updated' | 'smtp.created' | 'smtp.updated' | 'smtp.deleted'
  | 'oauth.updated' | 'cloudflare.updated' | 'cloudflare.worker_deployed' | 'cloudflare.worker_undeployed'
  | 'provider.connected' | 'provider.disconnected'
  // Campaigns
  | 'campaign.created' | 'campaign.updated' | 'campaign.deleted' | 'campaign.launched'
  | 'campaign.paused' | 'campaign.cancelled' | 'campaign.scheduled' | 'campaign.rescheduled'
  | 'campaign.cloned' | 'campaign.archived' | 'campaign.ab_variant_created'
  | 'campaign.ab_winner_declared' | 'campaign.ab_auto_winner_configured' | 'campaign.graymail_reset'
  // Contacts / lists
  | 'contacts.imported' | 'contacts.exported' | 'contacts.deleted' | 'contacts.erased'
  | 'contacts.created' | 'contacts.updated' | 'contacts.merged' | 'contacts.tagged' | 'contacts.moved'
  | 'contact.preference_updated'
  | 'list.created' | 'list.updated' | 'list.deleted'
  // Templates / sections
  | 'template.created' | 'template.updated' | 'template.deleted' | 'template.duplicated'
  | 'section.created' | 'section.updated' | 'section.deleted'
  // Automations
  | 'automation.created' | 'automation.updated' | 'automation.deleted' | 'automation.activated'
  | 'automation.paused' | 'automation.deactivated' | 'automation.contact_enrolled'
  | 'automation.contact_unenrolled' | 'automation.goal_updated' | 'automation.goal_removed'
  // Segments
  | 'segment.created' | 'segment.updated' | 'segment.deleted'
  | 'segment.members_added' | 'segment.members_removed'
  // Forms / pages
  | 'form.created' | 'form.updated' | 'form.deleted' | 'form.status_changed'
  | 'page.created' | 'page.updated' | 'page.deleted' | 'page.published' | 'page.unpublished'
  // Webhooks
  | 'webhook.created' | 'webhook.updated' | 'webhook.deleted' | 'webhook.toggled' | 'webhook.logs_cleared'
  // WhatsApp
  | 'whatsapp.config_created' | 'whatsapp.config_updated' | 'whatsapp.config_deleted'
  | 'whatsapp.template_created' | 'whatsapp.template_deleted'
  | 'whatsapp.message_sent' | 'whatsapp.bulk_sent'
  // Warmup
  | 'warmup.created' | 'warmup.paused' | 'warmup.resumed' | 'warmup.cancelled' | 'warmup.deleted'
  // Routing
  | 'routing.updated' | 'routing.provider_initialized' | 'routing.provider_health_changed' | 'routing.failover_triggered'
  // Plugins
  | 'plugin.installed' | 'plugin.enabled' | 'plugin.disabled' | 'plugin.settings_updated' | 'plugin.uninstalled'
  // Queue / jobs / suppression / send
  | 'job.paused' | 'job.resumed' | 'job.cancelled'
  | 'suppression.added' | 'suppression.removed'
  | 'send.enqueued' | 'send.log_deleted' | 'send.logs_bulk_deleted'
  // Data retention / API keys
  | 'data.retention_purge'
  | 'apikey.created' | 'apikey.revoked' | 'apikey.toggled' | 'apikey.scopes_updated'

export type ActivityAction =
  | 'campaign.created' | 'campaign.updated' | 'campaign.sent' | 'campaign.deleted'
  | 'template.created' | 'template.updated' | 'template.deleted'
  | 'contact.created' | 'contact.updated' | 'contact.deleted'
  | 'list.created' | 'list.updated' | 'list.deleted'
  | 'automation.created' | 'automation.activated' | 'automation.paused'
  | 'automation.updated' | 'automation.deleted' | 'automation.deactivated'
  | 'segment.created' | 'segment.updated' | 'segment.deleted'
  | 'form.created' | 'form.updated' | 'form.deleted'
  | 'page.created' | 'page.updated' | 'page.deleted'
  | 'team.created' | 'team.updated'
  | 'member.invited' | 'member.joined'
  | 'settings.updated'

export interface AuditEntry {
  orgId?: string; actorId: string; actorEmail?: string
  action: AuditAction; entityType: string; entityId?: string
  changes?: Record<string, { from: unknown; to: unknown }>
  ipAddress?: string; userAgent?: string; metadata?: Record<string, unknown>
}

export interface ActivityEntry {
  orgId?: string; actorId: string; actorEmail?: string
  action: ActivityAction; entityType: string; entityId?: string
  description: string; metadata?: Record<string, unknown>
}

export interface LogQuery {
  orgId?: string; actorId?: string; action?: string; entityType?: string
  entityId?: string; from?: string; to?: string; page?: number; limit?: number
}
