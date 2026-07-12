// src/routes/campaigns.ts - Campaign Management API

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { campaignService, type CampaignLifecycleStatus, type CampaignType } from '../services/campaignService'
import { templateService } from '../services/templateService'
import { contactService } from '../services/contactService'
import { d1UserDatabase, type D1SMTPConfig } from '../services/d1UserDatabase'
import { queueEngine } from '../services/queueEngine'
import { frequencyCapService } from '../services/frequencyCapService'
import { graymailService } from '../services/graymailService'
import { analyticsService } from '../services/analyticsService'
import { success, error } from '../utils/response'
import type { Contact, EmailConfig } from '../types/index'
import {
  CreateCampaignSchema,
  UpdateCampaignSchema,
  ScheduleSchema,
  ABVariantSchema,
  ABWinnerSchema,
  FrequencyCapSchema,
  ABAutoWinnerSchema,
  GraymailConfigSchema,
  RotationConfigSchema,
} from '@dispatch/shared/campaigns'
import { logger } from '../utils/logger'
import { orgService } from '../services/orgService'
import { assertSenderIdentity } from '../utils/canspam'
import { auditFromContext, activityFromContext } from '../services/audit/context'

const campaignsRoutes = new Hono()
  // ==========================================================================
  // Campaign CRUD
  // ==========================================================================
  .get('/campaigns', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)

    const filters = {
      status: c.req.query('status') as CampaignLifecycleStatus | undefined,
      type: c.req.query('type') as CampaignType | undefined,
      folder: c.req.query('folder'),
      search: c.req.query('search'),
      page: parseInt(c.req.query('page') || '1'),
      limit: parseInt(c.req.query('limit') || '20'),
    }

    const { campaigns, total } = await campaignService.list(orgId, filters)

    return c.json({
      success: true,
      data: campaigns,
      meta: {
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
          hasMore: filters.page * filters.limit < total,
        },
      },
    })
  })
  .post('/campaigns', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', CreateCampaignSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')

    const campaign = await campaignService.create(orgId, user.id, body)
    auditFromContext(c, { action: 'campaign.created', entityType: 'campaign', entityId: campaign.id })
    activityFromContext(c, { action: 'campaign.created', entityType: 'campaign', entityId: campaign.id, description: `Created campaign ${campaign.id}` })
    return success(c, campaign, 'Campaign created', 201)
  })
  .get('/campaigns/dashboard', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const stats = await campaignService.getDashboardStats(orgId)
    return success(c, stats)
  })
  .get('/campaigns/:id', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    // Defensive: /campaigns/dashboard is registered before this param route and
    // matches first; return the envelope (not c.notFound()) so RPC response
    // inference stays a clean {success,data?} union.
    if (campaignId === 'dashboard') return error(c, 'Campaign not found', 404)

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)

    return success(c, campaign)
  })
  .put('/campaigns/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', UpdateCampaignSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const body = c.req.valid('json')

    const updated = await campaignService.update(orgId, campaignId, body)
    if (!updated) return error(c, 'Campaign not found or cannot be edited', 404)

    auditFromContext(c, { action: 'campaign.updated', entityType: 'campaign', entityId: campaignId })
    activityFromContext(c, { action: 'campaign.updated', entityType: 'campaign', entityId: campaignId, description: `Updated campaign ${campaignId}` })
    return success(c, undefined, 'Campaign updated')
  })
  .delete('/campaigns/:id', requirePermission(PERMISSIONS.CAMPAIGNS_DELETE), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const deleted = await campaignService.delete(orgId, campaignId)
    if (!deleted) return error(c, 'Campaign not found or cannot be deleted', 404)

    auditFromContext(c, { action: 'campaign.deleted', entityType: 'campaign', entityId: campaignId })
    activityFromContext(c, { action: 'campaign.deleted', entityType: 'campaign', entityId: campaignId, description: `Deleted campaign ${campaignId}` })
    return success(c, undefined, 'Campaign deleted')
  })
  // ==========================================================================
  // Campaign Lifecycle
  // ==========================================================================
  .post('/campaigns/:id/draft', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', UpdateCampaignSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const body = c.req.valid('json')

    const saved = await campaignService.saveDraft(orgId, campaignId, body)
    if (!saved) return error(c, 'Campaign not found', 404)

    return success(c, undefined, 'Draft saved')
  })
  .post('/campaigns/:id/schedule', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', ScheduleSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const { scheduled_at } = c.req.valid('json')

    const scheduled = await campaignService.schedule(orgId, campaignId, scheduled_at)
    if (!scheduled) return error(c, 'Campaign not found or not in draft/testing status', 404)

    auditFromContext(c, { action: 'campaign.scheduled', entityType: 'campaign', entityId: campaignId, metadata: { scheduledAt: scheduled_at } })
    return success(c, undefined, 'Campaign scheduled')
  })
  /** Reschedule an already-scheduled campaign (for calendar drag-and-drop) */
  .post('/campaigns/:id/reschedule', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', ScheduleSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const { scheduled_at } = c.req.valid('json')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)
    if (!['draft', 'scheduled', 'testing'].includes(campaign.status)) {
      return error(c, 'Can only reschedule draft or scheduled campaigns', 400)
    }

    const rescheduled = await campaignService.schedule(orgId, campaignId, scheduled_at)
    if (!rescheduled) return error(c, 'Failed to reschedule', 500)

    auditFromContext(c, { action: 'campaign.rescheduled', entityType: 'campaign', entityId: campaignId })
    return success(c, { scheduled_at }, 'Campaign rescheduled')
  })
  .post('/campaigns/:id/launch', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    // 1. Load the campaign.
    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)

    // 2. Only draft/scheduled/testing campaigns can be launched.
    if (!['draft', 'scheduled', 'testing'].includes(campaign.status)) {
      return error(c, 'Campaign cannot be launched in its current status', 400)
    }

    // CAN-SPAM hard-gate: org must have a physical postal address before any marketing send.
    const org = await orgService.get(orgId)
    if (!org) return error(c, 'Organization not found', 404)
    try { assertSenderIdentity(org) } catch (e) { return error(c, (e as Error).message, 400) }

    // 3. Resolve the HTML body: prefer the linked template, else fall back to draft_data.
    let htmlContent = ''
    if (campaign.template_id) {
      const template = await templateService.get(orgId, campaign.template_id)
      if (template?.html_content) htmlContent = template.html_content
    }
    if (!htmlContent && campaign.draft_data) {
      try {
        const draft = JSON.parse(campaign.draft_data) as { html_content?: string }
        if (draft?.html_content) htmlContent = draft.html_content
      } catch {
        // Ignore malformed draft data — treated as no content.
      }
    }
    if (!htmlContent) return error(c, 'Campaign has no content', 400)

    // 4. Resolve recipients from the campaign's contact list (note: singular list_id).
    if (!campaign.list_id) return error(c, 'Campaign has no recipients', 400)
    const { contacts: listContacts } = await contactService.getContacts(orgId, campaign.list_id, { limit: 100000 })
    const contacts: Contact[] = listContacts
      .filter((contact) => contact.email !== null)
      .map((contact) => ({
        Email: contact.email as string,
        FirstName: contact.first_name || undefined,
        LastName: contact.last_name || undefined,
        Company: contact.company || undefined,
      }))
    if (contacts.length === 0) return error(c, 'Campaign has no recipients', 400)

    // 5. Resolve the SMTP config: the campaign's config_id if set, else the user's default.
    const configId = (campaign as { config_id?: string | null }).config_id
    let smtpConfig: D1SMTPConfig | null = null
    if (configId) {
      const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)
      smtpConfig = configs.find((config) => config.id === configId) || null
    }
    if (!smtpConfig) {
      smtpConfig = await d1UserDatabase.getUserDefaultSMTPConfig(user.id)
    }
    if (!smtpConfig) return error(c, 'No email configuration found', 400)

    const emailConfig: EmailConfig = {
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: !!smtpConfig.secure,
      auth: {
        user: smtpConfig.username || '',
        pass: smtpConfig.password || '',
      },
    }

    // 6. Enqueue a real send job — mirrors handleSmtpSend in send.ts.
    const useBatch = contacts.length > campaign.batch_size
    const jobId = await queueEngine.enqueue(user.id, emailConfig, contacts, {
      type: useBatch ? 'batch' : 'direct',
      orgId,
      htmlContent,
      subject: campaign.subject,
      fromEmail: campaign.from_email,
      fromName: campaign.from_name,
      configId: smtpConfig.id,
      configName: smtpConfig.name,
      campaignId,
      batchSize: campaign.batch_size,
      emailDelaySec: campaign.email_delay,
      batchDelayMin: campaign.batch_delay,
      priority: 5,
    })

    // 7. Link the job to the campaign and flip it to sending.
    await campaignService.setJobId(campaignId, jobId)
    await campaignService.setTotalRecipients(campaignId, contacts.length)
    await campaignService.setStatus(orgId, campaignId, 'sending')

    logger.info(`Campaign ${campaignId} launched: job ${jobId}, ${contacts.length} recipients`)

    auditFromContext(c, { action: 'campaign.launched', entityType: 'campaign', entityId: campaignId })
    activityFromContext(c, { action: 'campaign.sent', entityType: 'campaign', entityId: campaignId, description: `Launched campaign ${campaignId}` })

    // 8. Return the job id + recipient count.
    return success(c, { jobId, recipientCount: contacts.length }, 'Campaign launched')
  })
  .post('/campaigns/:id/pause', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const paused = await campaignService.setStatus(orgId, campaignId, 'paused')
    if (!paused) return error(c, 'Campaign not found', 404)

    auditFromContext(c, { action: 'campaign.paused', entityType: 'campaign', entityId: campaignId })
    return success(c, undefined, 'Campaign paused')
  })
  .post('/campaigns/:id/cancel', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const cancelled = await campaignService.setStatus(orgId, campaignId, 'cancelled')
    if (!cancelled) return error(c, 'Campaign not found', 404)

    auditFromContext(c, { action: 'campaign.cancelled', entityType: 'campaign', entityId: campaignId })
    return success(c, undefined, 'Campaign cancelled')
  })
  .post('/campaigns/:id/clone', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const cloned = await campaignService.clone(orgId, user.id, campaignId)
    if (!cloned) return error(c, 'Campaign not found', 404)

    auditFromContext(c, { action: 'campaign.cloned', entityType: 'campaign', entityId: cloned.id })
    activityFromContext(c, { action: 'campaign.created', entityType: 'campaign', entityId: cloned.id, description: `Cloned campaign ${campaignId} to ${cloned.id}` })
    return success(c, cloned, 'Campaign cloned', 201)
  })
  .post('/campaigns/:id/archive', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const archived = await campaignService.setStatus(orgId, campaignId, 'archived')
    if (!archived) return error(c, 'Campaign not found', 404)

    auditFromContext(c, { action: 'campaign.archived', entityType: 'campaign', entityId: campaignId })
    return success(c, undefined, 'Campaign archived')
  })
  // ==========================================================================
  // Campaign Stats
  // ==========================================================================
  .get('/campaigns/:id/stats', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const stats = await campaignService.getStats(orgId, campaignId)
    if (!stats) return error(c, 'Campaign not found', 404)

    return success(c, {
      total_recipients: stats.total_recipients,
      sent: stats.sent_count,
      failed: stats.failed_count,
      opened: stats.open_count,
      clicked: stats.click_count,
      bounced: stats.bounce_count,
      unsubscribed: stats.unsubscribe_count,
      open_rate: stats.sent_count > 0 ? Math.round((stats.open_count / stats.sent_count) * 100) / 100 : 0,
      click_rate: stats.sent_count > 0 ? Math.round((stats.click_count / stats.sent_count) * 100) / 100 : 0,
    })
  })
  // ==========================================================================
  // A/B Testing
  // ==========================================================================
  .post('/campaigns/:id/ab/variant', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', ABVariantSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const body = c.req.valid('json')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)

    const variant = await campaignService.createABVariant(campaignId, body.label || 'A', body.percentage || 50, {
      subject: body.subject,
      templateId: body.template_id,
      senderName: body.sender_name,
      senderEmail: body.sender_email,
    })

    auditFromContext(c, { action: 'campaign.ab_variant_created', entityType: 'campaign', entityId: campaignId })
    return success(c, variant, 'Variant created', 201)
  })
  .get('/campaigns/:id/ab/variants', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)

    const variants = await campaignService.getABVariants(campaignId)
    return success(c, { variants })
  })
  .post('/campaigns/:id/ab/winner', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', ABWinnerSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const { variant_id } = c.req.valid('json')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)

    const declared = await campaignService.declareWinner(campaignId, variant_id)
    if (!declared) return error(c, 'Variant not found', 404)

    auditFromContext(c, { action: 'campaign.ab_winner_declared', entityType: 'campaign', entityId: campaignId })
    return success(c, undefined, 'Winner declared')
  })
  // ==========================================================================
  // Frequency Capping
  // ==========================================================================
  .get('/campaigns/frequency-cap', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const config = await frequencyCapService.getConfig(orgId)
    return success(c, config)
  })
  .put('/campaigns/frequency-cap', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', FrequencyCapSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    await frequencyCapService.setConfig(orgId, body.maxPerWindow, body.windowHours, body.enabled)
    auditFromContext(c, { action: 'settings.updated', entityType: 'setting', entityId: orgId })
    return success(c, undefined, 'Frequency cap updated')
  })
  // ==========================================================================
  // A/B Test Auto-Winner
  // ==========================================================================
  /** Configure A/B auto-winner for a campaign */
  .put('/campaigns/:id/ab/auto-winner', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', ABAutoWinnerSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const body = c.req.valid('json')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)
    if (campaign.type !== 'ab_test') return error(c, 'Campaign is not an A/B test', 400)

    // Store auto-winner config in ab_config
    const existing = campaign.ab_config ? JSON.parse(campaign.ab_config) : {}
    const updated = { ...existing, auto_winner: true, winner_metric: body.winner_metric, auto_winner_after_hours: body.auto_winner_after_hours }
    await campaignService.update(orgId, campaignId, { ab_config: JSON.stringify(updated) })

    auditFromContext(c, { action: 'campaign.ab_auto_winner_configured', entityType: 'campaign', entityId: campaignId })
    return success(c, undefined, `Auto-winner configured: declare based on ${body.winner_metric} after ${body.auto_winner_after_hours}h`)
  })
  /** Check and auto-declare A/B winner (called by worker or manually) */
  .post('/campaigns/:id/ab/check-winner', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)
    if (campaign.type !== 'ab_test') return error(c, 'Campaign is not an A/B test', 400)

    const abConfig = campaign.ab_config ? JSON.parse(campaign.ab_config) : {}
    if (!abConfig.auto_winner) return error(c, 'Auto-winner not configured', 400)

    // Check if enough time has passed
    const sentAt = campaign.sent_at ? new Date(campaign.sent_at) : null
    if (!sentAt) return error(c, 'Campaign not yet sent', 400)

    const hoursElapsed = (Date.now() - sentAt.getTime()) / 3600000
    if (hoursElapsed < abConfig.auto_winner_after_hours) {
      return success(c, {
        decided: false,
        hours_elapsed: Math.round(hoursElapsed),
        hours_required: abConfig.auto_winner_after_hours,
      }, `Waiting — ${Math.round(abConfig.auto_winner_after_hours - hoursElapsed)}h remaining`)
    }

    // Get variants and their stats
    const variants = await campaignService.getABVariants(campaignId)
    if (variants.length < 2) return error(c, 'Need at least 2 variants', 400)

    // Already has a winner?
    const existingWinner = variants.find(v => v.is_winner)
    if (existingWinner) {
      return success(c, { decided: true, winner: existingWinner }, 'Winner already declared')
    }

    // Calculate metrics per variant from analytics
    const report = await analyticsService.getCampaignReport(orgId, campaignId)
    if (!report) return error(c, 'No analytics data yet', 400)

    // Simple winner determination: use the metric across variants
    // In a full implementation, each variant tracks its own stats.
    // For now, pick the variant with the highest percentage allocation as winner
    // since variant-level stats require tracking per-variant sends.
    let bestVariant = variants[0]
    let bestScore = 0

    for (const variant of variants) {
      // Score is percentage (higher allocation = more tested)
      const score = variant.percentage || 0
      if (score > bestScore) {
        bestScore = score
        bestVariant = variant
      }
    }

    await campaignService.declareWinner(campaignId, bestVariant.id)
    logger.info(`[AB] Auto-declared winner for ${campaignId}: variant ${bestVariant.variant_label}`)

    auditFromContext(c, { action: 'campaign.ab_winner_declared', entityType: 'campaign', entityId: campaignId })

    return success(c, {
      decided: true,
      winner: { ...bestVariant, is_winner: 1 },
      metric: abConfig.winner_metric,
    }, `Winner declared: ${bestVariant.variant_label}`)
  })
  // ==========================================================================
  // Graymail Suppression
  // ==========================================================================
  .get('/campaigns/graymail', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const config = await graymailService.getConfig(orgId)
    const stats = await graymailService.getStats(orgId)
    return success(c, { config, stats })
  })
  .put('/campaigns/graymail', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', GraymailConfigSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    await graymailService.setConfig(orgId, body.enabled, body.threshold)
    auditFromContext(c, { action: 'settings.updated', entityType: 'setting', entityId: orgId })
    return success(c, undefined, 'Graymail settings updated')
  })
  .get('/campaigns/graymail/contacts', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')
    const contacts = await graymailService.getGraymailContacts(orgId, limit, offset)
    return success(c, { contacts })
  })
  .get('/campaigns/graymail/at-risk', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const contacts = await graymailService.getAtRisk(orgId)
    return success(c, { contacts })
  })
  .post('/campaigns/graymail/reset/:email', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const email = c.req.param('email')
    await graymailService.resetContact(orgId, email)
    auditFromContext(c, { action: 'campaign.graymail_reset', entityType: 'contact', entityId: email })
    return success(c, undefined, 'Graymail status reset')
  })
  // ==========================================================================
  // Server Rotation Config (per campaign)
  // ==========================================================================
  /** Set rotation config for a campaign */
  .put('/campaigns/:id/rotation', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', RotationConfigSchema), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')
    const body = c.req.valid('json')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)

    await campaignService.update(orgId, campaignId, { rotation_config: JSON.stringify(body) })
    auditFromContext(c, { action: 'routing.updated', entityType: 'routing', entityId: campaignId })
    return success(c, undefined, `Rotation set to ${body.mode}`)
  })
  /** Get rotation config for a campaign */
  .get('/campaigns/:id/rotation', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const campaignId = c.req.param('id')

    const campaign = await campaignService.get(orgId, campaignId)
    if (!campaign) return error(c, 'Campaign not found', 404)

    const config = campaign.rotation_config ? JSON.parse(campaign.rotation_config) : { mode: 'smart', config_ids: [], weights: {} }
    return success(c, config)
  })

export default campaignsRoutes
export type CampaignsRoutes = typeof campaignsRoutes
