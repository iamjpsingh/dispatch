/**
 * Campaign Query Composables
 */
import { computed, type Ref } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { campaignsApi, automationsApi, type CampaignInput } from '../api'
import { queryKeys } from './keys'

// ============================================================================
// Campaign Composables
// ============================================================================

export function useCampaigns(filters?: Ref<{ status?: string; type?: string; search?: string; page?: number }>) {
  const resolvedFilters = computed(() => (filters ? filters.value : undefined))

  return useQuery({
    queryKey: computed(() => queryKeys.campaigns.list(resolvedFilters.value)),
    queryFn: () => campaignsApi.list(resolvedFilters.value),
    staleTime: 10 * 1000,
  })
}

export function useCampaign(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.campaigns.detail(id.value)),
    queryFn: () => campaignsApi.get(id.value),
    enabled: computed(() => !!id.value),
  })
}

export function useCreateCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: campaignsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string } & Partial<CampaignInput>) => campaignsApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: campaignsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function useLaunchCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: campaignsApi.launch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function useCloneCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: campaignsApi.clone,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function usePauseCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: campaignsApi.pause,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function useCancelCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: campaignsApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function useArchiveCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: campaignsApi.archive,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all })
    },
  })
}

export function useCampaignStats(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.campaigns.stats(id.value)),
    queryFn: () => campaignsApi.getStats(id.value),
    enabled: computed(() => !!id.value),
    staleTime: 10 * 1000,
  })
}

// ============================================================================
// Automation Composables
// ============================================================================

export function useAutomations() {
  return useQuery({
    queryKey: queryKeys.automations.list,
    queryFn: automationsApi.list,
    staleTime: 30 * 1000,
  })
}

export function useAutomation(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.automations.detail(id.value)),
    queryFn: () => automationsApi.get(id.value),
    enabled: computed(() => !!id.value),
  })
}

export function useCreateAutomation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: automationsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automations.all })
    },
  })
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: automationsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automations.all })
    },
  })
}
