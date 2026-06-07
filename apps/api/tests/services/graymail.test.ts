// P2 net — graymailService on real (PGlite) Postgres. Config upsert, send/engagement
// tracking, graymail flagging at threshold, at-risk + graymail listings, stats,
// reset, tenant (org_id) isolation, and a cross-check that a write lands in Postgres.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, graymail_tracker } from '../../src/db/pg/schema'
import { graymailService } from '../../src/services/graymailService'
import { and, eq } from 'drizzle-orm'

const ORG = 'org_g'
const ORG2 = 'org_g2'

describe('P2 — graymailService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org G', slug: 'org-g' },
      { id: ORG2, name: 'Org G2', slug: 'org-g2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  it('returns default config when none stored', async () => {
    const config = await graymailService.getConfig(ORG)
    expect(config).toEqual({ enabled: false, threshold: 11 })
  })

  it('sets and reads back config (upsert, integer flag preserved)', async () => {
    await graymailService.setConfig(ORG, true, 5)
    expect(await graymailService.getConfig(ORG)).toEqual({ enabled: true, threshold: 5 })
    // upsert on conflict (same org_id)
    await graymailService.setConfig(ORG, false, 8)
    expect(await graymailService.getConfig(ORG)).toEqual({ enabled: false, threshold: 8 })
  })

  // --------------------------------------------------------------------------
  // Tracking
  // --------------------------------------------------------------------------

  it('recordSend inserts then increments sends_since_engagement', async () => {
    await graymailService.recordSend(ORG, 'a@test.com')
    await graymailService.recordSend(ORG, 'a@test.com')
    await graymailService.recordSend(ORG, 'a@test.com')

    const [row] = await db
      .select()
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, ORG), eq(graymail_tracker.email, 'a@test.com')))
    expect(row.sends_since_engagement).toBe(3)
    expect(row.is_graymail).toBe(0)
    expect(row.last_sent_at).toBeTruthy()
  })

  it('flags graymail once sends reach the threshold (config enabled)', async () => {
    await graymailService.setConfig(ORG, true, 3)
    await graymailService.recordSend(ORG, 'gm@test.com') // 1
    expect(await graymailService.isGraymail(ORG, 'gm@test.com')).toBe(false)
    await graymailService.recordSend(ORG, 'gm@test.com') // 2
    await graymailService.recordSend(ORG, 'gm@test.com') // 3 -> threshold
    expect(await graymailService.isGraymail(ORG, 'gm@test.com')).toBe(true)

    const [row] = await db
      .select()
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, ORG), eq(graymail_tracker.email, 'gm@test.com')))
    expect(row.is_graymail).toBe(1)
  })

  it('does not flag graymail when config disabled (isGraymail always false)', async () => {
    // disabled by default; threshold reached but no flag, isGraymail false
    for (let i = 0; i < 15; i++) await graymailService.recordSend(ORG, 'd@test.com')
    expect(await graymailService.isGraymail(ORG, 'd@test.com')).toBe(false)
    const [row] = await db
      .select()
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, ORG), eq(graymail_tracker.email, 'd@test.com')))
    expect(row.is_graymail).toBe(0)
    expect(row.sends_since_engagement).toBe(15)
  })

  it('recordEngagement resets the counter and clears graymail', async () => {
    await graymailService.setConfig(ORG, true, 3)
    for (let i = 0; i < 3; i++) await graymailService.recordSend(ORG, 'e@test.com')
    expect(await graymailService.isGraymail(ORG, 'e@test.com')).toBe(true)

    await graymailService.recordEngagement(ORG, 'e@test.com')
    expect(await graymailService.isGraymail(ORG, 'e@test.com')).toBe(false)

    const [row] = await db
      .select()
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, ORG), eq(graymail_tracker.email, 'e@test.com')))
    expect(row.sends_since_engagement).toBe(0)
    expect(row.is_graymail).toBe(0)
    expect(row.last_engaged_at).toBeTruthy()
  })

  it('recordEngagement inserts a fresh row when none exists', async () => {
    await graymailService.recordEngagement(ORG, 'fresh@test.com')
    const [row] = await db
      .select()
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, ORG), eq(graymail_tracker.email, 'fresh@test.com')))
    expect(row).toBeTruthy()
    expect(row.sends_since_engagement).toBe(0)
  })

  // --------------------------------------------------------------------------
  // Checks
  // --------------------------------------------------------------------------

  it('canSend honors graymail status and the exempt flag', async () => {
    await graymailService.setConfig(ORG, true, 2)
    await graymailService.recordSend(ORG, 'c@test.com')
    await graymailService.recordSend(ORG, 'c@test.com') // graymail now
    expect(await graymailService.canSend(ORG, 'c@test.com')).toBe(false)
    expect(await graymailService.canSend(ORG, 'c@test.com', true)).toBe(true) // exempt bypass
    expect(await graymailService.canSend(ORG, 'never@test.com')).toBe(true)
  })

  it('isGraymail returns true via threshold even if flag not yet set', async () => {
    // Seed a row at the threshold count but with is_graymail = 0 (e.g. config enabled after sends)
    await graymailService.setConfig(ORG, true, 4)
    await db.insert(graymail_tracker).values({
      org_id: ORG,
      email: 'thr@test.com',
      sends_since_engagement: 5,
      is_graymail: 0,
    })
    expect(await graymailService.isGraymail(ORG, 'thr@test.com')).toBe(true)
  })

  // --------------------------------------------------------------------------
  // Stats / listings
  // --------------------------------------------------------------------------

  it('getStats counts tracked + graymail and computes percentage', async () => {
    await graymailService.setConfig(ORG, true, 2)
    await graymailService.recordSend(ORG, 'x@test.com')
    await graymailService.recordSend(ORG, 'x@test.com') // graymail
    await graymailService.recordSend(ORG, 'y@test.com') // tracked, not graymail
    await graymailService.recordEngagement(ORG, 'z@test.com') // tracked, not graymail

    const stats = await graymailService.getStats(ORG)
    expect(stats.totalTracked).toBe(3)
    expect(stats.graymailCount).toBe(1)
    expect(stats.graymailPercentage).toBeCloseTo(33.3, 1)
  })

  it('getStats returns zeroed percentage when nothing tracked', async () => {
    const stats = await graymailService.getStats(ORG)
    expect(stats).toEqual({ totalTracked: 0, graymailCount: 0, graymailPercentage: 0 })
  })

  it('getAtRisk returns non-graymail contacts past the warning threshold, ordered desc', async () => {
    await graymailService.setConfig(ORG, true, 10) // warning = floor(10*0.7) = 7
    // 8 sends: at risk (>=7, not yet graymail)
    for (let i = 0; i < 8; i++) await graymailService.recordSend(ORG, 'risk1@test.com')
    // 5 sends: below warning
    for (let i = 0; i < 5; i++) await graymailService.recordSend(ORG, 'safe@test.com')
    // 9 sends: more at risk -> should sort first
    for (let i = 0; i < 9; i++) await graymailService.recordSend(ORG, 'risk2@test.com')

    const atRisk = await graymailService.getAtRisk(ORG)
    expect(atRisk.map((r) => r.email)).toEqual(['risk2@test.com', 'risk1@test.com'])
    expect(atRisk[0].sends_since_engagement).toBe(9)
    expect(atRisk[0]).toHaveProperty('last_engaged_at')
  })

  it('getGraymailContacts returns flagged contacts with snake_case shape, paginated', async () => {
    await graymailService.setConfig(ORG, true, 2)
    await graymailService.recordSend(ORG, 'g1@test.com')
    await graymailService.recordSend(ORG, 'g1@test.com') // graymail
    await graymailService.recordSend(ORG, 'g2@test.com')
    await graymailService.recordSend(ORG, 'g2@test.com')
    await graymailService.recordSend(ORG, 'g2@test.com') // graymail, higher count -> first

    const contacts = await graymailService.getGraymailContacts(ORG)
    expect(contacts).toHaveLength(2)
    expect(contacts[0].email).toBe('g2@test.com')
    expect(contacts[0]).toHaveProperty('sends_since_engagement')
    expect(contacts[0]).toHaveProperty('last_sent_at')
    expect(contacts[0]).toHaveProperty('last_engaged_at')

    // offset pagination
    const page2 = await graymailService.getGraymailContacts(ORG, 1, 1)
    expect(page2).toHaveLength(1)
    expect(page2[0].email).toBe('g1@test.com')
  })

  it('resetContact clears counter and graymail flag (tenant-scoped)', async () => {
    await graymailService.setConfig(ORG, true, 2)
    await graymailService.recordSend(ORG, 'r@test.com')
    await graymailService.recordSend(ORG, 'r@test.com') // graymail
    expect(await graymailService.isGraymail(ORG, 'r@test.com')).toBe(true)

    await graymailService.resetContact(ORG, 'r@test.com')
    const [row] = await db
      .select()
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, ORG), eq(graymail_tracker.email, 'r@test.com')))
    expect(row.sends_since_engagement).toBe(0)
    expect(row.is_graymail).toBe(0)
  })

  // --------------------------------------------------------------------------
  // Tenant isolation
  // --------------------------------------------------------------------------

  it('isolates config, tracking, and stats by org_id', async () => {
    await graymailService.setConfig(ORG, true, 2)
    await graymailService.setConfig(ORG2, true, 9)
    expect((await graymailService.getConfig(ORG)).threshold).toBe(2)
    expect((await graymailService.getConfig(ORG2)).threshold).toBe(9)

    // same email tracked in both orgs is independent
    await graymailService.recordSend(ORG, 'shared@test.com')
    await graymailService.recordSend(ORG, 'shared@test.com') // graymail in ORG (threshold 2)
    await graymailService.recordSend(ORG2, 'shared@test.com') // 1 send in ORG2 (threshold 9)

    expect(await graymailService.isGraymail(ORG, 'shared@test.com')).toBe(true)
    expect(await graymailService.isGraymail(ORG2, 'shared@test.com')).toBe(false)

    expect((await graymailService.getStats(ORG)).graymailCount).toBe(1)
    expect((await graymailService.getStats(ORG2)).graymailCount).toBe(0)

    // ORG2 cannot reset ORG's contact
    await graymailService.resetContact(ORG2, 'shared@test.com')
    expect(await graymailService.isGraymail(ORG, 'shared@test.com')).toBe(true)
  })

  it('cross-check: a written row physically lands in Postgres (graymail_tracker)', async () => {
    await graymailService.recordSend(ORG, 'persist@test.com')
    const rows = await db
      .select()
      .from(graymail_tracker)
      .where(eq(graymail_tracker.org_id, ORG))
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('persist@test.com')
    expect(rows[0].org_id).toBe(ORG)
    expect(rows[0].id).toBeTypeOf('number') // auto-identity integer id, not supplied on insert
  })
})
