/**
 * WhatsApp Business API
 */
import { api } from './client'

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
    const res = await api.get<{ configs: WhatsAppConfig[] }>('/whatsapp/configs')
    if (!res.success) throw new Error(res.message || 'Failed to load configs')
    return res.data?.configs || []
  },

  getConfig: async (id: string): Promise<WhatsAppConfig> => {
    const res = await api.get<WhatsAppConfig>(`/whatsapp/configs/${id}`)
    if (!res.success) throw new Error(res.message || 'Config not found')
    return res.data!
  },

  createConfig: async (input: WhatsAppConfigInput): Promise<WhatsAppConfig> => {
    const res = await api.post<WhatsAppConfig>('/whatsapp/configs', input)
    if (!res.success) throw new Error(res.message || 'Failed to create config')
    return res.data!
  },

  updateConfig: async (id: string, updates: Partial<WhatsAppConfigInput>) => {
    const res = await api.put(`/whatsapp/configs/${id}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update config')
  },

  deleteConfig: async (id: string) => {
    const res = await api.delete(`/whatsapp/configs/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete config')
  },

  // Templates
  getTemplates: async (configId?: string): Promise<WhatsAppTemplate[]> => {
    const qs = configId ? `?config_id=${configId}` : ''
    const res = await api.get<{ templates: WhatsAppTemplate[] }>(`/whatsapp/templates${qs}`)
    if (!res.success) throw new Error(res.message || 'Failed to load templates')
    return res.data?.templates || []
  },

  syncTemplates: async (configId: string): Promise<number> => {
    const res = await api.post<{ synced: number }>('/whatsapp/templates/sync', { config_id: configId })
    if (!res.success) throw new Error(res.message || 'Failed to sync templates')
    return res.data?.synced || 0
  },

  createTemplate: async (input: { config_id: string; name: string; language: string; category: string; components: any[] }): Promise<WhatsAppTemplate> => {
    const res = await api.post<WhatsAppTemplate>('/whatsapp/templates', input)
    if (!res.success) throw new Error(res.message || 'Failed to create template')
    return res.data!
  },

  deleteTemplate: async (id: string) => {
    const res = await api.delete(`/whatsapp/templates/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete template')
  },

  // Sending
  sendTemplate: async (configId: string, phone: string, templateName: string, language = 'en', components?: any[]) => {
    const res = await api.post('/whatsapp/send', {
      config_id: configId,
      phone,
      template_name: templateName,
      language,
      components,
    })
    if (!res.success) throw new Error(res.message || 'Failed to send message')
    return res.data
  },

  sendText: async (configId: string, phone: string, text: string) => {
    const res = await api.post('/whatsapp/send-text', { config_id: configId, phone, text })
    if (!res.success) throw new Error(res.message || 'Failed to send message')
    return res.data
  },

  sendBulk: async (configId: string, templateName: string, recipients: { phone: string; params?: string[] }[], language = 'en') => {
    const res = await api.post<{ sent: number; failed: number }>('/whatsapp/send-bulk', {
      config_id: configId,
      template_name: templateName,
      recipients,
      language,
    })
    if (!res.success) throw new Error(res.message || 'Bulk send failed')
    return res.data!
  },

  // Messages
  getMessages: async (filters?: { configId?: string; status?: string; limit?: number; offset?: number }): Promise<{ messages: WhatsAppMessage[]; total: number }> => {
    const qs = new URLSearchParams()
    if (filters?.configId) qs.set('config_id', filters.configId)
    if (filters?.status) qs.set('status', filters.status)
    if (filters?.limit) qs.set('limit', String(filters.limit))
    if (filters?.offset) qs.set('offset', String(filters.offset))
    const res = await api.get<{ messages: WhatsAppMessage[]; total: number }>(`/whatsapp/messages?${qs}`)
    if (!res.success) throw new Error(res.message || 'Failed to load messages')
    return res.data || { messages: [], total: 0 }
  },

  // Stats
  getStats: async (configId?: string): Promise<WhatsAppStats> => {
    const qs = configId ? `?config_id=${configId}` : ''
    const res = await api.get<WhatsAppStats>(`/whatsapp/stats${qs}`)
    if (!res.success) throw new Error(res.message || 'Failed to load stats')
    return res.data!
  },
}
