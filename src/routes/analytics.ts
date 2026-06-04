// src/routes/analytics.ts - Advanced Analytics Endpoints

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { success, error } from '../utils/response'
import { analyticsService } from '../services/analyticsService'
import { cloudflareService } from '../services/cloudflareService'
import { contactService } from '../services/contactService'
import { scoringEngine } from '../services/scoringEngine'
import { parseUserAgent, detectReferralSource } from '../utils/userAgentParser'
import { validateBody } from '../utils/validate'

// ============================================================================
// Schemas
// ============================================================================

const RecordEventSchema = z.object({
  eventType: z.enum(['open', 'click', 'bounce', 'unsubscribe']),
  campaignId: z.string().optional(),
  recipientEmail: z.string().optional(),
  userAgent: z.string().optional(),
  url: z.string().optional(),
  geoCountry: z.string().optional(),
  geoCity: z.string().optional(),
})

const SeedSchema = z.object({
  campaignId: z.string().min(1, 'campaignId is required'),
  campaignName: z.string().optional(),
  stats: z.record(z.string(), z.unknown()),
})

const app = new Hono()

// Get analytics summary
app.get('/analytics/summary', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const summary = analyticsService.getSummary(orgId)
  return success(c, summary)
})

// Get campaign report
app.get('/analytics/campaigns/:campaignId', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('campaignId')
  const report = analyticsService.getCampaignReport(orgId, campaignId)

  if (!report) return error(c, 'No analytics data for this campaign', 404)
  return success(c, report)
})

// List all campaign reports
app.get('/analytics/campaigns', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const limit = parseInt(c.req.query('limit') || '50')
  const reports = analyticsService.listCampaignReports(orgId, limit)
  return success(c, { reports })
})

// Get link click map for campaign
app.get('/analytics/campaigns/:campaignId/links', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('campaignId')
  const links = analyticsService.getLinkClicks(orgId, campaignId)
  return success(c, { links })
})

// Get device breakdown
app.get('/analytics/devices', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.query('campaign_id')
  const clients = analyticsService.getDeviceBreakdown(orgId, campaignId || undefined)
  const devices = analyticsService.getDeviceTypeBreakdown(orgId, campaignId || undefined)
  return success(c, { clients, devices })
})

// Get geographic breakdown
app.get('/analytics/geo', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.query('campaign_id')
  const geo = analyticsService.getGeoBreakdown(orgId, campaignId || undefined)
  return success(c, { geo })
})

// Get time analysis (best send times)
app.get('/analytics/time', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const analysis = analyticsService.getTimeAnalysis(orgId)
  const recommendation = analyticsService.getBestSendTime(orgId)
  return success(c, { analysis, recommendation })
})

// Export campaign report
app.get('/analytics/export/campaign/:campaignId', requirePermission(PERMISSIONS.ANALYTICS_EXPORT), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('campaignId')
  const format = (c.req.query('format') || 'json') as 'csv' | 'json'
  const exportData = analyticsService.exportCampaignReport(orgId, campaignId, format)

  if (!exportData) return error(c, 'No data to export', 404)

  const contentType = format === 'csv' ? 'text/csv' : 'application/json'
  c.header('Content-Type', contentType)
  c.header('Content-Disposition', `attachment; filename="${exportData.filename}"`)
  return c.body(exportData.data)
})

// Export summary
app.get('/analytics/export/summary', requirePermission(PERMISSIONS.ANALYTICS_EXPORT), async (c) => {
  const orgId = getOrgId(c)
  const format = (c.req.query('format') || 'json') as 'csv' | 'json'
  const exportData = analyticsService.exportSummary(orgId, format)

  const contentType = format === 'csv' ? 'text/csv' : 'application/json'
  c.header('Content-Type', contentType)
  c.header('Content-Disposition', `attachment; filename="${exportData.filename}"`)
  return c.body(exportData.data)
})

// Record analytics event (internal/webhook use)
app.post('/analytics/events', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, RecordEventSchema)

  analyticsService.recordEvent(orgId, {
    campaignId: body.campaignId,
    eventType: body.eventType,
    recipientEmail: body.recipientEmail,
    userAgent: body.userAgent,
    url: body.url,
    geoCountry: body.geoCountry,
    geoCity: body.geoCity,
  })

  return success(c, null, 'Event recorded')
})

// Seed campaign analytics from existing data
app.post('/analytics/seed', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const { campaignId, campaignName, stats } = await validateBody(c, SeedSchema)

  analyticsService.seedFromCampaign(orgId, campaignId, campaignName || '', stats)
  return success(c, null, 'Campaign analytics seeded')
})

// ============================================================================
// Email Health Dashboard
// ============================================================================

