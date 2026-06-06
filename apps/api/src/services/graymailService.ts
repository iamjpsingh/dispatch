// src/services/graymailService.ts - Graymail detection and suppression
// Auto-suppress contacts with no engagement (opens/clicks) after N consecutive sends.
// Default threshold: 11 sends without engagement (same as HubSpot).

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'

const DB_PATH = './data/queue.db'

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
  private db: Database

  constructor() {
    const dir = dirname(DB_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new Database(DB_PATH)
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graymail_tracker (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        sends_since_engagement INTEGER DEFAULT 0,
        last_sent_at TEXT,
        last_engaged_at TEXT,
        is_graymail INTEGER DEFAULT 0,
        UNIQUE(org_id, email)
      );

      CREATE INDEX IF NOT EXISTS idx_gm_org_email ON graymail_tracker(org_id, email);
      CREATE INDEX IF NOT EXISTS idx_gm_graymail ON graymail_tracker(is_graymail) WHERE is_graymail = 1;

      CREATE TABLE IF NOT EXISTS graymail_config (
        org_id TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 0,
        threshold INTEGER DEFAULT 11,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `)
  }

  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  getConfig(orgId: string): GraymailConfig {
    const row = this.db.prepare('SELECT * FROM graymail_config WHERE org_id = ?').get(orgId) as any
    if (!row) return { enabled: false, threshold: 11 }
    return { enabled: !!row.enabled, threshold: row.threshold }
  }

  setConfig(orgId: string, enabled: boolean, threshold: number): void {
    this.db.prepare(`
      INSERT INTO graymail_config (org_id, enabled, threshold, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(org_id) DO UPDATE SET enabled = ?, threshold = ?, updated_at = datetime('now')
    `).run(orgId, enabled ? 1 : 0, threshold, enabled ? 1 : 0, threshold)
  }

  // --------------------------------------------------------------------------
  // Tracking
  // --------------------------------------------------------------------------

  /**
   * Record that an email was sent to a contact.
   * Increments sends_since_engagement counter.
   */
  recordSend(orgId: string, email: string): void {
    this.db.prepare(`
      INSERT INTO graymail_tracker (org_id, email, sends_since_engagement, last_sent_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(org_id, email) DO UPDATE SET
        sends_since_engagement = sends_since_engagement + 1,
        last_sent_at = datetime('now')
    `).run(orgId, email)

    // Check if now graymail
    const config = this.getConfig(orgId)
    if (config.enabled) {
      const row = this.db.prepare(
        'SELECT sends_since_engagement FROM graymail_tracker WHERE org_id = ? AND email = ?'
      ).get(orgId, email) as any
      if (row && row.sends_since_engagement >= config.threshold) {
        this.db.prepare(
          'UPDATE graymail_tracker SET is_graymail = 1 WHERE org_id = ? AND email = ?'
        ).run(orgId, email)
      }
    }
  }

  /**
   * Record engagement (open or click). Resets the counter.
   */
  recordEngagement(orgId: string, email: string): void {
    this.db.prepare(`
      INSERT INTO graymail_tracker (org_id, email, sends_since_engagement, last_engaged_at, is_graymail)
      VALUES (?, ?, 0, datetime('now'), 0)
      ON CONFLICT(org_id, email) DO UPDATE SET
        sends_since_engagement = 0,
        last_engaged_at = datetime('now'),
        is_graymail = 0
    `).run(orgId, email)
  }

  // --------------------------------------------------------------------------
  // Checks
  // --------------------------------------------------------------------------

  /**
   * Check if a contact is graymail (should be suppressed).
   * If graymail is not enabled for the org, always returns false.
   */
  isGraymail(orgId: string, email: string): boolean {
    const config = this.getConfig(orgId)
    if (!config.enabled) return false

    const row = this.db.prepare(
      'SELECT is_graymail, sends_since_engagement FROM graymail_tracker WHERE org_id = ? AND email = ?'
    ).get(orgId, email) as any

    if (!row) return false
    return !!row.is_graymail || row.sends_since_engagement >= config.threshold
  }

  /**
   * Check if a contact can receive email (not graymail or graymail disabled).
   * exemptFromGraymail: campaign flag to bypass graymail suppression.
   */
  canSend(orgId: string, email: string, exemptFromGraymail = false): boolean {
    if (exemptFromGraymail) return true
    return !this.isGraymail(orgId, email)
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  getStats(orgId: string): GraymailStats {
    const total = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM graymail_tracker WHERE org_id = ?'
    ).get(orgId) as any)?.cnt || 0

    const graymail = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM graymail_tracker WHERE org_id = ? AND is_graymail = 1'
    ).get(orgId) as any)?.cnt || 0

    return {
      totalTracked: total,
      graymailCount: graymail,
      graymailPercentage: total > 0 ? Math.round((graymail / total) * 1000) / 10 : 0,
    }
  }

  /**
   * Get contacts approaching graymail threshold.
   */
  getAtRisk(orgId: string, limit = 50): { email: string; sendsSinceEngagement: number; lastEngagedAt: string | null }[] {
    const config = this.getConfig(orgId)
    const warningThreshold = Math.floor(config.threshold * 0.7)

    return this.db.prepare(`
      SELECT email, sends_since_engagement, last_engaged_at
      FROM graymail_tracker
      WHERE org_id = ? AND is_graymail = 0 AND sends_since_engagement >= ?
      ORDER BY sends_since_engagement DESC
      LIMIT ?
    `).all(orgId, warningThreshold, limit) as any[]
  }

  /**
   * Get graymail contacts.
   */
  getGraymailContacts(orgId: string, limit = 100, offset = 0): { email: string; sendsSinceEngagement: number; lastSentAt: string; lastEngagedAt: string | null }[] {
    return this.db.prepare(`
      SELECT email, sends_since_engagement, last_sent_at, last_engaged_at
      FROM graymail_tracker
      WHERE org_id = ? AND is_graymail = 1
      ORDER BY sends_since_engagement DESC
      LIMIT ? OFFSET ?
    `).all(orgId, limit, offset) as any[]
  }

  /**
   * Reset graymail status for a contact (manual re-engagement).
   */
  resetContact(orgId: string, email: string): void {
    this.db.prepare(`
      UPDATE graymail_tracker SET sends_since_engagement = 0, is_graymail = 0
      WHERE org_id = ? AND email = ?
    `).run(orgId, email)
  }
}

export const graymailService = new GraymailService()
