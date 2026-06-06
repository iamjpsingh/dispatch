// src/services/analyticsService.ts - Advanced Analytics Engine
// Campaign reports, link clicks, device breakdown, time analysis, exports

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'
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

// ============================================================================
// Service
// ============================================================================

class AnalyticsService {
  private db: Database

  constructor() {
    const dbPath = './data/analytics.db'
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_analytics (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        campaign_name TEXT NOT NULL DEFAULT '',
        total_sent INTEGER DEFAULT 0,
        delivered INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        opened INTEGER DEFAULT 0,
        clicked INTEGER DEFAULT 0,
        bounced INTEGER DEFAULT 0,
        unsubscribed INTEGER DEFAULT 0,
        computed_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, campaign_id)
      );

      CREATE INDEX IF NOT EXISTS idx_analytics_user ON campaign_analytics(user_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_campaign ON campaign_analytics(campaign_id);

      CREATE TABLE IF NOT EXISTS link_analytics (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        url TEXT NOT NULL,
        click_count INTEGER DEFAULT 0,
        unique_clicks INTEGER DEFAULT 0,
        first_clicked_at TEXT,
        last_clicked_at TEXT,
        UNIQUE(user_id, campaign_id, url)
      );

      CREATE INDEX IF NOT EXISTS idx_link_campaign ON link_analytics(campaign_id);

      CREATE TABLE IF NOT EXISTS event_analytics (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        campaign_id TEXT,
        event_type TEXT NOT NULL CHECK (event_type IN ('open', 'click', 'bounce', 'unsubscribe')),
        recipient_email TEXT,
        user_agent TEXT,
        client_name TEXT,
        device_type TEXT DEFAULT 'unknown',
        geo_country TEXT,
        geo_city TEXT,
        event_hour INTEGER,
        event_day INTEGER,
        url TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_event_user ON event_analytics(user_id);
      CREATE INDEX IF NOT EXISTS idx_event_campaign ON event_analytics(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_event_type ON event_analytics(event_type);
    `)

    // Add org_id to existing tables (idempotent)
    try { this.db.exec('ALTER TABLE campaign_analytics ADD COLUMN org_id TEXT') } catch {}
    try { this.db.exec('ALTER TABLE link_analytics ADD COLUMN org_id TEXT') } catch {}
    try { this.db.exec('ALTER TABLE event_analytics ADD COLUMN org_id TEXT') } catch {}
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_org ON campaign_analytics(org_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_link_org ON link_analytics(org_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_event_org ON event_analytics(org_id)')

    logger.info('Analytics service initialized (data/analytics.db)')
  }

  // --------------------------------------------------------------------------
  // Event Recording
  // --------------------------------------------------------------------------

  recordEvent(orgId: string, event: {
    campaignId?: string
    eventType: 'open' | 'click' | 'bounce' | 'unsubscribe'
    recipientEmail?: string
    userAgent?: string
    url?: string
    geoCountry?: string
    geoCity?: string
  }) {
    const id = generateId('ae')
    const now = new Date()

    const clientName = event.userAgent ? this.parseClientName(event.userAgent) : 'unknown'
    const deviceType = event.userAgent ? this.parseDeviceType(event.userAgent) : 'unknown'

    this.db.prepare(`
      INSERT INTO event_analytics (id, org_id, user_id, campaign_id, event_type, recipient_email, user_agent, client_name, device_type, geo_country, geo_city, event_hour, event_day, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, orgId, event.campaignId || null, event.eventType,
      event.recipientEmail || null, event.userAgent || null,
      clientName, deviceType, event.geoCountry || null, event.geoCity || null,
      now.getHours(), now.getDay(), event.url || null
    )

    // Update link analytics
    if (event.eventType === 'click' && event.url && event.campaignId) {
      this.updateLinkStats(orgId, event.campaignId, event.url)
    }

    // Update campaign analytics
    if (event.campaignId) {
      this.updateCampaignStats(orgId, event.campaignId, event.eventType)
    }
  }

  private updateLinkStats(orgId: string, campaignId: string, url: string) {
    const existing = this.db.prepare(`
      SELECT id FROM link_analytics WHERE org_id = ? AND campaign_id = ? AND url = ?
    `).get(orgId, campaignId, url) as any

    if (existing) {
      this.db.prepare(`
        UPDATE link_analytics SET click_count = click_count + 1, last_clicked_at = datetime('now')
        WHERE id = ?
      `).run(existing.id)
    } else {
      const id = generateId('la')
      this.db.prepare(`
        INSERT INTO link_analytics (id, org_id, user_id, campaign_id, url, click_count, unique_clicks, first_clicked_at, last_clicked_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
      `).run(id, orgId, orgId, campaignId, url)
    }
  }

  private updateCampaignStats(orgId: string, campaignId: string, eventType: string) {
    const existing = this.db.prepare(`
      SELECT id FROM campaign_analytics WHERE org_id = ? AND campaign_id = ?
    `).get(orgId, campaignId) as any

    if (!existing) {
      const id = generateId('ca')
      this.db.prepare(`
        INSERT INTO campaign_analytics (id, org_id, user_id, campaign_id) VALUES (?, ?, ?, ?)
      `).run(id, orgId, orgId, campaignId)
    }

    const column = {
      open: 'opened',
      click: 'clicked',
      bounce: 'bounced',
      unsubscribe: 'unsubscribed',
    }[eventType]

    if (column) {
      this.db.prepare(`
        UPDATE campaign_analytics SET ${column} = ${column} + 1, computed_at = datetime('now')
        WHERE org_id = ? AND campaign_id = ?
      `).run(orgId, campaignId)
    }
  }

  // --------------------------------------------------------------------------
  // Campaign Reports
  // --------------------------------------------------------------------------

  getCampaignReport(orgId: string, campaignId: string): CampaignReport | null {
    const row = this.db.prepare(`
      SELECT * FROM campaign_analytics WHERE org_id = ? AND campaign_id = ?
    `).get(orgId, campaignId) as any

    if (!row) return null

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

  listCampaignReports(orgId: string, limit: number = 50): CampaignReport[] {
    const rows = this.db.prepare(`
      SELECT * FROM campaign_analytics WHERE org_id = ? ORDER BY computed_at DESC LIMIT ?
    `).all(orgId, limit) as any[]

    return rows.map(row => this.formatCampaignReport(row))
  }

  private formatCampaignReport(row: any): CampaignReport {
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

  getLinkClicks(orgId: string, campaignId: string): LinkClickData[] {
    return this.db.prepare(`
      SELECT url, click_count, unique_clicks, first_clicked_at, last_clicked_at
      FROM link_analytics
      WHERE org_id = ? AND campaign_id = ?
      ORDER BY click_count DESC
    `).all(orgId, campaignId) as LinkClickData[]
  }

  // --------------------------------------------------------------------------
  // Device & Client Breakdown
  // --------------------------------------------------------------------------

  getDeviceBreakdown(orgId: string, campaignId?: string): DeviceBreakdown[] {
    const where = campaignId ? 'org_id = ? AND campaign_id = ?' : 'org_id = ?'
    const params = campaignId ? [orgId, campaignId] : [orgId]

    const rows = this.db.prepare(`
      SELECT client_name as client, COUNT(*) as count
      FROM event_analytics
      WHERE ${where} AND event_type = 'open'
      GROUP BY client_name
      ORDER BY count DESC
    `).all(...params) as any[]

    const total = rows.reduce((sum, r) => sum + r.count, 0)
    return rows.map(r => ({
      client: r.client || 'Unknown',
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }))
  }

  getDeviceTypeBreakdown(orgId: string, campaignId?: string): DeviceBreakdown[] {
    const where = campaignId ? 'org_id = ? AND campaign_id = ?' : 'org_id = ?'
    const params = campaignId ? [orgId, campaignId] : [orgId]

    const rows = this.db.prepare(`
      SELECT device_type as client, COUNT(*) as count
      FROM event_analytics
      WHERE ${where} AND event_type = 'open'
      GROUP BY device_type
      ORDER BY count DESC
    `).all(...params) as any[]

    const total = rows.reduce((sum, r) => sum + r.count, 0)
    return rows.map(r => ({
      client: r.client || 'Unknown',
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }))
  }

  // --------------------------------------------------------------------------
  // Geographic Data
  // --------------------------------------------------------------------------

  getGeoBreakdown(orgId: string, campaignId?: string): { country: string; count: number; percentage: number }[] {
    const where = campaignId ? 'org_id = ? AND campaign_id = ?' : 'org_id = ?'
    const params = campaignId ? [orgId, campaignId] : [orgId]

    const rows = this.db.prepare(`
      SELECT geo_country as country, COUNT(*) as count
      FROM event_analytics
      WHERE ${where} AND geo_country IS NOT NULL
      GROUP BY geo_country
      ORDER BY count DESC
      LIMIT 50
    `).all(...params) as any[]

    const total = rows.reduce((sum, r) => sum + r.count, 0)
    return rows.map(r => ({
      country: r.country,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }))
  }

  // --------------------------------------------------------------------------
  // Time Analysis
  // --------------------------------------------------------------------------

  getTimeAnalysis(orgId: string): TimeAnalysis[] {
    return this.db.prepare(`
      SELECT event_hour as hour, event_day as day_of_week,
        SUM(CASE WHEN event_type = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) as click_count
      FROM event_analytics
      WHERE org_id = ?
      GROUP BY event_hour, event_day
      ORDER BY open_count DESC
    `).all(orgId) as TimeAnalysis[]
  }

  getBestSendTime(orgId: string): SendTimeRecommendation | null {
    const analysis = this.getTimeAnalysis(orgId)
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

  getSummary(orgId: string): AnalyticsSummary {
    const reports = this.listCampaignReports(orgId)

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
      best_send_time: this.getBestSendTime(orgId),
    }
  }

  // --------------------------------------------------------------------------
  // Export
  // --------------------------------------------------------------------------

  exportCampaignReport(orgId: string, campaignId: string, format: 'csv' | 'json'): ExportData | null {
    const report = this.getCampaignReport(orgId, campaignId)
    if (!report) return null

    const links = this.getLinkClicks(orgId, campaignId)
    const devices = this.getDeviceBreakdown(orgId, campaignId)

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
      links.forEach(l => {
        csv += `"${l.url}",${l.click_count},${l.unique_clicks},"${l.first_clicked_at}","${l.last_clicked_at}"\n`
      })
    }

    return {
      format: 'csv',
      data: csv,
      filename: `campaign-${campaignId}-report.csv`,
    }
  }

  exportSummary(orgId: string, format: 'csv' | 'json'): ExportData {
    const summary = this.getSummary(orgId)
    const reports = this.listCampaignReports(orgId)

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
      reports.forEach(r => {
        csv += Object.values(r).map(v => `"${v}"`).join(',') + '\n'
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

  seedFromCampaign(orgId: string, campaignId: string, campaignName: string, stats: {
    total_sent: number
    delivered?: number
    failed?: number
    opened?: number
    clicked?: number
    bounced?: number
    unsubscribed?: number
  }) {
    const existing = this.db.prepare(`
      SELECT id FROM campaign_analytics WHERE org_id = ? AND campaign_id = ?
    `).get(orgId, campaignId) as any

    if (existing) {
      this.db.prepare(`
        UPDATE campaign_analytics SET
          campaign_name = ?, total_sent = ?, delivered = ?, failed = ?,
          opened = ?, clicked = ?, bounced = ?, unsubscribed = ?,
          computed_at = datetime('now')
        WHERE id = ?
      `).run(
        campaignName, stats.total_sent, stats.delivered || 0, stats.failed || 0,
        stats.opened || 0, stats.clicked || 0, stats.bounced || 0, stats.unsubscribed || 0,
        existing.id
      )
    } else {
      const id = generateId('ca')
      this.db.prepare(`
        INSERT INTO campaign_analytics (id, org_id, user_id, campaign_id, campaign_name, total_sent, delivered, failed, opened, clicked, bounced, unsubscribed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, orgId, orgId, campaignId, campaignName,
        stats.total_sent, stats.delivered || 0, stats.failed || 0,
        stats.opened || 0, stats.clicked || 0, stats.bounced || 0, stats.unsubscribed || 0
      )
    }
  }

  // --------------------------------------------------------------------------
  // User-Agent Parsing
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
   * Returns events with user_agent, referrer, etc. for UA/geo analysis.
   */
  getRawEvents(orgId: string, campaignId: string, limit = 1000): any[] {
    try {
      return this.db.prepare(`
        SELECT * FROM analytics_events
        WHERE org_id = ? AND campaign_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(orgId, campaignId, limit) as any[]
    } catch {
      // Table may not have org_id or campaign_id — try without filters
      try {
        return this.db.prepare(`
          SELECT * FROM analytics_events
          WHERE campaign_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(campaignId, limit) as any[]
      } catch {
        return []
      }
    }
  }
}

export const analyticsService = new AnalyticsService()
