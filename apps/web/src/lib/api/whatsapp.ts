/**
 * WhatsApp Business API
 */
import { hc, type InferRequestType } from 'hono/client'
import type { WhatsappRoutes } from '@dispatch/api/src/routes/whatsapp'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<WhatsappRoutes>(rpcBase(), { fetch: rpcFetch })

// The web createTemplate input types `category` as a bare string and
// `components` as any[], while the server CreateTemplateSchema constrains
// `category` to a MARKETING/UTILITY/AUTHENTICATION enum. The loose ApiClient
// never type-checked this; RPC does. Bridge the payload to the server-inferred
// json shape at the boundary and reconcile the category type post-P6.
type CreateTemplateJson = InferRequestType<typeof client.whatsapp.templates.$post>['json']

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
// API
// ============================================================================

export const whatsappApi = {
  // Configs
  getConfigs: async (): Promise<WhatsAppConfig[]> => {
    const res = await client.whatsapp.configs.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load configs')
    return (body.data as { configs: WhatsAppConfig[] } | undefined)?.configs || []
  },

  getConfig: async (id: string): Promise<WhatsAppConfig> => {
    const res = await client.whatsapp.configs[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Config not found')
    return body.data as WhatsAppConfig
  },

  createConfig: async (input: WhatsAppConfigInput): Promise<WhatsAppConfig> => {
    const res = await client.whatsapp.configs.$post({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create config')
    return body.data as WhatsAppConfig
  },

  updateConfig: async (id: string, updates: Partial<WhatsAppConfigInput>) => {
    const res = await client.whatsapp.configs[':id'].$put({ param: { id }, json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update config')
  },

  deleteConfig: async (id: string) => {
    const res = await client.whatsapp.configs[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete config')
  },

  // Templates
  getTemplates: async (configId?: string): Promise<WhatsAppTemplate[]> => {
    const res = await client.whatsapp.templates.$get({ query: configId ? { config_id: configId } : {} })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load templates')
    return (body.data as { templates: WhatsAppTemplate[] } | undefined)?.templates || []
  },

  syncTemplates: async (configId: string): Promise<number> => {
    const res = await client.whatsapp.templates.sync.$post({ json: { config_id: configId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to sync templates')
    return (body.data as { synced: number } | undefined)?.synced || 0
  },

  createTemplate: async (input: { config_id: string; name: string; language: string; category: string; components: any[] }): Promise<WhatsAppTemplate> => {
    const res = await client.whatsapp.templates.$post({ json: input as CreateTemplateJson })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create template')
    return body.data as WhatsAppTemplate
  },

  deleteTemplate: async (id: string) => {
    const res = await client.whatsapp.templates[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete template')
  },

  // Sending
  sendTemplate: async (configId: string, phone: string, templateName: string, language = 'en', components?: any[]) => {
    const res = await client.whatsapp.send.$post({
      json: {
        config_id: configId,
        phone,
        template_name: templateName,
        language,
        components,
      },
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to send message')
    return body.data
  },

  sendText: async (configId: string, phone: string, text: string) => {
    const res = await client.whatsapp['send-text'].$post({ json: { config_id: configId, phone, text } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to send message')
    return body.data
  },

  sendBulk: async (configId: string, templateName: string, recipients: { phone: string; params?: string[] }[], language = 'en') => {
    const res = await client.whatsapp['send-bulk'].$post({
      json: {
        config_id: configId,
        template_name: templateName,
        recipients,
        language,
      },
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Bulk send failed')
    return body.data as { sent: number; failed: number }
  },

  // Messages
  getMessages: async (filters?: { configId?: string; status?: string; limit?: number; offset?: number }): Promise<{ messages: WhatsAppMessage[]; total: number }> => {
    const query: Record<string, string> = {}
    if (filters?.configId) query.config_id = filters.configId
    if (filters?.status) query.status = filters.status
    if (filters?.limit) query.limit = String(filters.limit)
    if (filters?.offset) query.offset = String(filters.offset)
    const res = await client.whatsapp.messages.$get({ query })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load messages')
    return (body.data as { messages: WhatsAppMessage[]; total: number } | undefined) || { messages: [], total: 0 }
  },

  // Stats
  getStats: async (configId?: string): Promise<WhatsAppStats> => {
    const res = await client.whatsapp.stats.$get({ query: configId ? { config_id: configId } : {} })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load stats')
    return body.data as WhatsAppStats
  },
}
