// src/services/campaignService.ts - Campaign Lifecycle Management

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { eventBus } from './eventBus'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export type CampaignType = 'one_time' | 'recurring' | 'ab_test' | 'automation'
export type CampaignLifecycleStatus = 'draft' | 'testing' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'cancelled' | 'archived'

export interface CampaignRecord {
  id: string
  org_id: string
  user_id: string
  name: string
  type: CampaignType
  status: CampaignLifecycleStatus
  template_id: string | null
  list_id: string | null
  segment_id: string | null
  subject: string
  from_name: string
  from_email: string
  reply_to: string | null
  tags: string // JSON array
  folder: string | null
  draft_data: string | null // JSON
  ab_config: string | null // JSON
  batch_size: number
  email_delay: number
  batch_delay: number
  total_recipients: number
  sent_count: number
  failed_count: number
  open_count: number
  click_count: number
  bounce_count: number
  unsubscribe_count: number
  job_id: string | null
  scheduled_at: string | null
  sent_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface CampaignInput {
  name: string
  type?: CampaignType
  template_id?: string
  list_id?: string
  segment_id?: string
  subject: string
  from_name: string
  from_email: string
  reply_to?: string
  tags?: string[]
  folder?: string
  batch_size?: number
  email_delay?: number
  batch_delay?: number
}

export interface CampaignFilters {
  status?: CampaignLifecycleStatus
  type?: CampaignType
  folder?: string
  search?: string
  page?: number
  limit?: number
}

export interface ABVariant {
  id: string
  campaign_id: string
  variant_label: string
  subject: string | null
  template_id: string | null
  sender_name: string | null
  sender_email: string | null
  percentage: number
  sent_count: number
  open_count: number
  click_count: number
  is_winner: number
  created_at: string
}

// ============================================================================
// Service
// ============================================================================

class CampaignService {
  private db: Database

  constructor() {
    const dbPath = './data/campaigns.db'
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'one_time' CHECK (type IN ('one_time', 'recurring', 'ab_test', 'automation')),
        status TEXT DEFAULT 'draft' CHECK (status IN (
          'draft', 'testing', 'scheduled', 'sending', 'paused', 'completed', 'cancelled', 'archived'
        )),
        template_id TEXT,
        list_id TEXT,
        segment_id TEXT,
        subject TEXT NOT NULL,
        from_name TEXT NOT NULL,
        from_email TEXT NOT NULL,
        reply_to TEXT,
        tags TEXT DEFAULT '[]',
        folder TEXT,
        draft_data TEXT,
        ab_config TEXT,
        batch_size INTEGER DEFAULT 20,
        email_delay INTEGER DEFAULT 45,
        batch_delay INTEGER DEFAULT 60,
        total_recipients INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        bounce_count INTEGER DEFAULT 0,
        unsubscribe_count INTEGER DEFAULT 0,
        job_id TEXT,
        scheduled_at TEXT,
        sent_at TEXT,
        completed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_camp_user ON campaigns(user_id);
      CREATE INDEX IF NOT EXISTS idx_camp_status ON campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_camp_type ON campaigns(type);
      CREATE INDEX IF NOT EXISTS idx_camp_scheduled ON campaigns(scheduled_at) WHERE status = 'scheduled';

      CREATE TABLE IF NOT EXISTS ab_variants (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        variant_label TEXT NOT NULL,
        subject TEXT,
        template_id TEXT,
        sender_name TEXT,
        sender_email TEXT,
        percentage INTEGER NOT NULL,
        sent_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        is_winner INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ab_campaign ON ab_variants(campaign_id);
    `)

    // Add columns to existing tables (idempotent)
    try { this.db.exec('ALTER TABLE campaigns ADD COLUMN org_id TEXT') } catch {}
    try { this.db.exec('ALTER TABLE campaigns ADD COLUMN rotation_config TEXT') } catch {}
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_camp_org ON campaigns(org_id)')

    logger.info('Campaigns database initialized (data/campaigns.db)')
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, input: CampaignInput): CampaignRecord {
    const id = generateId('camp')

    this.db.prepare(`
      INSERT INTO campaigns (id, org_id, user_id, name, type, subject, from_name, from_email, reply_to, template_id, list_id, segment_id, tags, folder, batch_size, email_delay, batch_delay)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId, input.name,
      input.type || 'one_time',
      input.subject, input.from_name, input.from_email,
      input.reply_to || null,
      input.template_id || null,
      input.list_id || null,
      input.segment_id || null,
      JSON.stringify(input.tags || []),
      input.folder || null,
      input.batch_size || 20,
      input.email_delay || 45,
      input.batch_delay || 60
    )

    return this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRecord
  }

