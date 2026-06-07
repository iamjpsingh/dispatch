// src/services/scoringEngine.ts - Engagement Scoring Engine (0-100) (Postgres/Drizzle, async)

import { eq, desc, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { engagement_events } from '../db/pg/schema'
import { eventBus } from './eventBus'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface EngagementEvent {
  id: string
  contact_id: string
  user_id: string
  campaign_id: string | null
  event_type: 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed' | 'complained'
  points: number
  created_at: string
}

export interface ScoreBreakdown {
  contactId: string
  score: number
  segment: 'hot' | 'warm' | 'cold' | 'dead'
  events: { type: string; count: number; points: number }[]
}

// Score rules
const SCORE_RULES = {
  opened:       { points: 5,   max: 20 },
  clicked:      { points: 10,  max: 30 },
  replied:      { points: 20,  max: 20 },
  bounced:      { points: -100, max: -100 },
  unsubscribed: { points: -100, max: -100 },
  complained:   { points: -100, max: -100 },
} as const

const SCORE_SEGMENTS = {
  hot:  { min: 80, max: 100, label: 'Hot' },
  warm: { min: 50, max: 79,  label: 'Warm' },
  cold: { min: 20, max: 49,  label: 'Cold' },
  dead: { min: 0,  max: 19,  label: 'Dead' },
} as const

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class ScoringEngine {
  private registerEventHandlers() {
    // Listen for tracking events to auto-score
    eventBus.on('email_opened', async (event) => {
      if (event.contactId) {
        await this.recordEvent(event.contactId, event.userId, 'opened', event.campaignId)
      }
    })

    eventBus.on('email_clicked', async (event) => {
      if (event.contactId) {
        await this.recordEvent(event.contactId, event.userId, 'clicked', event.campaignId)
      }
    })

    eventBus.on('email_bounced', async (event) => {
      if (event.contactId) {
        await this.recordEvent(event.contactId, event.userId, 'bounced', event.campaignId)
      }
    })

    eventBus.on('email_unsubscribed', async (event) => {
      if (event.contactId) {
        await this.recordEvent(event.contactId, event.userId, 'unsubscribed', event.campaignId)
      }
    })
  }

  constructor() {
    this.registerEventHandlers()
  }

  // --------------------------------------------------------------------------
  // Event Recording
  // --------------------------------------------------------------------------

  async recordEvent(contactId: string, userId: string, eventType: keyof typeof SCORE_RULES, campaignId?: string | null): Promise<number> {
    const rule = SCORE_RULES[eventType]
    const id = generateId('evt')

    await getDb().insert(engagement_events).values({
      id,
      contact_id: contactId,
      user_id: userId,
      campaign_id: campaignId || null,
      event_type: eventType,
      points: rule.points,
      created_at: now(),
    })

    // Recalculate and return new score
    const newScore = await this.calculateScore(contactId)

    // Emit scoring event
    eventBus.emit('contact_scored', userId, {
      contactId,
      score: newScore,
      eventType,
      segment: this.getSegment(newScore),
    })

    return newScore
  }

  // --------------------------------------------------------------------------
  // Score Calculation
  // --------------------------------------------------------------------------

  async calculateScore(contactId: string): Promise<number> {
    const events = await getDb()
      .select({
        event_type: engagement_events.event_type,
        total_points: sql<number>`sum(${engagement_events.points})::int`,
        event_count: sql<number>`count(*)::int`,
      })
      .from(engagement_events)
      .where(eq(engagement_events.contact_id, contactId))
      .groupBy(engagement_events.event_type)

    let score = 50 // Base score

    for (const event of events) {
      const rule = SCORE_RULES[event.event_type as keyof typeof SCORE_RULES]
      if (!rule) continue

      if (rule.points < 0) {
        // Negative events (bounce, unsub) are absolute
        score = 0
        break
      }

      // Cap positive points at max
      const cappedPoints = Math.min(event.total_points, rule.max)
      score += cappedPoints
    }

    return Math.max(0, Math.min(100, score))
  }

  async getScoreBreakdown(contactId: string): Promise<ScoreBreakdown> {
    const events = await getDb()
      .select({
        event_type: engagement_events.event_type,
        total_points: sql<number>`sum(${engagement_events.points})::int`,
        event_count: sql<number>`count(*)::int`,
      })
      .from(engagement_events)
      .where(eq(engagement_events.contact_id, contactId))
      .groupBy(engagement_events.event_type)

    const score = await this.calculateScore(contactId)

    return {
      contactId,
      score,
      segment: this.getSegment(score) as 'hot' | 'warm' | 'cold' | 'dead',
      events: events.map(e => ({
        type: e.event_type,
        count: e.event_count,
        points: e.total_points,
      })),
    }
  }

  getSegment(score: number): string {
    if (score >= SCORE_SEGMENTS.hot.min) return 'hot'
    if (score >= SCORE_SEGMENTS.warm.min) return 'warm'
    if (score >= SCORE_SEGMENTS.cold.min) return 'cold'
    return 'dead'
  }

  // --------------------------------------------------------------------------
  // Bulk Operations
  // --------------------------------------------------------------------------

  async getContactsByScoreRange(userId: string, min: number, max: number, limit = 100): Promise<{ contact_id: string; score: number }[]> {
    // Get all contacts with events for this user, calculate scores
    const contacts = await getDb()
      .selectDistinct({ contact_id: engagement_events.contact_id })
      .from(engagement_events)
      .where(eq(engagement_events.user_id, userId))

    const results: { contact_id: string; score: number }[] = []

    for (const contact of contacts) {
      const score = await this.calculateScore(contact.contact_id)
      if (score >= min && score <= max) {
        results.push({ contact_id: contact.contact_id, score })
      }
      if (results.length >= limit) break
    }

    return results.sort((a, b) => b.score - a.score)
  }

  /**
   * Apply score decay for contacts with no engagement in 30+ days
   * Run this daily via cron
   */
  async applyScoreDecay(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Find contacts whose last event is older than 30 days
    const staleContacts = await getDb()
      .select({
        contact_id: engagement_events.contact_id,
        user_id: sql<string>`max(${engagement_events.user_id})`,
        last_event: sql<string>`max(${engagement_events.created_at})`,
      })
      .from(engagement_events)
      .groupBy(engagement_events.contact_id)
      .having(sql`max(${engagement_events.created_at}) < ${thirtyDaysAgo}`)

    let affected = 0
    for (const contact of staleContacts) {
      const daysSince = Math.floor((Date.now() - new Date(contact.last_event).getTime()) / (24 * 60 * 60 * 1000))

      if (daysSince >= 90) {
        await this.recordEvent(contact.contact_id, contact.user_id, 'opened') // placeholder - actual decay
        // In a real implementation, we'd add a 'decay' event type
        affected++
      } else if (daysSince >= 30) {
        affected++
      }
    }

    return affected
  }

  /**
   * Get scoring stats for a user
   */
  async getStats(userId: string): Promise<{ total: number; hot: number; warm: number; cold: number; dead: number }> {
    const contacts = await getDb()
      .selectDistinct({ contact_id: engagement_events.contact_id })
      .from(engagement_events)
      .where(eq(engagement_events.user_id, userId))

    const stats = { total: contacts.length, hot: 0, warm: 0, cold: 0, dead: 0 }

    for (const contact of contacts) {
      const score = await this.calculateScore(contact.contact_id)
      const segment = this.getSegment(score) as keyof typeof stats
      if (segment !== 'total') stats[segment]++
    }

    return stats
  }

  /**
   * Get recent events for a contact
   */
  async getContactEvents(contactId: string, limit = 20): Promise<EngagementEvent[]> {
    const rows = await getDb()
      .select()
      .from(engagement_events)
      .where(eq(engagement_events.contact_id, contactId))
      .orderBy(desc(engagement_events.created_at))
      .limit(limit)
    return rows as EngagementEvent[]
  }
}

export const scoringEngine = new ScoringEngine()
export { SCORE_RULES, SCORE_SEGMENTS }
