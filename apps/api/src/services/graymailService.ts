// src/services/graymailService.ts - Graymail detection and suppression (Postgres/Drizzle, async)
// Auto-suppress contacts with no engagement (opens/clicks) after N consecutive sends.
// Default threshold: 11 sends without engagement (same as HubSpot).

import { and, eq, count, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { graymail_tracker, graymail_config } from '../db/pg/schema'

// ============================================================================
// Types
// ============================================================================

export interface GraymailConfig {
  enabled: boolean
  threshold: number // suppress after this many sends without engagement
}

export interface GraymailStats {
  totalTracked: number
  graymailCount: number
  graymailPercentage: number
}

// ============================================================================
// Graymail Service
// ============================================================================

class GraymailService {
  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  async getConfig(orgId: string): Promise<GraymailConfig> {
    const [row] = await getDb()
      .select()
      .from(graymail_config)
      .where(eq(graymail_config.org_id, orgId))
      .limit(1)
    if (!row) return { enabled: false, threshold: 11 }
    return { enabled: !!row.enabled, threshold: row.threshold }
  }

  async setConfig(orgId: string, enabled: boolean, threshold: number): Promise<void> {
    await getDb()
      .insert(graymail_config)
      .values({ org_id: orgId, enabled: enabled ? 1 : 0, threshold, updated_at: new Date().toISOString() })
      .onConflictDoUpdate({
        target: graymail_config.org_id,
        set: { enabled: enabled ? 1 : 0, threshold, updated_at: new Date().toISOString() },
      })
  }

  // --------------------------------------------------------------------------
  // Tracking
  // --------------------------------------------------------------------------

  /**
   * Record that an email was sent to a contact.
   * Increments sends_since_engagement counter.
   */
  async recordSend(orgId: string, email: string): Promise<void> {
    const db = getDb()
    await db
      .insert(graymail_tracker)
      .values({ org_id: orgId, email, sends_since_engagement: 1, last_sent_at: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [graymail_tracker.org_id, graymail_tracker.email],
        set: {
          sends_since_engagement: sql`${graymail_tracker.sends_since_engagement} + 1`,
          last_sent_at: new Date().toISOString(),
        },
      })

    // Check if now graymail
    const config = await this.getConfig(orgId)
    if (config.enabled) {
      const [row] = await db
        .select({ sends_since_engagement: graymail_tracker.sends_since_engagement })
        .from(graymail_tracker)
        .where(and(eq(graymail_tracker.org_id, orgId), eq(graymail_tracker.email, email)))
        .limit(1)
      if (row && row.sends_since_engagement >= config.threshold) {
        await db
          .update(graymail_tracker)
          .set({ is_graymail: 1 })
          .where(and(eq(graymail_tracker.org_id, orgId), eq(graymail_tracker.email, email)))
      }
    }
  }

  /**
   * Record engagement (open or click). Resets the counter.
   */
  async recordEngagement(orgId: string, email: string): Promise<void> {
    await getDb()
      .insert(graymail_tracker)
      .values({
        org_id: orgId,
        email,
        sends_since_engagement: 0,
        last_engaged_at: new Date().toISOString(),
        is_graymail: 0,
      })
      .onConflictDoUpdate({
        target: [graymail_tracker.org_id, graymail_tracker.email],
        set: {
          sends_since_engagement: 0,
          last_engaged_at: new Date().toISOString(),
          is_graymail: 0,
        },
      })
  }

  // --------------------------------------------------------------------------
  // Checks
  // --------------------------------------------------------------------------

  /**
   * Check if a contact is graymail (should be suppressed).
   * If graymail is not enabled for the org, always returns false.
   */
  async isGraymail(orgId: string, email: string): Promise<boolean> {
    const config = await this.getConfig(orgId)
    if (!config.enabled) return false

    const [row] = await getDb()
      .select({
        is_graymail: graymail_tracker.is_graymail,
        sends_since_engagement: graymail_tracker.sends_since_engagement,
      })
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, orgId), eq(graymail_tracker.email, email)))
      .limit(1)

    if (!row) return false
    return !!row.is_graymail || row.sends_since_engagement >= config.threshold
  }

  /**
   * Check if a contact can receive email (not graymail or graymail disabled).
   * exemptFromGraymail: campaign flag to bypass graymail suppression.
   */
  async canSend(orgId: string, email: string, exemptFromGraymail = false): Promise<boolean> {
    if (exemptFromGraymail) return true
    return !(await this.isGraymail(orgId, email))
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  async getStats(orgId: string): Promise<GraymailStats> {
    const db = getDb()

    const [tot] = await db
      .select({ value: count() })
      .from(graymail_tracker)
      .where(eq(graymail_tracker.org_id, orgId))
    const total = tot?.value ?? 0

    const [gm] = await db
      .select({ value: count() })
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, orgId), eq(graymail_tracker.is_graymail, 1)))
    const graymail = gm?.value ?? 0

    return {
      totalTracked: total,
      graymailCount: graymail,
      graymailPercentage: total > 0 ? Math.round((graymail / total) * 1000) / 10 : 0,
    }
  }

  /**
   * Get contacts approaching graymail threshold.
   */
  async getAtRisk(
    orgId: string,
    limit = 50
  ): Promise<{ email: string; sends_since_engagement: number; last_engaged_at: string | null }[]> {
    const config = await this.getConfig(orgId)
    const warningThreshold = Math.floor(config.threshold * 0.7)

    return getDb()
      .select({
        email: graymail_tracker.email,
        sends_since_engagement: graymail_tracker.sends_since_engagement,
        last_engaged_at: graymail_tracker.last_engaged_at,
      })
      .from(graymail_tracker)
      .where(
        and(
          eq(graymail_tracker.org_id, orgId),
          eq(graymail_tracker.is_graymail, 0),
          sql`${graymail_tracker.sends_since_engagement} >= ${warningThreshold}`
        )
      )
      .orderBy(sql`${graymail_tracker.sends_since_engagement} desc`)
      .limit(limit)
  }

  /**
   * Get graymail contacts.
   */
  async getGraymailContacts(
    orgId: string,
    limit = 100,
    offset = 0
  ): Promise<{ email: string; sends_since_engagement: number; last_sent_at: string | null; last_engaged_at: string | null }[]> {
    return getDb()
      .select({
        email: graymail_tracker.email,
        sends_since_engagement: graymail_tracker.sends_since_engagement,
        last_sent_at: graymail_tracker.last_sent_at,
        last_engaged_at: graymail_tracker.last_engaged_at,
      })
      .from(graymail_tracker)
      .where(and(eq(graymail_tracker.org_id, orgId), eq(graymail_tracker.is_graymail, 1)))
      .orderBy(sql`${graymail_tracker.sends_since_engagement} desc`)
      .limit(limit)
      .offset(offset)
  }

  /**
   * Reset graymail status for a contact (manual re-engagement).
   */
  async resetContact(orgId: string, email: string): Promise<void> {
    await getDb()
      .update(graymail_tracker)
      .set({ sends_since_engagement: 0, is_graymail: 0 })
      .where(and(eq(graymail_tracker.org_id, orgId), eq(graymail_tracker.email, email)))
  }
}

export const graymailService = new GraymailService()
