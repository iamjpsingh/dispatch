// Net — routingEngine on real (PGlite) Postgres. Stats recording (atomic increments,
// avg recompute, unhealthy gate), score math, selection/failover, config upsert,
// dashboard/history windows, scoping, and a Postgres landing cross-check.
// These tables key on loose user_id text (no FK), so no organizations/users rows are
// required to write rows.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
vi.mock('../../src/services/eventBus', () => ({
  eventBus: { on: vi.fn(), emit: vi.fn(), addSSEClient: vi.fn(), getSSEClientCount: vi.fn() },
}))

import { and, eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { provider_stats, routing_config, failover_log } from '../../src/db/pg/schema'
import { routingEngine } from '../../src/services/routingEngine'
import { eventBus } from '../../src/services/eventBus'

const USER = 'usr_r'
const USER2 = 'usr_r2'
const today = () => new Date().toISOString().split('T')[0]

describe('routingEngine (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  // ---- Stats recording ----

  it('initializeProvider creates a today row with the provider default limit', async () => {
    await routingEngine.initializeProvider(USER, 'cfg1', 'google', 'Gmail')
    const rows = await db.select().from(provider_stats).where(eq(provider_stats.user_id, USER))
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.config_id).toBe('cfg1')
    expect(r.provider_type).toBe('google')
    expect(r.config_name).toBe('Gmail')
    expect(r.date).toBe(today())
    expect(r.daily_limit).toBe(500) // google default
    expect(r.is_healthy).toBe(1)
    expect(r.sent_count).toBe(0)
  })

  it('initializeProvider applies an explicit dailyLimit override', async () => {
    await routingEngine.initializeProvider(USER, 'cfg1', 'microsoft', 'O365', 120)
    const [r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'cfg1'))
    expect(r.daily_limit).toBe(120)
  })

  it('recordSend increments sent_count atomically and recomputes the running avg', async () => {
    await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 100, true)
    await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 300, true)
    const [r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'cfg1'))
    expect(r.sent_count).toBe(2)
    expect(r.avg_send_time_ms).toBe(200) // (100 + 300) / 2
    expect(r.failed_count).toBe(0)
  })

  it('recordSend on failure increments failed_count, stores last_error, and flips is_healthy after 10 failures', async () => {
    for (let i = 0; i < 10; i++) await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 0, false, `e${i}`)
    let [r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'cfg1'))
    expect(r.failed_count).toBe(10)
    expect(r.is_healthy).toBe(1) // 10 is not > 10
    expect(r.last_error).toBe('e9')
    await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 0, false, 'boom')
    ;[r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'cfg1'))
    expect(r.failed_count).toBe(11)
    expect(r.is_healthy).toBe(0) // 11 > 10
    expect(r.last_error).toBe('boom')
  })

  it('recordSend without an explicit error stores a default last_error', async () => {
    await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 0, false)
    const [r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'cfg1'))
    expect(r.last_error).toBe('Unknown error')
  })

  it('recordBounce increments bounce_count for the matching user/config/date', async () => {
    await routingEngine.initializeProvider(USER, 'cfg1', 'smtp', 'SMTP')
    await routingEngine.recordBounce(USER, 'cfg1')
    await routingEngine.recordBounce(USER, 'cfg1')
    const [r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'cfg1'))
    expect(r.bounce_count).toBe(2)
  })

  it('getOrCreateStats reuses the existing today row (no duplicate inserts)', async () => {
    await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 50, true)
    await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 50, true)
    const rows = await db.select().from(provider_stats).where(and(eq(provider_stats.user_id, USER), eq(provider_stats.config_id, 'cfg1')))
    expect(rows).toHaveLength(1)
    expect(rows[0].sent_count).toBe(2)
  })

  // ---- Scoring & selection ----

  it('scoreProviders ranks healthy providers by weighted score and shapes the result', async () => {
    // A: lots of quota left, fast, perfect success
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A', 1000)
    await routingEngine.recordSend(USER, 'A', 'smtp', 'A', 100, true)
    // B: nearly exhausted quota, slow, with a failure
    await routingEngine.initializeProvider(USER, 'B', 'smtp', 'B', 10)
    await routingEngine.recordSend(USER, 'B', 'smtp', 'B', 5000, true)
    await routingEngine.recordSend(USER, 'B', 'smtp', 'B', 5000, false)

    const scores = await routingEngine.scoreProviders(USER)
    expect(scores).toHaveLength(2)
    // A should win on quota + success + speed
    expect(scores[0].configId).toBe('A')
    expect(scores[0].totalScore).toBeGreaterThan(scores[1].totalScore)
    // shape checks
    const a = scores[0]
    expect(a.successRate).toBe(100)
    expect(a.quotaRemaining).toBe(999)
    expect(a.avgSendTime).toBe(100)
    expect(typeof a.quotaScore).toBe('number')
  })

  it('scoreProviders excludes unhealthy providers and returns [] when none qualify', async () => {
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A')
    await routingEngine.markProviderUnhealthy(USER, 'A', 'down')
    expect(await routingEngine.scoreProviders(USER)).toEqual([])
  })

  it('selectProvider picks the top eligible provider and lists alternatives', async () => {
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A', 1000)
    await routingEngine.recordSend(USER, 'A', 'smtp', 'A', 100, true)
    await routingEngine.initializeProvider(USER, 'B', 'smtp', 'B', 1000)
    await routingEngine.recordSend(USER, 'B', 'smtp', 'B', 4000, true)

    const decision = await routingEngine.selectProvider(USER)
    expect(decision).not.toBeNull()
    expect(decision!.selectedConfigId).toBe('A')
    expect(decision!.alternatives.map(a => a.configId)).toContain('B')
    expect(decision!.reason).toContain('Highest score')
  })

  it('selectProvider honours excludeConfigIds and quota/success filters', async () => {
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A', 1)
    await routingEngine.recordSend(USER, 'A', 'smtp', 'A', 100, true) // quota now exhausted (limit 1)
    expect(await routingEngine.selectProvider(USER)).toBeNull()

    await routingEngine.initializeProvider(USER, 'B', 'smtp', 'B', 1000)
    await routingEngine.recordSend(USER, 'B', 'smtp', 'B', 100, true)
    // exclude B -> only A which has no quota -> null
    expect(await routingEngine.selectProvider(USER, ['B'])).toBeNull()
    // include all -> B selected
    expect((await routingEngine.selectProvider(USER))!.selectedConfigId).toBe('B')
  })

  it('failover selects an alternative and writes a failover_log row', async () => {
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A', 1000)
    await routingEngine.recordSend(USER, 'A', 'smtp', 'A', 100, true)
    await routingEngine.initializeProvider(USER, 'B', 'smtp', 'B', 1000)
    await routingEngine.recordSend(USER, 'B', 'smtp', 'B', 100, true)

    const decision = await routingEngine.failover(USER, 'A', 'rate limited')
    expect(decision!.selectedConfigId).toBe('B')

    const logs = await db.select().from(failover_log).where(eq(failover_log.user_id, USER))
    expect(logs).toHaveLength(1)
    expect(logs[0].from_config_id).toBe('A')
    expect(logs[0].to_config_id).toBe('B')
    expect(logs[0].reason).toBe('rate limited')
    expect(eventBus.emit).toHaveBeenCalled()
  })

  it('failover returns null and writes no log when no alternative exists', async () => {
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A', 1000)
    await routingEngine.recordSend(USER, 'A', 'smtp', 'A', 100, true)
    expect(await routingEngine.failover(USER, 'A', 'no backup')).toBeNull()
    expect(await db.select().from(failover_log).where(eq(failover_log.user_id, USER))).toHaveLength(0)
  })

  // ---- Config management ----

  it('getRoutingConfig returns defaults when no row exists', async () => {
    const cfg = await routingEngine.getRoutingConfig(USER)
    expect(cfg.weights.quota).toBe(0.4)
    expect(cfg.failover_enabled).toBe(true)
    expect(cfg.min_success_rate).toBe(0.8)
    expect(cfg.max_avg_send_time_ms).toBe(30000)
  })

  it('updateRoutingConfig inserts then partially updates, preserving the int flag', async () => {
    expect(await routingEngine.updateRoutingConfig(USER, { failover_enabled: false, min_success_rate: 0.5 })).toBe(true)
    let cfg = await routingEngine.getRoutingConfig(USER)
    expect(cfg.failover_enabled).toBe(false)
    expect(cfg.min_success_rate).toBe(0.5)

    // stored flag is the integer 0/1
    const [raw] = await db.select().from(routing_config).where(eq(routing_config.user_id, USER))
    expect(raw.failover_enabled).toBe(0)

    expect(await routingEngine.updateRoutingConfig(USER, { weights: { quota: 0.7, success_rate: 0.1, speed: 0.1, cost: 0.1 } })).toBe(true)
    cfg = await routingEngine.getRoutingConfig(USER)
    expect(cfg.weights.quota).toBe(0.7)
    expect(cfg.min_success_rate).toBe(0.5) // untouched
  })

  it('updateRoutingConfig returns false when there is nothing to update on an existing row', async () => {
    await routingEngine.updateRoutingConfig(USER, { min_success_rate: 0.9 })
    expect(await routingEngine.updateRoutingConfig(USER, {})).toBe(false)
  })

  // ---- Dashboard & history ----

  it('getProviderDashboard returns today stats, scores, and recent failovers', async () => {
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A', 1000)
    await routingEngine.recordSend(USER, 'A', 'smtp', 'A', 100, true)
    await routingEngine.initializeProvider(USER, 'B', 'smtp', 'B', 1000)
    await routingEngine.recordSend(USER, 'B', 'smtp', 'B', 100, true)
    await routingEngine.failover(USER, 'A', 'test')

    const dash = await routingEngine.getProviderDashboard(USER)
    expect(dash.today).toHaveLength(2)
    expect(dash.scores.length).toBe(2)
    expect(dash.failovers).toHaveLength(1)
  })

  it('getProviderHistory filters by the date window and orders by date desc', async () => {
    // today row via the service
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A')
    // an old row outside the 30-day window, inserted directly
    await db.insert(provider_stats).values({ id: 'old', user_id: USER, config_id: 'A', provider_type: 'smtp', config_name: 'A', date: '2000-01-01', daily_limit: 500 })

    const hist = await routingEngine.getProviderHistory(USER, 30)
    expect(hist).toHaveLength(1)
    expect(hist[0].date).toBe(today())

    // a wide window includes the old row
    const wide = await routingEngine.getProviderHistory(USER, 100000)
    expect(wide.map(h => h.date)).toContain('2000-01-01')
  })

  // ---- Health toggles ----

  it('markProviderHealthy / markProviderUnhealthy flip is_healthy and stamp checked/error', async () => {
    await routingEngine.initializeProvider(USER, 'A', 'smtp', 'A')
    await routingEngine.markProviderUnhealthy(USER, 'A', 'tls error')
    let [r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'A'))
    expect(r.is_healthy).toBe(0)
    expect(r.last_error).toBe('tls error')
    expect(r.last_checked_at).not.toBeNull()

    await routingEngine.markProviderHealthy(USER, 'A')
    ;[r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'A'))
    expect(r.is_healthy).toBe(1)
  })

  // ---- Scoping ----

  it('scopes all reads/writes by user_id', async () => {
    await routingEngine.recordSend(USER, 'A', 'smtp', 'A', 100, true)
    await routingEngine.recordSend(USER2, 'A', 'smtp', 'A', 100, true)

    // USER2's row is invisible to USER's dashboard
    const dash = await routingEngine.getProviderDashboard(USER)
    expect(dash.today).toHaveLength(1)
    expect(dash.today[0].user_id).toBe(USER)

    // recordBounce on USER does not touch USER2's row
    await routingEngine.recordBounce(USER, 'A')
    const [u2] = await db.select().from(provider_stats).where(eq(provider_stats.user_id, USER2))
    expect(u2.bounce_count).toBe(0)
  })

  // ---- Postgres landing cross-check ----

  it('lands a real row on Postgres with the expected column types', async () => {
    await routingEngine.recordSend(USER, 'cfg1', 'smtp', 'SMTP', 250, true)
    const [r] = await db.select().from(provider_stats).where(eq(provider_stats.config_id, 'cfg1'))
    expect(typeof r.sent_count).toBe('number') // integer
    expect(typeof r.avg_send_time_ms).toBe('number') // real
    expect(typeof r.is_healthy).toBe('number') // integer flag 0/1
    expect(typeof r.date).toBe('string') // date stored as YYYY-MM-DD text
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof r.created_at).toBe('string') // ISO timestamp text
    expect(r.avg_send_time_ms).toBe(250)
  })
})
