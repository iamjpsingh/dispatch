// P2 net — scoringEngine on real (PGlite) Postgres. Event recording, score math
// (base 50, capped positive points, absolute-zero on negatives), breakdown,
// segment buckets, score-range/stats bulk ops with user scoping, recent events
// ordering, decay window, and a Postgres landing cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
vi.mock('../../src/services/eventBus', () => ({ eventBus: { emit: vi.fn(), on: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, engagement_events } from '../../src/db/pg/schema'
import { scoringEngine, SCORE_RULES } from '../../src/services/scoringEngine'
import { eventBus } from '../../src/services/eventBus'

// engagement_events keeps user_id as loose text (no FK), so a contact_id need not
// exist as a row; only an organizations row is needed for org-keyed tables — and
// these tables aren't org-keyed at all, so no org is strictly required either. We
// still seed one org to mirror the standard net shape.
const ORG = 'org_sc'
const USER = 'usr_sc'
const USER2 = 'usr_sc2'

describe('P2 — scoringEngine (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([{ id: ORG, name: 'Org SC', slug: 'org-sc' }])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('records an event, returns the recalculated score, and emits contact_scored', async () => {
    const score = await scoringEngine.recordEvent('c1', USER, 'opened', 'camp1')
    // base 50 + opened(5)
    expect(score).toBe(55)
    expect(eventBus.emit).toHaveBeenCalledWith('contact_scored', USER, {
      contactId: 'c1',
      score: 55,
      eventType: 'opened',
      segment: 'warm',
    })
    // persisted with snake_case columns + the rule's points
    const rows = await db.select().from(engagement_events)
    expect(rows).toHaveLength(1)
    expect(rows[0].contact_id).toBe('c1')
    expect(rows[0].user_id).toBe(USER)
    expect(rows[0].campaign_id).toBe('camp1')
    expect(rows[0].event_type).toBe('opened')
    expect(rows[0].points).toBe(SCORE_RULES.opened.points)
    expect(typeof rows[0].created_at).toBe('string')
  })

  it('null campaign_id when none is supplied', async () => {
    await scoringEngine.recordEvent('c1', USER, 'replied')
    const [row] = await db.select().from(engagement_events)
    expect(row.campaign_id).toBeNull()
  })

  it('caps positive points per event_type at the rule max', async () => {
    // 5 opens = 25 raw points, capped at opened.max (20) => 50 + 20 = 70
    for (let i = 0; i < 5; i++) await scoringEngine.recordEvent('c2', USER, 'opened')
    expect(await scoringEngine.calculateScore('c2')).toBe(70)
  })

  it('combines capped buckets across event types and clamps to 100', async () => {
    // opened capped 20, clicked capped 30, replied capped 20 => 50+70 = 120 -> clamp 100
    for (let i = 0; i < 5; i++) await scoringEngine.recordEvent('c3', USER, 'opened')   // 20
    for (let i = 0; i < 5; i++) await scoringEngine.recordEvent('c3', USER, 'clicked')  // 30
    await scoringEngine.recordEvent('c3', USER, 'replied')                              // 20
    expect(await scoringEngine.calculateScore('c3')).toBe(100)
  })

  it('drops to 0 on any negative (bounce/unsub/complaint) event', async () => {
    await scoringEngine.recordEvent('c4', USER, 'clicked') // positive first
    expect(await scoringEngine.calculateScore('c4')).toBe(60)
    await scoringEngine.recordEvent('c4', USER, 'bounced')
    expect(await scoringEngine.calculateScore('c4')).toBe(0)
  })

  it('base score of 50 for a contact with no events', async () => {
    expect(await scoringEngine.calculateScore('nobody')).toBe(50)
    expect(scoringEngine.getSegment(50)).toBe('warm')
  })

  it('getScoreBreakdown groups counts + summed points per type', async () => {
    await scoringEngine.recordEvent('c5', USER, 'opened')
    await scoringEngine.recordEvent('c5', USER, 'opened')
    await scoringEngine.recordEvent('c5', USER, 'clicked')
    const bd = await scoringEngine.getScoreBreakdown('c5')
    expect(bd.contactId).toBe('c5')
    expect(bd.score).toBe(70) // 50 + opened(10) + clicked(10)
    expect(bd.segment).toBe('warm')
    const opened = bd.events.find((e) => e.type === 'opened')!
    const clicked = bd.events.find((e) => e.type === 'clicked')!
    expect(opened.count).toBe(2)
    expect(opened.points).toBe(10)
    expect(clicked.count).toBe(1)
    expect(clicked.points).toBe(10)
  })

  it('getSegment maps scores to the right bucket', () => {
    expect(scoringEngine.getSegment(80)).toBe('hot')
    expect(scoringEngine.getSegment(50)).toBe('warm')
    expect(scoringEngine.getSegment(20)).toBe('cold')
    expect(scoringEngine.getSegment(0)).toBe('dead')
  })

  it('getContactsByScoreRange filters by score window, scopes by user, sorts desc', async () => {
    // hot contact (clicks + replies -> 100)
    for (let i = 0; i < 5; i++) await scoringEngine.recordEvent('hot', USER, 'clicked')
    await scoringEngine.recordEvent('hot', USER, 'replied')
    // warm contact (single open -> 55)
    await scoringEngine.recordEvent('warm', USER, 'opened')
    // dead contact (bounce -> 0)
    await scoringEngine.recordEvent('dead', USER, 'bounced')
    // another user's contact must be excluded
    await scoringEngine.recordEvent('other', USER2, 'clicked')

    const range = await scoringEngine.getContactsByScoreRange(USER, 50, 100)
    expect(range.map((r) => r.contact_id)).toEqual(['hot', 'warm']) // dead (0) excluded, sorted desc
    expect(range[0].score).toBe(100)
    expect(range[1].score).toBe(55)
  })

  it('getStats counts distinct contacts per segment, scoped by user', async () => {
    for (let i = 0; i < 5; i++) await scoringEngine.recordEvent('h', USER, 'clicked')
    await scoringEngine.recordEvent('h', USER, 'replied') // hot=100
    await scoringEngine.recordEvent('w', USER, 'opened')  // warm=55
    await scoringEngine.recordEvent('d', USER, 'bounced') // dead=0
    await scoringEngine.recordEvent('foreign', USER2, 'opened') // other user

    const stats = await scoringEngine.getStats(USER)
    expect(stats).toEqual({ total: 3, hot: 1, warm: 1, cold: 0, dead: 1 })
  })

  it('getContactEvents returns recent rows newest-first, honoring the limit', async () => {
    // stagger created_at so ordering is deterministic
    await db.insert(engagement_events).values([
      { id: 'e1', contact_id: 'ce', user_id: USER, campaign_id: null, event_type: 'opened', points: 5, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'e2', contact_id: 'ce', user_id: USER, campaign_id: null, event_type: 'clicked', points: 10, created_at: '2026-02-01T00:00:00.000Z' },
      { id: 'e3', contact_id: 'ce', user_id: USER, campaign_id: null, event_type: 'replied', points: 20, created_at: '2026-03-01T00:00:00.000Z' },
      { id: 'eX', contact_id: 'other', user_id: USER, campaign_id: null, event_type: 'opened', points: 5, created_at: '2026-04-01T00:00:00.000Z' },
    ])
    const events = await scoringEngine.getContactEvents('ce', 2)
    expect(events.map((e) => e.id)).toEqual(['e3', 'e2']) // newest 2, contact-scoped
  })

  it('applyScoreDecay flags contacts whose last event is older than 30 days', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() // 40d -> decay window
    const veryOld = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString() // 100d -> placeholder re-record
    await db.insert(engagement_events).values([
      { id: 'd1', contact_id: 'stale', user_id: USER, campaign_id: null, event_type: 'opened', points: 5, created_at: old },
      { id: 'd2', contact_id: 'ancient', user_id: USER, campaign_id: null, event_type: 'opened', points: 5, created_at: veryOld },
      { id: 'd3', contact_id: 'fresh', user_id: USER, campaign_id: null, event_type: 'opened', points: 5, created_at: new Date().toISOString() },
    ])
    const affected = await scoringEngine.applyScoreDecay()
    expect(affected).toBe(2) // stale (40d) + ancient (100d); fresh excluded
    // ancient (>=90d) gets a placeholder re-record inserted
    const ancientRows = await db.select().from(engagement_events).where(eq(engagement_events.contact_id, 'ancient'))
    expect(ancientRows.length).toBe(2)
  })

  it('Postgres landing cross-check: aggregates round-trip through real SQL', async () => {
    await scoringEngine.recordEvent('land', USER, 'opened')
    await scoringEngine.recordEvent('land', USER, 'opened')
    await scoringEngine.recordEvent('land', USER, 'clicked')
    // Verify via a raw aggregate against the actual table that points sum + count
    // match what calculateScore consumed (sum cast ::int, count ::int).
    const agg = await db
      .select({
        type: engagement_events.event_type,
        total: sql<number>`sum(${engagement_events.points})::int`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(engagement_events)
      .where(eq(engagement_events.contact_id, 'land'))
      .groupBy(engagement_events.event_type)
    const opened = agg.find((a) => a.type === 'opened')!
    expect(opened.total).toBe(10)
    expect(opened.cnt).toBe(2)
    expect(await scoringEngine.calculateScore('land')).toBe(70) // 50 + opened(10) + clicked(10)
  })
})