app.get('/analytics/email-health', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const summary = analyticsService.getSummary(orgId)

  // Calculate rates from summary data
  const totalSent = summary.totalSent || 1
  const bounceRate = ((summary.totalBounced || 0) / totalSent) * 100
  const complaintRate = ((summary.totalComplaints || 0) / totalSent) * 100
  const unsubRate = ((summary.totalUnsubscribed || 0) / totalSent) * 100
  const openRate = ((summary.totalOpened || 0) / totalSent) * 100
  const clickRate = ((summary.totalClicked || 0) / totalSent) * 100

  // Score: Excellent (90+), Good (70-89), Needs Improvement (50-69), Poor (<50)
  let score = 100
  const recommendations: string[] = []

  // Bounce rate penalty
  if (bounceRate > 5) { score -= 30; recommendations.push(`Bounce rate is ${bounceRate.toFixed(1)}% (target: <2%). Clean your list and validate emails before sending.`) }
  else if (bounceRate > 2) { score -= 15; recommendations.push(`Bounce rate is ${bounceRate.toFixed(1)}% (target: <2%). Consider validating your contact list.`) }

  // Complaint rate penalty
  if (complaintRate > 0.5) { score -= 30; recommendations.push(`Complaint rate is ${complaintRate.toFixed(2)}% (target: <0.1%). Review your content and sending frequency.`) }
  else if (complaintRate > 0.1) { score -= 15; recommendations.push(`Complaint rate is ${complaintRate.toFixed(2)}% (target: <0.1%). Consider adding an unsubscribe link.`) }

  // Unsubscribe rate penalty
  if (unsubRate > 2) { score -= 15; recommendations.push(`Unsubscribe rate is ${unsubRate.toFixed(1)}% (target: <0.5%). Segment your audience for more relevant content.`) }
  else if (unsubRate > 0.5) { score -= 5; recommendations.push(`Unsubscribe rate is ${unsubRate.toFixed(1)}% — within acceptable range but could improve.`) }

  // Low engagement penalty
  if (openRate < 10) { score -= 20; recommendations.push(`Open rate is ${openRate.toFixed(1)}% (benchmark: >20%). Improve subject lines and send time.`) }
  else if (openRate < 20) { score -= 10; recommendations.push(`Open rate is ${openRate.toFixed(1)}% (benchmark: >20%). Test different subject lines.`) }

  score = Math.max(0, score)

  let rating: string
  if (score >= 90) rating = 'Excellent'
  else if (score >= 70) rating = 'Good'
  else if (score >= 50) rating = 'Needs Improvement'
  else rating = 'Poor'

  return success(c, {
    score,
    rating,
    metrics: {
      bounce_rate: +bounceRate.toFixed(2),
      complaint_rate: +complaintRate.toFixed(3),
      unsubscribe_rate: +unsubRate.toFixed(2),
      open_rate: +openRate.toFixed(2),
      click_rate: +clickRate.toFixed(2),
      total_sent: totalSent,
    },
    recommendations,
  })
})

// ============================================================================
// Custom Report Builder
// ============================================================================

const ALLOWED_COLUMNS = [
  'campaign_name', 'campaign_type', 'status', 'total_sent', 'delivered', 'failed',
  'opened', 'clicked', 'bounced', 'unsubscribed',
  'open_rate', 'click_rate', 'bounce_rate', 'unsubscribe_rate', 'click_to_open_rate',
  'delivery_rate', 'sent_at', 'completed_at', 'created_at',
] as const

const ALLOWED_FILTERS = [
  'status', 'type', 'min_sent', 'max_sent', 'min_open_rate', 'max_open_rate',
  'min_click_rate', 'max_click_rate', 'date_from', 'date_to',
] as const

