// src/services/campaignService.ts - Campaign Lifecycle Management (Postgres/Drizzle, async)

import { and, eq, ilike, or, inArray, desc, count, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { campaigns, ab_variants } from '../db/pg/schema'
import { eventBus } from './eventBus'
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
  rotation_config: string | null // JSON
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
  // Free-text in the DB; the route validates it via the shared zod enum. (The CampaignType
  // union and that enum use different vocabularies — pre-existing P6 debt — so keep this string.)
  type?: string
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

type StatField = 'sent_count' | 'failed_count' | 'open_count' | 'click_count' | 'bounce_count' | 'unsubscribe_count'
const STAT_COLUMNS = {
  sent_count: campaigns.sent_count,
  failed_count: campaigns.failed_count,
  open_count: campaigns.open_count,
  click_count: campaigns.click_count,
  bounce_count: campaigns.bounce_count,
  unsubscribe_count: campaigns.unsubscribe_count,
} as const

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class CampaignService {
  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(orgId: string, userId: string, input: CampaignInput): Promise<CampaignRecord> {
    const db = getDb()
    const id = generateId('camp')

    await db.insert(campaigns).values({
      id,
      org_id: orgId,
      user_id: userId,
      name: input.name,
      type: input.type || 'one_time',
      subject: input.subject,
      from_name: input.from_name,
      from_email: input.from_email,
      reply_to: input.reply_to || null,
      template_id: input.template_id || null,
      list_id: input.list_id || null,
      segment_id: input.segment_id || null,
      tags: JSON.stringify(input.tags || []),
      folder: input.folder || null,
      batch_size: input.batch_size || 20,
      email_delay: input.email_delay || 45,
      batch_delay: input.batch_delay || 60,
    })

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
    return row as CampaignRecord
  }

  async get(orgId: string, campaignId: string): Promise<CampaignRecord | null> {
    const [row] = await getDb()
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)))
      .limit(1)
    return (row as CampaignRecord) ?? null
  }

  async update(orgId: string, campaignId: string, updates: Partial<CampaignInput> & { ab_config?: string; rotation_config?: string }): Promise<boolean> {
    const u = updates
    const values: Partial<typeof campaigns.$inferInsert> = {}

    if (u.name !== undefined) values.name = u.name
    if (u.type !== undefined) values.type = u.type
    if (u.subject !== undefined) values.subject = u.subject
    if (u.from_name !== undefined) values.from_name = u.from_name
    if (u.from_email !== undefined) values.from_email = u.from_email
    if (u.reply_to !== undefined) values.reply_to = u.reply_to
    if (u.template_id !== undefined) values.template_id = u.template_id
    if (u.list_id !== undefined) values.list_id = u.list_id
    if (u.segment_id !== undefined) values.segment_id = u.segment_id
    if (u.tags !== undefined) values.tags = JSON.stringify(u.tags)
    if (u.folder !== undefined) values.folder = u.folder
    if (u.batch_size !== undefined) values.batch_size = u.batch_size
    if (u.email_delay !== undefined) values.email_delay = u.email_delay
    if (u.batch_delay !== undefined) values.batch_delay = u.batch_delay
    if (u.ab_config !== undefined) values.ab_config = u.ab_config
    if (u.rotation_config !== undefined) values.rotation_config = u.rotation_config

    if (Object.keys(values).length === 0) return false

    values.updated_at = now()

    // Only editable while in draft/testing (matches original gate).
    const res = await getDb()
      .update(campaigns)
      .set(values)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId), inArray(campaigns.status, ['draft', 'testing'])))
      .returning({ id: campaigns.id })
    return res.length > 0
  }

  async delete(orgId: string, campaignId: string): Promise<boolean> {
    const res = await getDb()
      .delete(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId), inArray(campaigns.status, ['draft', 'cancelled', 'archived'])))
      .returning({ id: campaigns.id })
    return res.length > 0
  }

  async list(orgId: string, filters: CampaignFilters = {}): Promise<{ campaigns: CampaignRecord[]; total: number }> {
    const db = getDb()
    const page = filters.page || 1
    const limit = Math.min(filters.limit || 20, 100)
    const offset = (page - 1) * limit

    const conditions = [eq(campaigns.org_id, orgId)]
    if (filters.status) conditions.push(eq(campaigns.status, filters.status))
    if (filters.type) conditions.push(eq(campaigns.type, filters.type))
    if (filters.folder) conditions.push(eq(campaigns.folder, filters.folder))
    if (filters.search) {
      const q = `%${filters.search}%`
      conditions.push(or(ilike(campaigns.name, q), ilike(campaigns.subject, q))!)
    }
    const where = and(...conditions)

    const [tot] = await db.select({ value: count() }).from(campaigns).where(where)
    const rows = await db.select().from(campaigns).where(where).orderBy(desc(campaigns.updated_at)).limit(limit).offset(offset)

    return { campaigns: rows as CampaignRecord[], total: tot?.value ?? 0 }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async saveDraft(orgId: string, campaignId: string, draftData: unknown): Promise<boolean> {
    const res = await getDb()
      .update(campaigns)
      .set({ draft_data: JSON.stringify(draftData), updated_at: now() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)))
      .returning({ id: campaigns.id })
    return res.length > 0
  }

  async setStatus(orgId: string, campaignId: string, status: CampaignLifecycleStatus): Promise<boolean> {
    const values: Partial<typeof campaigns.$inferInsert> = { status, updated_at: now() }
    if (status === 'sending') values.sent_at = now()
    if (status === 'completed') values.completed_at = now()

    const res = await getDb()
      .update(campaigns)
      .set(values)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)))
      .returning({ id: campaigns.id })

    if (res.length > 0) {
      if (status === 'sending') eventBus.emit('campaign_launched', orgId, { campaignId })
      if (status === 'completed') eventBus.emit('campaign_completed', orgId, { campaignId })
    }

    return res.length > 0
  }

  async schedule(orgId: string, campaignId: string, scheduledAt: string): Promise<boolean> {
    const res = await getDb()
      .update(campaigns)
      .set({ status: 'scheduled', scheduled_at: scheduledAt, updated_at: now() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId), inArray(campaigns.status, ['draft', 'testing'])))
      .returning({ id: campaigns.id })
    return res.length > 0
  }

  async clone(orgId: string, userId: string, campaignId: string): Promise<CampaignRecord | null> {
    const original = await this.get(orgId, campaignId)
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

  async updateStats(campaignId: string, field: StatField, increment = 1): Promise<void> {
    const col = STAT_COLUMNS[field]
    await getDb()
      .update(campaigns)
      .set({ [field]: sql`${col} + ${increment}`, updated_at: now() })
      .where(eq(campaigns.id, campaignId))
  }

  async setTotalRecipients(campaignId: string, total: number): Promise<void> {
    await getDb().update(campaigns).set({ total_recipients: total, updated_at: now() }).where(eq(campaigns.id, campaignId))
  }

  async setJobId(campaignId: string, jobId: string): Promise<void> {
    await getDb().update(campaigns).set({ job_id: jobId, updated_at: now() }).where(eq(campaigns.id, campaignId))
  }

  async getStats(orgId: string, campaignId: string): Promise<CampaignRecord | null> {
    return this.get(orgId, campaignId)
  }

  // --------------------------------------------------------------------------
  // A/B Testing
  // --------------------------------------------------------------------------

  async createABVariant(campaignId: string, label: string, percentage: number, opts: { subject?: string; templateId?: string; senderName?: string; senderEmail?: string } = {}): Promise<ABVariant> {
    const db = getDb()
    const id = generateId('var')

    await db.insert(ab_variants).values({
      id,
      campaign_id: campaignId,
      variant_label: label,
      subject: opts.subject || null,
      template_id: opts.templateId || null,
      sender_name: opts.senderName || null,
      sender_email: opts.senderEmail || null,
      percentage,
    })

    const [row] = await db.select().from(ab_variants).where(eq(ab_variants.id, id)).limit(1)
    return row as ABVariant
  }

  async getABVariants(campaignId: string): Promise<ABVariant[]> {
    const rows = await getDb()
      .select()
      .from(ab_variants)
      .where(eq(ab_variants.campaign_id, campaignId))
      .orderBy(ab_variants.variant_label)
    return rows as ABVariant[]
  }

  async declareWinner(campaignId: string, variantId: string): Promise<boolean> {
    const db = getDb()
    await db.update(ab_variants).set({ is_winner: 0 }).where(eq(ab_variants.campaign_id, campaignId))
    const res = await db
      .update(ab_variants)
      .set({ is_winner: 1 })
      .where(and(eq(ab_variants.id, variantId), eq(ab_variants.campaign_id, campaignId)))
      .returning({ id: ab_variants.id })
    return res.length > 0
  }

  /**
   * Get dashboard overview for campaigns
   */
  async getDashboardStats(orgId: string): Promise<{ total: number; drafts: number; sending: number; completed: number; scheduled: number }> {
    const [row] = await getDb()
      .select({
        total: count(),
        drafts: sql<number>`sum(case when ${campaigns.status} = 'draft' then 1 else 0 end)::int`,
        sending: sql<number>`sum(case when ${campaigns.status} = 'sending' then 1 else 0 end)::int`,
        completed: sql<number>`sum(case when ${campaigns.status} = 'completed' then 1 else 0 end)::int`,
        scheduled: sql<number>`sum(case when ${campaigns.status} = 'scheduled' then 1 else 0 end)::int`,
      })
      .from(campaigns)
      .where(eq(campaigns.org_id, orgId))

    return {
      total: row?.total ?? 0,
      drafts: row?.drafts ?? 0,
      sending: row?.sending ?? 0,
      completed: row?.completed ?? 0,
      scheduled: row?.scheduled ?? 0,
    }
  }
}

export const campaignService = new CampaignService()
