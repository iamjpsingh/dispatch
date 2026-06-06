// src/services/whatsappService.ts - WhatsApp Business API Integration
// Supports Meta Cloud API (direct), Twilio WhatsApp, 360dialog

import { db } from '../db/connection'
import { generateId } from '../utils/id'
import { logger } from '../utils/logger'

const META_API_VERSION = 'v21.0'
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

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

  createConfig(orgId: string, userId: string, input: WhatsAppConfigInput): WhatsAppConfig {
    const id = generateId('wac')
    const verifyToken = generateId('wavt')

    db.prepare(`
      INSERT INTO whatsapp_configs (id, org_id, user_id, name, provider, phone_number_id, business_account_id, access_token, phone_display, webhook_verify_token, daily_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId, input.name, input.provider || 'meta',
      input.phone_number_id, input.business_account_id || null,
      input.access_token, input.phone_display || null,
      verifyToken, input.daily_limit || 1000
    )

    return this.getConfig(orgId, id)!
  }

  getConfigs(orgId: string): WhatsAppConfig[] {
    return db.prepare('SELECT * FROM whatsapp_configs WHERE org_id = ? ORDER BY created_at DESC').all(orgId) as WhatsAppConfig[]
  }

  getConfig(orgId: string, id: string): WhatsAppConfig | null {
    return db.prepare('SELECT * FROM whatsapp_configs WHERE id = ? AND org_id = ?').get(id, orgId) as WhatsAppConfig | null
  }

  updateConfig(orgId: string, id: string, updates: Partial<WhatsAppConfigInput>): void {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.phone_number_id !== undefined) { fields.push('phone_number_id = ?'); values.push(updates.phone_number_id) }
    if (updates.business_account_id !== undefined) { fields.push('business_account_id = ?'); values.push(updates.business_account_id) }
    if (updates.access_token !== undefined) { fields.push('access_token = ?'); values.push(updates.access_token) }
    if (updates.phone_display !== undefined) { fields.push('phone_display = ?'); values.push(updates.phone_display) }
    if (updates.daily_limit !== undefined) { fields.push('daily_limit = ?'); values.push(updates.daily_limit) }

    if (fields.length === 0) return
    fields.push("updated_at = datetime('now')")
    values.push(id, orgId)

    db.prepare(`UPDATE whatsapp_configs SET ${fields.join(', ')} WHERE id = ? AND org_id = ?`).run(...values)
  }

  deleteConfig(orgId: string, id: string): void {
    db.prepare('DELETE FROM whatsapp_configs WHERE id = ? AND org_id = ?').run(id, orgId)
  }

  // --------------------------------------------------------------------------
  // Template Management
  // --------------------------------------------------------------------------

  async syncTemplates(orgId: string, configId: string): Promise<number> {
    const config = this.getConfig(orgId, configId)
    if (!config) throw new Error('Config not found')
    if (!config.business_account_id) throw new Error('Business Account ID required to sync templates')

    const data = await this.metaApi(config, `/${config.business_account_id}/message_templates?limit=100`)
    const templates = data.data || []

    let synced = 0
    for (const tpl of templates) {
      const existing = db.prepare(
        'SELECT id FROM whatsapp_templates WHERE config_id = ? AND meta_template_name = ? AND language = ?'
      ).get(configId, tpl.name, tpl.language) as { id: string } | null

      const bodyComponent = (tpl.components || []).find((c: any) => c.type === 'BODY')
      const bodyText = bodyComponent?.text || null

      if (existing) {
        db.prepare(`
          UPDATE whatsapp_templates
          SET status = ?, components_json = ?, meta_template_id = ?, category = ?, body_text = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(tpl.status, JSON.stringify(tpl.components || []), tpl.id, tpl.category, bodyText, existing.id)
      } else {
        db.prepare(`
          INSERT INTO whatsapp_templates (id, org_id, config_id, meta_template_name, meta_template_id, language, category, status, components_json, body_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId('wat'), orgId, configId, tpl.name, tpl.id,
          tpl.language, tpl.category, tpl.status,
          JSON.stringify(tpl.components || []), bodyText
        )
      }
      synced++
    }

    return synced
  }

  getTemplates(orgId: string, configId?: string): WhatsAppTemplate[] {
    if (configId) {
      return db.prepare('SELECT * FROM whatsapp_templates WHERE org_id = ? AND config_id = ? ORDER BY meta_template_name').all(orgId, configId) as WhatsAppTemplate[]
    }
    return db.prepare('SELECT * FROM whatsapp_templates WHERE org_id = ? ORDER BY meta_template_name').all(orgId) as WhatsAppTemplate[]
  }

  async createTemplate(orgId: string, configId: string, input: WhatsAppTemplateInput): Promise<WhatsAppTemplate> {
    const config = this.getConfig(orgId, configId)
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

    db.prepare(`
      INSERT INTO whatsapp_templates (id, org_id, config_id, meta_template_name, meta_template_id, language, category, status, components_json, body_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(
      id, orgId, configId, input.name, result.id,
      input.language || 'en', input.category || 'MARKETING',
      JSON.stringify(input.components), bodyComponent?.text || null
    )

    return db.prepare('SELECT * FROM whatsapp_templates WHERE id = ?').get(id) as WhatsAppTemplate
  }

  async deleteTemplate(orgId: string, id: string): Promise<void> {
    const tpl = db.prepare('SELECT * FROM whatsapp_templates WHERE id = ? AND org_id = ?').get(id, orgId) as WhatsAppTemplate | null
    if (!tpl) throw new Error('Template not found')

    const config = this.getConfig(orgId, tpl.config_id)
    if (config?.business_account_id) {
      try {
        await this.metaApi(config, `/${config.business_account_id}/message_templates?name=${tpl.meta_template_name}`, 'DELETE')
      } catch {
        // Template may already be deleted on Meta's side
      }
    }
    db.prepare('DELETE FROM whatsapp_templates WHERE id = ? AND org_id = ?').run(id, orgId)
  }

  // --------------------------------------------------------------------------
  // Sending
  // --------------------------------------------------------------------------

  private resetDailyCountIfNeeded(config: WhatsAppConfig): void {
    const today = new Date().toISOString().split('T')[0]
    if (config.last_reset_date !== today) {
      db.prepare(`UPDATE whatsapp_configs SET sent_today = 0, last_reset_date = ?, updated_at = datetime('now') WHERE id = ?`).run(today, config.id)
      config.sent_today = 0
      config.last_reset_date = today
    }
  }

  async sendTemplate(orgId: string, configId: string, input: SendTemplateInput): Promise<WhatsAppMessage> {
    const config = this.getConfig(orgId, configId)
    if (!config) throw new Error('Config not found')
    if (config.status !== 'active') throw new Error('Config is not active')

    this.resetDailyCountIfNeeded(config)
    if (config.sent_today >= config.daily_limit) {
      throw new Error(`Daily limit reached (${config.daily_limit})`)
    }

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

    db.prepare(`
      INSERT INTO whatsapp_messages (id, org_id, config_id, campaign_id, contact_id, phone_number, message_type, content_json, status)
      VALUES (?, ?, ?, ?, ?, ?, 'template', ?, 'queued')
    `).run(msgId, orgId, configId, input.campaign_id || null, input.contact_id || null, cleanPhone, JSON.stringify(content))

    try {
      const result = await this.metaApi(config, `/${config.phone_number_id}/messages`, 'POST', content)
      const wamid = result.messages?.[0]?.id || null

      db.prepare(`UPDATE whatsapp_messages SET status = 'sent', wamid = ?, sent_at = datetime('now') WHERE id = ?`).run(wamid, msgId)
      db.prepare(`UPDATE whatsapp_configs SET sent_today = sent_today + 1, updated_at = datetime('now') WHERE id = ?`).run(configId)

      return db.prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(msgId) as WhatsAppMessage
    } catch (err: any) {
      db.prepare(`UPDATE whatsapp_messages SET status = 'failed', error_message = ? WHERE id = ?`).run(err.message, msgId)
      throw err
    }
  }

  async sendText(orgId: string, configId: string, phone: string, text: string, contactId?: string): Promise<WhatsAppMessage> {
    const config = this.getConfig(orgId, configId)
    if (!config) throw new Error('Config not found')
    if (config.status !== 'active') throw new Error('Config is not active')

    this.resetDailyCountIfNeeded(config)
    const msgId = generateId('wam')
    const cleanPhone = phone.replace(/\D/g, '')
    const content = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { body: text },
    }

    db.prepare(`
      INSERT INTO whatsapp_messages (id, org_id, config_id, contact_id, phone_number, message_type, content_json, status)
      VALUES (?, ?, ?, ?, ?, 'text', ?, 'queued')
    `).run(msgId, orgId, configId, contactId || null, cleanPhone, JSON.stringify(content))

    try {
      const result = await this.metaApi(config, `/${config.phone_number_id}/messages`, 'POST', content)
      const wamid = result.messages?.[0]?.id || null

      db.prepare(`UPDATE whatsapp_messages SET status = 'sent', wamid = ?, sent_at = datetime('now') WHERE id = ?`).run(wamid, msgId)
      db.prepare(`UPDATE whatsapp_configs SET sent_today = sent_today + 1, updated_at = datetime('now') WHERE id = ?`).run(configId)

      return db.prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(msgId) as WhatsAppMessage
    } catch (err: any) {
      db.prepare(`UPDATE whatsapp_messages SET status = 'failed', error_message = ? WHERE id = ?`).run(err.message, msgId)
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

  verifyToken(token: string): boolean {
    const result = db.prepare('SELECT id FROM whatsapp_configs WHERE webhook_verify_token = ? LIMIT 1').get(token)
    return !!result
  }

  processWebhook(payload: any): void {
    try {
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
              db.prepare(`UPDATE whatsapp_messages SET status = 'delivered', delivered_at = ? WHERE wamid = ?`)
                .run(new Date(parseInt(s.timestamp) * 1000).toISOString(), s.id)
            } else if (s.status === 'read') {
              db.prepare(`UPDATE whatsapp_messages SET status = 'read', read_at = ? WHERE wamid = ?`)
                .run(new Date(parseInt(s.timestamp) * 1000).toISOString(), s.id)
            } else if (s.status === 'failed') {
              const errorMsg = s.errors?.[0]?.message || 'Delivery failed'
              db.prepare(`UPDATE whatsapp_messages SET status = 'failed', error_message = ? WHERE wamid = ?`)
                .run(errorMsg, s.id)
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

  getMessages(orgId: string, filters?: { configId?: string; status?: string; limit?: number; offset?: number }): { messages: WhatsAppMessage[]; total: number } {
    let where = 'WHERE org_id = ?'
    const params: any[] = [orgId]

    if (filters?.configId) { where += ' AND config_id = ?'; params.push(filters.configId) }
    if (filters?.status) { where += ' AND status = ?'; params.push(filters.status) }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM whatsapp_messages ${where}`).get(...params) as any).count
    const limit = filters?.limit || 50
    const offset = filters?.offset || 0

    const messages = db.prepare(
      `SELECT * FROM whatsapp_messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as WhatsAppMessage[]

    return { messages, total }
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  getStats(orgId: string, configId?: string): WhatsAppStats {
    let where = 'WHERE org_id = ?'
    const params: any[] = [orgId]
    if (configId) { where += ' AND config_id = ?'; params.push(configId) }

    const row = db.prepare(`
      SELECT
        COUNT(*) as total_messages,
        SUM(CASE WHEN status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM whatsapp_messages ${where}
    `).get(...params) as any

    const total = row.total_messages || 0
    const sentCount = row.sent || 0

    return {
      total_messages: total,
      sent: sentCount,
      delivered: row.delivered || 0,
      read: row.read_count || 0,
      failed: row.failed || 0,
      delivery_rate: sentCount > 0 ? Math.round(((row.delivered || 0) / sentCount) * 100) : 0,
      read_rate: sentCount > 0 ? Math.round(((row.read_count || 0) / sentCount) * 100) : 0,
    }
  }
}

export const whatsappService = new WhatsAppService()
