// src/services/analyticsService.ts - Advanced Analytics Engine (Postgres/Drizzle, async)
// Campaign reports, link clicks, device breakdown, time analysis, exports

import { and, eq, isNotNull, sql, desc } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { campaign_analytics, link_analytics, event_analytics } from '../db/pg/schema'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface CampaignReport {
  campaign_id: string
  campaign_name: string
  total_sent: number
  delivered: number
  failed: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number
  delivery_rate: number
  open_rate: number
  click_rate: number
  bounce_rate: number
  unsubscribe_rate: number
  click_to_open_rate: number
}

export interface LinkClickData {
  url: string
  click_count: number
  unique_clicks: number
  first_clicked_at: string
  last_clicked_at: string
}

export interface DeviceBreakdown {
  client: string
  count: number
  percentage: number
}

export interface TimeAnalysis {
  hour: number
  day_of_week: number
  open_count: number
  click_count: number
}

export interface SendTimeRecommendation {
  best_hour: number
  best_day: string
  confidence: number
  data_points: number
}

export interface AnalyticsSummary {
  total_campaigns: number
  total_emails_sent: number
  avg_open_rate: number
  avg_click_rate: number
  avg_bounce_rate: number
  avg_unsubscribe_rate: number
  top_performing_campaign: string | null
  best_send_time: SendTimeRecommendation | null
}

