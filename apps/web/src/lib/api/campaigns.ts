/**
 * Campaigns API
 */
import { hc, type InferRequestType } from 'hono/client'
import type { CampaignsRoutes } from '@dispatch/api/src/routes/campaigns'
import { type Pagination } from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<CampaignsRoutes>(rpcBase(), { fetch: rpcFetch })

// The web CampaignType union and the server CreateCampaignSchema `type` enum
// have pre-existing drift (web: one_time/recurring/automation; server:
// regular/ab_test/automated). The loose ApiClient never type-checked this; RPC
// does. Bridge create/update payloads to the server-inferred json shape at the
// boundary and reconcile the enums post-P6.
type CreateCampaignJson = InferRequestType<typeof client.campaigns.$post>['json']
type UpdateCampaignJson = InferRequestType<(typeof client.campaigns)[':id']['$put']>['json']

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
    const query: Record<string, string> = {}
    if (params)
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') query[k] = String(v)
      })
    const res = await client.campaigns.$get({ query })
    const body = await res.json()
    return {
      campaigns: (body.data as Campaign[]) || [],
      pagination: body.meta?.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 },
    }
  },

  get: async (id: string): Promise<Campaign> => {
    const res = await client.campaigns[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Campaign not found')
    return body.data as Campaign
  },

  create: async (input: CampaignInput): Promise<Campaign> => {
    const res = await client.campaigns.$post({ json: input as CreateCampaignJson })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create campaign')
    return body.data as Campaign
  },

  update: async (id: string, updates: Partial<CampaignInput>) => {
    const res = await client.campaigns[':id'].$put({ param: { id }, json: updates as UpdateCampaignJson })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update')
  },

  delete: async (id: string) => {
    const res = await client.campaigns[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete')
  },

  launch: async (id: string) => {
    await client.campaigns[':id'].launch.$post({ param: { id } })
  },
  pause: async (id: string) => {
    await client.campaigns[':id'].pause.$post({ param: { id } })
  },
  cancel: async (id: string) => {
    await client.campaigns[':id'].cancel.$post({ param: { id } })
  },
  clone: async (id: string): Promise<Campaign> => {
    const res = await client.campaigns[':id'].clone.$post({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to clone')
    return body.data as Campaign
  },
  archive: async (id: string) => {
    await client.campaigns[':id'].archive.$post({ param: { id } })
  },
  schedule: async (id: string, scheduledAt: string) => {
    await client.campaigns[':id'].schedule.$post({ param: { id }, json: { scheduled_at: scheduledAt } })
  },
  reschedule: async (id: string, scheduledAt: string) => {
    const res = await client.campaigns[':id'].reschedule.$post({ param: { id }, json: { scheduled_at: scheduledAt } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to reschedule')
  },

  getStats: async (id: string) => {
    const res = await client.campaigns[':id'].stats.$get({ param: { id } })
    const body = await res.json()
    return body.data
  },

  getDashboard: async () => {
    const res = await client.campaigns.dashboard.$get()
    const body = await res.json()
    return body.data
  },

  // Frequency capping
  getFrequencyCap: async (): Promise<FrequencyCapConfig> => {
    const res = await client.campaigns['frequency-cap'].$get()
    const body = await res.json()
    return (body.data as FrequencyCapConfig) || { maxPerWindow: 5, windowHours: 168, enabled: false }
  },

  setFrequencyCap: async (config: FrequencyCapConfig) => {
    const res = await client.campaigns['frequency-cap'].$put({ json: config })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update')
  },

  // A/B auto-winner
  setAutoWinner: async (id: string, metric: string, hours: number) => {
    const res = await client.campaigns[':id'].ab['auto-winner'].$put({
      param: { id },
      json: { winner_metric: metric as 'open_rate' | 'click_rate' | 'click_to_open_rate', auto_winner_after_hours: hours },
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  checkAutoWinner: async (id: string) => {
    const res = await client.campaigns[':id'].ab['check-winner'].$post({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data
  },

  // Graymail
  getGraymail: async (): Promise<{ config: GraymailConfig; stats: GraymailStats }> => {
    const res = await client.campaigns.graymail.$get()
    const body = await res.json()
    return (body.data as { config: GraymailConfig; stats: GraymailStats }) || {
      config: { enabled: false, threshold: 11 },
      stats: { totalTracked: 0, graymailCount: 0, graymailPercentage: 0 },
    }
  },

  setGraymail: async (config: GraymailConfig) => {
    const res = await client.campaigns.graymail.$put({ json: config })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  getGraymailContacts: async (limit = 50) => {
    const res = await client.campaigns.graymail.contacts.$get({ query: { limit: String(limit) } })
    const body = await res.json()
    return (body.data as { contacts: unknown[] } | undefined)?.contacts || []
  },

  getAtRiskContacts: async () => {
    const res = await client.campaigns.graymail['at-risk'].$get()
    const body = await res.json()
    return (body.data as { contacts: unknown[] } | undefined)?.contacts || []
  },

  resetGraymail: async (email: string) => {
    const res = await client.campaigns.graymail.reset[':email'].$post({ param: { email } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  // Rotation
  getRotation: async (id: string): Promise<RotationConfig> => {
    const res = await client.campaigns[':id'].rotation.$get({ param: { id } })
    const body = await res.json()
    return (body.data as RotationConfig) || { mode: 'smart', config_ids: [], weights: {} }
  },

  setRotation: async (id: string, config: RotationConfig) => {
    const res = await client.campaigns[':id'].rotation.$put({ param: { id }, json: config })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
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
