/**
 * Cloudflare Tracking API — OAuth connect, Worker deployment, analytics
 */
import { api } from './client'

// ============================================================================
// Types
// ============================================================================

export interface CloudflareZone {
  id: string
  name: string
  status: string
  plan: string
  deployed: boolean
  deployment: TrackingDeployment | null
}

export interface TrackingDeployment {
  zoneId: string
  domain: string
  workerName: string
  d1DatabaseId: string
  openPath: string
  clickPath: string
  unsubPath: string
  useSubdomain: boolean
  subdomain?: string
  routeIds: string[]
  deployedAt: string
}

export interface TrackingStats {
  opens: number
  uniqueOpens: number
  clicks: number
  uniqueClicks: number
  unsubscribes: number
  topLinks: { url: string; clicks: number }[]
}

export interface DeployOptions {
  zoneId: string
  domain: string
  openPath?: string
  clickPath?: string
  unsubPath?: string
  useSubdomain?: boolean
  subdomain?: string
  orgId?: string
}

// ============================================================================
// Cloudflare API
// ============================================================================

export const cloudflareApi = {
  // OAuth credentials
  getOAuthConfig: async (): Promise<{ configured: boolean; clientId: string | null; clientSecret: string | null }> => {
    const res = await api.get<any>('/admin/platform/settings/cloudflare')
    return res.data!
  },

  saveOAuthConfig: async (clientId: string, clientSecret: string) => {
    const res = await api.put('/admin/platform/settings/cloudflare', { clientId, clientSecret })
    if (!res.success) throw new Error(res.message || 'Failed to save Cloudflare OAuth config')
  },

  // Connection
  getConnectUrl: async (orgId?: string): Promise<string> => {
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await api.get<{ authUrl: string }>(`/admin/cloudflare/connect${qs}`)
    if (!res.success) throw new Error(res.message || 'Failed to get auth URL')
    return res.data!.authUrl
  },

  getStatus: async (orgId?: string): Promise<{ connected: boolean; accountId?: string; accountName?: string }> => {
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await api.get<any>(`/admin/cloudflare/status${qs}`)
    return res.data!
  },

  // Zones
  listZones: async (orgId?: string): Promise<CloudflareZone[]> => {
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await api.get<{ zones: CloudflareZone[] }>(`/admin/cloudflare/zones${qs}`)
    return res.data?.zones || []
  },

  // Deploy / Undeploy
  deploy: async (options: DeployOptions): Promise<TrackingDeployment> => {
    const res = await api.post<TrackingDeployment>('/admin/cloudflare/deploy', options)
    if (!res.success) throw new Error(res.message || 'Deployment failed')
    return res.data!
  },

  undeploy: async (domain: string, orgId?: string) => {
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await api.delete(`/admin/cloudflare/undeploy/${domain}${qs}`)
    if (!res.success) throw new Error(res.message || 'Failed to remove deployment')
  },

  // Analytics
  getAnalytics: async (domain: string, orgId?: string): Promise<TrackingStats> => {
    const qs = new URLSearchParams({ domain })
    if (orgId) qs.set('orgId', orgId)
    const res = await api.get<TrackingStats>(`/admin/cloudflare/analytics?${qs}`)
    return res.data!
  },

  // Webhook status
  getWebhookStatus: async (): Promise<{ registered: boolean; status: any }> => {
    const res = await api.get<any>('/admin/platform/settings/webhook-status')
    return res.data!
  },
}
