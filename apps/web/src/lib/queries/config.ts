/**
 * Config & OAuth Query Composables
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { configApi, oauthApi, type SMTPConfig } from '../api'
import { queryKeys } from './keys'

// ============================================================================
// Config Composables
// ============================================================================

export function useConfigs() {
  return useQuery({
    queryKey: queryKeys.configs.list(),
    queryFn: configApi.list,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useCreateConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: configApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.configs.all })
    },
  })
}

export function useUpdateConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...config }: { id: string } & Partial<SMTPConfig> & { pass?: string }) =>
      configApi.update(id, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.configs.all })
    },
  })
}

export function useDeleteConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: configApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.configs.all })
    },
  })
}

export function useTestConfig() {
  return useMutation({
    mutationFn: configApi.test,
  })
}

export function useTestConnection() {
  return useMutation({
    mutationFn: configApi.testConnection,
  })
}

// ============================================================================
// OAuth Composables
// ============================================================================

export function useOAuthStatus() {
  return useQuery({
    queryKey: queryKeys.oauth.status,
    queryFn: oauthApi.getStatus,
    staleTime: 60 * 1000, // 1 minute
  })
}

export function useConnectOAuth() {
  return useMutation({
    mutationFn: oauthApi.connect,
    onSuccess: (authUrl) => {
      window.location.href = authUrl
    },
  })
}

export function useDisconnectOAuth() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: oauthApi.disconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.configs.all })
    },
  })
}

export function useTestOAuth() {
  return useMutation({
    mutationFn: oauthApi.test,
  })
}
