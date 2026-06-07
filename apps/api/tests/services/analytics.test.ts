// P2.6 net — analyticsService on real (PGlite) Postgres. Event recording (with
// link + campaign-stat side effects), campaign reports + rate math, link clicks,
// device/geo breakdowns, time analysis + best-send-time, summary, exports, seeding,
// org scoping, and a Postgres landing cross-check. org_id is the FK to organizations;
// user_id is loose text (no FK), so no users row is required.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, campaign_analytics, link_analytics, event_analytics } from '../../src/db/pg/schema'
import { analyticsService } from '../../src/services/analyticsService'

const ORG = 'org_an'
const ORG2 = 'org_an2'
const CAMP = 'camp_1'

describe('P2.6 — analyticsService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org An', slug: 'org-an' },
      { id: ORG2, name: 'Org An2', slug: 'org-an2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('records an event and lands a row in event_analytics with parsed UA', async () => {
    await analyticsService.recordEvent(ORG, {
      campaignId: CAMP,
      eventType: 'open',
      recipientEmail: 'a@x.com',
      userAgent: 'Mozilla/5.0 (iPhone) Gmail',
    })
    const rows = await db.select().from(event_analytics)
    expect(rows).toHaveLength(1)
    expect(rows[0].org_id).toBe(ORG)
    expect(rows[0].user_id).toBe(ORG)
    expect(rows[0].event_type).toBe('open')
    expect(rows[0].client_name).toBe('Gmail')
    expect(rows[0].device_type).toBe('mobile')
    expect(rows[0].event_hour).toBeGreaterThanOrEqual(0)
    expect(rows[0].event_hour).toBeLessThanOrEqual(23)
  })

  it('open event creates + increments campaign_analytics', async () => {
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'click', url: 'https://x.com' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'bounce' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'unsubscribe' })

    const [ca] = await db.select().from(campaign_analytics).where(eq(campaign_analytics.campaign_id, CAMP))
    expect(ca.opened).toBe(2)
    expect(ca.clicked).toBe(1)
    expect(ca.bounced).toBe(1)
    expect(ca.unsubscribed).toBe(1)
  })

  it('click event upserts link_analytics (insert then atomic increment)', async () => {
    const url = 'https://example.com/a'
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'click', url })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'click', url })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'click', url: 'https://example.com/b' })

    const links = await analyticsService.getLinkClicks(ORG, CAMP)
    expect(links).toHaveLength(2)
    const a = links.find((l) => l.url === url)!
    expect(a.click_count).toBe(2)
    expect(a.unique_clicks).toBe(1)
    expect(a.first_clicked_at).toBeTruthy()
    expect(a.last_clicked_at).toBeTruthy()
    // ordered by click_count desc — the 2-click url comes first
    expect(links[0].url).toBe(url)

    const dbRows = await db.select().from(link_analytics)
    expect(dbRows).toHaveLength(2)
  })

  it('seedFromCampaign inserts then updates; getCampaignReport computes rates', async () => {
    await analyticsService.seedFromCampaign(ORG, CAMP, 'Newsletter', {
      total_sent: 1000,
      delivered: 950,
      failed: 50,
      opened: 475,
      clicked: 95,
      bounced: 30,
      unsubscribed: 19,
    })

    const report = await analyticsService.getCampaignReport(ORG, CAMP)
    expect(report).not.toBeNull()
    expect(report!.campaign_name).toBe('Newsletter')
    expect(report!.total_sent).toBe(1000)
    expect(report!.delivered).toBe(950)
    expect(report!.delivery_rate).toBe(95)
    expect(report!.open_rate).toBe(50) // 475/950
    expect(report!.click_rate).toBe(10) // 95/950
    expect(report!.bounce_rate).toBe(3) // 30/1000
    expect(report!.unsubscribe_rate).toBe(2) // 19/950
    expect(report!.click_to_open_rate).toBe(20) // 95/475

    // upsert path: second seed updates the existing row (no duplicate)
    await analyticsService.seedFromCampaign(ORG, CAMP, 'Renamed', { total_sent: 2000, delivered: 2000, opened: 1000 })
    const all = await db.select().from(campaign_analytics).where(eq(campaign_analytics.campaign_id, CAMP))
    expect(all).toHaveLength(1)
    const updated = await analyticsService.getCampaignReport(ORG, CAMP)
    expect(updated!.campaign_name).toBe('Renamed')
    expect(updated!.total_sent).toBe(2000)
    expect(updated!.open_rate).toBe(50)
  })

  it('getCampaignReport returns null for missing / cross-org', async () => {
    await analyticsService.seedFromCampaign(ORG, CAMP, 'X', { total_sent: 10 })
    expect(await analyticsService.getCampaignReport(ORG, 'nope')).toBeNull()
    expect(await analyticsService.getCampaignReport(ORG2, CAMP)).toBeNull()
  })

  it('listCampaignReports is org-scoped and ordered by computed_at desc', async () => {
    await analyticsService.seedFromCampaign(ORG, 'c1', 'C1', { total_sent: 10 })
    await analyticsService.seedFromCampaign(ORG, 'c2', 'C2', { total_sent: 20 })
    await analyticsService.seedFromCampaign(ORG2, 'c3', 'C3', { total_sent: 30 })

    const list = await analyticsService.listCampaignReports(ORG)
    expect(list).toHaveLength(2)
    expect(list.map((r) => r.campaign_id).sort()).toEqual(['c1', 'c2'])

    const limited = await analyticsService.listCampaignReports(ORG, 1)
    expect(limited).toHaveLength(1)
  })

  it('device + device-type breakdown with percentages (opens only)', async () => {
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open', userAgent: 'Gmail' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open', userAgent: 'Gmail' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open', userAgent: 'Outlook desktop' })
    // a click should NOT count toward open breakdown
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'click', url: 'https://x.com', userAgent: 'Gmail' })

    const clients = await analyticsService.getDeviceBreakdown(ORG, CAMP)
    const total = clients.reduce((s, c) => s + c.count, 0)
    expect(total).toBe(3)
    const gmail = clients.find((c) => c.client === 'Gmail')!
    expect(gmail.count).toBe(2)
    expect(gmail.percentage).toBeCloseTo(66.67, 1)
    // first by count desc
    expect(clients[0].client).toBe('Gmail')

    const devices = await analyticsService.getDeviceTypeBreakdown(ORG, CAMP)
    const dt = devices.reduce((s, d) => s + d.count, 0)
    expect(dt).toBe(3)
  })

  it('geo breakdown filters nulls and is org-scoped', async () => {
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open', geoCountry: 'US' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open', geoCountry: 'US' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open', geoCountry: 'CA' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open' }) // null country excluded
    await analyticsService.recordEvent(ORG2, { campaignId: CAMP, eventType: 'open', geoCountry: 'GB' }) // other org

    const geo = await analyticsService.getGeoBreakdown(ORG)
    expect(geo.map((g) => g.country).sort()).toEqual(['CA', 'US'])
    const us = geo.find((g) => g.country === 'US')!
    expect(us.count).toBe(2)
    expect(us.percentage).toBeCloseTo(66.67, 1)
  })

  it('time analysis + best send time', async () => {
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open' })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'click', url: 'https://x.com' })

    const ta = await analyticsService.getTimeAnalysis(ORG)
    expect(ta.length).toBeGreaterThanOrEqual(1)
    const totalOpens = ta.reduce((s, t) => s + t.open_count, 0)
    const totalClicks = ta.reduce((s, t) => s + t.click_count, 0)
    expect(totalOpens).toBe(2)
    expect(totalClicks).toBe(1)

    const best = await analyticsService.getBestSendTime(ORG)
    expect(best).not.toBeNull()
    expect(best!.data_points).toBe(3)
    expect(best!.best_hour).toBeGreaterThanOrEqual(0)
    expect(typeof best!.best_day).toBe('string')

    // empty org → null
    expect(await analyticsService.getBestSendTime(ORG2)).toBeNull()
  })

  it('summary aggregates reports + best send time; empty org returns zeros', async () => {
    await analyticsService.seedFromCampaign(ORG, 'c1', 'C1', { total_sent: 100, delivered: 100, opened: 60 })
    await analyticsService.seedFromCampaign(ORG, 'c2', 'C2', { total_sent: 200, delivered: 200, opened: 40 })

    const sum = await analyticsService.getSummary(ORG)
    expect(sum.total_campaigns).toBe(2)
    expect(sum.total_emails_sent).toBe(300)
    expect(sum.avg_open_rate).toBe(40) // (60% + 20%)/2
    expect(sum.top_performing_campaign).toBe('C1') // higher open rate

    const empty = await analyticsService.getSummary(ORG2)
    expect(empty.total_campaigns).toBe(0)
    expect(empty.total_emails_sent).toBe(0)
    expect(empty.top_performing_campaign).toBeNull()
    expect(empty.best_send_time).toBeNull()
  })

  it('exports campaign report as json and csv', async () => {
    await analyticsService.seedFromCampaign(ORG, CAMP, 'X', { total_sent: 10, delivered: 10, opened: 5 })
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'click', url: 'https://x.com' })

    const json = await analyticsService.exportCampaignReport(ORG, CAMP, 'json')
    expect(json!.format).toBe('json')
    expect(json!.filename).toBe(`campaign-${CAMP}-report.json`)
    const parsed = JSON.parse(json!.data)
    expect(parsed.report.campaign_id).toBe(CAMP)
    expect(parsed.links).toHaveLength(1)

    const csv = await analyticsService.exportCampaignReport(ORG, CAMP, 'csv')
    expect(csv!.format).toBe('csv')
    expect(csv!.data).toContain('campaign_id')
    expect(csv!.data).toContain('Link Analytics')

    expect(await analyticsService.exportCampaignReport(ORG, 'missing', 'json')).toBeNull()
  })

  it('exports summary as json and csv', async () => {
    await analyticsService.seedFromCampaign(ORG, CAMP, 'X', { total_sent: 10 })
    const json = await analyticsService.exportSummary(ORG, 'json')
    expect(json.format).toBe('json')
    expect(JSON.parse(json.data).summary.total_campaigns).toBe(1)

    const csv = await analyticsService.exportSummary(ORG, 'csv')
    expect(csv.format).toBe('csv')
    expect(csv.data).toContain('Analytics Summary')
    expect(csv.data).toContain('Campaign Reports')
  })

  it('updateCampaignStats / link stats are org-scoped (no cross-org leak)', async () => {
    await analyticsService.recordEvent(ORG, { campaignId: CAMP, eventType: 'open' })
    await analyticsService.recordEvent(ORG2, { campaignId: CAMP, eventType: 'open' })

    const r1 = await analyticsService.getCampaignReport(ORG, CAMP)
    const r2 = await analyticsService.getCampaignReport(ORG2, CAMP)
    expect(r1!.opened).toBe(1)
    expect(r2!.opened).toBe(1)
    // two distinct rows, one per org, despite same campaign_id
    const rows = await db.select().from(campaign_analytics).where(eq(campaign_analytics.campaign_id, CAMP))
    expect(rows).toHaveLength(2)
  })

  it('getRawEvents returns [] (legacy table absent in PG schema)', async () => {
    expect(await analyticsService.getRawEvents(ORG, CAMP)).toEqual([])
  })
})
