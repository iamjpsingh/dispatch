// P2 net — warmupService on real (PGlite) Postgres. CRUD + status gates, list/scoping,
// warmup limit/canSendMore/recordSend (atomic increment), advanceDay (logs + completion),
// progress, and a direct Postgres landing cross-check of stored column shapes.
// warmup_plans/logs are user_id-keyed loose text (no FK) — no organizations/users row needed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { warmup_plans, warmup_logs } from '../../src/db/pg/schema'
import { warmupService, type WarmupScheduleDay } from '../../src/services/warmupService'

const USER = 'usr_wu'
const USER2 = 'usr_wu2'
const CFG = 'cfg_wu'

const baseInput = (over: Partial<Parameters<typeof warmupService.create>[1]> = {}) => ({
  config_id: CFG,
  config_name: 'Primary',
  schedule_type: 'moderate' as const,
  ...over,
})

describe('P2 — warmupService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a plan with a generated schedule and reads it back', async () => {
    const plan = await warmupService.create(USER, baseInput())
    expect(plan.user_id).toBe(USER)
    expect(plan.config_id).toBe(CFG)
    expect(plan.config_name).toBe('Primary')
    expect(plan.status).toBe('active') // default
    expect(plan.current_day).toBe(1) // default
    expect(plan.emails_sent_today).toBe(0) // default
    expect(plan.total_days).toBeGreaterThan(0)
    expect(plan.daily_target).toBeGreaterThan(0)

    const schedule: WarmupScheduleDay[] = JSON.parse(plan.schedule_json)
    expect(schedule).toHaveLength(plan.total_days)
    expect(schedule[0].target).toBe(plan.daily_target)

    const got = await warmupService.get(USER, plan.id)
    expect(got?.id).toBe(plan.id)
  })

  it('honors a custom schedule', async () => {
    const custom: WarmupScheduleDay[] = [
      { day: 1, target: 10, increment_pct: 0 },
      { day: 2, target: 25, increment_pct: 150 },
    ]
    const plan = await warmupService.create(USER, baseInput({ schedule_type: 'custom', custom_schedule: custom }))
    expect(plan.total_days).toBe(2)
    expect(plan.daily_target).toBe(10)
    expect(JSON.parse(plan.schedule_json)).toEqual(custom)
  })

  it('get/list are user-scoped', async () => {
    const p1 = await warmupService.create(USER, baseInput())
    await warmupService.create(USER, baseInput({ config_id: 'cfg2' }))
    await warmupService.create(USER2, baseInput())

    expect((await warmupService.list(USER))).toHaveLength(2)
    expect((await warmupService.list(USER2))).toHaveLength(1)
    // other user cannot read this plan
    expect(await warmupService.get(USER2, p1.id)).toBeNull()
  })

  it('list filters by status', async () => {
    const a = await warmupService.create(USER, baseInput())
    await warmupService.create(USER, baseInput({ config_id: 'cfg2' }))
    await warmupService.pause(USER, a.id)

    expect((await warmupService.list(USER, 'active'))).toHaveLength(1)
    expect((await warmupService.list(USER, 'paused'))).toHaveLength(1)
    expect((await warmupService.list(USER, 'completed'))).toHaveLength(0)
  })

  it('pause/resume/cancel honor status gates and tenant scope', async () => {
    const plan = await warmupService.create(USER, baseInput())

    // wrong user cannot mutate
    expect(await warmupService.pause(USER2, plan.id)).toBe(false)

    expect(await warmupService.pause(USER, plan.id)).toBe(true)
    expect((await warmupService.get(USER, plan.id))?.status).toBe('paused')
    // pause again is a no-op (not active)
    expect(await warmupService.pause(USER, plan.id)).toBe(false)

    expect(await warmupService.resume(USER, plan.id)).toBe(true)
    expect((await warmupService.get(USER, plan.id))?.status).toBe('active')

    expect(await warmupService.cancel(USER, plan.id)).toBe(true)
    expect((await warmupService.get(USER, plan.id))?.status).toBe('cancelled')
    // cannot resume a cancelled plan
    expect(await warmupService.resume(USER, plan.id)).toBe(false)
  })

  it('delete only removes completed/cancelled plans, scoped to user', async () => {
    const active = await warmupService.create(USER, baseInput())
    expect(await warmupService.delete(USER, active.id)).toBe(false) // active not deletable

    await warmupService.cancel(USER, active.id)
    expect(await warmupService.delete(USER2, active.id)).toBe(false) // wrong user
    expect(await warmupService.delete(USER, active.id)).toBe(true)
    expect(await warmupService.get(USER, active.id)).toBeNull()
  })

  it('getWarmupLimit returns the current day target for the active plan', async () => {
    const custom: WarmupScheduleDay[] = [
      { day: 1, target: 50, increment_pct: 0 },
      { day: 2, target: 100, increment_pct: 100 },
    ]
    await warmupService.create(USER, baseInput({ schedule_type: 'custom', custom_schedule: custom }))
    expect(await warmupService.getWarmupLimit(USER, CFG)).toBe(50)
    // no active plan for an unknown config
    expect(await warmupService.getWarmupLimit(USER, 'nope')).toBeNull()
  })

  it('canSendMore reflects remaining quota and unlimited when no plan', async () => {
    const custom: WarmupScheduleDay[] = [{ day: 1, target: 2, increment_pct: 0 }]
    await warmupService.create(USER, baseInput({ schedule_type: 'custom', custom_schedule: custom }))

    let status = await warmupService.canSendMore(USER, CFG)
    expect(status).toEqual({ allowed: true, remaining: 2, limit: 2 })

    await warmupService.recordSend(USER, CFG, true)
    await warmupService.recordSend(USER, CFG, true)
    status = await warmupService.canSendMore(USER, CFG)
    expect(status).toEqual({ allowed: false, remaining: 0, limit: 2 })

    // no plan => unlimited
    expect(await warmupService.canSendMore(USER, 'no-plan')).toEqual({ allowed: true, remaining: Infinity, limit: Infinity })
  })

  it('recordSend atomically increments emails_sent_today on the active plan only', async () => {
    const plan = await warmupService.create(USER, baseInput())
    await warmupService.recordSend(USER, CFG, true)
    await warmupService.recordSend(USER, CFG, false)
    expect((await warmupService.get(USER, plan.id))?.emails_sent_today).toBe(2)

    // paused plan is not active => recordSend is a no-op
    await warmupService.pause(USER, plan.id)
    await warmupService.recordSend(USER, CFG, true)
    expect((await warmupService.get(USER, plan.id))?.emails_sent_today).toBe(2)
  })

  it('advanceDay logs progress and moves to the next day', async () => {
    const custom: WarmupScheduleDay[] = [
      { day: 1, target: 30, increment_pct: 0 },
      { day: 2, target: 60, increment_pct: 100 },
    ]
    const plan = await warmupService.create(USER, baseInput({ schedule_type: 'custom', custom_schedule: custom }))
    await warmupService.recordSend(USER, CFG, true)

    await warmupService.advanceDay()

    const after = await warmupService.get(USER, plan.id)
    expect(after?.current_day).toBe(2)
    expect(after?.daily_target).toBe(60)
    expect(after?.emails_sent_today).toBe(0) // reset on advance
    expect(after?.status).toBe('active')

    const prog = await warmupService.getProgress(USER, plan.id)
    expect(prog?.logs).toHaveLength(1)
    const log = prog!.logs[0]
    expect(log.day).toBe(1)
    expect(log.target).toBe(30)
    expect(log.sent).toBe(1)
    expect(log.failed).toBe(0)
    expect(log.bounce_rate).toBe(0)
    expect(log.date).toMatch(/^\d{4}-\d{2}-\d{2}$/) // 'YYYY-MM-DD'
  })

  it('advanceDay completes a plan on its final day', async () => {
    const custom: WarmupScheduleDay[] = [{ day: 1, target: 30, increment_pct: 0 }]
    const plan = await warmupService.create(USER, baseInput({ schedule_type: 'custom', custom_schedule: custom }))

    await warmupService.advanceDay()

    const after = await warmupService.get(USER, plan.id)
    expect(after?.status).toBe('completed')
    expect(after?.completed_at).toBeTruthy()
    // logged the final day before completing
    expect((await warmupService.getProgress(USER, plan.id))?.logs).toHaveLength(1)
  })

  it('getProgress computes percentage and getActivePlanForConfig finds the active plan', async () => {
    const custom: WarmupScheduleDay[] = [
      { day: 1, target: 10, increment_pct: 0 },
      { day: 2, target: 20, increment_pct: 100 },
      { day: 3, target: 30, increment_pct: 50 },
      { day: 4, target: 40, increment_pct: 33 },
    ]
    const plan = await warmupService.create(USER, baseInput({ schedule_type: 'custom', custom_schedule: custom }))
    const prog = await warmupService.getProgress(USER, plan.id)
    expect(prog?.progress).toBe(25) // day 1 / 4 days
    expect(prog?.schedule).toHaveLength(4)

    const active = await warmupService.getActivePlanForConfig(USER, CFG)
    expect(active?.id).toBe(plan.id)
    // scoped: other user has no active plan for this config
    expect(await warmupService.getActivePlanForConfig(USER2, CFG)).toBeNull()
  })

  it('Postgres landing: stored columns have the expected shapes/types', async () => {
    const plan = await warmupService.create(USER, baseInput())
    await warmupService.recordSend(USER, CFG, true)
    await warmupService.advanceDay()

    // read the raw row straight from PGlite to confirm what landed
    const [row] = await db.select().from(warmup_plans).where(eq(warmup_plans.id, plan.id)).limit(1)
    expect(typeof row.current_day).toBe('number')
    expect(typeof row.total_days).toBe('number')
    expect(typeof row.emails_sent_today).toBe('number')
    expect(typeof row.daily_target).toBe('number')
    expect(typeof row.schedule_json).toBe('string') // JSON-as-text
    expect(() => JSON.parse(row.schedule_json)).not.toThrow()
    expect(typeof row.created_at).toBe('string') // ISO timestamp text

    const [log] = await db.select().from(warmup_logs).where(eq(warmup_logs.plan_id, plan.id)).limit(1)
    expect(typeof log.sent).toBe('number')
    expect(typeof log.failed).toBe('number')
    expect(typeof log.bounce_rate).toBe('number') // REAL -> number
    expect(log.date).toMatch(/^\d{4}-\d{2}-\d{2}$/) // date-as-text 'YYYY-MM-DD'
  })
})
