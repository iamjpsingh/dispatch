// src/services/contactService.ts - Contact Management with Local SQLite

import Database from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../utils/logger';
import { generateId } from '../utils/id';

// ============================================================================
// Types
// ============================================================================

export interface ContactList {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  description: string | null;
  contact_count: number;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  org_id: string;
  user_id: string;
  list_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  tags: string; // JSON array
  custom_fields: string; // JSON object
  status: 'active' | 'unsubscribed' | 'bounced' | 'complained';
  engagement_score: number;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  tags?: string[];
  custom_fields?: Record<string, string>;
  status?: string;
  source?: string;
}

export interface ContactFilters {
  search?: string;
  status?: string;
  tags?: string[];
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  invalid: number;
  errors: { row: number; email: string; reason: string }[];
}

export interface ImportHistory {
  id: string;
  org_id: string;
  user_id: string;
  list_id: string;
  filename: string;
  format: string;
  total_rows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  field_mapping: string | null;
  created_at: string;
}

// Whitelist of allowed sort columns to prevent SQL injection
const ALLOWED_SORT_COLUMNS = new Set([
  'created_at', 'updated_at', 'email', 'first_name', 'last_name',
  'company', 'status', 'engagement_score',
])

// ============================================================================
// Service
// ============================================================================

class ContactService {
  private db: Database;

