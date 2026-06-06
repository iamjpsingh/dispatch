/**
 * Analytics, Segments, Webhooks, API Keys, Automations, Routing, Warmup, and Plugins APIs
 */
import { api } from './client'

// ============================================================================
// Analytics Types
// ============================================================================

export interface EmailHealth {
  score: number
  rating: 'Excellent' | 'Good' | 'Needs Improvement' | 'Poor'
  metrics: {
    bounce_rate: number
    complaint_rate: number
    unsubscribe_rate: number
    open_rate: number
    click_rate: number
    total_sent: number
  }
  recommendations: string[]
}

export interface AnalyticsSummary {
  total_campaigns: number
  total_emails_sent: number
  avg_open_rate: number
  avg_click_rate: number
  avg_bounce_rate: number
  avg_unsubscribe_rate: number
  top_performing_campaign: string | null
  best_send_time: { best_hour: number; best_day: string; confidence: number } | null
}

export interface CampaignReport {
  campaign_id: string
  campaign_name: string
  total_sent: number
  delivered: number
  failed: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number
  delivery_rate: number
  open_rate: number
  click_rate: number
  bounce_rate: number
  unsubscribe_rate: number
  click_to_open_rate: number
}

export interface LinkClickData {
  url: string
  click_count: number
  unique_clicks: number
}

// ============================================================================
// Routing Types
// ============================================================================

export interface RoutingScore {
  configId: string
  configName: string
  providerType: string
  totalScore: number
  quotaScore: number
  successScore: number
  speedScore: number
  costScore: number
  quotaRemaining: number
  successRate: number
  avgSendTime: number
}

export interface RoutingDecision {
  selectedConfigId: string
  selectedConfigName: string
  providerType: string
  score: number
  reason: string
  alternatives: RoutingScore[]
}

export interface RoutingConfig {
  weights: { quota: number; success_rate: number; speed: number; cost: number }
  failover_enabled: boolean
  min_success_rate: number
  max_avg_send_time_ms: number
}

// ============================================================================
// Warmup Types
// ============================================================================

export interface WarmupPlan {
  id: string
  config_id: string
  config_name: string
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  current_day: number
  total_days: number
  emails_sent_today: number
  daily_target: number
  started_at: string
  completed_at: string | null
  created_at: string
}

export interface WarmupInput {
  config_id: string
  config_name?: string
  schedule_type: 'conservative' | 'moderate' | 'aggressive' | 'custom'
  starting_volume?: number
  target_volume?: number
}

// ============================================================================
// Automation Types
// ============================================================================

export type TriggerType = 'list_join' | 'tag_added' | 'score_change' | 'date_field' | 'manual' | 'api'
export type AutomationStatus = 'draft' | 'active' | 'paused' | 'completed'

export interface Automation {
  id: string
  name: string
  description: string | null
  trigger_type: TriggerType
  status: AutomationStatus
  enrolled_count: number
  completed_count: number
  flow_json: string
  created_at: string
  updated_at: string
}

// ============================================================================
// Plugin Types
// ============================================================================

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  author: string
  type: 'provider' | 'hook' | 'template' | 'analytics'
  status: 'installed' | 'active' | 'disabled' | 'error'
  settings_json: string
  installed_at: string
}

// ============================================================================
// Analytics API
// ============================================================================

export const analyticsApi = {
  getSummary: async (): Promise<AnalyticsSummary> => {
    const res = await api.get<AnalyticsSummary>('/analytics/summary')
    return (
      res.data || {
        total_campaigns: 0,
        total_emails_sent: 0,
        avg_open_rate: 0,
        avg_click_rate: 0,
        avg_bounce_rate: 0,
        avg_unsubscribe_rate: 0,
        top_performing_campaign: null,
        best_send_time: null,
      }
    )
  },
  getCampaignReport: async (campaignId: string): Promise<CampaignReport> => {
    const res = await api.get<CampaignReport>(`/analytics/campaigns/${campaignId}`)
    if (!res.success) throw new Error(res.message || 'Not found')
    return res.data!
  },
  listReports: async (limit?: number): Promise<CampaignReport[]> => {
    const res = await api.get<{ reports: CampaignReport[] }>(`/analytics/campaigns?limit=${limit || 50}`)
    return res.data?.reports || []
  },
  getLinkClicks: async (campaignId: string): Promise<LinkClickData[]> => {
    const res = await api.get<{ links: LinkClickData[] }>(`/analytics/campaigns/${campaignId}/links`)
    return res.data?.links || []
  },
  getDevices: async (campaignId?: string) => {
    const params = campaignId ? `?campaign_id=${campaignId}` : ''
    const res = await api.get<any>(`/analytics/devices${params}`)
    return res.data
  },
  getGeo: async (campaignId?: string) => {
    const params = campaignId ? `?campaign_id=${campaignId}` : ''
    const res = await api.get<any>(`/analytics/geo${params}`)
    return res.data
  },
  getTimeAnalysis: async () => {
    const res = await api.get<any>('/analytics/time')
    return res.data
  },
  getEmailHealth: async (): Promise<EmailHealth> => {
    const res = await api.get<EmailHealth>('/analytics/email-health')
    return res.data || { score: 0, rating: 'Poor', metrics: { bounce_rate: 0, complaint_rate: 0, unsubscribe_rate: 0, open_rate: 0, click_rate: 0, total_sent: 0 }, recommendations: [] }
  },

  export: async (format: string): Promise<Blob> => {
    const response = await fetch(`/api/analytics/export?format=${format}`, {
      credentials: 'include',
      headers: {
        'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || '',
      },
    })
    if (!response.ok) throw new Error('Export failed')
    return response.blob()
  },
}

