// src/routes/admin.ts - Admin API routes

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission, requireAnyPermission, requirePlatformAdmin, requireOrgMember } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { authLocalService } from '../services/authLocalService'
import { orgService } from '../services/orgService'
import { teamService } from '../services/teamService'
import { rbacService } from '../services/rbacService'
import { auditService } from '../services/auditService'
import { gdprService } from '../services/gdprService'
import { invitationService } from '../services/invitationService'
import { systemSettingsService } from '../services/systemSettingsService'
import { systemMailerService } from '../services/systemMailerService'
import type { SystemMailerConfig, GmailOAuthProviderConfig, OutlookOAuthProviderConfig } from '../services/systemMailerService'
import { webhookRegistrationService } from '../services/webhookRegistrationService'
import { cloudflareService } from '../services/cloudflareService'
import { oauthService } from '../services/oauthService'
import { sendingDomainService } from '../services/sendingDomainService'
import { getDb } from '../db/pg/client'
import { users, organizations, org_members, sessions } from '../db/pg/schema'
import { eq, and } from 'drizzle-orm'
import { SERVER } from '../config'
import { success, error, paginated } from '../utils/response'
import { auditFromContext } from '../services/audit/context'

// ============================================================================
// Schemas
// ============================================================================

const EmailSchema = z.object({ email: z.string().email('Valid email is required') })

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const SenderIdentitySchema = z.object({
  sender_company_name: z.string().max(200).optional(),
  postal_address: z.string().max(1000).optional(),
})

const AddMemberSchema = z.object({
  email: z.string().email('Valid email is required'),
  role: z.string().max(50).optional(),
})

const RoleSchema = z.object({ role: z.string().min(1, 'Role is required').max(50) })

const TeamSchema = z.object({
  name: z.string().min(1, 'Team name is required').max(200),
  description: z.string().max(1000).optional(),
})

const TeamMemberSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  role: z.string().max(50).optional(),
})

const PermissionSchema = z.object({ permission: z.string().min(1, 'Permission is required') })

const InviteSchema = z.object({
  email: z.string().email('Valid email is required'),
  role: z.enum(['admin', 'manager', 'member', 'readonly']).default('member'),
})

