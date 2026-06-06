/**
 * Email, Batch, Scheduled, Queue, and Report Query Composables
 */
import { computed, isRef, type Ref, type ComputedRef } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { reportApi, batchApi, scheduledApi, queueApi } from '../api'
import { queryKeys } from './keys'

// ============================================================================
// Report Composables
// ============================================================================

type LogFilters = {
  status?: string
  send_type?: string
  provider?: string
  search?: string
  start_date?: string
  end_date?: string
  page?: number
  limit?: number
}

export function useLogs(filters?: LogFilters | Ref<LogFilters> | ComputedRef<LogFilters>) {
  // Support both reactive and non-reactive filters
  const resolvedFilters = computed<LogFilters | undefined>(() => {
    if (!filters) return undefined
    if (isRef(filters)) return filters.value
    return filters
  })

  return useQuery({
    queryKey: computed(() => queryKeys.reports.logs(resolvedFilters.value)),
    queryFn: () => reportApi.getLogs(resolvedFilters.value),
    staleTime: 10 * 1000, // 10 seconds
  })
}

export function useStats() {
  return useQuery({
    queryKey: queryKeys.reports.stats(),
    queryFn: reportApi.getStats,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useClearLogs() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => reportApi.deleteLogs(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}

export function useDeleteLog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reportApi.deleteLog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}

// ============================================================================
// Batch Composables
// ============================================================================

export function useBatchStatus() {
  return useQuery({
    queryKey: queryKeys.batch.status,
    queryFn: batchApi.getStatus,
    staleTime: 3 * 1000, // 3 seconds for active monitoring
  })
}

export function usePauseBatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: batchApi.pause,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.batch.status })
    },
  })
}

export function useResumeBatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: batchApi.resume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.batch.status })
    },
  })
}

export function useCancelBatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: batchApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.batch.status })
    },
  })
}

// ============================================================================
// Scheduled Jobs Composables
// ============================================================================

export function useScheduledJobs() {
  return useQuery({
    queryKey: queryKeys.scheduled.list,
    queryFn: scheduledApi.list,
    staleTime: 10 * 1000, // 10 seconds
  })
}

export function useCancelScheduledJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: scheduledApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduled.list })
    },
  })
}

// ============================================================================
// Queue Composables
// ============================================================================

export function useQueueJobs(status?: string) {
  return useQuery({
    queryKey: queryKeys.queue.jobs(status),
    queryFn: () => queueApi.getJobs(status),
    staleTime: 5 * 1000,
    refetchInterval: 10 * 1000,
  })
}

export function useQueueStats() {
  return useQuery({
    queryKey: queryKeys.queue.stats,
    queryFn: queueApi.getStats,
    staleTime: 5 * 1000,
    refetchInterval: 15 * 1000,
  })
}

export function usePauseJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: queueApi.pauseJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats })
    },
  })
}

export function useResumeJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: queueApi.resumeJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats })
    },
  })
}

export function useCancelJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: queueApi.cancelJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats })
    },
  })
}
