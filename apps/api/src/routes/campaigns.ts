// src/routes/campaigns.ts - Campaign Management API

import { Hono } from 'hono'
import { z } from 'zod'
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
import { validateBody } from '../utils/validate'
import { logger } from '../utils/logger'

// ============================================================================
// Schemas
// ============================================================================

const CreateCampaignSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  subject: z.string().min(1, 'Subject is required').max(500),
  from_email: z.string().email('Valid from_email is required'),
  from_name: z.string().min(1, 'from_name is required').max(200),
  type: z.enum(['regular', 'ab_test', 'automated', 'rss']).optional(),
  template_id: z.string().optional(),
  html_content: z.string().optional(),
  text_content: z.string().optional(),
  list_ids: z.array(z.string()).optional(),
  segment_ids: z.array(z.string()).optional(),
  config_id: z.string().optional(),
  folder: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
})

const UpdateCampaignSchema = CreateCampaignSchema.partial()

const ScheduleSchema = z.object({
  scheduled_at: z.string().min(1, 'scheduled_at is required'),
})

const ABVariantSchema = z.object({
  label: z.string().max(50).optional(),
  percentage: z.number().min(1).max(100).optional(),
  subject: z.string().max(500).optional(),
  template_id: z.string().optional(),
  sender_name: z.string().max(200).optional(),
  sender_email: z.string().email().optional(),
})

const ABWinnerSchema = z.object({
  variant_id: z.string().min(1, 'variant_id is required'),
})

const app = new Hono()

// ============================================================================
// Campaign CRUD
// ============================================================================

app.get('/campaigns', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
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

app.post('/campaigns', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreateCampaignSchema)

  const campaign = await campaignService.create(orgId, user.id, body)
  return success(c, campaign, 'Campaign created', 201)
})

app.get('/campaigns/dashboard', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const stats = await campaignService.getDashboardStats(orgId)
  return success(c, stats)
})

app.get('/campaigns/:id', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  if (campaignId === 'dashboard') return c.notFound()

  const campaign = await campaignService.get(orgId, campaignId)
  if (!campaign) return error(c, 'Campaign not found', 404)

  return success(c, campaign)
})

app.put('/campaigns/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')
  const body = await validateBody(c, UpdateCampaignSchema)

  const updated = await campaignService.update(orgId, campaignId, body)
  if (!updated) return error(c, 'Campaign not found or cannot be edited', 404)

  return success(c, undefined, 'Campaign updated')
})

app.delete('/campaigns/:id', requirePermission(PERMISSIONS.CAMPAIGNS_DELETE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const deleted = await campaignService.delete(orgId, campaignId)
  if (!deleted) return error(c, 'Campaign not found or cannot be deleted', 404)

  return success(c, undefined, 'Campaign deleted')
})

// ============================================================================
// Campaign Lifecycle
// ============================================================================

app.post('/campaigns/:id/draft', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')
  const body = await validateBody(c, UpdateCampaignSchema)

  const saved = await campaignService.saveDraft(orgId, campaignId, body)
  if (!saved) return error(c, 'Campaign not found', 404)

  return success(c, undefined, 'Draft saved')
})

app.post('/campaigns/:id/schedule', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')
  const { scheduled_at } = await validateBody(c, ScheduleSchema)

  const scheduled = await campaignService.schedule(orgId, campaignId, scheduled_at)
  if (!scheduled) return error(c, 'Campaign not found or not in draft/testing status', 404)

  return success(c, undefined, 'Campaign scheduled')
})

/** Reschedule an already-scheduled campaign (for calendar drag-and-drop) */
app.post('/campaigns/:id/reschedule', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')
  const { scheduled_at } = await validateBody(c, ScheduleSchema)

  const campaign = await campaignService.get(orgId, campaignId)
  if (!campaign) return error(c, 'Campaign not found', 404)
  if (!['draft', 'scheduled', 'testing'].includes(campaign.status)) {
    return error(c, 'Can only reschedule draft or scheduled campaigns', 400)
  }

  const rescheduled = await campaignService.schedule(orgId, campaignId, scheduled_at)
  if (!rescheduled) return error(c, 'Failed to reschedule', 500)

  return success(c, { scheduled_at }, 'Campaign rescheduled')
})

app.post('/campaigns/:id/launch', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
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
  const contacts: Contact[] = listContacts.map((contact) => ({
    Email: contact.email,
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
  const jobId = queueEngine.enqueue(user.id, emailConfig, contacts, {
    type: useBatch ? 'batch' : 'direct',
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

  // 8. Return the job id + recipient count.
  return success(c, { jobId, recipientCount: contacts.length }, 'Campaign launched')
})

app.post('/campaigns/:id/pause', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const paused = await campaignService.setStatus(orgId, campaignId, 'paused')
  if (!paused) return error(c, 'Campaign not found', 404)

  return success(c, undefined, 'Campaign paused')
})

app.post('/campaigns/:id/cancel', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const cancelled = await campaignService.setStatus(orgId, campaignId, 'cancelled')
  if (!cancelled) return error(c, 'Campaign not found', 404)

  return success(c, undefined, 'Campaign cancelled')
})

app.post('/campaigns/:id/clone', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const cloned = await campaignService.clone(orgId, user.id, campaignId)
  if (!cloned) return error(c, 'Campaign not found', 404)

  return success(c, cloned, 'Campaign cloned', 201)
})

app.post('/campaigns/:id/archive', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const archived = await campaignService.setStatus(orgId, campaignId, 'archived')
  if (!archived) return error(c, 'Campaign not found', 404)

  return success(c, undefined, 'Campaign archived')
})

// ============================================================================
// Campaign Stats
// ============================================================================

