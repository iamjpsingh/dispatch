/**
 * Config & OAuth APIs
 */
import { hc } from 'hono/client'
import type { ConfigRoutes } from '@dispatch/api/src/routes/config'
import type { OauthRoutes } from '@dispatch/api/src/routes/oauth'
import type { ReportRoutes } from '@dispatch/api/src/routes/report'
import type { DashboardRoutes } from '@dispatch/api/src/routes/dashboard'
import {
  type SMTPConfig,
  type ProviderStatus,
  type EmailLog,
  type EmailStats,
  type Pagination,
  type DashboardStats,
} from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<ConfigRoutes>(rpcBase(), { fetch: rpcFetch })
const oauthClient = hc<OauthRoutes>(rpcBase(), { fetch: rpcFetch })
const reportClient = hc<ReportRoutes>(rpcBase(), { fetch: rpcFetch })
const dashboardClient = hc<DashboardRoutes>(rpcBase(), { fetch: rpcFetch })

// Configs
export const configApi = {
  list: async (): Promise<SMTPConfig[]> => {
    const res = await client.config.list.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load configs')
    return (body.data as { configs: SMTPConfig[] } | undefined)?.configs || []
  },

  create: async (config: Partial<SMTPConfig> & { pass?: string }) => {
    const res = await client.config.smtp.$post({
      json: {
        name: config.name,
        host: config.host ?? '',
        port: config.port,
        secure: config.secure,
        user: config.user ?? '',
        pass: config.pass ?? '',
        fromEmail: config.from_email,
        fromName: config.from_name,
        isDefault: config.is_default,
      },
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create config')
    return (body.data as { configId: string } | undefined)?.configId
  },

  update: async (id: string, config: Partial<SMTPConfig> & { pass?: string }) => {
    const res = await client.config.smtp[':configId'].$put({
      param: { configId: id },
      json: {
        name: config.name,
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.user,
        pass: config.pass,
        fromEmail: config.from_email,
        fromName: config.from_name,
        isDefault: config.is_default,
      },
    })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update config')
  },

  delete: async (id: string) => {
    const res = await client.config.smtp[':configId'].$delete({ param: { configId: id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete config')
  },

  test: async (id: string) => {
    const res = await client.config.test[':configId'].$post({ param: { configId: id } })
    const body = await res.json()
    return { success: !!(body.success && (body.data as { valid: boolean } | undefined)?.valid), message: body.message ?? '' }
  },

  testConnection: async (config: { host: string; port: number; secure: boolean; user: string; pass: string }) => {
    const res = await client.config.smtp.test.$post({ json: config })
    const body = await res.json()
    return { success: !!(body.success && (body.data as { valid: boolean } | undefined)?.valid), message: body.message ?? '' }
  },
}

// OAuth
export const oauthApi = {
  getStatus: async (): Promise<Record<string, ProviderStatus>> => {
    const res = await oauthClient.oauth.status.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load OAuth status')
    return (body.data as { providers: Record<string, ProviderStatus> } | undefined)?.providers || {}
  },

  connect: async (provider: 'google' | 'microsoft'): Promise<string> => {
    // /oauth/google/connect and /oauth/microsoft/connect are distinct literal routes;
    // use the fetch fallback to keep the dynamic provider segment.
    const res = await rpcFetch(`${rpcBase()}/oauth/${provider}/connect`)
    const body = (await res.json()) as { success: boolean; message?: string; data?: { authUrl: string } }
    if (!body.success || !body.data?.authUrl) throw new Error(body.message || 'Failed to get auth URL')
    return body.data.authUrl
  },

  disconnect: async (configId: string) => {
    const res = await oauthClient.oauth[':configId'].disconnect.$delete({ param: { configId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to disconnect')
  },

  test: async (configId: string) => {
    const res = await oauthClient.oauth[':configId'].test.$post({ param: { configId } })
    const body = await res.json()
    return { success: !!(body.success && (body.data as { valid: boolean } | undefined)?.valid), message: body.message ?? '' }
  },
}

// Reports
export const reportApi = {
  getLogs: async (filters?: {
    status?: string
    send_type?: string
    provider?: string
    search?: string
    start_date?: string
    end_date?: string
    page?: number
    limit?: number
  }): Promise<{ logs: EmailLog[]; stats: EmailStats; pagination: Pagination }> => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, String(value))
        }
      })
    }
    // Route reads filters from query without a zValidator; use the fetch fallback.
    const res = await rpcFetch(`${rpcBase()}/report/logs?${params}`)
    const body = (await res.json()) as { success: boolean; message?: string; data?: { logs: EmailLog[]; stats: EmailStats; pagination: Pagination } }
    if (!body.success) throw new Error(body.message || 'Failed to load logs')
    return {
      logs: body.data?.logs || [],
      stats: body.data?.stats || { total: 0, sent: 0, failed: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
      pagination: body.data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 },
    }
  },

  getStats: async (): Promise<EmailStats> => {
    const res = await reportClient.report.stats.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load stats')
    return (body.data as EmailStats | undefined) || { total: 0, sent: 0, failed: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 }
  },

  deleteLog: async (id: string) => {
    const res = await reportClient.report.logs[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete log')
  },

  deleteLogs: async (ids: string[]) => {
    // /report/logs/delete-bulk parses JSON manually (no zValidator); use the fetch fallback.
    const res = await rpcFetch(`${rpcBase()}/report/logs/delete-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const body = (await res.json()) as { success: boolean; message?: string; data?: { deleted: number } }
    if (!body.success) throw new Error(body.message || 'Failed to delete logs')
    return body.data?.deleted || 0
  },
}

// Dashboard
export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const res = await dashboardClient.dashboard.stats.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load dashboard')
    const emptyQueue = {
      stats: {
        pending: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        total_sent: 0,
        total_failed: 0,
        dead_letters: 0,
      },
      activeJobs: [],
      pendingJobs: [],
      recentJobs: [],
    }
    return (
      (body.data as DashboardStats | undefined) || {
        stats: { total: 0, sent: 0, failed: 0 },
        queue: emptyQueue,
        scheduledJobs: [],
        recentLogs: [],
        timestamp: '',
      }
    )
  },

  getPollStatus: async () => {
    const res = await dashboardClient.dashboard['poll-status'].$get()
    const body = await res.json()
    return body.data as {
      pollNeeded: boolean
      pollInterval: number
      hasActiveJobs: boolean
      hasPendingJobs: boolean
      hasScheduledJobs: boolean
      activeJobCount: number
      pendingJobCount: number
      pausedJobCount: number
    } | undefined
  },
}
