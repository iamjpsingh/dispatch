/**
 * Analytics, Segments, Webhooks, API Keys, Automations, Routing, Warmup, and Plugins APIs
 */
import { hc, type InferRequestType } from 'hono/client'
import type { AnalyticsRoutes } from '@dispatch/api/src/routes/analytics'
import type { SegmentsRoutes } from '@dispatch/api/src/routes/segments'
import type { WebhooksRoutes } from '@dispatch/api/src/routes/webhooks'
import type { ApiKeysRoutes } from '@dispatch/api/src/routes/apikeys'
import type { AutomationsRoutes } from '@dispatch/api/src/routes/automations'
import type { RoutingRoutes } from '@dispatch/api/src/routes/routing'
import type { WarmupRoutes } from '@dispatch/api/src/routes/warmup'
import type { PluginsRoutes } from '@dispatch/api/src/routes/plugins'
import { rpcBase, rpcFetch } from '../rpc/client'

const analyticsClient = hc<AnalyticsRoutes>(rpcBase(), { fetch: rpcFetch })
const segmentsClient = hc<SegmentsRoutes>(rpcBase(), { fetch: rpcFetch })
const webhooksClient = hc<WebhooksRoutes>(rpcBase(), { fetch: rpcFetch })
const apiKeysClient = hc<ApiKeysRoutes>(rpcBase(), { fetch: rpcFetch })
const automationsClient = hc<AutomationsRoutes>(rpcBase(), { fetch: rpcFetch })
const routingClient = hc<RoutingRoutes>(rpcBase(), { fetch: rpcFetch })
const warmupClient = hc<WarmupRoutes>(rpcBase(), { fetch: rpcFetch })
const pluginsClient = hc<PluginsRoutes>(rpcBase(), { fetch: rpcFetch })

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
    const res = await analyticsClient.analytics.summary.$get()
    const body = await res.json()
    return (
      (body.data as AnalyticsSummary | undefined) || {
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
    const res = await analyticsClient.analytics.campaigns[':campaignId'].$get({ param: { campaignId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Not found')
    return body.data as CampaignReport
  },
  listReports: async (limit?: number): Promise<CampaignReport[]> => {
    const res = await analyticsClient.analytics.campaigns.$get({ query: { limit: String(limit || 50) } })
    const body = await res.json()
    return (body.data as { reports: CampaignReport[] } | undefined)?.reports || []
  },
  getLinkClicks: async (campaignId: string): Promise<LinkClickData[]> => {
    const res = await analyticsClient.analytics.campaigns[':campaignId'].links.$get({ param: { campaignId } })
    const body = await res.json()
    return (body.data as { links: LinkClickData[] } | undefined)?.links || []
  },
  getDevices: async (campaignId?: string): Promise<any> => {
    const query = campaignId ? { campaign_id: campaignId } : {}
    const res = await analyticsClient.analytics.devices.$get({ query })
    const body = await res.json()
    return body.data
  },
  getGeo: async (campaignId?: string): Promise<any> => {
    const query = campaignId ? { campaign_id: campaignId } : {}
    const res = await analyticsClient.analytics.geo.$get({ query })
    const body = await res.json()
    return body.data
  },
  getTimeAnalysis: async (): Promise<any> => {
    const res = await analyticsClient.analytics.time.$get()
    const body = await res.json()
    return body.data
  },
  getEmailHealth: async (): Promise<EmailHealth> => {
    const res = await analyticsClient.analytics['email-health'].$get()
    const body = await res.json()
    return (body.data as EmailHealth | undefined) || { score: 0, rating: 'Poor', metrics: { bounce_rate: 0, complaint_rate: 0, unsubscribe_rate: 0, open_rate: 0, click_rate: 0, total_sent: 0 }, recommendations: [] }
  },

  export: async (format: string): Promise<Blob> => {
    const response = await rpcFetch(`${rpcBase()}/analytics/export?format=${format}`)
    if (!response.ok) throw new Error('Export failed')
    return response.blob()
  },
}

// ============================================================================
// Segments API
// ============================================================================

export const segmentsApi = {
  list: async () => {
    const res = await segmentsClient.segments.$get()
    const body = await res.json()
    return (body.data as { segments: any[] } | undefined)?.segments || []
  },
  create: async (input: { name: string; type?: string; rules?: any }) => {
    // Pre-existing drift: web passes { type?: string; rules?: any }; server schema
    // expects { type?: 'static'|'dynamic'; rules_json?; description? }. Reconcile post-P6.
    const res = await segmentsClient.segments.$post({ json: input as InferRequestType<typeof segmentsClient.segments.$post>['json'] })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data
  },
  delete: async (id: string) => {
    await segmentsClient.segments[':id'].$delete({ param: { id } })
  },
}

// ============================================================================
// Webhooks API
// ============================================================================

export const webhooksApi = {
  list: async () => {
    const res = await webhooksClient.webhooks.$get()
    const body = await res.json()
    return (body.data as { webhooks: any[] } | undefined)?.webhooks || []
  },
  get: async (id: string) => {
    const res = await webhooksClient.webhooks[':id'].$get({ param: { id } })
    const body = await res.json()
    return (body.data as { webhook: any } | undefined)?.webhook
  },
  create: async (input: { name: string; url: string; events: string[] }) => {
    const res = await webhooksClient.webhooks.$post({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data
  },
  update: async (id: string, input: { name?: string; url?: string; events?: string[] }) => {
    const res = await webhooksClient.webhooks[':id'].$put({ param: { id }, json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data
  },
  delete: async (id: string) => {
    await webhooksClient.webhooks[':id'].$delete({ param: { id } })
  },
  toggle: async (id: string, enabled: boolean) => {
    const res = await webhooksClient.webhooks[':id'].toggle.$post({ param: { id }, json: { enabled } })
    const body = await res.json()
    return body.data
  },
  test: async (id: string) => {
    const res = await webhooksClient.webhooks[':id'].test.$post({ param: { id } })
    const body = await res.json()
    return body.data
  },
  getLogs: async (id: string, limit = 20, offset = 0) => {
    // Route reads query without a zValidator, so the typed client exposes no query
    // input on this param'd path; use the fetch fallback to pass limit/offset.
    const res = await rpcFetch(`${rpcBase()}/webhooks/${id}/logs?limit=${limit}&offset=${offset}`)
    const body = await res.json()
    return (body.data as { logs: any[]; total: number } | undefined) || { logs: [], total: 0 }
  },
}

// ============================================================================
// API Keys API
// ============================================================================

export const apiKeysApi = {
  list: async () => {
    const res = await apiKeysClient['api-keys'].$get()
    const body = await res.json()
    return (body.data as { keys: any[] } | undefined)?.keys || []
  },
  create: async (input: { name: string; scopes?: string[]; expires_at?: string }): Promise<any> => {
    // Pre-existing drift: web typed scopes as string[]; server schema restricts to a
    // fixed scope enum. Reconcile post-P6.
    const res = await apiKeysClient['api-keys'].$post({ json: input as InferRequestType<typeof apiKeysClient['api-keys']['$post']>['json'] })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data
  },
  delete: async (id: string) => {
    await apiKeysClient['api-keys'][':id'].$delete({ param: { id } })
  },
  toggle: async (id: string, enabled: boolean) => {
    const res = await apiKeysClient['api-keys'][':id'].toggle.$post({ param: { id }, json: { enabled } })
    const body = await res.json()
    return body.data
  },
  updateScopes: async (id: string, scopes: string[]) => {
    // Pre-existing drift: web typed scopes as string[]; server schema restricts to a
    // fixed scope enum. Reconcile post-P6.
    const res = await apiKeysClient['api-keys'][':id'].scopes.$put({ param: { id }, json: { scopes } as InferRequestType<typeof apiKeysClient['api-keys'][':id']['scopes']['$put']>['json'] })
    const body = await res.json()
    return body.data
  },
}

// ============================================================================
// Automations API
// ============================================================================

export const automationsApi = {
  list: async (): Promise<Automation[]> => {
    const res = await automationsClient.automations.$get()
    const body = await res.json()
    return (body.data as { automations: Automation[] } | undefined)?.automations || []
  },

  get: async (id: string): Promise<Automation & { steps: any[] }> => {
    const res = await automationsClient.automations[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Not found')
    return body.data as Automation & { steps: any[] }
  },

  create: async (input: {
    name: string
    trigger_type: TriggerType
    description?: string
    flow?: any
  }): Promise<Automation> => {
    // Pre-existing drift: web passes { description?; flow? }; server schema expects
    // { trigger_config?; steps? }. Reconcile post-P6.
    const res = await automationsClient.automations.$post({ json: input as InferRequestType<typeof automationsClient.automations.$post>['json'] })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create')
    return body.data as Automation
  },

  update: async (id: string, updates: any) => {
    const res = await automationsClient.automations[':id'].$put({ param: { id }, json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update')
  },

  delete: async (id: string) => {
    const res = await automationsClient.automations[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete')
  },

  activate: async (id: string) => {
    await automationsClient.automations[':id'].activate.$post({ param: { id } })
  },
  pause: async (id: string) => {
    await automationsClient.automations[':id'].pause.$post({ param: { id } })
  },
  deactivate: async (id: string) => {
    await automationsClient.automations[':id'].deactivate.$post({ param: { id } })
  },

  getStats: async (id: string) => {
    const res = await automationsClient.automations[':id'].stats.$get({ param: { id } })
    const body = await res.json()
    return body.data
  },

  getEnrollments: async (id: string) => {
    const res = await automationsClient.automations[':id'].enrollments.$get({ param: { id } })
    const body = await res.json()
    return (body.data as { enrollments: any[] } | undefined)?.enrollments || []
  },
}

// ============================================================================
// Routing API
// ============================================================================

export const routingApi = {
  getScores: async (): Promise<{ scores: RoutingScore[] }> => {
    const res = await routingClient.routing.scores.$get()
    const body = await res.json()
    return (body.data as { scores: RoutingScore[] } | undefined) || { scores: [] }
  },
  getRecommendation: async (): Promise<{ decision: RoutingDecision }> => {
    const res = await routingClient.routing.recommend.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'No eligible providers')
    return body.data as { decision: RoutingDecision }
  },
  getDashboard: async () => {
    const res = await routingClient.routing.dashboard.$get()
    const body = await res.json()
    return body.data
  },
  getHistory: async (days?: number) => {
    const res = await routingClient.routing.history.$get({ query: days ? { days: String(days) } : {} })
    const body = await res.json()
    return (body.data as { history: any[] } | undefined)?.history || []
  },
  getConfig: async (): Promise<RoutingConfig> => {
    const res = await routingClient.routing.config.$get()
    const body = await res.json()
    return (
      (body.data as { config: RoutingConfig } | undefined)?.config || {
        weights: { quota: 0.4, success_rate: 0.35, speed: 0.15, cost: 0.1 },
        failover_enabled: true,
        min_success_rate: 0.8,
        max_avg_send_time_ms: 30000,
      }
    )
  },
  updateConfig: async (config: Partial<RoutingConfig>) => {
    const res = await routingClient.routing.config.$put({ json: config })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },
}

// ============================================================================
// Warmup API
// ============================================================================

export const warmupApi = {
  list: async (status?: string): Promise<WarmupPlan[]> => {
    const res = await warmupClient.warmup.$get({ query: status ? { status } : {} })
    const body = await res.json()
    return (body.data as { plans: WarmupPlan[] } | undefined)?.plans || []
  },
  get: async (id: string): Promise<WarmupPlan> => {
    const res = await warmupClient.warmup[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Not found')
    return body.data as WarmupPlan
  },
  getProgress: async (id: string) => {
    const res = await warmupClient.warmup[':id'].progress.$get({ param: { id } })
    const body = await res.json()
    return body.data
  },
  create: async (input: WarmupInput): Promise<WarmupPlan> => {
    const res = await warmupClient.warmup.$post({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data as WarmupPlan
  },
  pause: async (id: string) => {
    await warmupClient.warmup[':id'].pause.$post({ param: { id } })
  },
  resume: async (id: string) => {
    await warmupClient.warmup[':id'].resume.$post({ param: { id } })
  },
  cancel: async (id: string) => {
    await warmupClient.warmup[':id'].cancel.$post({ param: { id } })
  },
  delete: async (id: string) => {
    await warmupClient.warmup[':id'].$delete({ param: { id } })
  },
  getConfigStatus: async (configId: string) => {
    const res = await warmupClient.warmup.config[':configId'].$get({ param: { configId } })
    const body = await res.json()
    return body.data
  },
}

// ============================================================================
// Plugins API
// ============================================================================

export const pluginsApi = {
  list: async (type?: string): Promise<PluginInfo[]> => {
    const res = await pluginsClient.plugins.$get({ query: type ? { type } : {} })
    const body = await res.json()
    return (body.data as { plugins: PluginInfo[] } | undefined)?.plugins || []
  },
  get: async (id: string): Promise<PluginInfo> => {
    const res = await pluginsClient.plugins[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Not found')
    return body.data as PluginInfo
  },
  install: async (manifest: any, settings?: Record<string, any>): Promise<PluginInfo> => {
    const res = await pluginsClient.plugins.$post({ json: { manifest, settings } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data as PluginInfo
  },
  activate: async (id: string) => {
    await pluginsClient.plugins[':id'].activate.$post({ param: { id } })
  },
  disable: async (id: string) => {
    await pluginsClient.plugins[':id'].disable.$post({ param: { id } })
  },
  updateSettings: async (id: string, settings: Record<string, any>) => {
    await pluginsClient.plugins[':id'].settings.$put({ param: { id }, json: { settings } })
  },
  uninstall: async (id: string) => {
    await pluginsClient.plugins[':id'].$delete({ param: { id } })
  },
}
