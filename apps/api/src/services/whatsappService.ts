// src/services/whatsappService.ts - WhatsApp Business API Integration (Postgres/Drizzle, async)
// Supports Meta Cloud API (direct), Twilio WhatsApp, 360dialog

import { and, eq, desc, count, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { whatsapp_configs, whatsapp_templates, whatsapp_messages } from '../db/pg/schema'
import { generateId } from '../utils/id'
import { logger } from '../utils/logger'

const META_API_VERSION = 'v21.0'
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

const now = () => new Date().toISOString()

// ============================================================================
// Types
// ============================================================================

export interface WhatsAppConfig {
  id: string
  org_id: string
  user_id: string
  name: string
  provider: 'meta' | 'twilio' | '360dialog'
  phone_number_id: string
  business_account_id: string | null
  access_token: string
  phone_display: string | null
  webhook_verify_token: string | null
  status: 'active' | 'paused' | 'error'
  daily_limit: number
  sent_today: number
  last_reset_date: string | null
  created_at: string
  updated_at: string
}

export interface WhatsAppConfigInput {
  name: string
  provider?: 'meta' | 'twilio' | '360dialog'
  phone_number_id: string
  business_account_id?: string
  access_token: string
  phone_display?: string
  daily_limit?: number
}

export interface WhatsAppTemplate {
  id: string
  org_id: string
  config_id: string
  meta_template_name: string
  meta_template_id: string | null
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'
  components_json: string
  example_json: string | null
  body_text: string | null
  created_at: string
  updated_at: string
}

export interface WhatsAppTemplateInput {
  name: string
  language?: string
  category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  components: MetaTemplateComponent[]
}

export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  text?: string
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[]
  example?: { body_text?: string[][] }
}

export interface WhatsAppMessage {
  id: string
  org_id: string
  config_id: string
  campaign_id: string | null
  contact_id: string | null
  phone_number: string
  template_id: string | null
  message_type: 'template' | 'text' | 'media'
  content_json: string
  wamid: string | null
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
  error_message: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  created_at: string
}

export interface SendTemplateInput {
  phone: string
  template_name: string
  language?: string
  components?: any[]
  contact_id?: string
  campaign_id?: string
}

export interface WhatsAppStats {
  total_messages: number
  sent: number
  delivered: number
  read: number
  failed: number
  delivery_rate: number
  read_rate: number
}

// ============================================================================
// Service
// ============================================================================

class WhatsAppService {

  // --------------------------------------------------------------------------
  // Meta Graph API helper
  // --------------------------------------------------------------------------

  private async metaApi(config: WhatsAppConfig, path: string, method = 'GET', body?: any): Promise<any> {
    const url = `${META_BASE_URL}${path}`
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
    }
    if (body) options.body = JSON.stringify(body)

    const res = await fetch(url, options)
    const json = await res.json() as any

