// src/services/routingEngine.ts - Smart Provider Routing Engine
// Score-based provider selection: quota (40%), success rate (35%), speed (15%), cost (10%)

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { eventBus } from './eventBus'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface ProviderStats {
  id: string
  user_id: string
  config_id: string
  provider_type: 'smtp' | 'google' | 'microsoft'
  config_name: string
  date: string
  sent_count: number
  failed_count: number
  bounce_count: number
  avg_send_time_ms: number
  daily_limit: number
  cost_per_email: number
  is_healthy: number
  last_error: string | null
  last_checked_at: string | null
  created_at: string
  updated_at: string
}

export interface RoutingScore {
  configId: string
  configName: string
  providerType: string
  totalScore: number
  quotaScore: number
  successScore: number
  speedScore: number
  costScore: number
  quotaRemaining: number
  successRate: number
  avgSendTime: number
}

export interface RoutingDecision {
  selectedConfigId: string
  selectedConfigName: string
  providerType: string
  score: number
  reason: string
  alternatives: RoutingScore[]
}

export interface RoutingConfig {
  weights: {
    quota: number
    success_rate: number
    speed: number
    cost: number
  }
  failover_enabled: boolean
  min_success_rate: number
  max_avg_send_time_ms: number
}

const DEFAULT_LIMITS: Record<string, number> = {
  google: 500,
  microsoft: 300,
  smtp: 500,
}

const DEFAULT_WEIGHTS: RoutingConfig['weights'] = {
  quota: 0.40,
  success_rate: 0.35,
  speed: 0.15,
  cost: 0.10,
}

// ============================================================================
// Service
// ============================================================================

class RoutingEngine {
  private db: Database