export interface ExportData {
  format: 'csv' | 'json'
  data: string
  filename: string
}

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class AnalyticsService {
  // --------------------------------------------------------------------------
  // Event Recording
  // --------------------------------------------------------------------------

  async recordEvent(orgId: string, event: {
    campaignId?: string
    eventType: 'open' | 'click' | 'bounce' | 'unsubscribe'
    recipientEmail?: string
    userAgent?: string
    url?: string
    geoCountry?: string
    geoCity?: string
  }): Promise<void> {
    const db = getDb()
    const id = generateId('ae')
    const nowDate = new Date()

    const clientName = event.userAgent ? this.parseClientName(event.userAgent) : 'unknown'
    const deviceType = event.userAgent ? this.parseDeviceType(event.userAgent) : 'unknown'

    await db.insert(event_analytics).values({
      id,
      org_id: orgId,
      user_id: orgId,
      campaign_id: event.campaignId || null,
      event_type: event.eventType,
      recipient_email: event.recipientEmail || null,
      user_agent: event.userAgent || null,
      client_name: clientName,
      device_type: deviceType,
      geo_country: event.geoCountry || null,
      geo_city: event.geoCity || null,
      event_hour: nowDate.getHours(),
      event_day: nowDate.getDay(),
      url: event.url || null,
    })

    // Update link analytics
    if (event.eventType === 'click' && event.url && event.campaignId) {
      await this.updateLinkStats(orgId, event.campaignId, event.url)
    }

    // Update campaign analytics
    if (event.campaignId) {
      await this.updateCampaignStats(orgId, event.campaignId, event.eventType)
    }
  }

  private async updateLinkStats(orgId: string, campaignId: string, url: string): Promise<void> {
    const db = getDb()
    const [existing] = await db
      .select({ id: link_analytics.id })
      .from(link_analytics)
      .where(and(eq(link_analytics.org_id, orgId), eq(link_analytics.campaign_id, campaignId), eq(link_analytics.url, url)))
      .limit(1)

    if (existing) {
      await db
        .update(link_analytics)
        .set({ click_count: sql`${link_analytics.click_count} + 1`, last_clicked_at: now() })
        .where(eq(link_analytics.id, existing.id))
    } else {
      const id = generateId('la')
      await db.insert(link_analytics).values({
        id,
        org_id: orgId,
        user_id: orgId,
        campaign_id: campaignId,
        url,
        click_count: 1,
        unique_clicks: 1,
        first_clicked_at: now(),
        last_clicked_at: now(),
      })
    }
  }

  private async updateCampaignStats(orgId: string, campaignId: string, eventType: string): Promise<void> {
    const db = getDb()
    const [existing] = await db
      .select({ id: campaign_analytics.id })
      .from(campaign_analytics)
      .where(and(eq(campaign_analytics.org_id, orgId), eq(campaign_analytics.campaign_id, campaignId)))
      .limit(1)

    if (!existing) {
      const id = generateId('ca')
      await db.insert(campaign_analytics).values({ id, org_id: orgId, user_id: orgId, campaign_id: campaignId })
    }

    const column = {
      open: campaign_analytics.opened,
      click: campaign_analytics.clicked,
      bounce: campaign_analytics.bounced,
      unsubscribe: campaign_analytics.unsubscribed,
    }[eventType]

    if (column) {
      await db
        .update(campaign_analytics)
        .set({ [column.name]: sql`${column} + 1`, computed_at: now() })
        .where(and(eq(campaign_analytics.org_id, orgId), eq(campaign_analytics.campaign_id, campaignId)))
    }
  }

  // --------------------------------------------------------------------------
  // Campaign Reports
  // --------------------------------------------------------------------------

  async getCampaignReport(orgId: string, campaignId: string): Promise<CampaignReport | null> {
    const [row] = await getDb()
      .select()
      .from(campaign_analytics)
      .where(and(eq(campaign_analytics.org_id, orgId), eq(campaign_analytics.campaign_id, campaignId)))
      .limit(1)

    if (!row) return null
    return this.formatCampaignReport(row)
  }

  async listCampaignReports(orgId: string, limit: number = 50): Promise<CampaignReport[]> {
    const rows = await getDb()
      .select()
      .from(campaign_analytics)
      .where(eq(campaign_analytics.org_id, orgId))
      .orderBy(desc(campaign_analytics.computed_at))
      .limit(limit)

    return rows.map((row) => this.formatCampaignReport(row))
  }

  private formatCampaignReport(row: typeof campaign_analytics.$inferSelect): CampaignReport {
    const totalSent = row.total_sent || 0
    const delivered = row.delivered || totalSent - (row.failed || 0) - (row.bounced || 0)
    return {
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      total_sent: totalSent,
      delivered,
      failed: row.failed || 0,
      opened: row.opened || 0,
      clicked: row.clicked || 0,
      bounced: row.bounced || 0,
      unsubscribed: row.unsubscribed || 0,
      delivery_rate: totalSent > 0 ? Math.round((delivered / totalSent) * 10000) / 100 : 0,
      open_rate: delivered > 0 ? Math.round((row.opened / delivered) * 10000) / 100 : 0,
      click_rate: delivered > 0 ? Math.round((row.clicked / delivered) * 10000) / 100 : 0,
      bounce_rate: totalSent > 0 ? Math.round((row.bounced / totalSent) * 10000) / 100 : 0,
      unsubscribe_rate: delivered > 0 ? Math.round((row.unsubscribed / delivered) * 10000) / 100 : 0,
      click_to_open_rate: row.opened > 0 ? Math.round((row.clicked / row.opened) * 10000) / 100 : 0,
    }
  }

  // --------------------------------------------------------------------------
  // Link Click Map
  // --------------------------------------------------------------------------

  async getLinkClicks(orgId: string, campaignId: string): Promise<LinkClickData[]> {
    const rows = await getDb()
      .select({
        url: link_analytics.url,
        click_count: link_analytics.click_count,
        unique_clicks: link_analytics.unique_clicks,
        first_clicked_at: link_analytics.first_clicked_at,
        last_clicked_at: link_analytics.last_clicked_at,
      })
      .from(link_analytics)
      .where(and(eq(link_analytics.org_id, orgId), eq(link_analytics.campaign_id, campaignId)))
      .orderBy(desc(link_analytics.click_count))
    return rows as LinkClickData[]
  }

  // --------------------------------------------------------------------------
  // Device & Client Breakdown
  // --------------------------------------------------------------------------

  async getDeviceBreakdown(orgId: string, campaignId?: string): Promise<DeviceBreakdown[]> {
    const where = campaignId
      ? and(eq(event_analytics.org_id, orgId), eq(event_analytics.campaign_id, campaignId), eq(event_analytics.event_type, 'open'))
      : and(eq(event_analytics.org_id, orgId), eq(event_analytics.event_type, 'open'))

    const rows = await getDb()
      .select({ client: event_analytics.client_name, count: sql<number>`count(*)::int` })
      .from(event_analytics)
      .where(where)
      .groupBy(event_analytics.client_name)
      .orderBy(desc(sql`count(*)`))

    const total = rows.reduce((sum, r) => sum + r.count, 0)
    return rows.map((r) => ({
      client: r.client || 'Unknown',
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }))
  }

  async getDeviceTypeBreakdown(orgId: string, campaignId?: string): Promise<DeviceBreakdown[]> {
    const where = campaignId
      ? and(eq(event_analytics.org_id, orgId), eq(event_analytics.campaign_id, campaignId), eq(event_analytics.event_type, 'open'))
      : and(eq(event_analytics.org_id, orgId), eq(event_analytics.event_type, 'open'))

    const rows = await getDb()
      .select({ client: event_analytics.device_type, count: sql<number>`count(*)::int` })
      .from(event_analytics)
      .where(where)
      .groupBy(event_analytics.device_type)
      .orderBy(desc(sql`count(*)`))

    const total = rows.reduce((sum, r) => sum + r.count, 0)
    return rows.map((r) => ({
      client: r.client || 'Unknown',
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }))
  }

  // --------------------------------------------------------------------------
  // Geographic Data
  // --------------------------------------------------------------------------

  async getGeoBreakdown(orgId: string, campaignId?: string): Promise<{ country: string; count: number; percentage: number }[]> {
    const where = campaignId
      ? and(eq(event_analytics.org_id, orgId), eq(event_analytics.campaign_id, campaignId), isNotNull(event_analytics.geo_country))
      : and(eq(event_analytics.org_id, orgId), isNotNull(event_analytics.geo_country))

    const rows = await getDb()
      .select({ country: event_analytics.geo_country, count: sql<number>`count(*)::int` })
      .from(event_analytics)
      .where(where)
      .groupBy(event_analytics.geo_country)
      .orderBy(desc(sql`count(*)`))
      .limit(50)

    const total = rows.reduce((sum, r) => sum + r.count, 0)
    return rows.map((r) => ({
      country: r.country as string,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }))
  }

  // --------------------------------------------------------------------------
  // Time Analysis
  // --------------------------------------------------------------------------

  async getTimeAnalysis(orgId: string): Promise<TimeAnalysis[]> {
    const rows = await getDb()
      .select({
        hour: event_analytics.event_hour,
        day_of_week: event_analytics.event_day,
        open_count: sql<number>`sum(case when ${event_analytics.event_type} = 'open' then 1 else 0 end)::int`,
        click_count: sql<number>`sum(case when ${event_analytics.event_type} = 'click' then 1 else 0 end)::int`,
      })
      .from(event_analytics)
      .where(eq(event_analytics.org_id, orgId))
      .groupBy(event_analytics.event_hour, event_analytics.event_day)
      .orderBy(desc(sql`sum(case when ${event_analytics.event_type} = 'open' then 1 else 0 end)`))
    return rows as TimeAnalysis[]
  }

  async getBestSendTime(orgId: string): Promise<SendTimeRecommendation | null> {
    const analysis = await this.getTimeAnalysis(orgId)
    if (analysis.length === 0) return null

    const best = analysis[0]
    const totalDataPoints = analysis.reduce((sum, a) => sum + a.open_count + a.click_count, 0)
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    return {
      best_hour: best.hour,
      best_day: dayNames[best.day_of_week] || 'Unknown',
      confidence: Math.min(100, Math.round((totalDataPoints / 100) * 100)),
      data_points: totalDataPoints,
    }
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------

  async getSummary(orgId: string): Promise<AnalyticsSummary> {
    const reports = await this.listCampaignReports(orgId)

    if (reports.length === 0) {
      return {
        total_campaigns: 0,
        total_emails_sent: 0,
        avg_open_rate: 0,
        avg_click_rate: 0,
        avg_bounce_rate: 0,
        avg_unsubscribe_rate: 0,
        top_performing_campaign: null,
        best_send_time: null,
      }
    }

    const totalSent = reports.reduce((sum, r) => sum + r.total_sent, 0)
    const avgOpen = reports.reduce((sum, r) => sum + r.open_rate, 0) / reports.length
    const avgClick = reports.reduce((sum, r) => sum + r.click_rate, 0) / reports.length
    const avgBounce = reports.reduce((sum, r) => sum + r.bounce_rate, 0) / reports.length
    const avgUnsub = reports.reduce((sum, r) => sum + r.unsubscribe_rate, 0) / reports.length

    const topCampaign = reports.sort((a, b) => b.open_rate - a.open_rate)[0]

    return {
      total_campaigns: reports.length,
      total_emails_sent: totalSent,
      avg_open_rate: Math.round(avgOpen * 100) / 100,
      avg_click_rate: Math.round(avgClick * 100) / 100,
      avg_bounce_rate: Math.round(avgBounce * 100) / 100,
      avg_unsubscribe_rate: Math.round(avgUnsub * 100) / 100,
      top_performing_campaign: topCampaign?.campaign_name || null,
      best_send_time: await this.getBestSendTime(orgId),
    }
  }

  // --------------------------------------------------------------------------
  // Export
  // --------------------------------------------------------------------------

  async exportCampaignReport(orgId: string, campaignId: string, format: 'csv' | 'json'): Promise<ExportData | null> {
    const report = await this.getCampaignReport(orgId, campaignId)
    if (!report) return null

    const links = await this.getLinkClicks(orgId, campaignId)
    const devices = await this.getDeviceBreakdown(orgId, campaignId)

    if (format === 'json') {
      return {
        format: 'json',
        data: JSON.stringify({ report, links, devices }, null, 2),
        filename: `campaign-${campaignId}-report.json`,
      }
    }

    // CSV
    const headers = Object.keys(report)
    const values = Object.values(report)
    let csv = headers.join(',') + '\n' + values.join(',') + '\n\n'

    if (links.length > 0) {
      csv += 'Link Analytics\n'
      csv += 'URL,Clicks,Unique Clicks,First Clicked,Last Clicked\n'
      links.forEach((l) => {
        csv += `"${l.url}",${l.click_count},${l.unique_clicks},"${l.first_clicked_at}","${l.last_clicked_at}"\n`
      })
    }

    return {
      format: 'csv',
      data: csv,
      filename: `campaign-${campaignId}-report.csv`,
    }
  }

  async exportSummary(orgId: string, format: 'csv' | 'json'): Promise<ExportData> {
    const summary = await this.getSummary(orgId)
    const reports = await this.listCampaignReports(orgId)

    if (format === 'json') {
      return {
        format: 'json',
        data: JSON.stringify({ summary, campaigns: reports }, null, 2),
        filename: 'analytics-summary.json',
      }
    }

    let csv = 'Analytics Summary\n'
    csv += Object.entries(summary).map(([k, v]) => `${k},${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')
    csv += '\n\nCampaign Reports\n'

    if (reports.length > 0) {
      csv += Object.keys(reports[0]).join(',') + '\n'
      reports.forEach((r) => {
        csv += Object.values(r).map((v) => `"${v}"`).join(',') + '\n'
      })
    }

    return {
      format: 'csv',
      data: csv,
      filename: 'analytics-summary.csv',
    }
  }

  // --------------------------------------------------------------------------
  // Seed campaign analytics from existing data
  // --------------------------------------------------------------------------

  async seedFromCampaign(orgId: string, campaignId: string, campaignName: string, stats: {
    total_sent: number
    delivered?: number
    failed?: number
    opened?: number
    clicked?: number
    bounced?: number
    unsubscribed?: number
  }): Promise<void> {
    const db = getDb()
    const [existing] = await db
      .select({ id: campaign_analytics.id })
      .from(campaign_analytics)
      .where(and(eq(campaign_analytics.org_id, orgId), eq(campaign_analytics.campaign_id, campaignId)))
      .limit(1)

    if (existing) {
      await db
        .update(campaign_analytics)
        .set({
          campaign_name: campaignName,
          total_sent: stats.total_sent,
          delivered: stats.delivered || 0,
          failed: stats.failed || 0,
          opened: stats.opened || 0,
          clicked: stats.clicked || 0,
          bounced: stats.bounced || 0,
          unsubscribed: stats.unsubscribed || 0,
          computed_at: now(),
        })
        .where(eq(campaign_analytics.id, existing.id))
    } else {
      const id = generateId('ca')
      await db.insert(campaign_analytics).values({
        id,
        org_id: orgId,
        user_id: orgId,
        campaign_id: campaignId,
        campaign_name: campaignName,
        total_sent: stats.total_sent,
        delivered: stats.delivered || 0,
        failed: stats.failed || 0,
        opened: stats.opened || 0,
        clicked: stats.clicked || 0,
        bounced: stats.bounced || 0,
        unsubscribed: stats.unsubscribed || 0,
      })
    }
  }

  // --------------------------------------------------------------------------
  // User-Agent Parsing (pure, synchronous)
  // --------------------------------------------------------------------------

  private parseClientName(ua: string): string {
    if (!ua) return 'Unknown'
    const lower = ua.toLowerCase()
    if (lower.includes('thunderbird')) return 'Thunderbird'
    if (lower.includes('outlook')) return 'Outlook'
    if (lower.includes('apple mail') || lower.includes('webkit')) return 'Apple Mail'
    if (lower.includes('gmail')) return 'Gmail'
    if (lower.includes('yahoo')) return 'Yahoo Mail'
    if (lower.includes('samsung')) return 'Samsung Mail'
    if (lower.includes('chrome')) return 'Chrome'
    if (lower.includes('firefox')) return 'Firefox'
    if (lower.includes('safari')) return 'Safari'
    return 'Other'
  }

  private parseDeviceType(ua: string): string {
    if (!ua) return 'unknown'
    const lower = ua.toLowerCase()
    if (lower.includes('mobile') || lower.includes('android') || lower.includes('iphone')) return 'mobile'
    if (lower.includes('tablet') || lower.includes('ipad')) return 'tablet'
    return 'desktop'
  }

  /**
   * Get raw event records for deep analytics parsing.
   * The legacy `analytics_events` table does not exist in the Postgres schema
   * (it was never created in SQLite either), so this returns an empty array —
   * preserving the original try/catch fallback behavior.
   */
  async getRawEvents(_orgId: string, _campaignId: string, _limit = 1000): Promise<(typeof event_analytics.$inferSelect)[]> {
    return []
  }
}

export const analyticsService = new AnalyticsService()