const CustomReportSchema = z.object({
  name: z.string().max(200).optional(),
  columns: z.array(z.string()).min(1, 'At least one column required'),
  filters: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

app.post('/analytics/custom-report', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, CustomReportSchema)

  // Validate columns against whitelist
  const validColumns = body.columns.filter(col => (ALLOWED_COLUMNS as readonly string[]).includes(col))
  if (validColumns.length === 0) {
    return error(c, 'No valid columns selected', 400)
  }

  // Build query from analytics data
  const reports = analyticsService.listCampaignReports(orgId, 500)

  // Apply filters
  let filtered = reports
  const filters = body.filters || {}

  if (filters.status) {
    filtered = filtered.filter(r => (r as any).status === filters.status)
  }
  if (filters.min_sent) {
    filtered = filtered.filter(r => r.total_sent >= Number(filters.min_sent))
  }
  if (filters.max_sent) {
    filtered = filtered.filter(r => r.total_sent <= Number(filters.max_sent))
  }
  if (filters.min_open_rate) {
    filtered = filtered.filter(r => r.open_rate >= Number(filters.min_open_rate))
  }
  if (filters.max_open_rate) {
    filtered = filtered.filter(r => r.open_rate <= Number(filters.max_open_rate))
  }
  if (filters.min_click_rate) {
    filtered = filtered.filter(r => r.click_rate >= Number(filters.min_click_rate))
  }
  if (filters.date_from) {
    filtered = filtered.filter(r => (r as any).created_at >= filters.date_from)
  }
  if (filters.date_to) {
    filtered = filtered.filter(r => (r as any).created_at <= filters.date_to)
  }

  // Sort
  if (body.sort_by && (ALLOWED_COLUMNS as readonly string[]).includes(body.sort_by)) {
    const dir = body.sort_order === 'asc' ? 1 : -1
    filtered.sort((a: any, b: any) => {
      const av = a[body.sort_by!] ?? 0
      const bv = b[body.sort_by!] ?? 0
      return dir * (av > bv ? 1 : av < bv ? -1 : 0)
    })
  }

  // Limit
  const limited = filtered.slice(0, body.limit || 100)

  // Project only requested columns
  const rows = limited.map(row => {
    const projected: Record<string, any> = {}
    for (const col of validColumns) {
      projected[col] = (row as any)[col] ?? null
    }
    return projected
  })

  return success(c, {
    columns: validColumns,
    rows,
    total: rows.length,
    filters_applied: Object.keys(filters).length,
  })
})

/** Get available columns and filters for the report builder UI */
app.get('/analytics/report-builder/schema', requirePermission(PERMISSIONS.ANALYTICS_VIEW), (c) => {
  return success(c, {
    columns: ALLOWED_COLUMNS.map(col => ({
      key: col,
      label: col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      type: ['total_sent', 'delivered', 'failed', 'opened', 'clicked', 'bounced', 'unsubscribed'].includes(col)
        ? 'number'
        : ['open_rate', 'click_rate', 'bounce_rate', 'unsubscribe_rate', 'click_to_open_rate', 'delivery_rate'].includes(col)
        ? 'percentage'
        : ['sent_at', 'completed_at', 'created_at'].includes(col)
        ? 'date'
        : 'string',
    })),
    filters: ALLOWED_FILTERS,
  })
})

// ============================================================================
// Deep Analytics — Matomo-Level Campaign Breakdowns
// ============================================================================

/** Geographic breakdown of opens/clicks for a campaign */
app.get('/analytics/campaigns/:id/geo', requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  // Try pulling from D1 via Cloudflare service
  try {
    const deployments = cloudflareService.getAllDeployments(orgId)
    if (deployments.length > 0) {
      const deployment = deployments[0]
      const token = await cloudflareService.getToken(orgId)
      const conn = cloudflareService.getConnection(orgId)
      if (conn) {
        const sql = `
          SELECT country, COUNT(*) as count, COUNT(DISTINCT email_id) as unique_count
          FROM events WHERE country IS NOT NULL AND country != ''
          GROUP BY country ORDER BY count DESC LIMIT 30
        `
        // Note: This would query D1 via Cloudflare API
        // For now, return from local analytics
      }
    }
  } catch { /* fallback to local */ }

  // Fallback: parse from local analytics events
  const report = analyticsService.getCampaignReport(orgId, campaignId)
  return success(c, {
    countries: [],
    cities: [],
    note: 'Deploy Cloudflare Tracking Worker for geographic data',
  })
})

/** Device/browser/OS breakdown for a campaign */
app.get('/analytics/campaigns/:id/devices', requirePermission(PERMISSIONS.ANALYTICS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  // Get raw events and parse UAs
  const events = analyticsService.getRawEvents?.(orgId, campaignId) || []
  const devices: Record<string, number> = {}
  const browsers: Record<string, number> = {}
  const oses: Record<string, number> = {}

  for (const event of events) {
    if (!event.user_agent) continue
    const parsed = parseUserAgent(event.user_agent)
    devices[parsed.deviceType] = (devices[parsed.deviceType] || 0) + 1
    browsers[parsed.browser] = (browsers[parsed.browser] || 0) + 1
    oses[parsed.os] = (oses[parsed.os] || 0) + 1
  }

  const total = events.length || 1
  return success(c, {
    devices: Object.entries(devices).map(([name, count]) => ({ name, count, percentage: Math.round(count / total * 1000) / 10 })).sort((a, b) => b.count - a.count),
    browsers: Object.entries(browsers).map(([name, count]) => ({ name, count, percentage: Math.round(count / total * 1000) / 10 })).sort((a, b) => b.count - a.count),
    operatingSystems: Object.entries(oses).map(([name, count]) => ({ name, count, percentage: Math.round(count / total * 1000) / 10 })).sort((a, b) => b.count - a.count),
    total: events.length,
  })
})

