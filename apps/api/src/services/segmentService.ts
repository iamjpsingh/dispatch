// src/services/segmentService.ts - Contact Segmentation (Static & Dynamic)

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface Segment {
  id: string
  org_id: string
  user_id: string
  name: string
  description: string | null
  type: 'static' | 'dynamic'
  rules_json: string | null // JSON: for dynamic segments
  contact_count: number
  last_calculated_at: string | null
  created_at: string
  updated_at: string
}

export interface SegmentInput {
  name: string
  description?: string
  type?: 'static' | 'dynamic'
  rules?: SegmentRules
}

export interface SegmentRules {
  operator: 'AND' | 'OR'
  conditions: SegmentCondition[]
}

export type SegmentCondition =
  | { field: 'tag'; operator: 'contains' | 'not_contains'; value: string }
  | { field: 'score'; operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte'; value: number }
  | { field: 'status'; operator: 'eq' | 'neq'; value: string }
  | { field: 'list'; operator: 'in' | 'not_in'; value: string }
  | { field: 'created_after'; operator: 'gt'; value: string }
  | { field: 'custom_field'; key: string; operator: 'eq' | 'contains'; value: string }
  | { field: 'last_engaged'; operator: 'gt' | 'lt'; value: string }

// ============================================================================
// Service
// ============================================================================

class SegmentService {
  private db: Database

  constructor() {
    const dbPath = './data/segments.db'
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
      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'dynamic' CHECK (type IN ('static', 'dynamic')),
        rules_json TEXT,
        contact_count INTEGER DEFAULT 0,
        last_calculated_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_seg_user ON segments(user_id);
      CREATE INDEX IF NOT EXISTS idx_seg_type ON segments(type);

      CREATE TABLE IF NOT EXISTS segment_contacts (
        segment_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        added_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (segment_id, contact_id),
        FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sc_segment ON segment_contacts(segment_id);
      CREATE INDEX IF NOT EXISTS idx_sc_contact ON segment_contacts(contact_id);
    `)

    // Add org_id to existing tables (idempotent)
    try { this.db.exec('ALTER TABLE segments ADD COLUMN org_id TEXT') } catch {}
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_seg_org ON segments(org_id)')

    logger.info('Segments database initialized (data/segments.db)')
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, input: SegmentInput): Segment {
    const id = generateId('seg')

    this.db.prepare(`
      INSERT INTO segments (id, org_id, user_id, name, description, type, rules_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId, input.name,
      input.description || null,
      input.type || 'dynamic',
      input.rules ? JSON.stringify(input.rules) : null
    )

    return this.db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Segment
  }

  get(orgId: string, segmentId: string): Segment | null {
    return this.db.prepare(`
      SELECT * FROM segments WHERE id = ? AND org_id = ?
    `).get(segmentId, orgId) as Segment | null
  }

  update(orgId: string, segmentId: string, updates: Partial<SegmentInput>): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description) }
    if (updates.type !== undefined) { sets.push('type = ?'); params.push(updates.type) }
    if (updates.rules !== undefined) { sets.push('rules_json = ?'); params.push(JSON.stringify(updates.rules)) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(segmentId, orgId)

    const result = this.db.prepare(`
      UPDATE segments SET ${sets.join(', ')} WHERE id = ? AND org_id = ?
    `).run(...params)

    return result.changes > 0
  }

  delete(orgId: string, segmentId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM segments WHERE id = ? AND org_id = ?
    `).run(segmentId, orgId)
    return result.changes > 0
  }

  list(orgId: string): Segment[] {
    return this.db.prepare(`
      SELECT * FROM segments WHERE org_id = ? ORDER BY updated_at DESC
    `).all(orgId) as Segment[]
  }

  // --------------------------------------------------------------------------
  // Static Segment Members
  // --------------------------------------------------------------------------

  addContacts(segmentId: string, contactIds: string[]): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO segment_contacts (segment_id, contact_id) VALUES (?, ?)
    `)

    let added = 0
    const transaction = this.db.transaction(() => {
      for (const contactId of contactIds) {
        const result = stmt.run(segmentId, contactId)
        if (result.changes > 0) added++
      }
    })

    transaction()
    this.updateContactCount(segmentId)
    return added
  }

  removeContacts(segmentId: string, contactIds: string[]): number {
    const placeholders = contactIds.map(() => '?').join(',')
    const result = this.db.prepare(`
      DELETE FROM segment_contacts WHERE segment_id = ? AND contact_id IN (${placeholders})
    `).run(segmentId, ...contactIds)

    this.updateContactCount(segmentId)
    return result.changes
  }

  getStaticMembers(segmentId: string, limit = 100, offset = 0): string[] {
    const rows = this.db.prepare(`
      SELECT contact_id FROM segment_contacts WHERE segment_id = ? LIMIT ? OFFSET ?
    `).all(segmentId, limit, offset) as { contact_id: string }[]

    return rows.map(r => r.contact_id)
  }

  private updateContactCount(segmentId: string) {
    this.db.prepare(`
      UPDATE segments SET contact_count = (
        SELECT COUNT(*) FROM segment_contacts WHERE segment_id = ?
      ), last_calculated_at = datetime('now') WHERE id = ?
    `).run(segmentId, segmentId)
  }

  // --------------------------------------------------------------------------
  // Dynamic Segment Query Builder
  // --------------------------------------------------------------------------

  /**
   * Build SQL WHERE clause from segment rules
   * Returns { sql, params } to be used with contacts table query
   */
  buildQuery(rules: SegmentRules): { sql: string; params: any[] } {
    if (!rules.conditions || rules.conditions.length === 0) {
      return { sql: '1=1', params: [] }
    }

    const clauses: { sql: string; params: any[] }[] = []

    for (const condition of rules.conditions) {
      clauses.push(this.conditionToSQL(condition))
    }

    const joiner = rules.operator === 'AND' ? ' AND ' : ' OR '

    return {
      sql: `(${clauses.map(c => c.sql).join(joiner)})`,
      params: clauses.flatMap(c => c.params),
    }
  }

  private conditionToSQL(condition: SegmentCondition): { sql: string; params: any[] } {
    switch (condition.field) {
      case 'tag':
        if (condition.operator === 'contains') {
          return { sql: `tags LIKE ?`, params: [`%"${condition.value}"%`] }
        }
        return { sql: `tags NOT LIKE ?`, params: [`%"${condition.value}"%`] }

      case 'score': {
        const op = { gt: '>', lt: '<', eq: '=', gte: '>=', lte: '<=' }[condition.operator]
        return { sql: `engagement_score ${op} ?`, params: [condition.value] }
      }

      case 'status':
        if (condition.operator === 'eq') {
          return { sql: `status = ?`, params: [condition.value] }
        }
        return { sql: `status != ?`, params: [condition.value] }

      case 'list':
        if (condition.operator === 'in') {
          return { sql: `list_id = ?`, params: [condition.value] }
        }
        return { sql: `list_id != ?`, params: [condition.value] }

      case 'created_after':
        return { sql: `created_at > ?`, params: [condition.value] }

      case 'custom_field':
        if (condition.operator === 'eq') {
          return { sql: `json_extract(custom_fields, ?) = ?`, params: [`$.${condition.key}`, condition.value] }
        }
        return { sql: `json_extract(custom_fields, ?) LIKE ?`, params: [`$.${condition.key}`, `%${condition.value}%`] }

      case 'last_engaged': {
        // This would reference scoring/engagement data
        // For now, approximate with updated_at
        const op = condition.operator === 'gt' ? '>' : '<'
        return { sql: `updated_at ${op} ?`, params: [condition.value] }
      }

      default:
        return { sql: '1=1', params: [] }
    }
  }

  /**
   * Preview dynamic segment size (estimate contact count)
   */
  previewCount(rules: SegmentRules): number {
    const { sql, params } = this.buildQuery(rules)
    // Note: This queries against the contacts.db, not segments.db
    // In practice, the caller should use this SQL against the contacts database
    // For now return 0 - actual count requires cross-db query
    return 0
  }
}

export const segmentService = new SegmentService()
