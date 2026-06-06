/**
 * Email, Batch, Scheduled, and Queue APIs
 */
import { api, type BatchStatus, type ScheduledJob, type QueueJobSummary, type QueueStats } from './client'

// Email Sending
export const emailApi = {
  send: async (formData: FormData) => {
    const res = await api.upload<{ contactCount: number; jobId?: string; message: string }>('/send', formData)
    if (!res.success) throw new Error(res.message || 'Failed to send emails')
    return res
  },

  parseExcel: async (file: File) => {
    const formData = new FormData()
    formData.append('excelFile', file)
    const res = await api.upload<{ contacts: any[]; totalCount: number }>('/parse-excel', formData)
    if (!res.success) throw new Error(res.message || 'Failed to parse Excel')
    return res.data
  },

  sendTestEmail: async (html: string, to: string, subject: string) => {
    const res = await api.post<{ message: string }>('/send-test', { html, to, subject })
    if (!res.success) throw new Error(res.message || 'Failed to send test email')
    return res.data
  },

  checkSpamScore: async (html: string) => {
    const res = await api.post<{ score: number; details: string[] }>('/spam-check', { html })
    if (!res.success) throw new Error(res.message || 'Failed to check spam score')
    return res.data
  },

  getProviderInfo: async (host: string, hasNotification: boolean) => {
    const formData = new FormData()
    formData.append('smtpHost', host)
    formData.append('hasNotification', String(hasNotification))
    const res = await api.upload<{ provider: string; dailyLimit: number; maxContacts: number }>(
      '/provider-info',
      formData
    )
    return res.data
  },
}

// Batch
export const batchApi = {
  getStatus: async (): Promise<BatchStatus> => {
    const res = await api.get<BatchStatus>('/batch-status')
    return res.data || { isRunning: false, currentJob: null }
  },

  pause: async () => {
    await api.post('/batch-pause')
  },

  resume: async () => {
    await api.post('/batch-resume')
  },

  cancel: async () => {
    await api.delete('/batch-cancel')
  },
}

// Scheduled Jobs
export const scheduledApi = {
  list: async (): Promise<ScheduledJob[]> => {
    const res = await api.get<ScheduledJob[]>('/scheduled-jobs')
    return res.data || []
  },

  cancel: async (jobId: string) => {
    const res = await api.delete(`/scheduled-jobs/${jobId}`)
    if (!res.success) throw new Error(res.message || 'Failed to cancel job')
  },
}

// Queue
export const queueApi = {
  getJobs: async (status?: string): Promise<QueueJobSummary[]> => {
    const params = status ? `?status=${status}` : ''
    const res = await api.get<QueueJobSummary[]>(`/queue/jobs${params}`)
    return res.data || []
  },

  getJob: async (jobId: string): Promise<QueueJobSummary> => {
    const res = await api.get<QueueJobSummary>(`/queue/jobs/${jobId}`)
    if (!res.success) throw new Error(res.message || 'Job not found')
    return res.data!
  },

  pauseJob: async (jobId: string) => {
    const res = await api.post(`/queue/jobs/${jobId}/pause`)
    if (!res.success) throw new Error(res.message || 'Failed to pause job')
  },

  resumeJob: async (jobId: string) => {
    const res = await api.post(`/queue/jobs/${jobId}/resume`)
    if (!res.success) throw new Error(res.message || 'Failed to resume job')
  },

  cancelJob: async (jobId: string) => {
    const res = await api.delete(`/queue/jobs/${jobId}`)
    if (!res.success) throw new Error(res.message || 'Failed to cancel job')
  },

  getStats: async (): Promise<QueueStats> => {
    const res = await api.get<QueueStats>('/queue/stats')
    return (
      res.data || {
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
