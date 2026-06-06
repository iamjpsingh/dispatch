/**
 * Template Query Composables
 */
import { computed, isRef, type Ref, type ComputedRef } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { templatesApi, type TemplateInput } from '../api'
import { queryKeys } from './keys'

export function useTemplates(
  filters?:
    | Ref<{ category?: string; search?: string; page?: number }>
    | ComputedRef<{ category?: string; search?: string; page?: number }>
) {
  const resolvedFilters = computed(() => (filters ? (isRef(filters) ? filters.value : filters) : undefined))

  return useQuery({
    queryKey: computed(() => queryKeys.templates.list(resolvedFilters.value)),
    queryFn: () => templatesApi.list(resolvedFilters.value),
    staleTime: 30 * 1000,
  })
}

export function useTemplate(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.templates.detail(id.value)),
    queryFn: () => templatesApi.get(id.value),
    enabled: computed(() => !!id.value),
  })
}

export function useStarterTemplates() {
  return useQuery({
    queryKey: queryKeys.templates.starters,
    queryFn: templatesApi.getStarters,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: templatesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.all })
    },
  })
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string } & Partial<TemplateInput>) => templatesApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.all })
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: templatesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.all })
    },
  })
}

export function useDuplicateTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => templatesApi.duplicate(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.all })
    },
  })
}
