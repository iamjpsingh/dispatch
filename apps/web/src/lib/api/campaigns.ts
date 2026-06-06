/**
 * Campaigns API
 */
import { api, type Pagination } from './client'

// ============================================================================
// Campaign Types
// ============================================================================

export type CampaignType = 'one_time' | 'recurring' | 'ab_test' | 'automation'
export type CampaignStatus =
  | 'draft'
  | 'testing'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'archived'

export interface Campaign {
  id: string
  name: string
  type: CampaignType
  status: CampaignStatus
  template_id: string | null
  list_id: string | null
  subject: string
  from_name: string
  from_email: string
  total_recipients: number
  sent_count: number
  failed_count: number
  open_count: number
  click_count: number
  bounce_count: number
  unsubscribe_count: number
  scheduled_at: string | null
  sent_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface CampaignInput {
  name: string
  type?: CampaignType
  template_id?: string
  list_id?: string
  subject: string
  from_name: string
  from_email: string
  reply_to?: string
  tags?: string[]
  batch_size?: number
  email_delay?: number
  batch_delay?: number
}

// ============================================================================
// Campaigns API
// ============================================================================

export const campaignsApi = {
  list: async (params?: {
    status?: string
    type?: string
    search?: string
    page?: number
    limit?: number
  }): Promise<{ campaigns: Campaign[]; pagination: Pagination }> => {
    const qs = new URLSearchParams()
    if (params)
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      })
    const res = await api.get<Campaign[]>(`/campaigns?${qs}`)
    return {
      campaigns: (res as any).data || [],
      pagination: (res as any).meta?.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 },
    }
  },

  get: async (id: string): Promise<Campaign> => {
    const res = await api.get<Campaign>(`/campaigns/${id}`)
    if (!res.success) throw new Error(res.message || 'Campaign not found')
    return res.data!
  },

  create: async (input: CampaignInput): Promise<Campaign> => {
    const res = await api.post<Campaign>('/campaigns', input)
    if (!res.success) throw new Error(res.message || 'Failed to create campaign')
    return res.data!
  },

  update: async (id: string, updates: Partial<CampaignInput>) => {
    const res = await api.put(`/campaigns/${id}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update')
  },

  delete: async (id: string) => {
    const res = await api.delete(`/campaigns/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete')
  },

  launch: async (id: string) => {
    await api.post(`/campaigns/${id}/launch`)
  },
  pause: async (id: string) => {
    await api.post(`/campaigns/${id}/pause`)
  },
  cancel: async (id: string) => {
    await api.post(`/campaigns/${id}/cancel`)
  },
  clone: async (id: string): Promise<Campaign> => {
    const res = await api.post<Campaign>(`/campaigns/${id}/clone`)
    if (!res.success) throw new Error(res.message || 'Failed to clone')
    return res.data!
  },
  archive: async (id: string) => {
    await api.post(`/campaigns/${id}/archive`)
  },
  schedule: async (id: string, scheduledAt: string) => {
    await api.post(`/campaigns/${id}/schedule`, { scheduled_at: scheduledAt })
  },
  reschedule: async (id: string, scheduledAt: string) => {
    const res = await api.post(`/campaigns/${id}/reschedule`, { scheduled_at: scheduledAt })
    if (!res.success) throw new Error(res.message || 'Failed to reschedule')
  },

  getStats: async (id: string) => {
    const res = await api.get<any>(`/campaigns/${id}/stats`)
    return res.data
  },

  getDashboard: async () => {
    const res = await api.get<any>('/campaigns/dashboard')
    return res.data
  },

  // Frequency capping
  getFrequencyCap: async (): Promise<FrequencyCapConfig> => {
    const res = await api.get<FrequencyCapConfig>('/campaigns/frequency-cap')
    return res.data || { maxPerWindow: 5, windowHours: 168, enabled: false }
  },

  setFrequencyCap: async (config: FrequencyCapConfig) => {
    const res = await api.put('/campaigns/frequency-cap', config)
    if (!res.success) throw new Error(res.message || 'Failed to update')
  },

  // A/B auto-winner
  setAutoWinner: async (id: string, metric: string, hours: number) => {
    const res = await api.put(`/campaigns/${id}/ab/auto-winner`, { winner_metric: metric, auto_winner_after_hours: hours })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  checkAutoWinner: async (id: string) => {
    const res = await api.post<any>(`/campaigns/${id}/ab/check-winner`)
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data
  },

  // Graymail
  getGraymail: async (): Promise<{ config: GraymailConfig; stats: GraymailStats }> => {
    const res = await api.get<{ config: GraymailConfig; stats: GraymailStats }>('/campaigns/graymail')
    return res.data || { config: { enabled: false, threshold: 11 }, stats: { totalTracked: 0, graymailCount: 0, graymailPercentage: 0 } }
  },

  setGraymail: async (config: GraymailConfig) => {
    const res = await api.put('/campaigns/graymail', config)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  getGraymailContacts: async (limit = 50) => {
    const res = await api.get<{ contacts: any[] }>(`/campaigns/graymail/contacts?limit=${limit}`)
    return res.data?.contacts || []
  },

  getAtRiskContacts: async () => {
    const res = await api.get<{ contacts: any[] }>('/campaigns/graymail/at-risk')
    return res.data?.contacts || []
  },

  resetGraymail: async (email: string) => {
    const res = await api.post(`/campaigns/graymail/reset/${encodeURIComponent(email)}`)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  // Rotation
  getRotation: async (id: string): Promise<RotationConfig> => {
    const res = await api.get<RotationConfig>(`/campaigns/${id}/rotation`)
    return res.data || { mode: 'smart', config_ids: [], weights: {} }
  },

  setRotation: async (id: string, config: RotationConfig) => {
    const res = await api.put(`/campaigns/${id}/rotation`, config)
    if (!res.success) throw new Error(res.message || 'Failed')
  },
}

export interface RotationConfig {
  mode: 'smart' | 'manual' | 'round_robin' | 'weighted'
  config_ids?: string[]
  weights?: Record<string, number>
}

export interface FrequencyCapConfig {
  maxPerWindow: number
  windowHours: number
  enabled: boolean
}

export interface GraymailConfig {
  enabled: boolean
  threshold: number
}

export interface GraymailStats {
  totalTracked: number
  graymailCount: number
  graymailPercentage: number
}