  get(orgId: string, campaignId: string): CampaignRecord | null {
    return this.db.prepare(`
      SELECT * FROM campaigns WHERE id = ? AND org_id = ?
    `).get(campaignId, orgId) as CampaignRecord | null
  }

  update(orgId: string, campaignId: string, updates: Partial<CampaignInput>): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.type !== undefined) { sets.push('type = ?'); params.push(updates.type) }
    if (updates.subject !== undefined) { sets.push('subject = ?'); params.push(updates.subject) }
    if (updates.from_name !== undefined) { sets.push('from_name = ?'); params.push(updates.from_name) }
    if (updates.from_email !== undefined) { sets.push('from_email = ?'); params.push(updates.from_email) }
    if (updates.reply_to !== undefined) { sets.push('reply_to = ?'); params.push(updates.reply_to) }
    if (updates.template_id !== undefined) { sets.push('template_id = ?'); params.push(updates.template_id) }
    if (updates.list_id !== undefined) { sets.push('list_id = ?'); params.push(updates.list_id) }
    if (updates.segment_id !== undefined) { sets.push('segment_id = ?'); params.push(updates.segment_id) }
    if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)) }
    if (updates.folder !== undefined) { sets.push('folder = ?'); params.push(updates.folder) }
    if (updates.batch_size !== undefined) { sets.push('batch_size = ?'); params.push(updates.batch_size) }
    if (updates.email_delay !== undefined) { sets.push('email_delay = ?'); params.push(updates.email_delay) }
    if (updates.batch_delay !== undefined) { sets.push('batch_delay = ?'); params.push(updates.batch_delay) }
    if ((updates as any).ab_config !== undefined) { sets.push('ab_config = ?'); params.push((updates as any).ab_config) }
    if ((updates as any).rotation_config !== undefined) { sets.push('rotation_config = ?'); params.push((updates as any).rotation_config) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(campaignId, orgId)

    const result = this.db.prepare(`
      UPDATE campaigns SET ${sets.join(', ')} WHERE id = ? AND org_id = ? AND status IN ('draft', 'testing')
    `).run(...params)

    return result.changes > 0
  }

  delete(orgId: string, campaignId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM campaigns WHERE id = ? AND org_id = ? AND status IN ('draft', 'cancelled', 'archived')
    `).run(campaignId, orgId)
    return result.changes > 0
  }

  list(orgId: string, filters: CampaignFilters = {}): { campaigns: CampaignRecord[]; total: number } {
    const page = filters.page || 1
    const limit = Math.min(filters.limit || 20, 100)
    const offset = (page - 1) * limit

    const conditions: string[] = ['org_id = ?']
    const params: any[] = [orgId]

    if (filters.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    }
    if (filters.type) {
      conditions.push('type = ?')
      params.push(filters.type)
    }
    if (filters.folder) {
      conditions.push('folder = ?')
      params.push(filters.folder)
    }
    if (filters.search) {
      conditions.push('(name LIKE ? OR subject LIKE ?)')
      const q = `%${filters.search}%`
      params.push(q, q)
    }

    const where = conditions.join(' AND ')

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM campaigns WHERE ${where}`).get(...params) as any).count

    const campaigns = this.db.prepare(`
      SELECT * FROM campaigns WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as CampaignRecord[]

    return { campaigns, total }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  saveDraft(orgId: string, campaignId: string, draftData: unknown): boolean {
    const result = this.db.prepare(`
      UPDATE campaigns SET draft_data = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?
    `).run(JSON.stringify(draftData), campaignId, orgId)
    return result.changes > 0
  }

  setStatus(orgId: string, campaignId: string, status: CampaignLifecycleStatus): boolean {
    const extra: string[] = []
    if (status === 'sending') extra.push("sent_at = datetime('now')")
    if (status === 'completed') extra.push("completed_at = datetime('now')")

    const setClause = [`status = ?`, "updated_at = datetime('now')", ...extra].join(', ')

    const result = this.db.prepare(`
      UPDATE campaigns SET ${setClause} WHERE id = ? AND org_id = ?
    `).run(status, campaignId, orgId)

    if (result.changes > 0) {
      if (status === 'sending') eventBus.emit('campaign_launched', orgId, { campaignId })
      if (status === 'completed') eventBus.emit('campaign_completed', orgId, { campaignId })
    }

    return result.changes > 0
  }

  schedule(orgId: string, campaignId: string, scheduledAt: string): boolean {
    const result = this.db.prepare(`
      UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND status IN ('draft', 'testing')
    `).run(scheduledAt, campaignId, orgId)
    return result.changes > 0
  }

  clone(orgId: string, userId: string, campaignId: string): CampaignRecord | null {
    const original = this.get(orgId, campaignId)
    if (!original) return null

    return this.create(orgId, userId, {
      name: `${original.name} (Copy)`,
      type: original.type,
      subject: original.subject,
      from_name: original.from_name,
      from_email: original.from_email,
      reply_to: original.reply_to || undefined,
      template_id: original.template_id || undefined,
      list_id: original.list_id || undefined,
      tags: JSON.parse(original.tags || '[]'),
      folder: original.folder || undefined,
      batch_size: original.batch_size,
      email_delay: original.email_delay,
      batch_delay: original.batch_delay,
    })
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  updateStats(campaignId: string, field: 'sent_count' | 'failed_count' | 'open_count' | 'click_count' | 'bounce_count' | 'unsubscribe_count', increment = 1): void {
    this.db.prepare(`
      UPDATE campaigns SET ${field} = ${field} + ?, updated_at = datetime('now') WHERE id = ?
    `).run(increment, campaignId)
  }

  setTotalRecipients(campaignId: string, total: number): void {
    this.db.prepare(`
      UPDATE campaigns SET total_recipients = ?, updated_at = datetime('now') WHERE id = ?
    `).run(total, campaignId)
  }

  setJobId(campaignId: string, jobId: string): void {
    this.db.prepare(`
      UPDATE campaigns SET job_id = ?, updated_at = datetime('now') WHERE id = ?
    `).run(jobId, campaignId)
  }

  getStats(orgId: string, campaignId: string): CampaignRecord | null {
    return this.get(orgId, campaignId)
  }

  // --------------------------------------------------------------------------
  // A/B Testing
  // --------------------------------------------------------------------------

  createABVariant(campaignId: string, label: string, percentage: number, opts: { subject?: string; templateId?: string; senderName?: string; senderEmail?: string } = {}): ABVariant {
    const id = generateId('var')

    this.db.prepare(`
      INSERT INTO ab_variants (id, campaign_id, variant_label, subject, template_id, sender_name, sender_email, percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, campaignId, label, opts.subject || null, opts.templateId || null, opts.senderName || null, opts.senderEmail || null, percentage)

    return this.db.prepare('SELECT * FROM ab_variants WHERE id = ?').get(id) as ABVariant
  }

  getABVariants(campaignId: string): ABVariant[] {
    return this.db.prepare(`
      SELECT * FROM ab_variants WHERE campaign_id = ? ORDER BY variant_label
    `).all(campaignId) as ABVariant[]
  }

  declareWinner(campaignId: string, variantId: string): boolean {
    this.db.prepare(`UPDATE ab_variants SET is_winner = 0 WHERE campaign_id = ?`).run(campaignId)
    const result = this.db.prepare(`UPDATE ab_variants SET is_winner = 1 WHERE id = ? AND campaign_id = ?`).run(variantId, campaignId)
    return result.changes > 0
  }

  /**
   * Get dashboard overview for campaigns
   */
  getDashboardStats(orgId: string): { total: number; drafts: number; sending: number; completed: number; scheduled: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
      FROM campaigns WHERE org_id = ?
    `).get(orgId) as any

    return {
      total: row.total || 0,
      drafts: row.drafts || 0,
      sending: row.sending || 0,
      completed: row.completed || 0,
      scheduled: row.scheduled || 0,
    }
  }
}

export const campaignService = new CampaignService()
