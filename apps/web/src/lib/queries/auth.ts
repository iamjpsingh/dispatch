/**
 * Auth Query Composables
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { authApi } from '../api'
import type { AuthContext } from '../api'
import { queryKeys } from './keys'

export function useCurrentUser() {
  return useQuery<AuthContext | null>({
    queryKey: queryKeys.auth.me,
    queryFn: authApi.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => authApi.login(email, password),
    onSuccess: (ctx: AuthContext) => {
      queryClient.setQueryData(queryKeys.auth.me, ctx)
    },
  })
}

export function useRegister() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, email, password }: { name: string; email: string; password: string }) =>
      authApi.register(name, email, password),
    onSuccess: (ctx: AuthContext) => {
      queryClient.setQueryData(queryKeys.auth.me, ctx)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.me, null)
      queryClient.clear()
    },
  })
}
