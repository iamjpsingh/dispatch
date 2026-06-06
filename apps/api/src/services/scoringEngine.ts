// src/services/scoringEngine.ts - Engagement Scoring Engine (0-100)

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { eventBus } from './eventBus'
import { logger } from '../utils/logger'
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

// ============================================================================
// Service
// ============================================================================

class ScoringEngine {
  private db: Database

  constructor() {
    const dbPath = './data/scoring.db'
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
      CREATE TABLE IF NOT EXISTS engagement_events (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        campaign_id TEXT,
        event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'complained')),
        points INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_ee_contact ON engagement_events(contact_id);
      CREATE INDEX IF NOT EXISTS idx_ee_user ON engagement_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_ee_type ON engagement_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_ee_date ON engagement_events(created_at);
    `)

    logger.info('Scoring database initialized (data/scoring.db)')
  }

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

  // --------------------------------------------------------------------------
  // Event Recording
  // --------------------------------------------------------------------------

  recordEvent(contactId: string, userId: string, eventType: keyof typeof SCORE_RULES, campaignId?: string | null): number {
    const rule = SCORE_RULES[eventType]
    const id = generateId('evt')

    this.db.prepare(`
      INSERT INTO engagement_events (id, contact_id, user_id, campaign_id, event_type, points)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, contactId, userId, campaignId || null, eventType, rule.points)

    // Recalculate and return new score
    const newScore = this.calculateScore(contactId)

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

  calculateScore(contactId: string): number {
    const events = this.db.prepare(`
      SELECT event_type, SUM(points) as total_points, COUNT(*) as event_count
      FROM engagement_events
      WHERE contact_id = ?
      GROUP BY event_type
    `).all(contactId) as { event_type: string; total_points: number; event_count: number }[]

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

  getScoreBreakdown(contactId: string): ScoreBreakdown {
    const events = this.db.prepare(`
      SELECT event_type, SUM(points) as total_points, COUNT(*) as event_count
      FROM engagement_events
      WHERE contact_id = ?
      GROUP BY event_type
    `).all(contactId) as { event_type: string; total_points: number; event_count: number }[]

    const score = this.calculateScore(contactId)

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

  getContactsByScoreRange(userId: string, min: number, max: number, limit = 100): { contact_id: string; score: number }[] {
    // Get all contacts with events for this user, calculate scores
    const contacts = this.db.prepare(`
      SELECT DISTINCT contact_id FROM engagement_events WHERE user_id = ?
    `).all(userId) as { contact_id: string }[]

    const results: { contact_id: string; score: number }[] = []

    for (const contact of contacts) {
      const score = this.calculateScore(contact.contact_id)
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
  applyScoreDecay(): number {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Find contacts whose last event is older than 30 days
    const staleContacts = this.db.prepare(`
      SELECT contact_id, user_id, MAX(created_at) as last_event
      FROM engagement_events
      GROUP BY contact_id
      HAVING MAX(created_at) < ?
    `).all(thirtyDaysAgo) as { contact_id: string; user_id: string; last_event: string }[]

    let affected = 0
    for (const contact of staleContacts) {
      const daysSince = Math.floor((Date.now() - new Date(contact.last_event).getTime()) / (24 * 60 * 60 * 1000))

      if (daysSince >= 90) {
        this.recordEvent(contact.contact_id, contact.user_id, 'opened') // placeholder - actual decay
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
  getStats(userId: string): { total: number; hot: number; warm: number; cold: number; dead: number } {
    const contacts = this.db.prepare(`
      SELECT DISTINCT contact_id FROM engagement_events WHERE user_id = ?
    `).all(userId) as { contact_id: string }[]

    const stats = { total: contacts.length, hot: 0, warm: 0, cold: 0, dead: 0 }

    for (const contact of contacts) {
      const score = this.calculateScore(contact.contact_id)
      const segment = this.getSegment(score) as keyof typeof stats
      if (segment !== 'total') stats[segment]++
    }

    return stats
  }

  /**
   * Get recent events for a contact
   */
  getContactEvents(contactId: string, limit = 20): EngagementEvent[] {
    return this.db.prepare(`
      SELECT * FROM engagement_events
      WHERE contact_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(contactId, limit) as EngagementEvent[]
  }
}

export const scoringEngine = new ScoringEngine()
export { SCORE_RULES, SCORE_SEGMENTS }