// ============================================================================
// Segments API
// ============================================================================

export const segmentsApi = {
  list: async () => {
    const res = await api.get<{ segments: any[] }>('/segments')
    return res.data?.segments || []
  },
  create: async (input: { name: string; type?: string; rules?: any }) => {
    const res = await api.post('/segments', input)
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data
  },
  delete: async (id: string) => {
    await api.delete(`/segments/${id}`)
  },
}

// ============================================================================
// Webhooks API
// ============================================================================

export const webhooksApi = {
  list: async () => {
    const res = await api.get<{ webhooks: any[] }>('/webhooks')
    return res.data?.webhooks || []
  },
  get: async (id: string) => {
    const res = await api.get<{ webhook: any }>(`/webhooks/${id}`)
    return res.data?.webhook
  },
  create: async (input: { name: string; url: string; events: string[] }) => {
    const res = await api.post('/webhooks', input)
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data
  },
  update: async (id: string, input: { name?: string; url?: string; events?: string[] }) => {
    const res = await api.put(`/webhooks/${id}`, input)
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data
  },
  delete: async (id: string) => {
    await api.delete(`/webhooks/${id}`)
  },
  toggle: async (id: string, enabled: boolean) => {
    const res = await api.post(`/webhooks/${id}/toggle`, { enabled })
    return res.data
  },
  test: async (id: string) => {
    const res = await api.post<{ success: boolean }>(`/webhooks/${id}/test`)
    return res.data
  },
  getLogs: async (id: string, limit = 20, offset = 0) => {
    const res = await api.get<{ logs: any[]; total: number }>(`/webhooks/${id}/logs?limit=${limit}&offset=${offset}`)
    return res.data || { logs: [], total: 0 }
  },
}

// ============================================================================
// API Keys API
// ============================================================================

export const apiKeysApi = {
  list: async () => {
    const res = await api.get<{ keys: any[] }>('/api-keys')
    return res.data?.keys || []
  },
  create: async (input: { name: string; scopes?: string[]; expires_at?: string }) => {
    const res = await api.post<any>('/api-keys', input)
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data
  },
  delete: async (id: string) => {
    await api.delete(`/api-keys/${id}`)
  },
  toggle: async (id: string, enabled: boolean) => {
    const res = await api.post(`/api-keys/${id}/toggle`, { enabled })
    return res.data
  },
  updateScopes: async (id: string, scopes: string[]) => {
    const res = await api.put(`/api-keys/${id}/scopes`, { scopes })
    return res.data
  },
}

// ============================================================================
// Automations API
// ============================================================================

