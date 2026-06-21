/**
 * Cloudflare Tracking API — OAuth connect, Worker deployment, analytics
 */
import { hc } from 'hono/client'
import type { AdminRoutes } from '@dispatch/api/src/routes/admin'
import { rpcBase, rpcFetch } from '../rpc/client'

const adminClient = hc<AdminRoutes>(rpcBase(), { fetch: rpcFetch })

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
    const res = await adminClient.admin.platform.settings.cloudflare.$get()
    const body = await res.json()
    return body.data as { configured: boolean; clientId: string | null; clientSecret: string | null }
  },

  saveOAuthConfig: async (clientId: string, clientSecret: string) => {
    // Route parses JSON manually (no zValidator); use the fetch fallback.
    const res = await rpcFetch(`${rpcBase()}/admin/platform/settings/cloudflare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    })
    const body = (await res.json()) as { success: boolean; message?: string }
    if (!body.success) throw new Error(body.message || 'Failed to save Cloudflare OAuth config')
  },

  // Connection
  getConnectUrl: async (orgId?: string): Promise<string> => {
    // Route reads orgId from query without a zValidator; use the fetch fallback.
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await rpcFetch(`${rpcBase()}/admin/cloudflare/connect${qs}`)
    const body = (await res.json()) as { success: boolean; message?: string; data?: { authUrl: string } }
    if (!body.success) throw new Error(body.message || 'Failed to get auth URL')
    return body.data!.authUrl
  },

  getStatus: async (orgId?: string): Promise<{ connected: boolean; accountId?: string; accountName?: string }> => {
    // Route reads orgId from query without a zValidator; use the fetch fallback.
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await rpcFetch(`${rpcBase()}/admin/cloudflare/status${qs}`)
    const body = (await res.json()) as { data?: { connected: boolean; accountId?: string; accountName?: string } }
    return body.data!
  },

  // Zones
  listZones: async (orgId?: string): Promise<CloudflareZone[]> => {
    // Route reads orgId from query without a zValidator; use the fetch fallback.
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await rpcFetch(`${rpcBase()}/admin/cloudflare/zones${qs}`)
    const body = (await res.json()) as { data?: { zones: CloudflareZone[] } }
    return body.data?.zones || []
  },

  // Deploy / Undeploy
  deploy: async (options: DeployOptions): Promise<TrackingDeployment> => {
    // Route parses JSON manually (no zValidator); use the fetch fallback.
    const res = await rpcFetch(`${rpcBase()}/admin/cloudflare/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })
    const body = (await res.json()) as { success: boolean; message?: string; data?: TrackingDeployment }
    if (!body.success) throw new Error(body.message || 'Deployment failed')
    return body.data!
  },

  undeploy: async (domain: string, orgId?: string) => {
    // Route reads orgId from query without a zValidator; use the fetch fallback.
    const qs = orgId ? `?orgId=${orgId}` : ''
    const res = await rpcFetch(`${rpcBase()}/admin/cloudflare/undeploy/${domain}${qs}`, { method: 'DELETE' })
    const body = (await res.json()) as { success: boolean; message?: string }
    if (!body.success) throw new Error(body.message || 'Failed to remove deployment')
  },

  // Analytics
  getAnalytics: async (domain: string, orgId?: string): Promise<TrackingStats> => {
    // Route reads domain/orgId from query without a zValidator; use the fetch fallback.
    const qs = new URLSearchParams({ domain })
    if (orgId) qs.set('orgId', orgId)
    const res = await rpcFetch(`${rpcBase()}/admin/cloudflare/analytics?${qs}`)
    const body = (await res.json()) as { data?: TrackingStats }
    return body.data!
  },

  // Webhook status
  getWebhookStatus: async (): Promise<{ registered: boolean; status: any }> => {
    const res = await adminClient.admin.platform.settings['webhook-status'].$get()
    const body = await res.json()
    return body.data as { registered: boolean; status: any }
  },
}
