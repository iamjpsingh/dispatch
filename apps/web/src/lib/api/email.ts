/**
 * Email, Batch, Scheduled, and Queue APIs
 */
import { hc } from 'hono/client'
import type { SendRoutes } from '@dispatch/api/src/routes/send'
import type { QueueRoutes } from '@dispatch/api/src/routes/queue'
import { type BatchStatus, type ScheduledJob, type QueueJobSummary, type QueueStats } from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const sendClient = hc<SendRoutes>(rpcBase(), { fetch: rpcFetch })
const queueClient = hc<QueueRoutes>(rpcBase(), { fetch: rpcFetch })

// Email Sending
export const emailApi = {
  send: async (formData: FormData) => {
    // Multipart form upload; /send parses FormData manually (no zValidator) so use the fetch fallback.
    const res = await rpcFetch(`${rpcBase()}/send`, { method: 'POST', body: formData })
    const body = (await res.json()) as { success: boolean; message?: string; data?: { contactCount: number; jobId?: string; message: string } }
    if (!body.success) throw new Error(body.message || 'Failed to send emails')
    return body
  },

  parseExcel: async (file: File) => {
    const formData = new FormData()
    formData.append('excelFile', file)
    // Multipart upload; /parse-excel parses FormData manually.
    const res = await rpcFetch(`${rpcBase()}/parse-excel`, { method: 'POST', body: formData })
    const body = (await res.json()) as { success: boolean; message?: string; data?: { contacts: any[]; totalCount: number } }
    if (!body.success) throw new Error(body.message || 'Failed to parse Excel')
    return body.data
  },

  sendTestEmail: async (html: string, to: string, subject: string) => {
    // /send-test parses JSON manually (no zValidator); use the fetch fallback.
    const res = await rpcFetch(`${rpcBase()}/send-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, to, subject }),
    })
    const body = (await res.json()) as { success: boolean; message?: string; data?: { message: string } }
    if (!body.success) throw new Error(body.message || 'Failed to send test email')
    return body.data
  },

  checkSpamScore: async (html: string) => {
    // /spam-check parses JSON manually (no zValidator); use the fetch fallback.
    const res = await rpcFetch(`${rpcBase()}/spam-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    })
    const body = (await res.json()) as { success: boolean; message?: string; data?: { score: number; details: string[] } }
    if (!body.success) throw new Error(body.message || 'Failed to check spam score')
    return body.data
  },

  getProviderInfo: async (host: string, hasNotification: boolean) => {
    const formData = new FormData()
    formData.append('smtpHost', host)
    formData.append('hasNotification', String(hasNotification))
    // Multipart upload; /provider-info parses FormData manually.
    const res = await rpcFetch(`${rpcBase()}/provider-info`, { method: 'POST', body: formData })
    const body = (await res.json()) as { success: boolean; message?: string; data?: { provider: string; dailyLimit: number; maxContacts: number } }
    return body.data
  },
}

// Batch
export const batchApi = {
  getStatus: async (): Promise<BatchStatus> => {
    const res = await sendClient['batch-status'].$get()
    const body = await res.json()
    return (body.data as BatchStatus | undefined) || { isRunning: false, currentJob: null }
  },

  pause: async () => {
    await sendClient['batch-pause'].$post()
  },

  resume: async () => {
    await sendClient['batch-resume'].$post()
  },

  cancel: async () => {
    await sendClient['batch-cancel'].$delete()
  },
}

// Scheduled Jobs
export const scheduledApi = {
  list: async (): Promise<ScheduledJob[]> => {
    const res = await sendClient['scheduled-jobs'].$get()
    const body = await res.json()
    return (body.data as ScheduledJob[] | undefined) || []
  },

  cancel: async (jobId: string) => {
    const res = await sendClient['scheduled-jobs'][':id'].$delete({ param: { id: jobId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message || 'Failed to cancel job')
  },
}

// Queue
export const queueApi = {
  getJobs: async (status?: string): Promise<QueueJobSummary[]> => {
    // Route reads status from query without a zValidator, so the typed client exposes no
    // query input on this path; use the fetch fallback to pass status.
    const params = status ? `?status=${status}` : ''
    const res = await rpcFetch(`${rpcBase()}/queue/jobs${params}`)
    const body = (await res.json()) as { data?: QueueJobSummary[] }
    return body.data || []
  },

  getJob: async (jobId: string): Promise<QueueJobSummary> => {
    const res = await queueClient.queue.jobs[':id'].$get({ param: { id: jobId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message || 'Job not found')
    return body.data as QueueJobSummary
  },

  pauseJob: async (jobId: string) => {
    const res = await queueClient.queue.jobs[':id'].pause.$post({ param: { id: jobId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message || 'Failed to pause job')
  },

  resumeJob: async (jobId: string) => {
    const res = await queueClient.queue.jobs[':id'].resume.$post({ param: { id: jobId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message || 'Failed to resume job')
  },

  cancelJob: async (jobId: string) => {
    const res = await queueClient.queue.jobs[':id'].$delete({ param: { id: jobId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message || 'Failed to cancel job')
  },

  getStats: async (): Promise<QueueStats> => {
    const res = await queueClient.queue.stats.$get()
    const body = await res.json()
    return (
      (body.data as QueueStats | undefined) || {
        pending: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        total_sent: 0,
        total_failed: 0,
        dead_letters: 0,
      }
    )
  },
}
