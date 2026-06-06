// src/services/preferenceCenterService.ts - Email preference management for contacts

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

const DB_PATH = './data/queue.db'

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
  private db: Database

  constructor() {
    const dir = dirname(DB_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new Database(DB_PATH)
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_preferences (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        preference TEXT NOT NULL DEFAULT 'subscribed'
          CHECK (preference IN ('subscribed', 'campaign_only', 'digest_weekly', 'digest_monthly', 'paused', 'unsubscribed')),
        pause_until TEXT,
        reason TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, email)
      );

      CREATE INDEX IF NOT EXISTS idx_pref_org_email ON email_preferences(org_id, email);
      CREATE INDEX IF NOT EXISTS idx_pref_preference ON email_preferences(preference);
    `)
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  getPreference(orgId: string, email: string): EmailPreference | null {
    return this.db.prepare('SELECT * FROM email_preferences WHERE org_id = ? AND email = ?')
      .get(orgId, email) as EmailPreference | null
  }

  getEffectivePreference(orgId: string, email: string): PreferenceType {
    const pref = this.getPreference(orgId, email)
    if (!pref) return 'subscribed'

    // If paused, check if pause has expired
    if (pref.preference === 'paused' && pref.pause_until) {
      if (new Date(pref.pause_until) < new Date()) {
        // Pause expired, revert to subscribed
        this.setPreference(orgId, email, 'subscribed')
        return 'subscribed'
      }
    }

    return pref.preference
  }

  /**
   * Check if an email should receive this type of message.
   * campaignType: 'marketing' | 'transactional'
   */
  canReceive(orgId: string, email: string, campaignType: 'marketing' | 'transactional' = 'marketing'): boolean {
    // Transactional emails always go through (password reset, etc.)
    if (campaignType === 'transactional') return true

    const pref = this.getEffectivePreference(orgId, email)

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

  setPreference(orgId: string, email: string, preference: PreferenceType, reason?: string, pauseDays?: number): void {
    const id = generateId('pref')
    const pauseUntil = preference === 'paused' && pauseDays
      ? new Date(Date.now() + pauseDays * 86400000).toISOString()
      : null

    this.db.prepare(`
      INSERT INTO email_preferences (id, org_id, email, preference, pause_until, reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(org_id, email) DO UPDATE SET
        preference = ?, pause_until = ?, reason = ?, updated_at = datetime('now')
    `).run(id, orgId, email, preference, pauseUntil, reason || null, preference, pauseUntil, reason || null)

    logger.info(`[Preferences] ${email} → ${preference}${reason ? ` (${reason})` : ''}`)
  }

  unsubscribe(orgId: string, email: string, reason?: string): void {
    this.setPreference(orgId, email, 'unsubscribed', reason)
  }

  resubscribe(orgId: string, email: string): void {
    this.setPreference(orgId, email, 'subscribed')
  }

  pause(orgId: string, email: string, days: number): void {
    this.setPreference(orgId, email, 'paused', undefined, days)
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  getStats(orgId: string): Record<PreferenceType, number> {
    const rows = this.db.prepare(`
      SELECT preference, COUNT(*) as count FROM email_preferences
      WHERE org_id = ? GROUP BY preference
    `).all(orgId) as { preference: PreferenceType; count: number }[]

    const stats: Record<string, number> = {
      subscribed: 0, campaign_only: 0, digest_weekly: 0,
      digest_monthly: 0, paused: 0, unsubscribed: 0,
    }
    for (const row of rows) {
      stats[row.preference] = row.count
    }
    return stats as Record<PreferenceType, number>
  }

  getUnsubscribedEmails(orgId: string): string[] {
    const rows = this.db.prepare(`
      SELECT email FROM email_preferences
      WHERE org_id = ? AND preference IN ('unsubscribed')
    `).all(orgId) as { email: string }[]
    return rows.map(r => r.email)
  }
}

export const preferenceCenterService = new PreferenceCenterService()
