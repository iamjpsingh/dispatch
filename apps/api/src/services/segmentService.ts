// src/services/segmentService.ts - Contact Segmentation (Postgres/Drizzle, async)

import { and, eq, inArray, desc, count } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { segments, segment_contacts } from '../db/pg/schema'
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
  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(orgId: string, userId: string, input: SegmentInput): Promise<Segment> {
    const db = getDb()
    const id = generateId('seg')

    await db.insert(segments).values({
      id,
      org_id: orgId,
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      type: input.type || 'dynamic',
      rules_json: input.rules ? JSON.stringify(input.rules) : null,
    })

    const [row] = await db.select().from(segments).where(eq(segments.id, id)).limit(1)
    return row as Segment
  }

  async get(orgId: string, segmentId: string): Promise<Segment | null> {
    const [row] = await getDb()
      .select()
      .from(segments)
      .where(and(eq(segments.id, segmentId), eq(segments.org_id, orgId)))
      .limit(1)
    return (row as Segment) ?? null
  }

  async update(orgId: string, segmentId: string, updates: Partial<SegmentInput>): Promise<boolean> {
    const values: Partial<typeof segments.$inferInsert> = {}

    if (updates.name !== undefined) values.name = updates.name
    if (updates.description !== undefined) values.description = updates.description
    if (updates.type !== undefined) values.type = updates.type
    if (updates.rules !== undefined) values.rules_json = JSON.stringify(updates.rules)

    if (Object.keys(values).length === 0) return false

    values.updated_at = new Date().toISOString()

    const res = await getDb()
      .update(segments)
      .set(values)
      .where(and(eq(segments.id, segmentId), eq(segments.org_id, orgId)))
      .returning({ id: segments.id })

    return res.length > 0
  }

  async delete(orgId: string, segmentId: string): Promise<boolean> {
    const res = await getDb()
      .delete(segments)
      .where(and(eq(segments.id, segmentId), eq(segments.org_id, orgId)))
      .returning({ id: segments.id })
    return res.length > 0
  }

  async list(orgId: string): Promise<Segment[]> {
    const rows = await getDb()
      .select()
      .from(segments)
      .where(eq(segments.org_id, orgId))
      .orderBy(desc(segments.updated_at))
    return rows as Segment[]
  }

  // --------------------------------------------------------------------------
  // Static Segment Members
  // --------------------------------------------------------------------------

  async addContacts(segmentId: string, contactIds: string[]): Promise<number> {
    const db = getDb()
    let added = 0

    await db.transaction(async (tx) => {
      for (const contactId of contactIds) {
        const res = await tx
          .insert(segment_contacts)
          .values({ segment_id: segmentId, contact_id: contactId })
          .onConflictDoNothing()
          .returning({ contact_id: segment_contacts.contact_id })
        if (res.length > 0) added++
      }
    })

    await this.updateContactCount(segmentId)
    return added
  }

  async removeContacts(segmentId: string, contactIds: string[]): Promise<number> {
    if (contactIds.length === 0) {
      await this.updateContactCount(segmentId)
      return 0
    }
    const res = await getDb()
      .delete(segment_contacts)
      .where(and(eq(segment_contacts.segment_id, segmentId), inArray(segment_contacts.contact_id, contactIds)))
      .returning({ contact_id: segment_contacts.contact_id })

    await this.updateContactCount(segmentId)
    return res.length
  }

  async getStaticMembers(segmentId: string, limit = 100, offset = 0): Promise<string[]> {
    const rows = await getDb()
      .select({ contact_id: segment_contacts.contact_id })
      .from(segment_contacts)
      .where(eq(segment_contacts.segment_id, segmentId))
      .limit(limit)
      .offset(offset)

    return rows.map((r) => r.contact_id)
  }

  private async updateContactCount(segmentId: string): Promise<void> {
    const db = getDb()
    const [c] = await db.select({ value: count() }).from(segment_contacts).where(eq(segment_contacts.segment_id, segmentId))
    await db
      .update(segments)
      .set({ contact_count: c?.value ?? 0, last_calculated_at: new Date().toISOString() })
      .where(eq(segments.id, segmentId))
  }
}

export const segmentService = new SegmentService()
