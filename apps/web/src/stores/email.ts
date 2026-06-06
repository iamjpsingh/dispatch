/**
 * Email Store
 * Uses TanStack Query for state management
 */
import { computed } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import {
  useLogs,
  useClearLogs,
  useBatchStatus,
  usePauseBatch,
  useResumeBatch,
  useCancelBatch,
  useScheduledJobs,
  useCancelScheduledJob,
  queryKeys,
} from '../lib/query'
import { emailApi } from '../lib/api'
import type { EmailLog, EmailStats, BatchStatus, ScheduledJob } from '../lib/api'

export type { EmailLog, EmailStats, BatchStatus, ScheduledJob }

/**
 * Email store composable
 */
export function useEmailStore() {
  const queryClient = useQueryClient()

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: emailApi.send,
    onSuccess: () => {
      // Invalidate reports after sending
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats })
    },
  })

  async function sendEmails(formData: FormData) {
    return sendMutation.mutateAsync(formData)
  }

  return {
    sending: computed(() => sendMutation.isPending.value),
    sendEmails,
  }
}

/**
 * Reports store composable
 */
export function useReportsStore(filters?: Record<string, any>) {
  const { data, isLoading, refetch } = useLogs(filters)
  const clearMutation = useClearLogs()

  return {
    logs: computed(() => data.value?.logs || []),
    stats: computed(() => data.value?.stats || { total: 0, sent: 0, failed: 0 }),
    pagination: computed(() => data.value?.pagination),
    loading: isLoading,
    refetch,
    clearLogs: (ids: string[]) => clearMutation.mutateAsync(ids),
    isClearing: computed(() => clearMutation.isPending.value),
  }
}

/**
 * Batch store composable
 */
export function useBatchStore() {
  const { data: status, isLoading, refetch } = useBatchStatus()
  const pauseMutation = usePauseBatch()
  const resumeMutation = useResumeBatch()
  const cancelMutation = useCancelBatch()

  return {
    status: computed(() => status.value || { isRunning: false, currentJob: null }),
    isRunning: computed(() => status.value?.isRunning || false),
    currentJob: computed(() => status.value?.currentJob),
    loading: isLoading,
    refetch,
    pause: () => pauseMutation.mutateAsync(),
    resume: () => resumeMutation.mutateAsync(),
    cancel: () => cancelMutation.mutateAsync(),
    isPausing: computed(() => pauseMutation.isPending.value),
    isResuming: computed(() => resumeMutation.isPending.value),
    isCancelling: computed(() => cancelMutation.isPending.value),
  }
}

/**
 * Scheduled jobs store composable
 */
export function useScheduledStore() {
  const { data: jobs, isLoading, refetch } = useScheduledJobs()
  const cancelMutation = useCancelScheduledJob()

  return {
    jobs: computed(() => jobs.value || []),
    loading: isLoading,
    refetch,
    cancelJob: (jobId: string) => cancelMutation.mutateAsync(jobId),
    isCancelling: computed(() => cancelMutation.isPending.value),
  }
}

/**
 * Dashboard store composable
 */
export function useDashboardStore() {
  const { data, isLoading, refetch } = useLogs()
  const { data: batchStatus } = useBatchStatus()
  const { data: scheduledJobs } = useScheduledJobs()

  return {
    stats: computed(() => data.value?.stats || { total: 0, sent: 0, failed: 0 }),
    recentLogs: computed(() => (data.value?.logs || []).slice(0, 10)),
    batchStatus: computed(() => batchStatus.value),
    scheduledJobs: computed(() => scheduledJobs.value || []),
    loading: isLoading,
    refetch,
  }
}