/** Email client breakdown for a campaign */
app.get('/analytics/campaigns/:id/clients', requirePermission(PERMISSIONS.ANALYTICS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const events = analyticsService.getRawEvents?.(orgId, campaignId) || []
  const clients: Record<string, number> = {}

  for (const event of events) {
    if (!event.user_agent) continue
    const parsed = parseUserAgent(event.user_agent)
    const client = parsed.emailClient || parsed.browser
    clients[client] = (clients[client] || 0) + 1
  }

  const total = events.length || 1
  return success(c, {
    clients: Object.entries(clients).map(([name, count]) => ({ name, count, percentage: Math.round(count / total * 1000) / 10 })).sort((a, b) => b.count - a.count),
    total: events.length,
  })
})

/** Referral sources for click events in a campaign */
app.get('/analytics/campaigns/:id/referrers', requirePermission(PERMISSIONS.ANALYTICS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const campaignId = c.req.param('id')

  const events = (analyticsService.getRawEvents?.(orgId, campaignId) || []).filter((e: any) => e.event_type === 'click')
  const sources: Record<string, { count: number; medium: string }> = {}

  for (const event of events) {
    const ref = detectReferralSource(event.referrer || '')
    if (!sources[ref.source]) sources[ref.source] = { count: 0, medium: ref.medium }
    sources[ref.source].count++
  }

  return success(c, {
    sources: Object.entries(sources).map(([source, data]) => ({ source, ...data })).sort((a, b) => b.count - a.count),
    total: events.length,
  })
})

// ============================================================================
// Deep Analytics — Contact/Recipient Profile
// ============================================================================

/** Full recipient engagement profile */
app.get('/analytics/contacts/:contactId/profile', requirePermission(PERMISSIONS.ANALYTICS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const contactId = c.req.param('contactId')

  const contact = contactService.getContact(orgId, contactId)
  if (!contact) return error(c, 'Contact not found', 404)

  // Get timeline events
  const events = scoringEngine.getContactEvents(contactId, 100)

  // Aggregate stats
  let emailsSent = 0, emailsOpened = 0, linksClicked = 0, bounced = 0
  const campaignsEngaged = new Set<string>()
  const linksClickedUrls: Record<string, number> = {}
  const openHours: Record<number, number> = {}

  for (const event of events) {
    const meta = event.metadata ? JSON.parse(event.metadata) : {}
    switch (event.event_type) {
      case 'email_sent': emailsSent++; break
      case 'email_opened':
        emailsOpened++
        if (meta.campaign_id) campaignsEngaged.add(meta.campaign_id)
        const hour = new Date(event.created_at).getHours()
        openHours[hour] = (openHours[hour] || 0) + 1
        break
      case 'link_clicked':
        linksClicked++
        if (meta.url) linksClickedUrls[meta.url] = (linksClickedUrls[meta.url] || 0) + 1
        if (meta.campaign_id) campaignsEngaged.add(meta.campaign_id)
        break
      case 'bounced': bounced++; break
    }
  }

  // Best open time
  let bestHour = 0, bestHourCount = 0
  for (const [hour, count] of Object.entries(openHours)) {
    if (count > bestHourCount) { bestHour = Number(hour); bestHourCount = count }
  }

  return success(c, {
    contact: {
      id: contact.id,
      email: contact.email,
      first_name: contact.first_name,
      last_name: contact.last_name,
      company: contact.company,
      engagement_score: contact.engagement_score,
      status: contact.status,
      tags: contact.tags,
      created_at: contact.created_at,
    },
    stats: {
      emails_sent: emailsSent,
      emails_opened: emailsOpened,
      open_rate: emailsSent > 0 ? Math.round(emailsOpened / emailsSent * 1000) / 10 : 0,
      links_clicked: linksClicked,
      click_rate: emailsOpened > 0 ? Math.round(linksClicked / emailsOpened * 1000) / 10 : 0,
      bounced,
      campaigns_engaged: campaignsEngaged.size,
      best_open_hour: bestHour,
    },
    top_links: Object.entries(linksClickedUrls)
      .map(([url, clicks]) => ({ url, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10),
    open_hour_distribution: openHours,
    recent_events: events.slice(0, 20).map((e: any) => ({
      type: e.event_type,
      metadata: e.metadata ? JSON.parse(e.metadata) : null,
      created_at: e.created_at,
    })),
  })
})

export default app
