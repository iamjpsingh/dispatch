/**
 * TanStack Vue Query composables for common API patterns.
 * Eliminates manual loading/error state and adds caching + deduplication.
 *
 * Usage:
 *   const { data: configs, isLoading } = useApiQuery(['wa-configs'], () => whatsappApi.getConfigs())
 *   const { mutateAsync: save, isPending } = useApiMutation(
 *     (input) => whatsappApi.createConfig(input),
 *     { invalidate: ['wa-configs'], success: 'Config saved' }
 *   )
 */
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/vue-query'
import type { MaybeRef, Ref, ComputedRef } from 'vue'
import { computed, unref } from 'vue'
import { useToast } from './useToast'

// ============================================================================
// useApiQuery — cached data fetching with auto loading/error
// ============================================================================

interface QueryOptions {
  enabled?: MaybeRef<boolean>
  staleTime?: number
  refetchOnMount?: boolean | 'always'
}

export function useApiQuery<T>(
  key: QueryKey | Ref<QueryKey> | ComputedRef<QueryKey>,
  fetcher: () => Promise<T>,
  options?: QueryOptions
) {
  const toast = useToast()

  return useQuery<T>({
    queryKey: key,
    queryFn: async () => {
      try {
        return await fetcher()
      } catch (err: any) {
        toast.error(err.message || 'Request failed')
        throw err
      }
    },
    enabled: options?.enabled !== undefined ? computed(() => unref(options.enabled!)) : undefined,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}

// ============================================================================
// useApiMutation — mutations with auto invalidation + toast
// ============================================================================

interface MutationOptions<TResult> {
  invalidate?: QueryKey[]  // Query keys to invalidate on success
  success?: string          // Success toast message
  onSuccess?: (data: TResult) => void
}

export function useApiMutation<TInput, TResult = void>(
  mutator: (input: TInput) => Promise<TResult>,
  options?: MutationOptions<TResult>
) {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation<TResult, Error, TInput>({
    mutationFn: mutator,
    onSuccess: (data) => {
      if (options?.success) toast.success(options.success)
      if (options?.invalidate) {
        for (const key of options.invalidate) {
          queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] })
        }
      }
      options?.onSuccess?.(data)
    },
    onError: (err) => {
      toast.error(err.message || 'Operation failed')
    },
  })
}
