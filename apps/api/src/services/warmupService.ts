// src/services/warmupService.ts - Email Warmup Service (Postgres/Drizzle, async)
// Gradual volume ramp for new sender domains/IPs

import { and, eq, asc, desc, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { warmup_plans, warmup_logs } from '../db/pg/schema'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface WarmupPlan {
  id: string
  user_id: string
  config_id: string
  config_name: string
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  schedule_json: string // JSON: WarmupScheduleDay[]
  current_day: number
  total_days: number
  emails_sent_today: number
  daily_target: number
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface WarmupScheduleDay {
  day: number
  target: number
  increment_pct: number
}

export interface WarmupLog {
  id: string
  plan_id: string
  day: number
  date: string
  target: number
  sent: number
  failed: number
  bounce_rate: number
  created_at: string
}

export interface WarmupInput {
  config_id: string
  config_name: string
  schedule_type: 'conservative' | 'moderate' | 'aggressive' | 'custom'
  starting_volume?: number
  target_volume?: number
  custom_schedule?: WarmupScheduleDay[]
}

// Pre-built warmup schedules
const WARMUP_SCHEDULES: Record<string, (start: number, target: number) => WarmupScheduleDay[]> = {
  conservative: (start, target) => generateSchedule(start, target, 30, 0.2),
  moderate: (start, target) => generateSchedule(start, target, 21, 0.35),
  aggressive: (start, target) => generateSchedule(start, target, 14, 0.5),
}

function generateSchedule(start: number, target: number, days: number, dailyIncrement: number): WarmupScheduleDay[] {
  const schedule: WarmupScheduleDay[] = []
  let current = start

  for (let day = 1; day <= days; day++) {
    schedule.push({
      day,
      target: Math.round(current),
      increment_pct: dailyIncrement * 100,
    })

    current = Math.min(current * (1 + dailyIncrement), target)
    if (Math.round(current) >= target) {
      // Fill remaining days at target
      for (let d = day + 1; d <= days; d++) {
        schedule.push({ day: d, target, increment_pct: 0 })
      }
      break
    }
  }

  // If we didn't reach target, add extra days
  if (schedule.length < days) {
    while (schedule.length < days) {
      const d = schedule.length + 1
      schedule.push({ day: d, target, increment_pct: 0 })
    }
  }

  return schedule
}

const now = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'

// ============================================================================
// Service
// ============================================================================

class WarmupService {
  private workerInterval: ReturnType<typeof setInterval> | null = null

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(userId: string, input: WarmupInput): Promise<WarmupPlan> {
    const db = getDb()
    const id = generateId('wu')
    const start = input.starting_volume || 20
    const target = input.target_volume || 500

    let schedule: WarmupScheduleDay[]
    if (input.schedule_type === 'custom' && input.custom_schedule) {
      schedule = input.custom_schedule
    } else {
      const generator = WARMUP_SCHEDULES[input.schedule_type] || WARMUP_SCHEDULES.moderate
      schedule = generator(start, target)
    }

    const totalDays = schedule.length
    const dailyTarget = schedule[0]?.target || start

    await db.insert(warmup_plans).values({
      id,
      user_id: userId,
      config_id: input.config_id,
      config_name: input.config_name,
      schedule_json: JSON.stringify(schedule),
      total_days: totalDays,
      daily_target: dailyTarget,
    })

    const [row] = await db.select().from(warmup_plans).where(eq(warmup_plans.id, id)).limit(1)
    return row as WarmupPlan
  }

  async get(userId: string, planId: string): Promise<WarmupPlan | null> {
    const [row] = await getDb()
      .select()
      .from(warmup_plans)
      .where(and(eq(warmup_plans.id, planId), eq(warmup_plans.user_id, userId)))
      .limit(1)
    return (row as WarmupPlan) ?? null
  }

  async list(userId: string, status?: string): Promise<WarmupPlan[]> {
    const conditions = [eq(warmup_plans.user_id, userId)]
    if (status) conditions.push(eq(warmup_plans.status, status))
    const rows = await getDb()
      .select()
      .from(warmup_plans)
      .where(and(...conditions))
      .orderBy(desc(warmup_plans.created_at))
    return rows as WarmupPlan[]
  }

  async pause(userId: string, planId: string): Promise<boolean> {
    const res = await getDb()
      .update(warmup_plans)
      .set({ status: 'paused', updated_at: now() })
      .where(and(eq(warmup_plans.id, planId), eq(warmup_plans.user_id, userId), eq(warmup_plans.status, 'active')))
      .returning({ id: warmup_plans.id })
    return res.length > 0
  }

  async resume(userId: string, planId: string): Promise<boolean> {
    const res = await getDb()
      .update(warmup_plans)
      .set({ status: 'active', updated_at: now() })
      .where(and(eq(warmup_plans.id, planId), eq(warmup_plans.user_id, userId), eq(warmup_plans.status, 'paused')))
      .returning({ id: warmup_plans.id })
    return res.length > 0
  }

  async cancel(userId: string, planId: string): Promise<boolean> {
    const res = await getDb()
      .update(warmup_plans)
      .set({ status: 'cancelled', updated_at: now() })
      .where(and(eq(warmup_plans.id, planId), eq(warmup_plans.user_id, userId), sql`${warmup_plans.status} in ('active', 'paused')`))
      .returning({ id: warmup_plans.id })
    return res.length > 0
  }

  async delete(userId: string, planId: string): Promise<boolean> {
    const res = await getDb()
      .delete(warmup_plans)
      .where(and(eq(warmup_plans.id, planId), eq(warmup_plans.user_id, userId), sql`${warmup_plans.status} in ('completed', 'cancelled')`))
      .returning({ id: warmup_plans.id })
    return res.length > 0
  }

  // --------------------------------------------------------------------------
  // Warmup Logic
  // --------------------------------------------------------------------------

  /**
   * Get today's sending limit for a config under warmup
   */
  async getWarmupLimit(userId: string, configId: string): Promise<number | null> {
    const [plan] = await getDb()
      .select()
      .from(warmup_plans)
      .where(and(eq(warmup_plans.user_id, userId), eq(warmup_plans.config_id, configId), eq(warmup_plans.status, 'active')))
      .limit(1)

    if (!plan) return null

    const schedule: WarmupScheduleDay[] = JSON.parse(plan.schedule_json)
    const daySchedule = schedule.find((s) => s.day === plan.current_day)

    return daySchedule?.target || null
  }

  /**
   * Check if config can send more emails today under warmup
   */
  async canSendMore(userId: string, configId: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
    const [plan] = await getDb()
      .select()
      .from(warmup_plans)
      .where(and(eq(warmup_plans.user_id, userId), eq(warmup_plans.config_id, configId), eq(warmup_plans.status, 'active')))
      .limit(1)

    if (!plan) return { allowed: true, remaining: Infinity, limit: Infinity }

    const limit = plan.daily_target
    const remaining = Math.max(0, limit - plan.emails_sent_today)

    return { allowed: remaining > 0, remaining, limit }
  }

  /**
   * Record email sent during warmup
   */
  async recordSend(userId: string, configId: string, _success: boolean): Promise<void> {
    const db = getDb()
    const [plan] = await db
      .select()
      .from(warmup_plans)
      .where(and(eq(warmup_plans.user_id, userId), eq(warmup_plans.config_id, configId), eq(warmup_plans.status, 'active')))
      .limit(1)

    if (!plan) return

    await db
      .update(warmup_plans)
      .set({ emails_sent_today: sql`${warmup_plans.emails_sent_today} + 1`, updated_at: now() })
      .where(eq(warmup_plans.id, plan.id))
  }

  /**
   * Advance warmup plans to next day (call daily)
   */
  async advanceDay(): Promise<void> {
    const db = getDb()
    const activePlans = (await db.select().from(warmup_plans).where(eq(warmup_plans.status, 'active'))) as WarmupPlan[]

    for (const plan of activePlans) {
      const schedule: WarmupScheduleDay[] = JSON.parse(plan.schedule_json)

      // Log today's progress
      const logId = generateId('wl')
      await db.insert(warmup_logs).values({
        id: logId,
        plan_id: plan.id,
        day: plan.current_day,
        date: today(),
        target: plan.daily_target,
        sent: plan.emails_sent_today,
      })

      // Check if warmup is complete
      if (plan.current_day >= plan.total_days) {
        await db
          .update(warmup_plans)
          .set({ status: 'completed', completed_at: now(), updated_at: now() })
          .where(eq(warmup_plans.id, plan.id))
        continue
      }

      // Advance to next day
      const nextDay = plan.current_day + 1
      const nextSchedule = schedule.find((s) => s.day === nextDay)
      const nextTarget = nextSchedule?.target || plan.daily_target

      await db
        .update(warmup_plans)
        .set({ current_day: nextDay, daily_target: nextTarget, emails_sent_today: 0, updated_at: now() })
        .where(eq(warmup_plans.id, plan.id))
    }
  }

  // --------------------------------------------------------------------------
  // Progress & Logs
  // --------------------------------------------------------------------------

  async getProgress(
    userId: string,
    planId: string
  ): Promise<{ plan: WarmupPlan; schedule: WarmupScheduleDay[]; logs: WarmupLog[]; progress: number } | null> {
    const plan = await this.get(userId, planId)
    if (!plan) return null

    const schedule: WarmupScheduleDay[] = JSON.parse(plan.schedule_json)
    const logs = (await getDb()
      .select()
      .from(warmup_logs)
      .where(eq(warmup_logs.plan_id, planId))
      .orderBy(asc(warmup_logs.day))) as WarmupLog[]

    const progress = plan.total_days > 0 ? Math.round((plan.current_day / plan.total_days) * 100) : 0

    return { plan, schedule, logs, progress }
  }

  async getActivePlanForConfig(userId: string, configId: string): Promise<WarmupPlan | null> {
    const [row] = await getDb()
      .select()
      .from(warmup_plans)
      .where(and(eq(warmup_plans.user_id, userId), eq(warmup_plans.config_id, configId), eq(warmup_plans.status, 'active')))
      .limit(1)
    return (row as WarmupPlan) ?? null
  }

  // --------------------------------------------------------------------------
  // Worker
  // --------------------------------------------------------------------------

  startWorker(intervalMs: number = 86400000) { // Default: once per day
    if (this.workerInterval) return
    this.workerInterval = setInterval(() => {
      void this.advanceDay()
    }, intervalMs)
    logger.startup('   Warmup worker started')
  }

  stopWorker() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval)
      this.workerInterval = null
    }
  }
}

export const warmupService = new WarmupService()