app.get('/campaigns/:id/stats', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
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

// ============================================================================
// A/B Testing
// ============================================================================

app.post('/campaigns/:id/ab/variant', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')
  const body = await validateBody(c, ABVariantSchema)

  const campaign = await campaignService.get(orgId, campaignId)
  if (!campaign) return error(c, 'Campaign not found', 404)

  const variant = await campaignService.createABVariant(campaignId, body.label || 'A', body.percentage || 50, {
    subject: body.subject,
    templateId: body.template_id,
    senderName: body.sender_name,
    senderEmail: body.sender_email,
  })

  return success(c, variant, 'Variant created', 201)
})

app.get('/campaigns/:id/ab/variants', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const campaign = await campaignService.get(orgId, campaignId)
  if (!campaign) return error(c, 'Campaign not found', 404)

  const variants = await campaignService.getABVariants(campaignId)
  return success(c, { variants })
})

app.post('/campaigns/:id/ab/winner', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const campaignId = c.req.param('id')
  const { variant_id } = await validateBody(c, ABWinnerSchema)

  const declared = await campaignService.declareWinner(campaignId, variant_id)
  if (!declared) return error(c, 'Variant not found', 404)

  return success(c, undefined, 'Winner declared')
})

// ============================================================================
// Frequency Capping
// ============================================================================

const FrequencyCapSchema = z.object({
  maxPerWindow: z.number().int().min(1).max(100),
  windowHours: z.number().int().min(1).max(720),
  enabled: z.boolean(),
})

app.get('/campaigns/frequency-cap', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const config = await frequencyCapService.getConfig(orgId)
  return success(c, config)
})

app.put('/campaigns/frequency-cap', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, FrequencyCapSchema)
  await frequencyCapService.setConfig(orgId, body.maxPerWindow, body.windowHours, body.enabled)
  return success(c, undefined, 'Frequency cap updated')
})

// ============================================================================
// A/B Test Auto-Winner
// ============================================================================

const ABAutoWinnerSchema = z.object({
  winner_metric: z.enum(['open_rate', 'click_rate', 'click_to_open_rate']).default('open_rate'),
  auto_winner_after_hours: z.number().int().min(1).max(168).default(24),
})

/** Configure A/B auto-winner for a campaign */
app.put('/campaigns/:id/ab/auto-winner', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')
  const body = await validateBody(c, ABAutoWinnerSchema)

  const campaign = await campaignService.get(orgId, campaignId)
  if (!campaign) return error(c, 'Campaign not found', 404)
  if (campaign.type !== 'ab_test') return error(c, 'Campaign is not an A/B test', 400)

  // Store auto-winner config in ab_config
  const existing = campaign.ab_config ? JSON.parse(campaign.ab_config) : {}
  const updated = { ...existing, auto_winner: true, winner_metric: body.winner_metric, auto_winner_after_hours: body.auto_winner_after_hours }
  await campaignService.update(orgId, campaignId, { ab_config: JSON.stringify(updated) })

  return success(c, undefined, `Auto-winner configured: declare based on ${body.winner_metric} after ${body.auto_winner_after_hours}h`)
})

/** Check and auto-declare A/B winner (called by worker or manually) */
app.post('/campaigns/:id/ab/check-winner', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
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
  const report = analyticsService.getCampaignReport(orgId, campaignId)
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

  return success(c, {
    decided: true,
    winner: { ...bestVariant, is_winner: 1 },
    metric: abConfig.winner_metric,
  }, `Winner declared: ${bestVariant.variant_label}`)
})

// ============================================================================
// Graymail Suppression
// ============================================================================

const GraymailConfigSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(3).max(50),
})

app.get('/campaigns/graymail', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const config = await graymailService.getConfig(orgId)
  const stats = await graymailService.getStats(orgId)
  return success(c, { config, stats })
})

app.put('/campaigns/graymail', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, GraymailConfigSchema)
  await graymailService.setConfig(orgId, body.enabled, body.threshold)
  return success(c, undefined, 'Graymail settings updated')
})

app.get('/campaigns/graymail/contacts', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')
  const contacts = await graymailService.getGraymailContacts(orgId, limit, offset)
  return success(c, { contacts })
})

app.get('/campaigns/graymail/at-risk', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const contacts = await graymailService.getAtRisk(orgId)
  return success(c, { contacts })
})

app.post('/campaigns/graymail/reset/:email', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const email = c.req.param('email')
  await graymailService.resetContact(orgId, email)
  return success(c, undefined, 'Graymail status reset')
})

// ============================================================================
// Server Rotation Config (per campaign)
// ============================================================================

const RotationConfigSchema = z.object({
  mode: z.enum(['smart', 'manual', 'round_robin', 'weighted']),
  config_ids: z.array(z.string()).optional(),
  weights: z.record(z.string(), z.number()).optional(),
})

/** Set rotation config for a campaign */
app.put('/campaigns/:id/rotation', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')
  const body = await validateBody(c, RotationConfigSchema)

  const campaign = await campaignService.get(orgId, campaignId)
  if (!campaign) return error(c, 'Campaign not found', 404)

  await campaignService.update(orgId, campaignId, { rotation_config: JSON.stringify(body) })
  return success(c, undefined, `Rotation set to ${body.mode}`)
})

/** Get rotation config for a campaign */
app.get('/campaigns/:id/rotation', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const campaign = await campaignService.get(orgId, campaignId)
  if (!campaign) return error(c, 'Campaign not found', 404)

  const config = campaign.rotation_config ? JSON.parse(campaign.rotation_config) : { mode: 'smart', config_ids: [], weights: {} }
  return success(c, config)
})

export default app
