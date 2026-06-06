// src/services/warmupService.ts - Email Warmup Service
// Gradual volume ramp for new sender domains/IPs

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
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

// ============================================================================
// Service
// ============================================================================

class WarmupService {
  private db: Database
  private workerInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    const dbPath = './data/warmup.db'
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
      CREATE TABLE IF NOT EXISTS warmup_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        config_name TEXT NOT NULL DEFAULT '',
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
        schedule_json TEXT NOT NULL,
        current_day INTEGER DEFAULT 1,
        total_days INTEGER NOT NULL,
        emails_sent_today INTEGER DEFAULT 0,
        daily_target INTEGER DEFAULT 0,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_warmup_user ON warmup_plans(user_id);
      CREATE INDEX IF NOT EXISTS idx_warmup_config ON warmup_plans(config_id);
      CREATE INDEX IF NOT EXISTS idx_warmup_status ON warmup_plans(status);

      CREATE TABLE IF NOT EXISTS warmup_logs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        date TEXT NOT NULL DEFAULT (date('now')),
        target INTEGER NOT NULL,
        sent INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        bounce_rate REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (plan_id) REFERENCES warmup_plans(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_warmup_log_plan ON warmup_logs(plan_id);
    `)

    logger.info('Warmup service initialized (data/warmup.db)')
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(userId: string, input: WarmupInput): WarmupPlan {
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

    this.db.prepare(`
      INSERT INTO warmup_plans (id, user_id, config_id, config_name, schedule_json, total_days, daily_target)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, input.config_id, input.config_name, JSON.stringify(schedule), totalDays, dailyTarget)

    return this.db.prepare('SELECT * FROM warmup_plans WHERE id = ?').get(id) as WarmupPlan
  }

  get(userId: string, planId: string): WarmupPlan | null {
    return this.db.prepare(`
      SELECT * FROM warmup_plans WHERE id = ? AND user_id = ?
    `).get(planId, userId) as WarmupPlan | null
  }

  list(userId: string, status?: string): WarmupPlan[] {
    if (status) {
      return this.db.prepare(`
        SELECT * FROM warmup_plans WHERE user_id = ? AND status = ? ORDER BY created_at DESC
      `).all(userId, status) as WarmupPlan[]
    }
    return this.db.prepare(`
      SELECT * FROM warmup_plans WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId) as WarmupPlan[]
  }

  pause(userId: string, planId: string): boolean {
    const result = this.db.prepare(`
      UPDATE warmup_plans SET status = 'paused', updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status = 'active'
    `).run(planId, userId)
    return result.changes > 0
  }

  resume(userId: string, planId: string): boolean {
    const result = this.db.prepare(`
      UPDATE warmup_plans SET status = 'active', updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status = 'paused'
    `).run(planId, userId)
    return result.changes > 0
  }

  cancel(userId: string, planId: string): boolean {
    const result = this.db.prepare(`
      UPDATE warmup_plans SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status IN ('active', 'paused')
    `).run(planId, userId)
    return result.changes > 0
  }

  delete(userId: string, planId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM warmup_plans WHERE id = ? AND user_id = ? AND status IN ('completed', 'cancelled')
    `).run(planId, userId)
    return result.changes > 0
  }

  // --------------------------------------------------------------------------
  // Warmup Logic
  // --------------------------------------------------------------------------

  /**
   * Get today's sending limit for a config under warmup
   */
  getWarmupLimit(userId: string, configId: string): number | null {
    const plan = this.db.prepare(`
      SELECT * FROM warmup_plans WHERE user_id = ? AND config_id = ? AND status = 'active'
    `).get(userId, configId) as WarmupPlan | null

    if (!plan) return null

    const schedule: WarmupScheduleDay[] = JSON.parse(plan.schedule_json)
    const daySchedule = schedule.find(s => s.day === plan.current_day)

    return daySchedule?.target || null
  }

  /**
   * Check if config can send more emails today under warmup
   */
  canSendMore(userId: string, configId: string): { allowed: boolean; remaining: number; limit: number } {
    const plan = this.db.prepare(`
      SELECT * FROM warmup_plans WHERE user_id = ? AND config_id = ? AND status = 'active'
    `).get(userId, configId) as WarmupPlan | null

    if (!plan) return { allowed: true, remaining: Infinity, limit: Infinity }

    const limit = plan.daily_target
    const remaining = Math.max(0, limit - plan.emails_sent_today)

    return { allowed: remaining > 0, remaining, limit }
  }

  /**
   * Record email sent during warmup
   */
  recordSend(userId: string, configId: string, success: boolean) {
    const plan = this.db.prepare(`
      SELECT * FROM warmup_plans WHERE user_id = ? AND config_id = ? AND status = 'active'
    `).get(userId, configId) as WarmupPlan | null

    if (!plan) return

    this.db.prepare(`
      UPDATE warmup_plans SET emails_sent_today = emails_sent_today + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(plan.id)
  }

  /**
   * Advance warmup plans to next day (call daily)
   */
  advanceDay() {
    const activePlans = this.db.prepare(`
      SELECT * FROM warmup_plans WHERE status = 'active'
    `).all() as WarmupPlan[]

    for (const plan of activePlans) {
      const schedule: WarmupScheduleDay[] = JSON.parse(plan.schedule_json)

      // Log today's progress
      const logId = generateId('wl')
      this.db.prepare(`
        INSERT INTO warmup_logs (id, plan_id, day, target, sent)
        VALUES (?, ?, ?, ?, ?)
      `).run(logId, plan.id, plan.current_day, plan.daily_target, plan.emails_sent_today)

      // Check if warmup is complete
      if (plan.current_day >= plan.total_days) {
        this.db.prepare(`
          UPDATE warmup_plans SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(plan.id)
        continue
      }

      // Advance to next day
      const nextDay = plan.current_day + 1
      const nextSchedule = schedule.find(s => s.day === nextDay)
      const nextTarget = nextSchedule?.target || plan.daily_target

      this.db.prepare(`
        UPDATE warmup_plans SET
          current_day = ?,
          daily_target = ?,
          emails_sent_today = 0,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(nextDay, nextTarget, plan.id)
    }
  }

  // --------------------------------------------------------------------------
  // Progress & Logs
  // --------------------------------------------------------------------------

  getProgress(userId: string, planId: string): { plan: WarmupPlan; schedule: WarmupScheduleDay[]; logs: WarmupLog[]; progress: number } | null {
    const plan = this.get(userId, planId)
    if (!plan) return null

    const schedule: WarmupScheduleDay[] = JSON.parse(plan.schedule_json)
    const logs = this.db.prepare(`
      SELECT * FROM warmup_logs WHERE plan_id = ? ORDER BY day ASC
    `).all(planId) as WarmupLog[]

    const progress = plan.total_days > 0 ? Math.round((plan.current_day / plan.total_days) * 100) : 0

    return { plan, schedule, logs, progress }
  }

  getActivePlanForConfig(userId: string, configId: string): WarmupPlan | null {
    return this.db.prepare(`
      SELECT * FROM warmup_plans WHERE user_id = ? AND config_id = ? AND status = 'active'
    `).get(userId, configId) as WarmupPlan | null
  }

  // --------------------------------------------------------------------------
  // Worker
  // --------------------------------------------------------------------------

  startWorker(intervalMs: number = 86400000) { // Default: once per day
    if (this.workerInterval) return
    this.workerInterval = setInterval(() => this.advanceDay(), intervalMs)
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
