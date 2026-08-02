/**
 * Dashboard, Routing, Warmup, Analytics, and Plugins Query Composables
 */
import { computed, type Ref } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { dashboardApi, routingApi, warmupApi, analyticsApi, pluginsApi, type RoutingConfig } from '../api'
import { queryKeys } from './keys'

// ============================================================================
// Dashboard Composables
// ============================================================================

export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.dashboard.stats,
    queryFn: dashboardApi.getStats,
    staleTime: 5 * 1000, // 5 seconds
    refetchInterval: 30 * 1000, // Auto-refresh every 30 seconds
  })
}

export function usePollStatus() {
  return useQuery({
    queryKey: queryKeys.dashboard.pollStatus,
    queryFn: dashboardApi.getPollStatus,
    staleTime: 5 * 1000,
  })
}

// ============================================================================
// Routing Composables
// ============================================================================

export function useRoutingScores() {
  return useQuery({
    queryKey: queryKeys.routing.scores,
    queryFn: routingApi.getScores,
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
  })
}

export function useRoutingDashboard() {
  return useQuery({
    queryKey: queryKeys.routing.dashboard,
    queryFn: routingApi.getDashboard,
    staleTime: 10 * 1000,
  })
}

export function useRoutingConfig() {
  return useQuery({
    queryKey: queryKeys.routing.config,
    queryFn: routingApi.getConfig,
    staleTime: 60 * 1000,
  })
}

export function useUpdateRoutingConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<RoutingConfig>) => routingApi.updateConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routing'] })
    },
  })
}

// ============================================================================
// Warmup Composables
// ============================================================================

export function useWarmupPlans(status?: string) {
  return useQuery({
    queryKey: queryKeys.warmup.list(status),
    queryFn: () => warmupApi.list(status),
    staleTime: 30 * 1000,
  })
}

export function useWarmupPlan(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.warmup.detail(id.value)),
    queryFn: () => warmupApi.get(id.value),
    enabled: computed(() => !!id.value),
  })
}

export function useWarmupProgress(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.warmup.progress(id.value)),
    queryFn: () => warmupApi.getProgress(id.value),
    enabled: computed(() => !!id.value),
    refetchInterval: 60 * 1000,
  })
}

export function useCreateWarmup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: warmupApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warmup.all })
    },
  })
}

export function usePauseWarmup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: warmupApi.pause,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warmup.all })
    },
  })
}

export function useResumeWarmup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: warmupApi.resume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warmup.all })
    },
  })
}

export function useCancelWarmup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: warmupApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warmup.all })
    },
  })
}

// ============================================================================
// Analytics Composables
// ============================================================================

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: queryKeys.analytics.summary,
    queryFn: analyticsApi.getSummary,
    staleTime: 60 * 1000,
  })
}

export function useAnalyticsReports() {
  return useQuery({
    queryKey: queryKeys.analytics.reports,
    queryFn: () => analyticsApi.listReports(),
    staleTime: 30 * 1000,
  })
}

export function useCampaignAnalytics(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.analytics.campaign(id.value)),
    queryFn: () => analyticsApi.getCampaignReport(id.value),
    enabled: computed(() => !!id.value),
  })
}

export function useDeviceAnalytics() {
  return useQuery({
    queryKey: queryKeys.analytics.devices,
    queryFn: () => analyticsApi.getDevices(),
    staleTime: 60 * 1000,
  })
}

export function useTimeAnalysis() {
  return useQuery({
    queryKey: queryKeys.analytics.time,
    queryFn: analyticsApi.getTimeAnalysis,
    staleTime: 60 * 1000,
  })
}

// ============================================================================
// Plugins Composables
// ============================================================================

export function usePlugins(type?: string) {
  return useQuery({
    queryKey: queryKeys.plugins.list(type),
    queryFn: () => pluginsApi.list(type),
    staleTime: 30 * 1000,
  })
}

export function useInstallPlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ manifest, settings }: { manifest: any; settings?: Record<string, any> }) =>
      pluginsApi.install(manifest, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all })
    },
  })
}

export function useActivatePlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: pluginsApi.activate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all })
    },
  })
}

export function useDisablePlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: pluginsApi.disable,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all })
    },
  })
}

export function useUninstallPlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: pluginsApi.uninstall,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all })
    },
  })
}
