// src/services/frequencyCapService.ts - Frequency capping to limit emails per contact per window

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'

const DB_PATH = './data/queue.db'

// ============================================================================
// Frequency Cap Service
// ============================================================================

class FrequencyCapService {
  private db: Database

  constructor() {
    const dir = dirname(DB_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new Database(DB_PATH)
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS frequency_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        campaign_id TEXT,
        sent_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_freq_org_email ON frequency_log(org_id, email);
      CREATE INDEX IF NOT EXISTS idx_freq_sent ON frequency_log(sent_at);

      CREATE TABLE IF NOT EXISTS frequency_config (
        org_id TEXT PRIMARY KEY,
        max_per_window INTEGER DEFAULT 5,
        window_hours INTEGER DEFAULT 168,
        enabled INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `)
  }

  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  getConfig(orgId: string): { maxPerWindow: number; windowHours: number; enabled: boolean } {
    const row = this.db.prepare('SELECT * FROM frequency_config WHERE org_id = ?').get(orgId) as any
    if (!row) return { maxPerWindow: 5, windowHours: 168, enabled: false }
    return { maxPerWindow: row.max_per_window, windowHours: row.window_hours, enabled: !!row.enabled }
  }

  setConfig(orgId: string, maxPerWindow: number, windowHours: number, enabled: boolean): void {
    this.db.prepare(`
      INSERT INTO frequency_config (org_id, max_per_window, window_hours, enabled, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(org_id) DO UPDATE SET max_per_window = ?, window_hours = ?, enabled = ?, updated_at = datetime('now')
    `).run(orgId, maxPerWindow, windowHours, enabled ? 1 : 0, maxPerWindow, windowHours, enabled ? 1 : 0)
  }

  // --------------------------------------------------------------------------
  // Check & Log
  // --------------------------------------------------------------------------

  /**
   * Check if a contact can receive another email within the frequency window.
   * Returns true if the contact is under the cap, false if they should be skipped.
   */
  canSend(orgId: string, email: string): boolean {
    const config = this.getConfig(orgId)
    if (!config.enabled) return true

    const count = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM frequency_log
      WHERE org_id = ? AND email = ? AND sent_at > datetime('now', ?)
    `).get(orgId, email, `-${config.windowHours} hours`) as { cnt: number }

    return count.cnt < config.maxPerWindow
  }

  /**
   * Get how many emails a contact has received in the current window.
   */
  getCount(orgId: string, email: string): number {
    const config = this.getConfig(orgId)
    const count = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM frequency_log
      WHERE org_id = ? AND email = ? AND sent_at > datetime('now', ?)
    `).get(orgId, email, `-${config.windowHours} hours`) as { cnt: number }
    return count.cnt
  }

  /**
   * Log that an email was sent to a contact. Call this after successfully sending.
   */
  logSend(orgId: string, email: string, campaignId?: string): void {
    this.db.prepare(`
      INSERT INTO frequency_log (org_id, email, campaign_id) VALUES (?, ?, ?)
    `).run(orgId, email, campaignId || null)
  }

  /**
   * Bulk check: given a list of emails, return which ones can be sent to.
   */
  filterAllowed(orgId: string, emails: string[]): { allowed: string[]; capped: string[] } {
    const config = this.getConfig(orgId)
    if (!config.enabled) return { allowed: emails, capped: [] }

    const allowed: string[] = []
    const capped: string[] = []

    for (const email of emails) {
      if (this.canSend(orgId, email)) {
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
  cleanup(): number {
    const result = this.db.prepare(`
      DELETE FROM frequency_log WHERE sent_at < datetime('now', '-30 days')
    `).run()
    if (result.changes > 0) {
      logger.info(`[FreqCap] Cleaned up ${result.changes} old frequency log entries`)
    }
    return result.changes
  }
}

export const frequencyCapService = new FrequencyCapService()