    if (json.error) {
      logger.error(`WhatsApp API error: ${json.error.message}`, json.error)
      throw new Error(json.error.message || 'WhatsApp API error')
    }
    return json
  }

  // --------------------------------------------------------------------------
  // Config CRUD
  // --------------------------------------------------------------------------

  async createConfig(orgId: string, userId: string, input: WhatsAppConfigInput): Promise<WhatsAppConfig> {
    const id = generateId('wac')
    const verifyToken = generateId('wavt')

    await getDb().insert(whatsapp_configs).values({
      id,
      org_id: orgId,
      user_id: userId,
      name: input.name,
      provider: input.provider || 'meta',
      phone_number_id: input.phone_number_id,
      business_account_id: input.business_account_id || null,
      access_token: input.access_token,
      phone_display: input.phone_display || null,
      webhook_verify_token: verifyToken,
      daily_limit: input.daily_limit || 1000,
    })

    return (await this.getConfig(orgId, id))!
  }

  async getConfigs(orgId: string): Promise<WhatsAppConfig[]> {
    const rows = await getDb()
      .select()
      .from(whatsapp_configs)
      .where(eq(whatsapp_configs.org_id, orgId))
      .orderBy(desc(whatsapp_configs.created_at))
    return rows as WhatsAppConfig[]
  }

  async getConfig(orgId: string, id: string): Promise<WhatsAppConfig | null> {
    const [row] = await getDb()
      .select()
      .from(whatsapp_configs)
      .where(and(eq(whatsapp_configs.id, id), eq(whatsapp_configs.org_id, orgId)))
      .limit(1)
    return (row as WhatsAppConfig) ?? null
  }

  async updateConfig(orgId: string, id: string, updates: Partial<WhatsAppConfigInput>): Promise<void> {
    const values: Partial<typeof whatsapp_configs.$inferInsert> = {}

    if (updates.name !== undefined) values.name = updates.name
    if (updates.phone_number_id !== undefined) values.phone_number_id = updates.phone_number_id
    if (updates.business_account_id !== undefined) values.business_account_id = updates.business_account_id
    if (updates.access_token !== undefined) values.access_token = updates.access_token
    if (updates.phone_display !== undefined) values.phone_display = updates.phone_display
    if (updates.daily_limit !== undefined) values.daily_limit = updates.daily_limit

    if (Object.keys(values).length === 0) return
    values.updated_at = now()

    await getDb()
      .update(whatsapp_configs)
      .set(values)
      .where(and(eq(whatsapp_configs.id, id), eq(whatsapp_configs.org_id, orgId)))
  }

  async deleteConfig(orgId: string, id: string): Promise<void> {
    await getDb()
      .delete(whatsapp_configs)
      .where(and(eq(whatsapp_configs.id, id), eq(whatsapp_configs.org_id, orgId)))
  }

  // --------------------------------------------------------------------------
  // Template Management
  // --------------------------------------------------------------------------

  async syncTemplates(orgId: string, configId: string): Promise<number> {
    const config = await this.getConfig(orgId, configId)
    if (!config) throw new Error('Config not found')
    if (!config.business_account_id) throw new Error('Business Account ID required to sync templates')

    const data = await this.metaApi(config, `/${config.business_account_id}/message_templates?limit=100`)
    const templates = data.data || []

    const db = getDb()
    let synced = 0
    for (const tpl of templates) {
      const [existing] = await db
        .select({ id: whatsapp_templates.id })
        .from(whatsapp_templates)
        .where(and(
          eq(whatsapp_templates.config_id, configId),
          eq(whatsapp_templates.meta_template_name, tpl.name),
          eq(whatsapp_templates.language, tpl.language),
        ))
        .limit(1)

      const bodyComponent = (tpl.components || []).find((c: any) => c.type === 'BODY')
      const bodyText = bodyComponent?.text || null

      if (existing) {
        await db
          .update(whatsapp_templates)
          .set({
            status: tpl.status,
            components_json: JSON.stringify(tpl.components || []),
            meta_template_id: tpl.id,
            category: tpl.category,
            body_text: bodyText,
            updated_at: now(),
          })
          .where(eq(whatsapp_templates.id, existing.id))
      } else {
        await db.insert(whatsapp_templates).values({
          id: generateId('wat'),
          org_id: orgId,
          config_id: configId,
          meta_template_name: tpl.name,
          meta_template_id: tpl.id,
          language: tpl.language,
          category: tpl.category,
          status: tpl.status,
          components_json: JSON.stringify(tpl.components || []),
          body_text: bodyText,
        })
      }
      synced++
    }

    return synced
  }

  async getTemplates(orgId: string, configId?: string): Promise<WhatsAppTemplate[]> {
    const db = getDb()
    if (configId) {
      const rows = await db
        .select()
        .from(whatsapp_templates)
        .where(and(eq(whatsapp_templates.org_id, orgId), eq(whatsapp_templates.config_id, configId)))
        .orderBy(whatsapp_templates.meta_template_name)
      return rows as WhatsAppTemplate[]
    }
    const rows = await db
      .select()
      .from(whatsapp_templates)
      .where(eq(whatsapp_templates.org_id, orgId))
      .orderBy(whatsapp_templates.meta_template_name)
    return rows as WhatsAppTemplate[]
  }

  async createTemplate(orgId: string, configId: string, input: WhatsAppTemplateInput): Promise<WhatsAppTemplate> {
    const config = await this.getConfig(orgId, configId)
    if (!config) throw new Error('Config not found')
    if (!config.business_account_id) throw new Error('Business Account ID required')

    const result = await this.metaApi(config, `/${config.business_account_id}/message_templates`, 'POST', {
      name: input.name,
      language: input.language || 'en',
      category: input.category || 'MARKETING',
      components: input.components,
    })

    const bodyComponent = input.components.find(c => c.type === 'BODY')
    const id = generateId('wat')

    const db = getDb()
    await db.insert(whatsapp_templates).values({
      id,
      org_id: orgId,
      config_id: configId,
      meta_template_name: input.name,
      meta_template_id: result.id,
      language: input.language || 'en',
      category: input.category || 'MARKETING',
      status: 'PENDING',
      components_json: JSON.stringify(input.components),
      body_text: bodyComponent?.text || null,
    })

    const [row] = await db.select().from(whatsapp_templates).where(eq(whatsapp_templates.id, id)).limit(1)
    return row as WhatsAppTemplate
  }

  async deleteTemplate(orgId: string, id: string): Promise<void> {
    const [tpl] = await getDb()
      .select()
      .from(whatsapp_templates)
      .where(and(eq(whatsapp_templates.id, id), eq(whatsapp_templates.org_id, orgId)))
      .limit(1)
    if (!tpl) throw new Error('Template not found')

    const config = await this.getConfig(orgId, tpl.config_id)
    if (config?.business_account_id) {
      try {
        await this.metaApi(config, `/${config.business_account_id}/message_templates?name=${tpl.meta_template_name}`, 'DELETE')
      } catch {
        // Template may already be deleted on Meta's side
      }
    }
    await getDb()
      .delete(whatsapp_templates)
      .where(and(eq(whatsapp_templates.id, id), eq(whatsapp_templates.org_id, orgId)))
  }

  // --------------------------------------------------------------------------
  // Sending
  // --------------------------------------------------------------------------

  private async resetDailyCountIfNeeded(config: WhatsAppConfig): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    if (config.last_reset_date !== today) {
      await getDb()
        .update(whatsapp_configs)
        .set({ sent_today: 0, last_reset_date: today, updated_at: now() })
        .where(eq(whatsapp_configs.id, config.id))
      config.sent_today = 0
      config.last_reset_date = today
    }
  }

  async sendTemplate(orgId: string, configId: string, input: SendTemplateInput): Promise<WhatsAppMessage> {
    const config = await this.getConfig(orgId, configId)
    if (!config) throw new Error('Config not found')
    if (config.status !== 'active') throw new Error('Config is not active')

    await this.resetDailyCountIfNeeded(config)
    if (config.sent_today >= config.daily_limit) {
      throw new Error(`Daily limit reached (${config.daily_limit})`)
    }

    const db = getDb()
    const msgId = generateId('wam')
    const cleanPhone = input.phone.replace(/\D/g, '')
    const content = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: {
        name: input.template_name,
        language: { code: input.language || 'en' },
        ...(input.components?.length ? { components: input.components } : {}),
      },
    }

    await db.insert(whatsapp_messages).values({
      id: msgId,
      org_id: orgId,
      config_id: configId,
      campaign_id: input.campaign_id || null,
      contact_id: input.contact_id || null,
      phone_number: cleanPhone,
      message_type: 'template',
      content_json: JSON.stringify(content),
      status: 'queued',
    })

    try {
      const result = await this.metaApi(config, `/${config.phone_number_id}/messages`, 'POST', content)
      const wamid = result.messages?.[0]?.id || null

      await db
        .update(whatsapp_messages)
        .set({ status: 'sent', wamid, sent_at: now() })
        .where(eq(whatsapp_messages.id, msgId))
      await db
        .update(whatsapp_configs)
        .set({ sent_today: sql`${whatsapp_configs.sent_today} + 1`, updated_at: now() })
        .where(eq(whatsapp_configs.id, configId))

      const [row] = await db.select().from(whatsapp_messages).where(eq(whatsapp_messages.id, msgId)).limit(1)
      return row as WhatsAppMessage
    } catch (err: any) {
      await db
        .update(whatsapp_messages)
        .set({ status: 'failed', error_message: err.message })
        .where(eq(whatsapp_messages.id, msgId))
      throw err
    }
  }

  async sendText(orgId: string, configId: string, phone: string, text: string, contactId?: string): Promise<WhatsAppMessage> {
    const config = await this.getConfig(orgId, configId)
    if (!config) throw new Error('Config not found')
    if (config.status !== 'active') throw new Error('Config is not active')

    await this.resetDailyCountIfNeeded(config)
    const db = getDb()
    const msgId = generateId('wam')
    const cleanPhone = phone.replace(/\D/g, '')
    const content = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { body: text },
    }

    await db.insert(whatsapp_messages).values({
      id: msgId,
      org_id: orgId,
      config_id: configId,
      contact_id: contactId || null,
      phone_number: cleanPhone,
      message_type: 'text',
      content_json: JSON.stringify(content),
      status: 'queued',
    })

    try {
      const result = await this.metaApi(config, `/${config.phone_number_id}/messages`, 'POST', content)
      const wamid = result.messages?.[0]?.id || null

      await db
        .update(whatsapp_messages)
        .set({ status: 'sent', wamid, sent_at: now() })
        .where(eq(whatsapp_messages.id, msgId))
      await db
        .update(whatsapp_configs)
        .set({ sent_today: sql`${whatsapp_configs.sent_today} + 1`, updated_at: now() })
        .where(eq(whatsapp_configs.id, configId))

      const [row] = await db.select().from(whatsapp_messages).where(eq(whatsapp_messages.id, msgId)).limit(1)
      return row as WhatsAppMessage
    } catch (err: any) {
      await db
        .update(whatsapp_messages)
        .set({ status: 'failed', error_message: err.message })
        .where(eq(whatsapp_messages.id, msgId))
      throw err
    }
  }

  async sendBulk(
    orgId: string, configId: string, templateName: string,
    recipients: { phone: string; contactId?: string; params?: string[] }[],
    language = 'en'
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0
    let failed = 0

    for (const recipient of recipients) {
      try {
        const components = recipient.params?.length ? [{
          type: 'body',
          parameters: recipient.params.map((p: string) => ({ type: 'text', text: p })),
        }] : undefined

        await this.sendTemplate(orgId, configId, {
          phone: recipient.phone,
          template_name: templateName,
          language,
          components,
          contact_id: recipient.contactId,
        })
        sent++
      } catch {
        failed++
      }

      // Rate limit: Meta allows ~80 msg/s, we throttle to be safe
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return { sent, failed }
  }

  // --------------------------------------------------------------------------
  // Webhook Processing
  // --------------------------------------------------------------------------

  async verifyToken(token: string): Promise<boolean> {
    const [row] = await getDb()
      .select({ id: whatsapp_configs.id })
      .from(whatsapp_configs)
      .where(eq(whatsapp_configs.webhook_verify_token, token))
      .limit(1)
    return !!row
  }

  async processWebhook(payload: any): Promise<void> {
    try {
      const db = getDb()
      const entries = payload.entry || []
      for (const entry of entries) {
        const changes = entry.changes || []
        for (const change of changes) {
          const value = change.value
          if (!value) continue

          const statuses = value.statuses || []
          for (const s of statuses) {
            if (!s.id) continue

            if (s.status === 'delivered') {
              await db
                .update(whatsapp_messages)
                .set({ status: 'delivered', delivered_at: new Date(parseInt(s.timestamp) * 1000).toISOString() })
                .where(eq(whatsapp_messages.wamid, s.id))
            } else if (s.status === 'read') {
              await db
                .update(whatsapp_messages)
                .set({ status: 'read', read_at: new Date(parseInt(s.timestamp) * 1000).toISOString() })
                .where(eq(whatsapp_messages.wamid, s.id))
            } else if (s.status === 'failed') {
              const errorMsg = s.errors?.[0]?.message || 'Delivery failed'
              await db
                .update(whatsapp_messages)
                .set({ status: 'failed', error_message: errorMsg })
                .where(eq(whatsapp_messages.wamid, s.id))
            }
          }
        }
      }
    } catch (err) {
      logger.error('WhatsApp webhook processing error:', err)
    }
  }

  // --------------------------------------------------------------------------
  // Message Queries
  // --------------------------------------------------------------------------

  async getMessages(orgId: string, filters?: { configId?: string; status?: string; limit?: number; offset?: number }): Promise<{ messages: WhatsAppMessage[]; total: number }> {
    const db = getDb()
    const conditions = [eq(whatsapp_messages.org_id, orgId)]
    if (filters?.configId) conditions.push(eq(whatsapp_messages.config_id, filters.configId))
    if (filters?.status) conditions.push(eq(whatsapp_messages.status, filters.status))
    const where = and(...conditions)

    const [tot] = await db.select({ value: count() }).from(whatsapp_messages).where(where)
    const limit = filters?.limit || 50
    const offset = filters?.offset || 0

    const messages = await db
      .select()
      .from(whatsapp_messages)
      .where(where)
      .orderBy(desc(whatsapp_messages.created_at))
      .limit(limit)
      .offset(offset)

    return { messages: messages as WhatsAppMessage[], total: tot?.value ?? 0 }
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  async getStats(orgId: string, configId?: string): Promise<WhatsAppStats> {
    const conditions = [eq(whatsapp_messages.org_id, orgId)]
    if (configId) conditions.push(eq(whatsapp_messages.config_id, configId))
    const where = and(...conditions)

    const [row] = await getDb()
      .select({
        total_messages: sql<number>`count(*)::int`,
        sent: sql<number>`sum(case when ${whatsapp_messages.status} in ('sent', 'delivered', 'read') then 1 else 0 end)::int`,
        delivered: sql<number>`sum(case when ${whatsapp_messages.status} in ('delivered', 'read') then 1 else 0 end)::int`,
        read_count: sql<number>`sum(case when ${whatsapp_messages.status} = 'read' then 1 else 0 end)::int`,
        failed: sql<number>`sum(case when ${whatsapp_messages.status} = 'failed' then 1 else 0 end)::int`,
      })
      .from(whatsapp_messages)
      .where(where)

    const total = row?.total_messages || 0
    const sentCount = row?.sent || 0

    return {
      total_messages: total,
      sent: sentCount,
      delivered: row?.delivered || 0,
      read: row?.read_count || 0,
      failed: row?.failed || 0,
      delivery_rate: sentCount > 0 ? Math.round(((row?.delivered || 0) / sentCount) * 100) : 0,
      read_rate: sentCount > 0 ? Math.round(((row?.read_count || 0) / sentCount) * 100) : 0,
    }
  }
}

export const whatsappService = new WhatsAppService()
