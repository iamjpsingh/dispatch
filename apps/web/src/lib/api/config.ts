/**
 * Config & OAuth APIs
 */
import { hc } from 'hono/client'
import type { ConfigRoutes } from '@dispatch/api/src/routes/config'
import {
  api,
  type SMTPConfig,
  type ProviderStatus,
  type EmailLog,
  type EmailStats,
  type Pagination,
  type DashboardStats,
} from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<ConfigRoutes>(rpcBase(), { fetch: rpcFetch })

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
    const res = await api.get<{ providers: Record<string, ProviderStatus> }>('/oauth/status')
    if (!res.success) throw new Error(res.message || 'Failed to load OAuth status')
    return res.data?.providers || {}
  },

  connect: async (provider: 'google' | 'microsoft'): Promise<string> => {
    const res = await api.get<{ authUrl: string }>(`/oauth/${provider}/connect`)
    if (!res.success || !res.data?.authUrl) throw new Error(res.message || 'Failed to get auth URL')
    return res.data.authUrl
  },

  disconnect: async (configId: string) => {
    const res = await api.delete(`/oauth/${configId}/disconnect`)
    if (!res.success) throw new Error(res.message || 'Failed to disconnect')
  },

  test: async (configId: string) => {
    const res = await api.post<{ valid: boolean }>(`/oauth/${configId}/test`)
    return { success: !!(res.success && res.data?.valid), message: res.message || '' }
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
    const res = await api.get<{ logs: EmailLog[]; stats: EmailStats; pagination: Pagination }>(`/report/logs?${params}`)
    if (!res.success) throw new Error(res.message || 'Failed to load logs')
    return {
      logs: res.data?.logs || [],
      stats: res.data?.stats || { total: 0, sent: 0, failed: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
      pagination: res.data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 },
    }
  },

  getStats: async (): Promise<EmailStats> => {
    const res = await api.get<EmailStats>('/report/stats')
    if (!res.success) throw new Error(res.message || 'Failed to load stats')
    return res.data || { total: 0, sent: 0, failed: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 }
  },

  deleteLog: async (id: string) => {
    const res = await api.delete(`/report/logs/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete log')
  },

  deleteLogs: async (ids: string[]) => {
    const res = await api.post<{ deleted: number }>('/report/logs/delete-bulk', { ids })
    if (!res.success) throw new Error(res.message || 'Failed to delete logs')
    return res.data?.deleted || 0
  },
}

// Dashboard
export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const res = await api.get<DashboardStats>('/dashboard/stats')
    if (!res.success) throw new Error(res.message || 'Failed to load dashboard')
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
      res.data || {
        stats: { total: 0, sent: 0, failed: 0 },
        queue: emptyQueue,
        scheduledJobs: [],
        recentLogs: [],
        timestamp: '',
      }
    )
  },

  getPollStatus: async () => {
    const res = await api.get<{
      pollNeeded: boolean
      pollInterval: number
      hasActiveJobs: boolean
      hasPendingJobs: boolean
      hasScheduledJobs: boolean
      activeJobCount: number
      pendingJobCount: number
      pausedJobCount: number
    }>('/dashboard/poll-status')
    return res.data
  },
}
