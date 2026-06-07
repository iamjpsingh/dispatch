// src/services/frequencyCapService.ts - Frequency capping to limit emails per contact per window (Postgres/Drizzle, async)

import { and, eq, gt, lt, count } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { frequency_log, frequency_config } from '../db/pg/schema'
import { logger } from '../utils/logger'

// ============================================================================
// Frequency Cap Service
// ============================================================================

class FrequencyCapService {
  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  async getConfig(orgId: string): Promise<{ maxPerWindow: number; windowHours: number; enabled: boolean }> {
    const [row] = await getDb().select().from(frequency_config).where(eq(frequency_config.org_id, orgId)).limit(1)
    if (!row) return { maxPerWindow: 5, windowHours: 168, enabled: false }
    return { maxPerWindow: row.max_per_window, windowHours: row.window_hours, enabled: !!row.enabled }
  }

  async setConfig(orgId: string, maxPerWindow: number, windowHours: number, enabled: boolean): Promise<void> {
    const now = new Date().toISOString()
    await getDb()
      .insert(frequency_config)
      .values({ org_id: orgId, max_per_window: maxPerWindow, window_hours: windowHours, enabled: enabled ? 1 : 0, updated_at: now })
      .onConflictDoUpdate({
        target: frequency_config.org_id,
        set: { max_per_window: maxPerWindow, window_hours: windowHours, enabled: enabled ? 1 : 0, updated_at: now },
      })
  }

  // --------------------------------------------------------------------------
  // Check & Log
  // --------------------------------------------------------------------------

  /**
   * Check if a contact can receive another email within the frequency window.
   * Returns true if the contact is under the cap, false if they should be skipped.
   */
  async canSend(orgId: string, email: string): Promise<boolean> {
    const config = await this.getConfig(orgId)
    if (!config.enabled) return true

    const cnt = await this.countInWindow(orgId, email, config.windowHours)
    return cnt < config.maxPerWindow
  }

  /**
   * Get how many emails a contact has received in the current window.
   */
  async getCount(orgId: string, email: string): Promise<number> {
    const config = await this.getConfig(orgId)
    return this.countInWindow(orgId, email, config.windowHours)
  }

  /**
   * Log that an email was sent to a contact. Call this after successfully sending.
   */
  async logSend(orgId: string, email: string, campaignId?: string): Promise<void> {
    await getDb().insert(frequency_log).values({ org_id: orgId, email, campaign_id: campaignId || null })
  }

  /**
   * Bulk check: given a list of emails, return which ones can be sent to.
   */
  async filterAllowed(orgId: string, emails: string[]): Promise<{ allowed: string[]; capped: string[] }> {
    const config = await this.getConfig(orgId)
    if (!config.enabled) return { allowed: emails, capped: [] }

    const allowed: string[] = []
    const capped: string[] = []

    for (const email of emails) {
      const cnt = await this.countInWindow(orgId, email, config.windowHours)
      if (cnt < config.maxPerWindow) {
        allowed.push(email)
      } else {
        capped.push(email)
      }
    }

    return { allowed, capped }
  }

  /**
   * Cleanup old frequency log entries (older than 30 days).
   */
  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const res = await getDb().delete(frequency_log).where(lt(frequency_log.sent_at, cutoff)).returning({ id: frequency_log.id })
    if (res.length > 0) {
      logger.info(`[FreqCap] Cleaned up ${res.length} old frequency log entries`)
    }
    return res.length
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /** COUNT(*) of org+email rows whose sent_at falls within the last `windowHours`. */
  private async countInWindow(orgId: string, email: string, windowHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
    const [c] = await getDb()
      .select({ value: count() })
      .from(frequency_log)
      .where(and(eq(frequency_log.org_id, orgId), eq(frequency_log.email, email), gt(frequency_log.sent_at, cutoff)))
    return c?.value ?? 0
  }
}

export const frequencyCapService = new FrequencyCapService()