  constructor() {
    const dbPath = './data/contacts.db';
    const dbDir = dirname(dbPath);

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=5000');
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contact_lists (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        contact_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_cl_user ON contact_lists(user_id);

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        list_id TEXT NOT NULL,
        email TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        company TEXT,
        phone TEXT,
        tags TEXT DEFAULT '[]',
        custom_fields TEXT DEFAULT '{}',
        status TEXT DEFAULT 'active',
        engagement_score INTEGER DEFAULT 50,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(list_id, email),
        FOREIGN KEY (list_id) REFERENCES contact_lists(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_c_user ON contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_c_list ON contacts(list_id);
      CREATE INDEX IF NOT EXISTS idx_c_email ON contacts(email);
      CREATE INDEX IF NOT EXISTS idx_c_status ON contacts(status);
      CREATE INDEX IF NOT EXISTS idx_c_score ON contacts(engagement_score);

      CREATE TABLE IF NOT EXISTS import_history (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        list_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        format TEXT NOT NULL,
        total_rows INTEGER DEFAULT 0,
        imported INTEGER DEFAULT 0,
        duplicates INTEGER DEFAULT 0,
        invalid INTEGER DEFAULT 0,
        field_mapping TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Add org_id to existing tables (idempotent)
    try { this.db.exec('ALTER TABLE contact_lists ADD COLUMN org_id TEXT') } catch {}
    try { this.db.exec('ALTER TABLE contacts ADD COLUMN org_id TEXT') } catch {}
    try { this.db.exec('ALTER TABLE import_history ADD COLUMN org_id TEXT') } catch {}
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_cl_org ON contact_lists(org_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_c_org ON contacts(org_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_ih_org ON import_history(org_id)');

    logger.info('Contacts database initialized (data/contacts.db)');
  }

  // --------------------------------------------------------------------------
  // Lists
  // --------------------------------------------------------------------------

  createList(orgId: string, userId: string, name: string, description?: string): ContactList {
    const id = generateId('list');
    this.db.prepare(`
      INSERT INTO contact_lists (id, org_id, user_id, name, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, orgId, userId, name, description || null);
    return this.db.prepare('SELECT * FROM contact_lists WHERE id = ?').get(id) as ContactList;
  }

  getLists(orgId: string): ContactList[] {
    return this.db.prepare(`
      SELECT cl.*, (SELECT COUNT(*) FROM contacts WHERE contacts.list_id = cl.id) AS contact_count
      FROM contact_lists cl WHERE cl.org_id = ? ORDER BY cl.created_at DESC
    `).all(orgId) as ContactList[];
  }

  getList(orgId: string, listId: string): ContactList | null {
    return this.db.prepare(`
      SELECT * FROM contact_lists WHERE id = ? AND org_id = ?
    `).get(listId, orgId) as ContactList | null;
  }

  updateList(orgId: string, listId: string, name: string, description?: string): boolean {
    const result = this.db.prepare(`
      UPDATE contact_lists SET name = ?, description = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?
    `).run(name, description || null, listId, orgId);
    return result.changes > 0;
  }

  deleteList(orgId: string, listId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM contact_lists WHERE id = ? AND org_id = ?
    `).run(listId, orgId);
    return result.changes > 0;
  }

  // --------------------------------------------------------------------------
  // Contacts CRUD
  // --------------------------------------------------------------------------

  addContact(orgId: string, userId: string, listId: string, input: ContactInput): Contact {
    const id = generateId('con');
    this.db.prepare(`
      INSERT INTO contacts (id, org_id, user_id, list_id, email, first_name, last_name, company, phone, tags, custom_fields, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId, listId,
      input.email.toLowerCase().trim(),
      input.first_name || null,
      input.last_name || null,
      input.company || null,
      input.phone || null,
      JSON.stringify(input.tags || []),
      JSON.stringify(input.custom_fields || {}),
      input.status || 'active',
      input.source || 'manual'
    );
    return this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Contact;
  }

  updateContact(orgId: string, contactId: string, updates: Partial<ContactInput>): boolean {
    const sets: string[] = [];
    const params: any[] = [];

    if (updates.email !== undefined) { sets.push('email = ?'); params.push(updates.email.toLowerCase().trim()); }
    if (updates.first_name !== undefined) { sets.push('first_name = ?'); params.push(updates.first_name); }
    if (updates.last_name !== undefined) { sets.push('last_name = ?'); params.push(updates.last_name); }
    if (updates.company !== undefined) { sets.push('company = ?'); params.push(updates.company); }
    if (updates.phone !== undefined) { sets.push('phone = ?'); params.push(updates.phone); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    if (updates.custom_fields !== undefined) { sets.push('custom_fields = ?'); params.push(JSON.stringify(updates.custom_fields)); }
    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }

    if (sets.length === 0) return false;

    sets.push("updated_at = datetime('now')");
    params.push(contactId, orgId);

    const result = this.db.prepare(`
      UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND org_id = ?
    `).run(...params);
    return result.changes > 0;
  }

  deleteContacts(orgId: string, contactIds: string[]): number {
    const placeholders = contactIds.map(() => '?').join(',');
    const result = this.db.prepare(`
      DELETE FROM contacts WHERE id IN (${placeholders}) AND org_id = ?
    `).run(...contactIds, orgId);
    return result.changes;
  }

  getContacts(orgId: string, listId: string, filters: ContactFilters = {}): { contacts: Contact[]; total: number } {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 200);
    const offset = (page - 1) * limit;
    const sortBy = ALLOWED_SORT_COLUMNS.has(filters.sort_by || '') ? filters.sort_by! : 'created_at';
    const sortOrder = filters.sort_order === 'asc' ? 'ASC' : 'DESC';

    const conditions: string[] = ['org_id = ?', 'list_id = ?'];
    const params: any[] = [orgId, listId];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.search) {
      conditions.push("(email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR company LIKE ?)");
      const q = `%${filters.search}%`;
      params.push(q, q, q, q);
    }

    if (filters.tags && filters.tags.length > 0) {
      for (const tag of filters.tags) {
        conditions.push("tags LIKE ?");
        params.push(`%"${tag}"%`);
      }
    }

    const where = conditions.join(' AND ');

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM contacts WHERE ${where}`).get(...params) as any).count;

    const contacts = this.db.prepare(`
      SELECT * FROM contacts WHERE ${where}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Contact[];

    return { contacts, total };
  }

  getContact(orgId: string, contactId: string): Contact | null {
    return this.db.prepare(`
      SELECT * FROM contacts WHERE id = ? AND org_id = ?
    `).get(contactId, orgId) as Contact | null;
  }

  /**
   * Best-effort cross-org lookup by email (email is effectively unique per
   * contact across the install). Used by inbound tracking events that only
   * carry the recipient address, with no org/session context. Returns null if
   * no contact matches. Email is normalized to match how it is stored
   * (lowercased + trimmed on insert).
   */
  getContactByEmail(email: string): Contact | null {
    const normalized = (email || '').toLowerCase().trim();
    if (!normalized) return null;
    return this.db.prepare(`
      SELECT * FROM contacts WHERE email = ? ORDER BY created_at ASC LIMIT 1
    `).get(normalized) as Contact | null;
  }

  searchContacts(orgId: string, query: string, limit = 20): Contact[] {
    const q = `%${query}%`;
    return this.db.prepare(`
      SELECT * FROM contacts WHERE org_id = ?
      AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR company LIKE ?)
      ORDER BY email ASC LIMIT ?
    `).all(orgId, q, q, q, q, limit) as Contact[];
  }

  // --------------------------------------------------------------------------
  // Import
  // --------------------------------------------------------------------------

  importContacts(
    orgId: string,
    userId: string,
    listId: string,
    rows: Record<string, string>[],
    fieldMapping: Record<string, string>,
    options: { skipDuplicates?: boolean; source?: string } = {}
  ): ImportResult {
    const result: ImportResult = { total: rows.length, imported: 0, duplicates: 0, invalid: 0, errors: [] };

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO contacts (id, org_id, user_id, list_id, email, first_name, last_name, company, phone, tags, custom_fields, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?)
    `);

    const checkStmt = this.db.prepare(`
      SELECT 1 FROM contacts WHERE list_id = ? AND email = ?
    `);

    const transaction = this.db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const mapped: Record<string, string> = {};

        for (const [sourceCol, targetField] of Object.entries(fieldMapping)) {
          if (row[sourceCol] !== undefined) {
            mapped[targetField] = row[sourceCol];
          }
        }

        const email = (mapped.email || '').toLowerCase().trim();
        if (!email || !email.includes('@')) {
          result.invalid++;
          result.errors.push({ row: i + 1, email: email || '(empty)', reason: 'Invalid email format' });
          continue;
        }

        if (options.skipDuplicates !== false) {
          const exists = checkStmt.get(listId, email);
          if (exists) {
            result.duplicates++;
            continue;
          }
        }

        const id = `${generateId('con')}_${i}`;

        try {
          insertStmt.run(
            id, orgId, userId, listId, email,
            mapped.first_name || null,
            mapped.last_name || null,
            mapped.company || null,
            mapped.phone || null,
            options.source || 'import'
          );
          result.imported++;
        } catch (err) {
          result.duplicates++;
        }
      }
    });

    transaction();
    return result;
  }

