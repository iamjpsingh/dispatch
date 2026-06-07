// src/services/preferenceCenterService.ts - Email preference management for contacts
// (Postgres/Drizzle, async)

import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { email_preferences } from '../db/pg/schema'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export type PreferenceType = 'subscribed' | 'campaign_only' | 'digest_weekly' | 'digest_monthly' | 'paused' | 'unsubscribed'

export interface EmailPreference {
  id: string
  org_id: string
  email: string
  preference: PreferenceType
  pause_until: string | null
  reason: string | null
  updated_at: string
}

// ============================================================================
// Preference Center Service
// ============================================================================

class PreferenceCenterService {
  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  async getPreference(orgId: string, email: string): Promise<EmailPreference | null> {
    const [row] = await getDb()
      .select({
        id: email_preferences.id,
        org_id: email_preferences.org_id,
        email: email_preferences.email,
        preference: email_preferences.preference,
        pause_until: email_preferences.pause_until,
        reason: email_preferences.reason,
        updated_at: email_preferences.updated_at,
      })
      .from(email_preferences)
      .where(and(eq(email_preferences.org_id, orgId), eq(email_preferences.email, email)))
      .limit(1)
    return (row as EmailPreference) ?? null
  }

  async getEffectivePreference(orgId: string, email: string): Promise<PreferenceType> {
    const pref = await this.getPreference(orgId, email)
    if (!pref) return 'subscribed'

    // If paused, check if pause has expired
    if (pref.preference === 'paused' && pref.pause_until) {
      if (new Date(pref.pause_until) < new Date()) {
        // Pause expired, revert to subscribed
        await this.setPreference(orgId, email, 'subscribed')
        return 'subscribed'
      }
    }

    return pref.preference
  }

  /**
   * Check if an email should receive this type of message.
   * campaignType: 'marketing' | 'transactional'
   */
  async canReceive(orgId: string, email: string, campaignType: 'marketing' | 'transactional' = 'marketing'): Promise<boolean> {
    // Transactional emails always go through (password reset, etc.)
    if (campaignType === 'transactional') return true

    const pref = await this.getEffectivePreference(orgId, email)

    switch (pref) {
      case 'subscribed': return true
      case 'campaign_only': return true
      case 'digest_weekly': return false // should be batched, not individual
      case 'digest_monthly': return false // should be batched, not individual
      case 'paused': return false
      case 'unsubscribed': return false
      default: return true
    }
  }

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  async setPreference(orgId: string, email: string, preference: PreferenceType, reason?: string, pauseDays?: number): Promise<void> {
    const id = generateId('pref')
    const pauseUntil = preference === 'paused' && pauseDays
      ? new Date(Date.now() + pauseDays * 86400000).toISOString()
      : null
    const now = new Date().toISOString()

    await getDb()
      .insert(email_preferences)
      .values({
        id,
        org_id: orgId,
        email,
        preference,
        pause_until: pauseUntil,
        reason: reason || null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [email_preferences.org_id, email_preferences.email],
        set: {
          preference,
          pause_until: pauseUntil,
          reason: reason || null,
          updated_at: now,
        },
      })

    logger.info(`[Preferences] ${email} → ${preference}${reason ? ` (${reason})` : ''}`)
  }

  async unsubscribe(orgId: string, email: string, reason?: string): Promise<void> {
    await this.setPreference(orgId, email, 'unsubscribed', reason)
  }

  async resubscribe(orgId: string, email: string): Promise<void> {
    await this.setPreference(orgId, email, 'subscribed')
  }

  async pause(orgId: string, email: string, days: number): Promise<void> {
    await this.setPreference(orgId, email, 'paused', undefined, days)
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  async getStats(orgId: string): Promise<Record<PreferenceType, number>> {
    const rows = await getDb()
      .select({
        preference: email_preferences.preference,
        count: sql<number>`count(*)::int`,
      })
      .from(email_preferences)
      .where(eq(email_preferences.org_id, orgId))
      .groupBy(email_preferences.preference)

    const stats: Record<string, number> = {
      subscribed: 0, campaign_only: 0, digest_weekly: 0,
      digest_monthly: 0, paused: 0, unsubscribed: 0,
    }
    for (const row of rows) {
      stats[row.preference] = row.count
    }
    return stats as Record<PreferenceType, number>
  }

  async getUnsubscribedEmails(orgId: string): Promise<string[]> {
    const rows = await getDb()
      .select({ email: email_preferences.email })
      .from(email_preferences)
      .where(and(eq(email_preferences.org_id, orgId), inArray(email_preferences.preference, ['unsubscribed'])))
    return rows.map((r) => r.email)
  }
}

export const preferenceCenterService = new PreferenceCenterService()