export const automationsApi = {
  list: async (): Promise<Automation[]> => {
    const res = await api.get<{ automations: Automation[] }>('/automations')
    return res.data?.automations || []
  },

  get: async (id: string): Promise<Automation & { steps: any[] }> => {
    const res = await api.get<Automation & { steps: any[] }>(`/automations/${id}`)
    if (!res.success) throw new Error(res.message || 'Not found')
    return res.data!
  },

  create: async (input: {
    name: string
    trigger_type: TriggerType
    description?: string
    flow?: any
  }): Promise<Automation> => {
    const res = await api.post<Automation>('/automations', input)
    if (!res.success) throw new Error(res.message || 'Failed to create')
    return res.data!
  },

  update: async (id: string, updates: any) => {
    const res = await api.put(`/automations/${id}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update')
  },

  delete: async (id: string) => {
    const res = await api.delete(`/automations/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete')
  },

  activate: async (id: string) => {
    await api.post(`/automations/${id}/activate`)
  },
  pause: async (id: string) => {
    await api.post(`/automations/${id}/pause`)
  },
  deactivate: async (id: string) => {
    await api.post(`/automations/${id}/deactivate`)
  },

  getStats: async (id: string) => {
    const res = await api.get<any>(`/automations/${id}/stats`)
    return res.data
  },

  getEnrollments: async (id: string) => {
    const res = await api.get<{ enrollments: any[] }>(`/automations/${id}/enrollments`)
    return res.data?.enrollments || []
  },
}

// ============================================================================
// Routing API
// ============================================================================

export const routingApi = {
  getScores: async (): Promise<{ scores: RoutingScore[] }> => {
    const res = await api.get<{ scores: RoutingScore[] }>('/routing/scores')
    return res.data || { scores: [] }
  },
  getRecommendation: async (): Promise<{ decision: RoutingDecision }> => {
    const res = await api.get<{ decision: RoutingDecision }>('/routing/recommend')
    if (!res.success) throw new Error(res.message || 'No eligible providers')
    return res.data!
  },
  getDashboard: async () => {
    const res = await api.get<any>('/routing/dashboard')
    return res.data
  },
  getHistory: async (days?: number) => {
    const res = await api.get<{ history: any[] }>(`/routing/history${days ? `?days=${days}` : ''}`)
    return res.data?.history || []
  },
  getConfig: async (): Promise<RoutingConfig> => {
    const res = await api.get<{ config: RoutingConfig }>('/routing/config')
    return (
      res.data?.config || {
        weights: { quota: 0.4, success_rate: 0.35, speed: 0.15, cost: 0.1 },
        failover_enabled: true,
        min_success_rate: 0.8,
        max_avg_send_time_ms: 30000,
      }
    )
  },
  updateConfig: async (config: Partial<RoutingConfig>) => {
    const res = await api.put('/routing/config', config)
    if (!res.success) throw new Error(res.message || 'Failed')
  },
}

// ============================================================================
// Warmup API
// ============================================================================

export const warmupApi = {
  list: async (status?: string): Promise<WarmupPlan[]> => {
    const params = status ? `?status=${status}` : ''
    const res = await api.get<{ plans: WarmupPlan[] }>(`/warmup${params}`)
    return res.data?.plans || []
  },
  get: async (id: string): Promise<WarmupPlan> => {
    const res = await api.get<WarmupPlan>(`/warmup/${id}`)
    if (!res.success) throw new Error(res.message || 'Not found')
    return res.data!
  },
  getProgress: async (id: string) => {
    const res = await api.get<any>(`/warmup/${id}/progress`)
    return res.data
  },
  create: async (input: WarmupInput): Promise<WarmupPlan> => {
    const res = await api.post<WarmupPlan>('/warmup', input)
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data!
  },
  pause: async (id: string) => {
    await api.post(`/warmup/${id}/pause`)
  },
  resume: async (id: string) => {
    await api.post(`/warmup/${id}/resume`)
  },
  cancel: async (id: string) => {
    await api.post(`/warmup/${id}/cancel`)
  },
  delete: async (id: string) => {
    await api.delete(`/warmup/${id}`)
  },
  getConfigStatus: async (configId: string) => {
    const res = await api.get<any>(`/warmup/config/${configId}`)
    return res.data
  },
}

// ============================================================================
// Plugins API
// ============================================================================

export const pluginsApi = {
  list: async (type?: string): Promise<PluginInfo[]> => {
    const params = type ? `?type=${type}` : ''
    const res = await api.get<{ plugins: PluginInfo[] }>(`/plugins${params}`)
    return res.data?.plugins || []
  },
  get: async (id: string): Promise<PluginInfo> => {
    const res = await api.get<PluginInfo>(`/plugins/${id}`)
    if (!res.success) throw new Error(res.message || 'Not found')
    return res.data!
  },
  getProviders: async () => {
    const res = await api.get<{ providers: any[] }>('/plugins/providers')
    return res.data?.providers || []
  },
  install: async (manifest: any, settings?: Record<string, any>): Promise<PluginInfo> => {
    const res = await api.post<PluginInfo>('/plugins', { manifest, settings })
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data!
  },
  installProvider: async (providerName: string, settings: Record<string, any>) => {
    const res = await api.post('/plugins/providers/install', { providerName, settings })
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data
  },
  activate: async (id: string) => {
    await api.post(`/plugins/${id}/activate`)
  },
  disable: async (id: string) => {
    await api.post(`/plugins/${id}/disable`)
  },
  updateSettings: async (id: string, settings: Record<string, any>) => {
    await api.put(`/plugins/${id}/settings`, { settings })
  },
  uninstall: async (id: string) => {
    await api.delete(`/plugins/${id}`)
  },
}