  recordImport(orgId: string, userId: string, listId: string, filename: string, format: string, result: ImportResult, fieldMapping: Record<string, string>) {
    const id = generateId('imp');
    this.db.prepare(`
      INSERT INTO import_history (id, org_id, user_id, list_id, filename, format, total_rows, imported, duplicates, invalid, field_mapping)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, userId, listId, filename, format, result.total, result.imported, result.duplicates, result.invalid, JSON.stringify(fieldMapping));
  }

  getImportHistory(orgId: string, limit = 20): ImportHistory[] {
    return this.db.prepare(`
      SELECT * FROM import_history WHERE org_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(orgId, limit) as ImportHistory[];
  }

  // --------------------------------------------------------------------------
  // Bulk Operations
  // --------------------------------------------------------------------------

  tagContacts(orgId: string, contactIds: string[], tagsToAdd: string[]): number {
    let updated = 0;
    const getStmt = this.db.prepare('SELECT id, tags FROM contacts WHERE id = ? AND org_id = ?');
    const updateStmt = this.db.prepare("UPDATE contacts SET tags = ?, updated_at = datetime('now') WHERE id = ?");

    for (const contactId of contactIds) {
      const contact = getStmt.get(contactId, orgId) as { id: string; tags: string } | null;
      if (!contact) continue;

      const existingTags: string[] = JSON.parse(contact.tags || '[]');
      const merged = [...new Set([...existingTags, ...tagsToAdd])];
      updateStmt.run(JSON.stringify(merged), contactId);
      updated++;
    }

    return updated;
  }

  moveContacts(orgId: string, contactIds: string[], targetListId: string): number {
    const placeholders = contactIds.map(() => '?').join(',');
    const result = this.db.prepare(`
      UPDATE contacts SET list_id = ?, updated_at = datetime('now')
      WHERE id IN (${placeholders}) AND org_id = ?
    `).run(targetListId, ...contactIds, orgId);
    return result.changes;
  }

  /**
   * Get contacts for a list as array (for email sending)
   */
  getContactsForSending(orgId: string, listId: string): { Email: string; FirstName?: string; LastName?: string; Company?: string }[] {
    const contacts = this.db.prepare(`
      SELECT email, first_name, last_name, company FROM contacts
      WHERE org_id = ? AND list_id = ? AND status = 'active'
      ORDER BY email ASC
    `).all(orgId, listId) as any[];

    return contacts.map(c => ({
      Email: c.email,
      FirstName: c.first_name || undefined,
      LastName: c.last_name || undefined,
      Company: c.company || undefined,
    }));
  }

  // --------------------------------------------------------------------------
  // Deduplication
  // --------------------------------------------------------------------------

  findDuplicates(orgId: string): { email: string; count: number; ids: string[]; lists: string[] }[] {
    const rows = this.db.prepare(`
      SELECT email, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(DISTINCT list_id) as lists
      FROM contacts WHERE org_id = ?
      GROUP BY LOWER(email) HAVING count > 1
      ORDER BY count DESC LIMIT 100
    `).all(orgId) as { email: string; count: number; ids: string; lists: string }[];

    return rows.map(r => ({
      email: r.email,
      count: r.count,
      ids: r.ids.split(','),
      lists: r.lists.split(','),
    }));
  }

  mergeContacts(orgId: string, primaryId: string, mergeIds: string[]): boolean {
    const primary = this.getContact(orgId, primaryId);
    if (!primary) return false;

    const allIds = [primaryId, ...mergeIds];
    const contacts = allIds
      .map(id => this.getContact(orgId, id))
      .filter(Boolean) as Contact[];

    if (contacts.length < 2) return false;

    // Merge strategy: keep newest non-empty value, combine tags, sum scores
    let mergedTags: string[] = [];
    let mergedScore = 0;
    let mergedCustom: Record<string, string> = {};

    for (const c of contacts) {
      const tags: string[] = JSON.parse(c.tags || '[]');
      mergedTags = [...new Set([...mergedTags, ...tags])];
      mergedScore += c.engagement_score;

      const custom: Record<string, string> = JSON.parse(c.custom_fields || '{}');
      for (const [k, v] of Object.entries(custom)) {
        if (v && !mergedCustom[k]) mergedCustom[k] = v;
      }
    }

    // Update primary with merged data
    const newest = contacts.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    this.db.prepare(`
      UPDATE contacts SET
        first_name = COALESCE(NULLIF(?, ''), first_name),
        last_name = COALESCE(NULLIF(?, ''), last_name),
        company = COALESCE(NULLIF(?, ''), company),
        phone = COALESCE(NULLIF(?, ''), phone),
        tags = ?,
        custom_fields = ?,
        engagement_score = ?,
        updated_at = datetime('now')
      WHERE id = ? AND org_id = ?
    `).run(
      newest.first_name, newest.last_name, newest.company, newest.phone,
      JSON.stringify(mergedTags), JSON.stringify(mergedCustom), mergedScore,
      primaryId, orgId
    );

    // Delete merged contacts (keep primary)
    for (const id of mergeIds) {
      this.db.prepare('DELETE FROM contacts WHERE id = ? AND org_id = ?').run(id, orgId);
    }

    return true;
  }
}

export const contactService = new ContactService();