const adminRoutes = new Hono()
  // ==========================================================================
  // Platform Admin (super-admin only, no org context needed)
  // ==========================================================================
  /** List all users (paginated) */
  .get('/admin/platform/users', requirePlatformAdmin(), async (c) => {
    const page = Number(c.req.query('page')) || 1
    const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
    const { users, total } = await authLocalService.listAllUsers(page, limit)
    return paginated(c, users, { page, limit, total })
  })
  /** List all organizations (paginated) */
  .get('/admin/platform/orgs', requirePlatformAdmin(), async (c) => {
    const page = Number(c.req.query('page')) || 1
    const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
    const { orgs, total } = await orgService.listAll(page, limit)
    return paginated(c, orgs, { page, limit, total })
  })
  /** Cleanup expired sessions */
  .post('/admin/platform/cleanup', requirePlatformAdmin(), async (c) => {
    try {
      const deleted = await authLocalService.cleanupSessions()
      return success(c, { sessionsDeleted: deleted }, 'Session cleanup complete')
    } catch (e: any) {
      return error(c, e.message || 'Cleanup failed', 500)
    }
  })
  /** Suspend/activate/delete a user (platform admin only) */
  .put('/admin/platform/users/:userId/status', requirePlatformAdmin(), async (c) => {
    const userId = c.req.param('userId')
    const body = await c.req.json() as { status: string }
    if (!['active', 'suspended', 'deactivated'].includes(body.status)) {
      return error(c, 'Invalid status. Use: active, suspended, deactivated', 400)
    }
    const updated = await getDb()
      .update(users)
      .set({ status: body.status, updated_at: new Date().toISOString() })
      .where(and(eq(users.id, userId), eq(users.is_platform_admin, 0)))
      .returning()
    if (updated.length === 0) return error(c, 'User not found', 404)
    auditFromContext(c, { action: 'user.status_changed', entityType: 'user', entityId: userId, metadata: { status: body.status } })
    return success(c, undefined, `User ${body.status}`)
  })
  .delete('/admin/platform/users/:userId', requirePlatformAdmin(), async (c) => {
    const userId = c.req.param('userId')
    const dbc = getDb()
    // Don't allow deleting platform admin
    const [user] = await dbc
      .select({ is_platform_admin: users.is_platform_admin })
      .from(users)
      .where(eq(users.id, userId))
    if (!user) return error(c, 'User not found', 404)
    if (user.is_platform_admin) return error(c, 'Cannot delete platform admin', 403)
    await dbc.delete(org_members).where(eq(org_members.user_id, userId))
    await dbc.delete(sessions).where(eq(sessions.user_id, userId))
    await dbc.delete(users).where(eq(users.id, userId))
    auditFromContext(c, { action: 'user.deleted', entityType: 'user', entityId: userId })
    return success(c, undefined, 'User deleted')
  })
  /** Suspend/activate/delete an org (platform admin only) */
  .put('/admin/platform/orgs/:orgId/status', requirePlatformAdmin(), async (c) => {
    const orgId = c.req.param('orgId')
    const body = await c.req.json() as { status: string }
    if (!['active', 'suspended', 'archived'].includes(body.status)) {
      return error(c, 'Invalid status. Use: active, suspended, archived', 400)
    }
    const updated = await getDb()
      .update(organizations)
      .set({ status: body.status, updated_at: new Date().toISOString() })
      .where(eq(organizations.id, orgId))
      .returning()
    if (updated.length === 0) return error(c, 'Organization not found', 404)
    auditFromContext(c, { action: 'org.status_changed', entityType: 'org', entityId: orgId })
    return success(c, undefined, `Organization ${body.status}`)
  })
  .delete('/admin/platform/orgs/:orgId', requirePlatformAdmin(), async (c) => {
    const orgId = c.req.param('orgId')
    const dbc = getDb()
    await dbc.delete(org_members).where(eq(org_members.org_id, orgId))
    const deleted = await dbc.delete(organizations).where(eq(organizations.id, orgId)).returning()
    if (deleted.length === 0) return error(c, 'Organization not found', 404)
    auditFromContext(c, { action: 'org.deleted', entityType: 'org', entityId: orgId })
    return success(c, undefined, 'Organization deleted')
  })
  // ==========================================================================
  // Platform Settings (system mailer, OAuth config, etc.)
  // ==========================================================================
  /** Get system mailer config (sensitive fields masked) */
  .get('/admin/platform/settings/mailer', requirePlatformAdmin(), async (c) => {
    const masked = await systemMailerService.getMaskedConfig()
    return success(c, { configured: !!masked, config: masked })
  })
  /** Save system mailer config */
  .put('/admin/platform/settings/mailer', requirePlatformAdmin(), async (c) => {
    const user = requireAuth(c)
    try {
      const body = await c.req.json() as SystemMailerConfig
      if (!body.fromName || !body.fromEmail || !body.providerConfig?.provider) {
        return error(c, 'fromName, fromEmail, and providerConfig are required', 400)
      }
      await systemMailerService.saveConfig(body, user.id)
      auditFromContext(c, { action: 'smtp.updated', entityType: 'smtp', metadata: { secretChanged: true } })

      // Auto-register bounce webhooks with provider API (fire-and-forget)
      webhookRegistrationService.register(body.providerConfig).then(result => {
        if (result.success) {
          systemSettingsService.set('webhook_registration_status', JSON.stringify({
            provider: body.providerConfig.provider,
            webhookId: result.webhookId,
            registeredAt: new Date().toISOString(),
          }))
        }
      }).catch(() => { /* non-blocking */ })

      return success(c, undefined, 'System mailer configuration saved')
    } catch (e: any) {
      return error(c, e.message || 'Failed to save mailer config', 500)
    }
  })
  /** Test system mailer connection */
  .post('/admin/platform/settings/mailer/test', requirePlatformAdmin(), async (c) => {
    try {
      const result = await systemMailerService.verify()
      if (result.success) return success(c, undefined, 'Connection verified successfully')
      return error(c, `Connection failed: ${result.error}`, 400)
    } catch (e: any) {
      return error(c, e.message || 'Test failed', 500)
    }
  })
  /** Send a test email via system mailer */
  .post('/admin/platform/settings/mailer/send-test', requirePlatformAdmin(), async (c) => {
    const user = requireAuth(c)
    try {
      await systemMailerService.send({
        to: user.email,
        subject: 'Dispatch — Test Email',
        html: '<div style="font-family: sans-serif; padding: 20px;"><h2>Test Email</h2><p>Your system mailer is working correctly.</p><p style="color: #888; font-size: 12px;">Sent by Dispatch</p></div>',
        text: 'Test Email\n\nYour system mailer is working correctly.',
      })
      return success(c, undefined, `Test email sent to ${user.email}`)
    } catch (e: any) {
      return error(c, e.message || 'Failed to send test email', 500)
    }
  })
  /** Remove system mailer config */
  .delete('/admin/platform/settings/mailer', requirePlatformAdmin(), async (c) => {
    const user = requireAuth(c)
    await systemMailerService.removeConfig(user.id)
    auditFromContext(c, { action: 'smtp.deleted', entityType: 'smtp' })
    return success(c, undefined, 'System mailer configuration removed')
  })
  /** Get/save OAuth credentials (Google/Microsoft client ID+secret for the platform) */
  .get('/admin/platform/settings/oauth', requirePlatformAdmin(), async (c) => {
    const google = await systemSettingsService.getSecretJson<{ clientId: string; clientSecret: string }>('oauth_google') || null
    const microsoft = await systemSettingsService.getSecretJson<{ clientId: string; clientSecret: string }>('oauth_microsoft') || null
    return success(c, {
      google: google ? { clientId: google.clientId, clientSecret: '********' } : null,
      microsoft: microsoft ? { clientId: microsoft.clientId, clientSecret: '********' } : null,
    })
  })
  .put('/admin/platform/settings/oauth', requirePlatformAdmin(), async (c) => {
    const user = requireAuth(c)
    try {
      const body = await c.req.json() as { provider: 'google' | 'microsoft'; clientId: string; clientSecret: string }
      if (!body.provider || !body.clientId || !body.clientSecret) {
        return error(c, 'provider, clientId, and clientSecret required', 400)
      }
      // If secret is masked placeholder, preserve the existing secret
      let finalSecret = body.clientSecret
      if (finalSecret === '********') {
        const existing = await systemSettingsService.getSecretJson<{ clientId: string; clientSecret: string }>(`oauth_${body.provider}`)
        if (existing?.clientSecret && existing.clientSecret !== '********') {
          finalSecret = existing.clientSecret
        } else {
          return error(c, 'Please enter the actual client secret', 400)
        }
      }
      await systemSettingsService.setSecretJson(`oauth_${body.provider}`, { clientId: body.clientId, clientSecret: finalSecret }, user.id)
      auditFromContext(c, { action: 'oauth.updated', entityType: 'setting', entityId: body.provider, metadata: { secretChanged: true } })
      return success(c, undefined, `${body.provider} OAuth credentials saved`)
    } catch (e: any) {
      return error(c, e.message || 'Failed', 500)
    }
  })
  /** Initiate OAuth connect flow for platform system mailer (Gmail/Outlook) */
  .get('/admin/platform/settings/mailer/oauth/:provider/connect', requirePlatformAdmin(), async (c) => {
    try {
      const user = requireAuth(c)
      const provider = c.req.param('provider') as 'gmail' | 'outlook'

      // Uses the SAME redirect URI as user OAuth — no redirect_uri_mismatch
      const authUrl = provider === 'gmail'
        ? await oauthService.getPlatformGoogleAuthUrl(user.id)
        : await oauthService.getPlatformMicrosoftAuthUrl(user.id)

      return success(c, { authUrl })
    } catch (e: any) {
      return error(c, e.message || 'Failed to initiate OAuth', 500)
    }
  })
  // ==========================================================================
  // Cloudflare Tracking Integration (platform admin)
  // ==========================================================================
  /** Save Cloudflare OAuth credentials */
  .put('/admin/platform/settings/cloudflare', requirePlatformAdmin(), async (c) => {
    const user = requireAuth(c)
    try {
      const body = await c.req.json() as { clientId: string; clientSecret: string }
      if (!body.clientId || !body.clientSecret) {
        return error(c, 'clientId and clientSecret required', 400)
      }
      await systemSettingsService.setSecretJson('cloudflare_oauth', body, user.id)
      auditFromContext(c, { action: 'cloudflare.updated', entityType: 'setting', metadata: { secretChanged: true } })
      return success(c, undefined, 'Cloudflare OAuth credentials saved')
    } catch (e: any) {
      return error(c, e.message || 'Failed', 500)
    }
  })
  /** Get Cloudflare OAuth credentials (masked) */
  .get('/admin/platform/settings/cloudflare', requirePlatformAdmin(), async (c) => {
    const creds = await systemSettingsService.getSecretJson<{ clientId: string; clientSecret: string }>('cloudflare_oauth')
    return success(c, {
      configured: !!creds,
      clientId: creds?.clientId || null,
      clientSecret: creds ? '********' : null,
    })
  })
  /** Initiate Cloudflare OAuth connect flow */
  .get('/admin/cloudflare/connect', requirePlatformAdmin(), (c) => {
    try {
      const user = requireAuth(c)
      const orgId = c.req.query('orgId') || 'platform'
      const authUrl = cloudflareService.getAuthUrl(orgId)
      return success(c, { authUrl })
    } catch (e: any) {
      return error(c, e.message, 400)
    }
  })
  /** Cloudflare OAuth callback */
  .get('/admin/cloudflare/callback', async (c) => {
    const code = c.req.query('code')
    const stateParam = c.req.query('state')
    const cfError = c.req.query('error')

    if (cfError || !code || !stateParam) {
      return c.redirect(`${SERVER.FRONTEND_URL}/admin/platform-settings?cf_error=${cfError || 'missing_code'}`)
    }

    let stateData: { orgId: string; purpose: string }
    try {
      stateData = JSON.parse(Buffer.from(stateParam, 'base64url').toString())
    } catch {
      return c.redirect(`${SERVER.FRONTEND_URL}/admin/platform-settings?cf_error=invalid_state`)
    }

    try {
      const connection = await cloudflareService.exchangeCode(code)
      await cloudflareService.saveConnection(stateData.orgId, connection)
      return c.redirect(`${SERVER.FRONTEND_URL}/admin/platform-settings?cf_success=true&account=${encodeURIComponent(connection.accountName)}`)
    } catch (e: any) {
      return c.redirect(`${SERVER.FRONTEND_URL}/admin/platform-settings?cf_error=${encodeURIComponent(e.message)}`)
    }
  })
  /** Get Cloudflare connection status */
  .get('/admin/cloudflare/status', requirePlatformAdmin(), async (c) => {
    const orgId = c.req.query('orgId') || 'platform'
    const conn = await cloudflareService.getConnection(orgId)
    if (!conn) {
      return success(c, { connected: false })
    }
    return success(c, {
      connected: true,
      accountId: conn.accountId,
      accountName: conn.accountName,
    })
  })
  /** List Cloudflare zones (domains) */
  .get('/admin/cloudflare/zones', requirePlatformAdmin(), async (c) => {
    try {
      const orgId = c.req.query('orgId') || 'platform'
      const zones = await cloudflareService.listZones(orgId)
      const deployments = cloudflareService.getAllDeployments(orgId)

      // Annotate zones with deployment status
      const annotated = zones.map(z => ({
        ...z,
        deployed: deployments.some(d => d.domain === z.name),
        deployment: deployments.find(d => d.domain === z.name) || null,
      }))

      return success(c, { zones: annotated })
    } catch (e: any) {
      return error(c, e.message, 500)
    }
  })
  /** Deploy tracking Worker to a zone */
  .post('/admin/cloudflare/deploy', requirePlatformAdmin(), async (c) => {
    try {
      const body = await c.req.json() as {
        orgId?: string
        zoneId: string
        domain: string
        openPath?: string
        clickPath?: string
        unsubPath?: string
        useSubdomain?: boolean
        subdomain?: string
      }
      const orgId = body.orgId || 'platform'

      const deployment = await cloudflareService.deployTrackingWorker(orgId, body.zoneId, body.domain, {
        openPath: body.openPath,
        clickPath: body.clickPath,
        unsubPath: body.unsubPath,
        useSubdomain: body.useSubdomain,
        subdomain: body.subdomain,
      })

      auditFromContext(c, { action: 'cloudflare.worker_deployed', entityType: 'setting', entityId: body.domain })
      return success(c, deployment, 'Tracking Worker deployed')
    } catch (e: any) {
      return error(c, e.message, 500)
    }
  })
  /** Undeploy tracking Worker from a zone */
  .delete('/admin/cloudflare/undeploy/:domain', requirePlatformAdmin(), async (c) => {
    try {
      const domain = c.req.param('domain')
      const orgId = c.req.query('orgId') || 'platform'
      await cloudflareService.undeployTrackingWorker(orgId, domain)
      auditFromContext(c, { action: 'cloudflare.worker_undeployed', entityType: 'setting', entityId: domain })
      return success(c, undefined, 'Tracking Worker removed')
    } catch (e: any) {
      return error(c, e.message, 500)
    }
  })
  /** Get tracking analytics from D1 */
  .get('/admin/cloudflare/analytics', requirePlatformAdmin(), async (c) => {
    try {
      const orgId = c.req.query('orgId') || 'platform'
      const domain = c.req.query('domain')
      if (!domain) return error(c, 'domain query param required', 400)

      const stats = await cloudflareService.getTrackingStats(orgId, domain)
      return success(c, stats)
    } catch (e: any) {
      return error(c, e.message, 500)
    }
  })
  /** Get webhook registration status */
  .get('/admin/platform/settings/webhook-status', requirePlatformAdmin(), (c) => {
    const status = webhookRegistrationService.getWebhookStatus()
    return success(c, { registered: !!status, status })
  })
  // ==========================================================================
  // Organization Management (org-scoped)
  // ==========================================================================
  /** Check org slug availability */
  .get('/admin/org/check-slug', requirePermission(PERMISSIONS.ORG_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const slug = c.req.query('slug')
    if (!slug) return error(c, 'slug query param required', 400)
    const result = await orgService.checkSlugAvailability(slug, orgId)
    return success(c, result)
  })
  /** Update org slug */
  .put('/admin/org/slug', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const body = await c.req.json() as { slug: string }
    if (!body.slug) return error(c, 'slug is required', 400)
    try {
      await orgService.updateSlug(orgId, body.slug)
      auditFromContext(c, { action: 'org.slug_changed', entityType: 'org', entityId: orgId, metadata: { slug: body.slug } })
      return success(c, undefined, 'Organization slug updated')
    } catch (e: any) {
      return error(c, e.message, 400)
    }
  })
  // ==========================================================================
  // Sender Identity / Compliance (org-scoped)
  // ==========================================================================
  .get('/admin/org/sender-identity', requirePermission(PERMISSIONS.ORG_VIEW), async (c) => {
    const orgId = getOrgId(c)
    return success(c, await orgService.getSenderIdentity(orgId))
  })
  .put('/admin/org/sender-identity', requirePermission(PERMISSIONS.ORG_MANAGE), zValidator('json', SenderIdentitySchema), async (c) => {
    const orgId = getOrgId(c)
    await orgService.setSenderIdentity(orgId, c.req.valid('json'))
    auditFromContext(c, { action: 'org.sender_identity_updated', entityType: 'org', entityId: orgId })
    return success(c, undefined, 'Sender identity updated')
  })
  // ==========================================================================
  // Sending Domains & Emails (org-scoped)
  // ==========================================================================
  .get('/admin/org/domains', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const domains = await sendingDomainService.listDomains(orgId)
    return success(c, { domains })
  })
  .post('/admin/org/domains', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const body = await c.req.json() as { domain: string }
    if (!body.domain) return error(c, 'domain is required', 400)
    try {
      const domain = await sendingDomainService.addDomain(orgId, body.domain)
      const dnsRecords = sendingDomainService.getDnsRecords(domain)
      auditFromContext(c, { action: 'domain.created', entityType: 'domain', entityId: domain.id })
      return success(c, { domain, dnsRecords }, 'Domain added — configure DNS records below', 201)
    } catch (e: any) {
      return error(c, e.message, 400)
    }
  })
  .get('/admin/org/domains/:id/dns', requirePermission(PERMISSIONS.ORG_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const domain = await sendingDomainService.getDomain(orgId, c.req.param('id'))
    if (!domain) return error(c, 'Domain not found', 404)
    return success(c, { dnsRecords: sendingDomainService.getDnsRecords(domain) })
  })
  .post('/admin/org/domains/:id/verify', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const verified = await sendingDomainService.verifyDomain(orgId, c.req.param('id'))
    if (!verified) return error(c, 'Domain not found', 404)
    auditFromContext(c, { action: 'domain.verified', entityType: 'domain', entityId: c.req.param('id') })
    return success(c, undefined, 'Domain verified')
  })
  .delete('/admin/org/domains/:id', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const deleted = await sendingDomainService.deleteDomain(orgId, c.req.param('id'))
    if (!deleted) return error(c, 'Domain not found', 404)
    auditFromContext(c, { action: 'domain.deleted', entityType: 'domain', entityId: c.req.param('id') })
    return success(c, undefined, 'Domain deleted')
  })
  // Sending emails under a domain
  .get('/admin/org/sending-emails', requirePermission(PERMISSIONS.ORG_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const domainId = c.req.query('domain_id')
    const emails = await sendingDomainService.listEmails(orgId, domainId || undefined)
    return success(c, { emails })
  })
  .get('/admin/org/sending-emails/mine', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const emails = await sendingDomainService.listEmailsForUser(orgId, user.id)
    return success(c, { emails })
  })
  .post('/admin/org/sending-emails', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const body = await c.req.json() as { domain_id: string; email: string; display_name?: string; assigned_to?: string }
    if (!body.domain_id || !body.email) return error(c, 'domain_id and email required', 400)
    try {
      const email = await sendingDomainService.addEmail(orgId, body.domain_id, body.email, body.display_name, body.assigned_to)
      auditFromContext(c, { action: 'sending_email.created', entityType: 'sending_email', entityId: email.id })
      return success(c, email, 'Sending email created', 201)
    } catch (e: any) {
      return error(c, e.message, 400)
    }
  })
  .put('/admin/org/sending-emails/:id', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const body = await c.req.json() as { display_name?: string; assigned_to?: string | null; is_default?: boolean }
    const updated = await sendingDomainService.updateEmail(orgId, c.req.param('id'), body)
    if (!updated) return error(c, 'Email not found', 404)
    auditFromContext(c, { action: 'sending_email.updated', entityType: 'sending_email', entityId: c.req.param('id') })
    return success(c, undefined, 'Sending email updated')
  })
  .delete('/admin/org/sending-emails/:id', requirePermission(PERMISSIONS.ORG_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const deleted = await sendingDomainService.deleteEmail(orgId, c.req.param('id'))
    if (!deleted) return error(c, 'Email not found', 404)
    auditFromContext(c, { action: 'sending_email.deleted', entityType: 'sending_email', entityId: c.req.param('id') })
    return success(c, undefined, 'Sending email deleted')
  })
  // ==========================================================================
  // Organization Management (org-scoped)
  // ==========================================================================
  /** Get current org details */
  .get('/admin/org', requirePermission(PERMISSIONS.ORG_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const org = await orgService.get(orgId)
    if (!org) return error(c, 'Organization not found', 404)

    const memberCount = await orgService.getMemberCount(orgId)
    return success(c, { ...org, memberCount })
  })
  /** Update current org */
  .put('/admin/org', requirePermission(PERMISSIONS.ORG_MANAGE), zValidator('json', UpdateOrgSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const updates = c.req.valid('json')

    try {
      const updated = await orgService.update(orgId, updates, user.id)
      if (!updated) return error(c, 'No changes applied', 400)
      return success(c, undefined, 'Organization updated')
    } catch (e: any) {
      return error(c, e.message || 'Failed to update organization', 500)
    }
  })
  /** List org members */
  .get('/admin/org/members', requirePermission(PERMISSIONS.USERS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const members = await orgService.getMembers(orgId)
    return success(c, { members })
  })
  /** Add member to org by email */
  .post('/admin/org/members', requirePermission(PERMISSIONS.USERS_INVITE), zValidator('json', AddMemberSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const { email, role } = c.req.valid('json')

    const target = await authLocalService.getUserByEmail(email)
    if (!target) return error(c, 'User not found. They must register first.', 404)

    const existing = await orgService.getMember(orgId, target.id)
    if (existing) return error(c, 'User is already a member of this organization', 400)

    try {
      const member = await orgService.addMember(orgId, target.id, role || 'member', user.id)
      auditFromContext(c, { action: 'member.added', entityType: 'member', entityId: member.id })
      return success(c, member, 'Member added', 201)
    } catch (e: any) {
      return error(c, e.message || 'Failed to add member', 500)
    }
  })
  /** Change member role */
  .put('/admin/org/members/:userId/role', requirePermission(PERMISSIONS.USERS_MANAGE), zValidator('json', RoleSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const targetId = c.req.param('userId')
    const { role } = c.req.valid('json')

    if (!(await rbacService.canManageUser(user.id, targetId, orgId))) {
      return error(c, 'You cannot manage a user with equal or higher role', 403)
    }

    try {
      const updated = await orgService.updateMemberRole(orgId, targetId, role, user.id)
      if (!updated) return error(c, 'Member not found or no change', 404)
      auditFromContext(c, { action: 'member.role_changed', entityType: 'member', entityId: targetId, metadata: { role } })
      return success(c, undefined, 'Member role updated')
    } catch (e: any) {
      return error(c, e.message || 'Failed to update member role', 500)
    }
  })
  /** Remove member from org */
  .delete('/admin/org/members/:userId', requirePermission(PERMISSIONS.USERS_REMOVE), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const targetId = c.req.param('userId')

    if (user.id === targetId) {
      return error(c, 'You cannot remove yourself', 400)
    }

    if (!(await rbacService.canManageUser(user.id, targetId, orgId))) {
      return error(c, 'You cannot remove a user with equal or higher role', 403)
    }

    try {
      const removed = await orgService.removeMember(orgId, targetId, user.id)
      if (!removed) return error(c, 'Member not found or is org owner', 404)
      auditFromContext(c, { action: 'member.removed', entityType: 'member', entityId: targetId })
      return success(c, undefined, 'Member removed')
    } catch (e: any) {
      return error(c, e.message || 'Failed to remove member', 500)
    }
  })
  // ==========================================================================
  // Team Management (org-scoped)
  // ==========================================================================
  /** List teams */
  .get('/admin/teams', requirePermission(PERMISSIONS.TEAMS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const teams = await teamService.list(orgId)
    return success(c, { teams })
  })
  /** Create team */
  .post('/admin/teams', requirePermission(PERMISSIONS.TEAMS_MANAGE), zValidator('json', TeamSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const { name, description } = c.req.valid('json')

    try {
      const team = teamService.create(orgId, name.trim(), user.id, description)
      return success(c, team, 'Team created', 201)
    } catch (e: any) {
      return error(c, e.message || 'Failed to create team', 500)
    }
  })
  /** Update team */
  .put('/admin/teams/:teamId', requirePermission(PERMISSIONS.TEAMS_MANAGE), zValidator('json', TeamSchema.partial()), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const teamId = c.req.param('teamId')
    const updates = c.req.valid('json')

    try {
      const updated = await teamService.update(orgId, teamId, updates, user.id)
      if (!updated) return error(c, 'Team not found or no change', 404)
      auditFromContext(c, { action: 'team.updated', entityType: 'team', entityId: teamId })
      return success(c, undefined, 'Team updated')
    } catch (e: any) {
      return error(c, e.message || 'Failed to update team', 500)
    }
  })
  /** Delete team */
  .delete('/admin/teams/:teamId', requirePermission(PERMISSIONS.TEAMS_MANAGE), (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const teamId = c.req.param('teamId')

    try {
      const deleted = teamService.delete(orgId, teamId, user.id)
      if (!deleted) return error(c, 'Team not found', 404)
      return success(c, undefined, 'Team deleted')
    } catch (e: any) {
      return error(c, e.message || 'Failed to delete team', 500)
    }
  })
  /** List team members */
  .get('/admin/teams/:teamId/members', requirePermission(PERMISSIONS.TEAMS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const teamId = c.req.param('teamId')

    const team = await teamService.get(orgId, teamId)
    if (!team) return error(c, 'Team not found', 404)

    const members = await teamService.getMembers(teamId)
    return success(c, { members })
  })
  /** Add member to team */
  .post('/admin/teams/:teamId/members', requirePermission(PERMISSIONS.TEAMS_MANAGE), zValidator('json', TeamMemberSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const teamId = c.req.param('teamId')
    const { userId, role } = c.req.valid('json')

    const team = await teamService.get(orgId, teamId)
    if (!team) return error(c, 'Team not found', 404)

    // Verify user is an org member
    const orgMember = await orgService.getMember(orgId, userId)
    if (!orgMember) return error(c, 'User is not a member of this organization', 400)

    try {
      const added = await teamService.addMember(orgId, teamId, userId, role || 'member', user.id)
      if (!added) return error(c, 'User is already a team member', 400)
      auditFromContext(c, { action: 'team.member_added', entityType: 'team', entityId: teamId, metadata: { userId } })
      return success(c, undefined, 'Member added to team', 201)
    } catch (e: any) {
      return error(c, e.message || 'Failed to add team member', 500)
    }
  })
  /** Remove member from team */
  .delete('/admin/teams/:teamId/members/:userId', requirePermission(PERMISSIONS.TEAMS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const teamId = c.req.param('teamId')
    const targetId = c.req.param('userId')

    try {
      const removed = await teamService.removeMember(orgId, teamId, targetId, user.id)
      if (!removed) return error(c, 'Team member not found', 404)
      auditFromContext(c, { action: 'team.member_removed', entityType: 'team', entityId: teamId, metadata: { userId: targetId } })
      return success(c, undefined, 'Member removed from team')
    } catch (e: any) {
      return error(c, e.message || 'Failed to remove team member', 500)
    }
  })
  // ==========================================================================
  // Roles & Permissions (org-scoped)
  // ==========================================================================
  /** List system roles (excludes platform_super_admin — invisible to org users) */
  .get('/admin/roles', requirePermission(PERMISSIONS.ROLES_VIEW), async (c) => {
    const roles = (await rbacService.listSystemRoles()).filter(r => r.name !== 'platform_super_admin')
    return success(c, { roles })
  })
  /** Get effective permissions for a user */
  .get('/admin/permissions/:userId', requirePermission(PERMISSIONS.PERMISSIONS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const targetId = c.req.param('userId')

    const role = await rbacService.getUserRole(targetId, orgId)
    const permissions = await rbacService.getEffectivePermissions(targetId, orgId)

    return success(c, { userId: targetId, role, permissions })
  })
  /** Grant permission override */
  .post('/admin/permissions/:userId/grant', requirePermission(PERMISSIONS.PERMISSIONS_MANAGE), zValidator('json', PermissionSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const targetId = c.req.param('userId')
    const { permission } = c.req.valid('json')

    if (!(await rbacService.canManageUser(user.id, targetId, orgId))) {
      return error(c, 'You cannot manage permissions for a user with equal or higher role', 403)
    }

    try {
      await rbacService.grantPermission(orgId, targetId, permission, user.id)
      auditFromContext(c, { action: 'permission.granted', entityType: 'member', entityId: targetId, metadata: { permission } })
      return success(c, undefined, 'Permission granted')
    } catch (e: any) {
      return error(c, e.message || 'Failed to grant permission', 500)
    }
  })
  /** Revoke permission (explicit deny) */
  .post('/admin/permissions/:userId/revoke', requirePermission(PERMISSIONS.PERMISSIONS_MANAGE), zValidator('json', PermissionSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const targetId = c.req.param('userId')
    const { permission } = c.req.valid('json')

    if (!(await rbacService.canManageUser(user.id, targetId, orgId))) {
      return error(c, 'You cannot manage permissions for a user with equal or higher role', 403)
    }

    try {
      await rbacService.revokePermission(orgId, targetId, permission, user.id)
      auditFromContext(c, { action: 'permission.revoked', entityType: 'member', entityId: targetId, metadata: { permission } })
      return success(c, undefined, 'Permission revoked')
    } catch (e: any) {
      return error(c, e.message || 'Failed to revoke permission', 500)
    }
  })
  /** Remove permission override (revert to role default) */
  .delete('/admin/permissions/:userId/:permission', requirePermission(PERMISSIONS.PERMISSIONS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const targetId = c.req.param('userId')
    const permission = c.req.param('permission')

    if (!(await rbacService.canManageUser(user.id, targetId, orgId))) {
      return error(c, 'You cannot manage permissions for a user with equal or higher role', 403)
    }

    try {
      await rbacService.removePermissionOverride(orgId, targetId, permission)
      auditFromContext(c, { action: 'permission.override_removed', entityType: 'member', entityId: targetId })
      return success(c, undefined, 'Permission override removed')
    } catch (e: any) {
      return error(c, e.message || 'Failed to remove permission override', 500)
    }
  })
  // ==========================================================================
  // Audit & Activity Logs (org-scoped)
  // ==========================================================================
  /** Query audit logs */
  .get('/admin/audit-logs', requirePermission(PERMISSIONS.AUDIT_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const query = {
      orgId,
      action: c.req.query('action') || undefined,
      entityType: c.req.query('entityType') || undefined,
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
      page: Number(c.req.query('page')) || 1,
      limit: Math.min(Number(c.req.query('limit')) || 50, 200),
    }

    const { logs, total } = await auditService.queryAuditLogs(query)
    return paginated(c, logs, { page: query.page, limit: query.limit, total })
  })
  /** Query activity logs */
  .get('/admin/activity-logs', requirePermission(PERMISSIONS.LOGS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const query = {
      orgId,
      action: c.req.query('action') || undefined,
      entityType: c.req.query('entityType') || undefined,
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
      page: Number(c.req.query('page')) || 1,
      limit: Math.min(Number(c.req.query('limit')) || 50, 200),
    }

    const { logs, total } = await auditService.queryActivityLogs(query)
    return paginated(c, logs, { page: query.page, limit: query.limit, total })
  })
  /** Recent activity for dashboard */
  .get('/admin/activity/recent', requirePermission(PERMISSIONS.LOGS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const limit = Math.min(Number(c.req.query('limit')) || 20, 100)
    const activity = await auditService.getRecentActivity(orgId, limit)
    return success(c, { activity })
  })
  // ==========================================================================
  // Invitations (org-scoped)
  // ==========================================================================
  /** List pending invitations for current org */
  .get('/admin/invitations', requirePermission(PERMISSIONS.USERS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const invitations = await invitationService.listForOrg(orgId)
    return success(c, { invitations })
  })
  /** Send an invitation */
  .post('/admin/invitations', requirePermission(PERMISSIONS.USERS_INVITE), zValidator('json', InviteSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const { email, role } = c.req.valid('json')

    try {
      const invitation = await invitationService.create(orgId, email, role, user.id)
      return success(c, invitation, 'Invitation sent', 201)
    } catch (e: any) {
      return error(c, e.message || 'Failed to send invitation', 400)
    }
  })
  /** Cancel an invitation */
  .delete('/admin/invitations/:id', requirePermission(PERMISSIONS.USERS_INVITE), async (c) => {
    const user = requireAuth(c)
    const id = c.req.param('id')

    const cancelled = await invitationService.cancel(id, user.id)
    if (!cancelled) return error(c, 'Invitation not found or already processed', 404)
    auditFromContext(c, { action: 'invitation.cancelled', entityType: 'member', entityId: id })
    return success(c, undefined, 'Invitation cancelled')
  })
  /** Resend an invitation */
  .post('/admin/invitations/:id/resend', requirePermission(PERMISSIONS.USERS_INVITE), async (c) => {
    const user = requireAuth(c)
    const id = c.req.param('id')

    const invitation = await invitationService.resend(id, user.id)
    if (!invitation) return error(c, 'Invitation not found or already processed', 404)
    auditFromContext(c, { action: 'invitation.resent', entityType: 'member', entityId: id })
    return success(c, invitation, 'Invitation resent')
  })
  // ==========================================================================
  // Invitation acceptance (authenticated, no org context needed)
  // ==========================================================================
  /** Get invitation details by token (for accept page) */
  .get('/admin/invitations/accept/:token', async (c) => {
    const token = c.req.param('token')
    const invitation = await invitationService.getByToken(token)
    if (!invitation) return error(c, 'Invalid or expired invitation', 404)
    return success(c, {
      orgName: invitation.org_name,
      inviterName: invitation.inviter_name,
      role: invitation.role,
      email: invitation.email,
    })
  })
  /** Accept an invitation */
  .post('/admin/invitations/accept/:token', async (c) => {
    const user = requireAuth(c)
    const token = c.req.param('token')

    const result = await invitationService.accept(token, user.id)
    if (!result) return error(c, 'Invalid invitation or email mismatch', 400)
    return success(c, result, 'Invitation accepted')
  })
  /** List my pending invitations (for current user's email) */
  .get('/admin/invitations/mine', async (c) => {
    const user = requireAuth(c)
    const invitations = await invitationService.listForEmail(user.email)
    return success(c, { invitations })
  })
  // ==========================================================================
  // GDPR / DSAR — Data Subject Access Request export (org-scoped)
  // ==========================================================================
  .get('/admin/contacts/:id/gdpr-export', requirePermission(PERMISSIONS.GDPR_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const user = requireAuth(c)
    const contactId = c.req.param('id')
    const data = await gdprService.exportRecipient(orgId, contactId)
    if (!data) return error(c, 'Contact not found', 404)
    auditService.log({ orgId, actorId: user.id, action: 'contacts.exported', entityType: 'contact', entityId: contactId })
    c.header('Content-Type', 'application/json')
    c.header('Content-Disposition', `attachment; filename="gdpr-export-${contactId}.json"`)
    return c.body(JSON.stringify(data, null, 2))
  })
  .post('/admin/contacts/:id/gdpr-erase', requirePermission(PERMISSIONS.GDPR_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const user = requireAuth(c)
    const ok = await gdprService.eraseRecipient(orgId, c.req.param('id'), user.id)
    if (!ok) return error(c, 'Contact not found', 404)
    return success(c, undefined, 'Recipient erased')
  })

export default adminRoutes
export type AdminRoutes = typeof adminRoutes
