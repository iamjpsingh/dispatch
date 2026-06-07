// src/services/routingEngine.ts - Smart Provider Routing Engine (Postgres/Drizzle, async)
// Score-based provider selection: quota (40%), success rate (35%), speed (15%), cost (10%)

import { and, eq, gte, desc, asc, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { provider_stats, routing_config, failover_log } from '../db/pg/schema'
import { eventBus } from './eventBus'
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

const now = () => new Date().toISOString()
const today = () => new Date().toISOString().split('T')[0]

// ============================================================================
// Service
// ============================================================================

class RoutingEngine {
  constructor() {
    this.registerEventHandlers()
  }

  private registerEventHandlers() {
    // eventBus nests custom fields under `payload.data`; userId is top-level.
    eventBus.on('email_sent', async (payload) => {
      const d = payload.data || {}
      if (d.configId && payload.userId) {
        await this.recordSend(payload.userId, String(d.configId), String(d.providerType || 'smtp'), String(d.configName || ''), Number(d.sendTimeMs || 0), true)
      }
    })

    eventBus.on('email_failed', async (payload) => {
      const d = payload.data || {}
      if (d.configId && payload.userId) {
        await this.recordSend(payload.userId, String(d.configId), String(d.providerType || 'smtp'), String(d.configName || ''), 0, false, d.error as string | undefined)
      }
    })

    eventBus.on('email_bounced', async (payload) => {
      const d = payload.data || {}
      if (d.configId && payload.userId) {
        await this.recordBounce(payload.userId, String(d.configId))
      }
    })
  }

  // --------------------------------------------------------------------------
  // Stats Recording
  // --------------------------------------------------------------------------

  private async getOrCreateStats(userId: string, configId: string, providerType: string, configName: string): Promise<ProviderStats> {
    const db = getDb()
    const day = today()

    const [existing] = await db
      .select()
      .from(provider_stats)
      .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.config_id, configId), eq(provider_stats.date, day)))
      .limit(1)

    if (existing) return existing as ProviderStats

    const id = generateId('rs')
    const limit = DEFAULT_LIMITS[providerType] || 500

    // onConflictDoNothing keeps the UNIQUE(user_id, config_id, date) upsert
    // race-safe; re-select by the unique key to return whichever row won.
    await db
      .insert(provider_stats)
      .values({ id, user_id: userId, config_id: configId, provider_type: providerType, config_name: configName, date: day, daily_limit: limit })
      .onConflictDoNothing()

    const [row] = await db
      .select()
      .from(provider_stats)
      .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.config_id, configId), eq(provider_stats.date, day)))
      .limit(1)

    return row as ProviderStats
  }

  async recordSend(userId: string, configId: string, providerType: string, configName: string, sendTimeMs: number, success: boolean, error?: string): Promise<void> {
    const db = getDb()
    const stats = await this.getOrCreateStats(userId, configId, providerType, configName)

    if (success) {
      const newAvg = stats.sent_count > 0
        ? (stats.avg_send_time_ms * stats.sent_count + sendTimeMs) / (stats.sent_count + 1)
        : sendTimeMs

      await db
        .update(provider_stats)
        .set({
          sent_count: sql`${provider_stats.sent_count} + 1`,
          avg_send_time_ms: newAvg,
          updated_at: now(),
        })
        .where(eq(provider_stats.id, stats.id))
    } else {
      await db
        .update(provider_stats)
        .set({
          failed_count: sql`${provider_stats.failed_count} + 1`,
          last_error: error || 'Unknown error',
          is_healthy: sql`case when ${provider_stats.failed_count} + 1 > 10 then 0 else ${provider_stats.is_healthy} end`,
          updated_at: now(),
        })
        .where(eq(provider_stats.id, stats.id))
    }
  }

  async recordBounce(userId: string, configId: string): Promise<void> {
    const day = today()
    await getDb()
      .update(provider_stats)
      .set({ bounce_count: sql`${provider_stats.bounce_count} + 1`, updated_at: now() })
      .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.config_id, configId), eq(provider_stats.date, day)))
  }

  // --------------------------------------------------------------------------
  // Scoring & Selection
  // --------------------------------------------------------------------------

  private async getUserConfig(userId: string): Promise<RoutingConfig> {
    const [row] = await getDb().select().from(routing_config).where(eq(routing_config.user_id, userId)).limit(1)

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

  async scoreProviders(userId: string): Promise<RoutingScore[]> {
    const config = await this.getUserConfig(userId)

    const stats = (await getDb()
      .select()
      .from(provider_stats)
      .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.date, today()), eq(provider_stats.is_healthy, 1)))
      .orderBy(asc(provider_stats.sent_count))) as ProviderStats[]

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

  async selectProvider(userId: string, excludeConfigIds: string[] = []): Promise<RoutingDecision | null> {
    const scores = await this.scoreProviders(userId)
    const config = await this.getUserConfig(userId)

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

  async failover(userId: string, failedConfigId: string, reason: string): Promise<RoutingDecision | null> {
    const decision = await this.selectProvider(userId, [failedConfigId])

    if (decision) {
      const id = generateId('fo')
      await getDb()
        .insert(failover_log)
        .values({ id, user_id: userId, from_config_id: failedConfigId, to_config_id: decision.selectedConfigId, reason })

      eventBus.emit('provider_failover' as never, userId, {
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

  async updateRoutingConfig(userId: string, config: Partial<RoutingConfig>): Promise<boolean> {
    const db = getDb()
    const [existing] = await db.select({ id: routing_config.id }).from(routing_config).where(eq(routing_config.user_id, userId)).limit(1)

    if (existing) {
      const values: Partial<typeof routing_config.$inferInsert> = {}

      if (config.weights) values.weights_json = JSON.stringify(config.weights)
      if (config.failover_enabled !== undefined) values.failover_enabled = config.failover_enabled ? 1 : 0
      if (config.min_success_rate !== undefined) values.min_success_rate = config.min_success_rate
      if (config.max_avg_send_time_ms !== undefined) values.max_avg_send_time_ms = config.max_avg_send_time_ms

      if (Object.keys(values).length === 0) return false

      values.updated_at = now()

      await db.update(routing_config).set(values).where(eq(routing_config.user_id, userId))
    } else {
      const id = generateId('rc')
      await db.insert(routing_config).values({
        id,
        user_id: userId,
        weights_json: JSON.stringify(config.weights || DEFAULT_WEIGHTS),
        failover_enabled: config.failover_enabled !== false ? 1 : 0,
        min_success_rate: config.min_success_rate || 0.8,
        max_avg_send_time_ms: config.max_avg_send_time_ms || 30000,
      })
    }

    return true
  }

  async getRoutingConfig(userId: string): Promise<RoutingConfig> {
    return this.getUserConfig(userId)
  }

  // --------------------------------------------------------------------------
  // Dashboard & History
  // --------------------------------------------------------------------------

  async getProviderDashboard(userId: string): Promise<{ today: ProviderStats[]; scores: RoutingScore[]; failovers: (typeof failover_log.$inferSelect)[] }> {
    const db = getDb()
    const day = today()

    const stats = (await db
      .select()
      .from(provider_stats)
      .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.date, day)))) as ProviderStats[]

    const scores = await this.scoreProviders(userId)

    const failovers = await db
      .select()
      .from(failover_log)
      .where(eq(failover_log.user_id, userId))
      .orderBy(desc(failover_log.created_at))
      .limit(20)

    return { today: stats, scores, failovers }
  }

  async getProviderHistory(userId: string, days: number = 30): Promise<ProviderStats[]> {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    const cutoff = startDate.toISOString().split('T')[0]

    return (await getDb()
      .select()
      .from(provider_stats)
      .where(and(eq(provider_stats.user_id, userId), gte(provider_stats.date, cutoff)))
      .orderBy(desc(provider_stats.date), asc(provider_stats.config_id))) as ProviderStats[]
  }

  async markProviderHealthy(userId: string, configId: string): Promise<void> {
    const day = today()
    await getDb()
      .update(provider_stats)
      .set({ is_healthy: 1, last_checked_at: now(), updated_at: now() })
      .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.config_id, configId), eq(provider_stats.date, day)))
  }

  async markProviderUnhealthy(userId: string, configId: string, error: string): Promise<void> {
    const day = today()
    await getDb()
      .update(provider_stats)
      .set({ is_healthy: 0, last_error: error, last_checked_at: now(), updated_at: now() })
      .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.config_id, configId), eq(provider_stats.date, day)))
  }

  async initializeProvider(userId: string, configId: string, providerType: string, configName: string, dailyLimit?: number): Promise<void> {
    await this.getOrCreateStats(userId, configId, providerType, configName)
    if (dailyLimit) {
      const day = today()
      await getDb()
        .update(provider_stats)
        .set({ daily_limit: dailyLimit })
        .where(and(eq(provider_stats.user_id, userId), eq(provider_stats.config_id, configId), eq(provider_stats.date, day)))
    }
  }
}

export const routingEngine = new RoutingEngine()