  constructor() {
    const dbPath = './data/routing.db'
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
    this.registerEventHandlers()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_stats (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        provider_type TEXT NOT NULL CHECK (provider_type IN ('smtp', 'google', 'microsoft')),
        config_name TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT (date('now')),
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        bounce_count INTEGER DEFAULT 0,
        avg_send_time_ms REAL DEFAULT 0,
        daily_limit INTEGER DEFAULT 500,
        cost_per_email REAL DEFAULT 0,
        is_healthy INTEGER DEFAULT 1,
        last_error TEXT,
        last_checked_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, config_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_routing_user_date ON provider_stats(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_routing_config ON provider_stats(config_id);

      CREATE TABLE IF NOT EXISTS routing_config (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        weights_json TEXT DEFAULT '${JSON.stringify(DEFAULT_WEIGHTS)}',
        failover_enabled INTEGER DEFAULT 1,
        min_success_rate REAL DEFAULT 0.8,
        max_avg_send_time_ms INTEGER DEFAULT 30000,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS failover_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        from_config_id TEXT NOT NULL,
        to_config_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_failover_user ON failover_log(user_id);
    `)

    logger.info('Routing engine initialized (data/routing.db)')
  }

  private registerEventHandlers() {
    // eventBus nests custom fields under `payload.data`; userId is top-level.
    eventBus.on('email_sent', (payload: any) => {
      const d = payload.data || {}
      if (d.configId && payload.userId) {
        this.recordSend(payload.userId, d.configId, d.providerType || 'smtp', d.configName || '', d.sendTimeMs || 0, true)
      }
    })

    eventBus.on('email_failed', (payload: any) => {
      const d = payload.data || {}
      if (d.configId && payload.userId) {
        this.recordSend(payload.userId, d.configId, d.providerType || 'smtp', d.configName || '', 0, false, d.error)
      }
    })

    eventBus.on('email_bounced', (payload: any) => {
      const d = payload.data || {}
      if (d.configId && payload.userId) {
        this.recordBounce(payload.userId, d.configId)
      }
    })
  }

  // --------------------------------------------------------------------------
  // Stats Recording
  // --------------------------------------------------------------------------

  private getOrCreateStats(userId: string, configId: string, providerType: string, configName: string): ProviderStats {
    const today = new Date().toISOString().split('T')[0]
    let stats = this.db.prepare(`
      SELECT * FROM provider_stats WHERE user_id = ? AND config_id = ? AND date = ?
    `).get(userId, configId, today) as ProviderStats | null

    if (!stats) {
      const id = generateId('rs')
      const limit = DEFAULT_LIMITS[providerType] || 500

      this.db.prepare(`
        INSERT INTO provider_stats (id, user_id, config_id, provider_type, config_name, date, daily_limit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, configId, providerType, configName, today, limit)

      stats = this.db.prepare('SELECT * FROM provider_stats WHERE id = ?').get(id) as ProviderStats
    }

    return stats
  }

  recordSend(userId: string, configId: string, providerType: string, configName: string, sendTimeMs: number, success: boolean, error?: string) {
    const stats = this.getOrCreateStats(userId, configId, providerType, configName)

    if (success) {
      const newAvg = stats.sent_count > 0
        ? (stats.avg_send_time_ms * stats.sent_count + sendTimeMs) / (stats.sent_count + 1)
        : sendTimeMs

      this.db.prepare(`
        UPDATE provider_stats SET
          sent_count = sent_count + 1,
          avg_send_time_ms = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(newAvg, stats.id)
    } else {
      this.db.prepare(`
        UPDATE provider_stats SET
          failed_count = failed_count + 1,
          last_error = ?,
          is_healthy = CASE WHEN failed_count + 1 > 10 THEN 0 ELSE is_healthy END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(error || 'Unknown error', stats.id)
    }
  }

  recordBounce(userId: string, configId: string) {
    const today = new Date().toISOString().split('T')[0]
    this.db.prepare(`
      UPDATE provider_stats SET
        bounce_count = bounce_count + 1,
        updated_at = datetime('now')
      WHERE user_id = ? AND config_id = ? AND date = ?
    `).run(userId, configId, today)
  }

  // --------------------------------------------------------------------------
  // Scoring & Selection
  // --------------------------------------------------------------------------

  private getUserConfig(userId: string): RoutingConfig {
    const row = this.db.prepare('SELECT * FROM routing_config WHERE user_id = ?').get(userId) as any

    if (row) {
      return {
        weights: JSON.parse(row.weights_json),
        failover_enabled: !!row.failover_enabled,
        min_success_rate: row.min_success_rate,
        max_avg_send_time_ms: row.max_avg_send_time_ms,
      }
    }

    return {
      weights: { ...DEFAULT_WEIGHTS },
      failover_enabled: true,
      min_success_rate: 0.8,
      max_avg_send_time_ms: 30000,
    }
  }

  scoreProviders(userId: string): RoutingScore[] {
    const today = new Date().toISOString().split('T')[0]
    const config = this.getUserConfig(userId)

    const stats = this.db.prepare(`
      SELECT * FROM provider_stats
      WHERE user_id = ? AND date = ? AND is_healthy = 1
      ORDER BY sent_count ASC
    `).all(userId, today) as ProviderStats[]

    if (stats.length === 0) return []

    const maxSendTime = Math.max(...stats.map(s => s.avg_send_time_ms), 1)
    const maxCost = Math.max(...stats.map(s => s.cost_per_email), 0.01)

    return stats.map(s => {
      const totalSends = s.sent_count + s.failed_count
      const successRate = totalSends > 0 ? s.sent_count / totalSends : 1
      const quotaRemaining = Math.max(0, s.daily_limit - s.sent_count)
      const quotaRatio = s.daily_limit > 0 ? quotaRemaining / s.daily_limit : 0

      const quotaScore = quotaRatio * 100
      const successScore = successRate * 100
      const speedScore = maxSendTime > 0 ? (1 - s.avg_send_time_ms / maxSendTime) * 100 : 100
      const costScore = maxCost > 0 ? (1 - s.cost_per_email / maxCost) * 100 : 100

      const totalScore =
        quotaScore * config.weights.quota +
        successScore * config.weights.success_rate +
        speedScore * config.weights.speed +
        costScore * config.weights.cost

      return {
        configId: s.config_id,
        configName: s.config_name,
        providerType: s.provider_type,
        totalScore: Math.round(totalScore * 100) / 100,
        quotaScore: Math.round(quotaScore * 100) / 100,
        successScore: Math.round(successScore * 100) / 100,
        speedScore: Math.round(speedScore * 100) / 100,
        costScore: Math.round(costScore * 100) / 100,
        quotaRemaining,
        successRate: Math.round(successRate * 10000) / 100,
        avgSendTime: Math.round(s.avg_send_time_ms),
      }
    }).sort((a, b) => b.totalScore - a.totalScore)
  }

  selectProvider(userId: string, excludeConfigIds: string[] = []): RoutingDecision | null {
    const scores = this.scoreProviders(userId)
    const config = this.getUserConfig(userId)

    const eligible = scores.filter(s =>
      !excludeConfigIds.includes(s.configId) &&
      s.quotaRemaining > 0 &&
      s.successRate >= config.min_success_rate * 100
    )

    if (eligible.length === 0) return null

    const selected = eligible[0]

    return {
      selectedConfigId: selected.configId,
      selectedConfigName: selected.configName,
      providerType: selected.providerType,
      score: selected.totalScore,
      reason: `Highest score (${selected.totalScore}): quota ${selected.quotaRemaining} remaining, ${selected.successRate}% success rate`,
      alternatives: eligible.slice(1),
    }
  }

  failover(userId: string, failedConfigId: string, reason: string): RoutingDecision | null {
    const decision = this.selectProvider(userId, [failedConfigId])

    if (decision) {
      const id = generateId('fo')
      this.db.prepare(`
        INSERT INTO failover_log (id, user_id, from_config_id, to_config_id, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, userId, failedConfigId, decision.selectedConfigId, reason)

      eventBus.emit('provider_failover', {
        userId,
        fromConfigId: failedConfigId,
        toConfigId: decision.selectedConfigId,
        reason,
      })
    }

    return decision
  }

  // --------------------------------------------------------------------------
  // Config Management
  // --------------------------------------------------------------------------

  updateRoutingConfig(userId: string, config: Partial<RoutingConfig>): boolean {
    const existing = this.db.prepare('SELECT id FROM routing_config WHERE user_id = ?').get(userId) as any

    if (existing) {
      const sets: string[] = []
      const params: any[] = []

      if (config.weights) { sets.push('weights_json = ?'); params.push(JSON.stringify(config.weights)) }
      if (config.failover_enabled !== undefined) { sets.push('failover_enabled = ?'); params.push(config.failover_enabled ? 1 : 0) }
      if (config.min_success_rate !== undefined) { sets.push('min_success_rate = ?'); params.push(config.min_success_rate) }
      if (config.max_avg_send_time_ms !== undefined) { sets.push('max_avg_send_time_ms = ?'); params.push(config.max_avg_send_time_ms) }

      if (sets.length === 0) return false

      sets.push("updated_at = datetime('now')")
      params.push(userId)

      this.db.prepare(`UPDATE routing_config SET ${sets.join(', ')} WHERE user_id = ?`).run(...params)
    } else {
      const id = generateId('rc')
      this.db.prepare(`
        INSERT INTO routing_config (id, user_id, weights_json, failover_enabled, min_success_rate, max_avg_send_time_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id, userId,
        JSON.stringify(config.weights || DEFAULT_WEIGHTS),
        config.failover_enabled !== false ? 1 : 0,
        config.min_success_rate || 0.8,
        config.max_avg_send_time_ms || 30000
      )
    }

    return true
  }

  getRoutingConfig(userId: string): RoutingConfig {
    return this.getUserConfig(userId)
  }

  // --------------------------------------------------------------------------
  // Dashboard & History
  // --------------------------------------------------------------------------

  getProviderDashboard(userId: string): { today: ProviderStats[]; scores: RoutingScore[]; failovers: any[] } {
    const today = new Date().toISOString().split('T')[0]

    const stats = this.db.prepare(`
      SELECT * FROM provider_stats WHERE user_id = ? AND date = ?
    `).all(userId, today) as ProviderStats[]

    const scores = this.scoreProviders(userId)

    const failovers = this.db.prepare(`
      SELECT * FROM failover_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(userId)

    return { today: stats, scores, failovers }
  }

  getProviderHistory(userId: string, days: number = 30): ProviderStats[] {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    return this.db.prepare(`
      SELECT * FROM provider_stats
      WHERE user_id = ? AND date >= ?
      ORDER BY date DESC, config_id
    `).all(userId, startDate.toISOString().split('T')[0]) as ProviderStats[]
  }

  markProviderHealthy(userId: string, configId: string) {
    const today = new Date().toISOString().split('T')[0]
    this.db.prepare(`
      UPDATE provider_stats SET is_healthy = 1, last_checked_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ? AND config_id = ? AND date = ?
    `).run(userId, configId, today)
  }

  markProviderUnhealthy(userId: string, configId: string, error: string) {
    const today = new Date().toISOString().split('T')[0]
    this.db.prepare(`
      UPDATE provider_stats SET is_healthy = 0, last_error = ?, last_checked_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ? AND config_id = ? AND date = ?
    `).run(error, userId, configId, today)
  }

  initializeProvider(userId: string, configId: string, providerType: string, configName: string, dailyLimit?: number) {
    this.getOrCreateStats(userId, configId, providerType, configName)
    if (dailyLimit) {
      const today = new Date().toISOString().split('T')[0]
      this.db.prepare(`
        UPDATE provider_stats SET daily_limit = ? WHERE user_id = ? AND config_id = ? AND date = ?
      `).run(dailyLimit, userId, configId, today)
    }
  }
}

export const routingEngine = new RoutingEngine()
