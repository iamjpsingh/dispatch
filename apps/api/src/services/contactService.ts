// src/services/contactService.ts - Contact Management (Postgres/Drizzle, async)

import { and, eq, or, asc, desc, ilike, inArray, count, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { contact_lists, contacts, import_history, type ImportHistoryRow } from '../db/pg/schema'
import { generateId } from '../utils/id'
import { suppressionStore } from './queue/suppressionStore'

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
  email: string | null;
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
const SORT_COLUMNS = {
  created_at: contacts.created_at,
  updated_at: contacts.updated_at,
  email: contacts.email,
  first_name: contacts.first_name,
  last_name: contacts.last_name,
  company: contacts.company,
  status: contacts.status,
  engagement_score: contacts.engagement_score,
} as const

// ============================================================================
// Service
// ============================================================================

class ContactService {
  // --------------------------------------------------------------------------
  // Lists
  // --------------------------------------------------------------------------

  async createList(orgId: string, userId: string, name: string, description?: string): Promise<ContactList> {
    const db = getDb()
    const id = generateId('list')
    await db.insert(contact_lists).values({ id, org_id: orgId, user_id: userId, name, description: description ?? null })
    const [row] = await db.select().from(contact_lists).where(eq(contact_lists.id, id)).limit(1)
    return row as ContactList
  }

  async getLists(orgId: string): Promise<ContactList[]> {
    // contact_count is computed (the stored column is not maintained). LEFT JOIN +
    // GROUP BY the list PK so lists with zero contacts still return (count 0).
    const rows = await getDb()
      .select({
        id: contact_lists.id,
        org_id: contact_lists.org_id,
        user_id: contact_lists.user_id,
        name: contact_lists.name,
        description: contact_lists.description,
        contact_count: sql<number>`count(${contacts.id})::int`,
        created_at: contact_lists.created_at,
        updated_at: contact_lists.updated_at,
      })
      .from(contact_lists)
      .leftJoin(contacts, eq(contacts.list_id, contact_lists.id))
      .where(eq(contact_lists.org_id, orgId))
      .groupBy(contact_lists.id)
      .orderBy(desc(contact_lists.created_at))
    return rows as ContactList[]
  }

  async getList(orgId: string, listId: string): Promise<ContactList | null> {
    const [row] = await getDb()
      .select()
      .from(contact_lists)
      .where(and(eq(contact_lists.id, listId), eq(contact_lists.org_id, orgId)))
      .limit(1)
    return (row as ContactList) ?? null
  }

  async updateList(orgId: string, listId: string, name: string, description?: string): Promise<boolean> {
    const res = await getDb()
      .update(contact_lists)
      .set({ name, description: description ?? null, updated_at: new Date().toISOString() })
      .where(and(eq(contact_lists.id, listId), eq(contact_lists.org_id, orgId)))
      .returning({ id: contact_lists.id })
    return res.length > 0
  }

  async deleteList(orgId: string, listId: string): Promise<boolean> {
    const res = await getDb()
      .delete(contact_lists)
      .where(and(eq(contact_lists.id, listId), eq(contact_lists.org_id, orgId)))
      .returning({ id: contact_lists.id })
    return res.length > 0
  }

  // --------------------------------------------------------------------------
  // Contacts CRUD
  // --------------------------------------------------------------------------

  async addContact(orgId: string, userId: string, listId: string, input: ContactInput): Promise<Contact> {
    const db = getDb()
    const id = generateId('con')
    await db.insert(contacts).values({
      id,
      org_id: orgId,
      user_id: userId,
      list_id: listId,
      email: input.email.toLowerCase().trim(),
      first_name: input.first_name ?? null,
      last_name: input.last_name ?? null,
      company: input.company ?? null,
      phone: input.phone ?? null,
      tags: JSON.stringify(input.tags || []),
      custom_fields: JSON.stringify(input.custom_fields || {}),
      status: input.status || 'active',
      source: input.source || 'manual',
    })
    const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
    return row as Contact
  }

  async updateContact(orgId: string, contactId: string, updates: Partial<ContactInput>): Promise<boolean> {
    const values: Partial<typeof contacts.$inferInsert> = {}

    if (updates.email !== undefined) values.email = updates.email.toLowerCase().trim()
    if (updates.first_name !== undefined) values.first_name = updates.first_name
    if (updates.last_name !== undefined) values.last_name = updates.last_name
    if (updates.company !== undefined) values.company = updates.company
    if (updates.phone !== undefined) values.phone = updates.phone
    if (updates.tags !== undefined) values.tags = JSON.stringify(updates.tags)
    if (updates.custom_fields !== undefined) values.custom_fields = JSON.stringify(updates.custom_fields)
    if (updates.status !== undefined) values.status = updates.status

    if (Object.keys(values).length === 0) return false

    values.updated_at = new Date().toISOString()

    const res = await getDb()
      .update(contacts)
      .set(values)
      .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
      .returning({ id: contacts.id })
    return res.length > 0
  }

  async deleteContacts(orgId: string, contactIds: string[]): Promise<number> {
    if (contactIds.length === 0) return 0
    const res = await getDb()
      .delete(contacts)
      .where(and(inArray(contacts.id, contactIds), eq(contacts.org_id, orgId)))
      .returning({ id: contacts.id })
    return res.length
  }

  async getContacts(orgId: string, listId: string, filters: ContactFilters = {}): Promise<{ contacts: Contact[]; total: number }> {
    const db = getDb()
    const page = filters.page || 1
    const limit = Math.min(filters.limit || 50, 200)
    const offset = (page - 1) * limit
    const sortKey = (filters.sort_by && filters.sort_by in SORT_COLUMNS ? filters.sort_by : 'created_at') as keyof typeof SORT_COLUMNS
    const sortCol = SORT_COLUMNS[sortKey]

    const conditions = [eq(contacts.org_id, orgId), eq(contacts.list_id, listId)]
    if (filters.status) conditions.push(eq(contacts.status, filters.status))
    if (filters.search) {
      const q = `%${filters.search}%`
      conditions.push(or(ilike(contacts.email, q), ilike(contacts.first_name, q), ilike(contacts.last_name, q), ilike(contacts.company, q))!)
    }
    if (filters.tags && filters.tags.length > 0) {
      // ilike (case-insensitive) preserves the original SQLite LIKE semantics.
      for (const tag of filters.tags) conditions.push(ilike(contacts.tags, `%"${tag}"%`))
    }
    const where = and(...conditions)

    const [tot] = await db.select({ value: count() }).from(contacts).where(where)

    const rows = await db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(filters.sort_order === 'asc' ? asc(sortCol) : desc(sortCol))
      .limit(limit)
      .offset(offset)

    return { contacts: rows as Contact[], total: tot?.value ?? 0 }
  }

  async getContact(orgId: string, contactId: string): Promise<Contact | null> {
    const [row] = await getDb()
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
      .limit(1)
    return (row as Contact) ?? null
  }

  /**
   * Best-effort cross-org lookup by email (email is effectively unique per
   * contact across the install). Used by inbound tracking events that only
   * carry the recipient address, with no org/session context. Returns null if
   * no contact matches. Email is normalized to match how it is stored
   * (lowercased + trimmed on insert).
   */
  async getContactByEmail(email: string): Promise<Contact | null> {
    const normalized = (email || '').toLowerCase().trim()
    if (!normalized) return null
    const [row] = await getDb()
      .select()
      .from(contacts)
      .where(eq(contacts.email, normalized))
      .orderBy(asc(contacts.created_at))
      .limit(1)
    return (row as Contact) ?? null
  }

  async searchContacts(orgId: string, query: string, limit = 20): Promise<Contact[]> {
    const q = `%${query}%`
    const rows = await getDb()
      .select()
      .from(contacts)
      .where(and(
        eq(contacts.org_id, orgId),
        or(ilike(contacts.email, q), ilike(contacts.first_name, q), ilike(contacts.last_name, q), ilike(contacts.company, q))!,
      ))
      .orderBy(asc(contacts.email))
      .limit(limit)
    return rows as Contact[]
  }

  // --------------------------------------------------------------------------
  // Import
  // --------------------------------------------------------------------------

  async importContacts(
    orgId: string,
    userId: string,
    listId: string,
    rows: Record<string, string>[],
    fieldMapping: Record<string, string>,
    options: { skipDuplicates?: boolean; source?: string } = {}
  ): Promise<ImportResult> {
    const db = getDb()
    const result: ImportResult = { total: rows.length, imported: 0, duplicates: 0, invalid: 0, errors: [] }

    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const mapped: Record<string, string> = {}

        for (const [sourceCol, targetField] of Object.entries(fieldMapping)) {
          if (row[sourceCol] !== undefined) {
            mapped[targetField] = row[sourceCol]
          }
        }

        const email = (mapped.email || '').toLowerCase().trim()
        if (!email || !email.includes('@')) {
          result.invalid++
          result.errors.push({ row: i + 1, email: email || '(empty)', reason: 'Invalid email format' })
          continue
        }

        if (await suppressionStore.isSuppressed(userId, email, tx)) {
          result.invalid++
          result.errors.push({ row: i + 1, email, reason: 'Email is suppressed' })
          continue
        }

        if (options.skipDuplicates !== false) {
          const exists = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.list_id, listId), eq(contacts.email, email))).limit(1)
          if (exists.length > 0) {
            result.duplicates++
            continue
          }
        }

        const id = `${generateId('con')}_${i}`

        // onConflictDoNothing skips (does not throw) on a (list_id,email) conflict;
        // .returning() tells us whether the row was actually inserted, so counts stay accurate.
        const inserted = await tx.insert(contacts).values({
          id,
          org_id: orgId,
          user_id: userId,
          list_id: listId,
          email,
          first_name: mapped.first_name || null,
          last_name: mapped.last_name || null,
          company: mapped.company || null,
          phone: mapped.phone || null,
          source: options.source || 'import',
        }).onConflictDoNothing().returning({ id: contacts.id })
        if (inserted.length > 0) result.imported++
        else result.duplicates++
      }
    })

    return result
  }

  async recordImport(orgId: string, userId: string, listId: string, filename: string, format: string, result: ImportResult, fieldMapping: Record<string, string>, fileKey: string | null = null): Promise<void> {
    await getDb().insert(import_history).values({
      id: generateId('imp'),
      org_id: orgId,
      user_id: userId,
      list_id: listId,
      filename,
      format,
      total_rows: result.total,
      imported: result.imported,
      duplicates: result.duplicates,
      invalid: result.invalid,
      field_mapping: JSON.stringify(fieldMapping),
      file_key: fileKey,
    })
  }

  async getImport(orgId: string, id: string): Promise<ImportHistoryRow | null> {
    const [row] = await getDb()
      .select()
      .from(import_history)
      .where(and(eq(import_history.id, id), eq(import_history.org_id, orgId)))
      .limit(1)
    return row ?? null
  }

  async getImportHistory(orgId: string, limit = 20): Promise<ImportHistory[]> {
    const rows = await getDb()
      .select()
      .from(import_history)
      .where(eq(import_history.org_id, orgId))
      .orderBy(desc(import_history.created_at))
      .limit(limit)
    return rows as ImportHistory[]
  }

  // --------------------------------------------------------------------------
  // Bulk Operations
  // --------------------------------------------------------------------------

  async tagContacts(orgId: string, contactIds: string[], tagsToAdd: string[]): Promise<number> {
    const db = getDb()
    let updated = 0

    for (const contactId of contactIds) {
      const [contact] = await db.select({ id: contacts.id, tags: contacts.tags }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId))).limit(1)
      if (!contact) continue

      const existingTags: string[] = JSON.parse(contact.tags || '[]')
      const merged = [...new Set([...existingTags, ...tagsToAdd])]
      await db.update(contacts).set({ tags: JSON.stringify(merged), updated_at: new Date().toISOString() }).where(eq(contacts.id, contactId))
      updated++
    }

    return updated
  }

  async moveContacts(orgId: string, contactIds: string[], targetListId: string): Promise<number> {
    if (contactIds.length === 0) return 0
    const res = await getDb()
      .update(contacts)
      .set({ list_id: targetListId, updated_at: new Date().toISOString() })
      .where(and(inArray(contacts.id, contactIds), eq(contacts.org_id, orgId)))
      .returning({ id: contacts.id })
    return res.length
  }

  /**
   * Get contacts for a list as array (for email sending)
   */
  async getContactsForSending(orgId: string, listId: string): Promise<{ Email: string; FirstName?: string; LastName?: string; Company?: string }[]> {
    const rows = await getDb()
      .select({ email: contacts.email, first_name: contacts.first_name, last_name: contacts.last_name, company: contacts.company })
      .from(contacts)
      .where(and(eq(contacts.org_id, orgId), eq(contacts.list_id, listId), eq(contacts.status, 'active')))
      .orderBy(asc(contacts.email))

    return rows
      .filter((c) => c.email !== null)
      .map((c) => ({
        Email: c.email as string,
        FirstName: c.first_name || undefined,
        LastName: c.last_name || undefined,
        Company: c.company || undefined,
      }))
  }

  // --------------------------------------------------------------------------
  // Deduplication
  // --------------------------------------------------------------------------

  async findDuplicates(orgId: string): Promise<{ email: string; count: number; ids: string[]; lists: string[] }[]> {
    const rows = await getDb()
      .select({
        email: sql<string>`min(${contacts.email})`,
        count: sql<number>`count(*)::int`,
        ids: sql<string>`string_agg(${contacts.id}, ',')`,
        lists: sql<string>`string_agg(distinct ${contacts.list_id}, ',')`,
      })
      .from(contacts)
      .where(eq(contacts.org_id, orgId))
      .groupBy(sql`lower(${contacts.email})`)
      .having(sql`count(*) > 1`)
      .orderBy(sql`count(*) desc`)
      .limit(100)

    return rows.map((r) => ({
      email: r.email,
      count: r.count,
      ids: r.ids.split(','),
      lists: r.lists.split(','),
    }))
  }

  async mergeContacts(orgId: string, primaryId: string, mergeIds: string[]): Promise<boolean> {
    const db = getDb()
    const primary = await this.getContact(orgId, primaryId)
    if (!primary) return false

    const allIds = [primaryId, ...mergeIds]
    const fetched = await Promise.all(allIds.map((id) => this.getContact(orgId, id)))
    const list = fetched.filter(Boolean) as Contact[]

    if (list.length < 2) return false

    // Merge strategy: keep newest non-empty value, combine tags, sum scores
    let mergedTags: string[] = []
    let mergedScore = 0
    const mergedCustom: Record<string, string> = {}

    for (const c of list) {
      const tags: string[] = JSON.parse(c.tags || '[]')
      mergedTags = [...new Set([...mergedTags, ...tags])]
      mergedScore += c.engagement_score

      const custom: Record<string, string> = JSON.parse(c.custom_fields || '{}')
      for (const [k, v] of Object.entries(custom)) {
        if (v && !mergedCustom[k]) mergedCustom[k] = v
      }
    }

    // Newest non-empty value wins, else keep the primary's existing value.
    // Parse to epoch ms (not string compare) robustly across both timestamp shapes:
    // DB-default 'YYYY-MM-DD HH:MM:SS.ffffff+00' and explicit ISO 'YYYY-MM-DDTHH:MM:SS.sssZ'.
    // Normalize: space→T, truncate sub-ms fraction, and pad a bare '+00' offset to '+00:00'.
    const ms = (s: string) => Date.parse(s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d\d)$/, '$1:00'))
    const newest = [...list].sort((a, b) => ms(b.updated_at) - ms(a.updated_at))[0]
    const pick = (next: string | null, prev: string | null) => (next && next !== '' ? next : prev)

    await db.update(contacts).set({
      first_name: pick(newest.first_name, primary.first_name),
      last_name: pick(newest.last_name, primary.last_name),
      company: pick(newest.company, primary.company),
      phone: pick(newest.phone, primary.phone),
      tags: JSON.stringify(mergedTags),
      custom_fields: JSON.stringify(mergedCustom),
      engagement_score: mergedScore,
      updated_at: new Date().toISOString(),
    }).where(and(eq(contacts.id, primaryId), eq(contacts.org_id, orgId)))

    await db.delete(contacts).where(and(inArray(contacts.id, mergeIds), eq(contacts.org_id, orgId)))

    return true
  }
}

export const contactService = new ContactService();
