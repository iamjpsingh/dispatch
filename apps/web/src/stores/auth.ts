/**
 * Auth Store
 * Uses TanStack Query for state management
 */
import { computed, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useCurrentUser, useLogin, useRegister, useLogout, queryKeys } from '../lib/query'
import type { User, AuthContext, OrgInfo } from '../lib/api'

export type { User, AuthContext, OrgInfo }

// Track if we've attempted to initialize auth
const authInitialized = ref(false)

/**
 * Auth composable - wraps TanStack Query hooks
 */
export function useAuth() {
  const queryClient = useQueryClient()
  const { data: authCtx, isLoading: loading, isFetched } = useCurrentUser()
  const loginMutation = useLogin()
  const registerMutation = useRegister()
  const logoutMutation = useLogout()

  const user = computed(() => authCtx.value?.user ?? null)
  const orgId = computed(() => authCtx.value?.orgId ?? null)
  const role = computed(() => authCtx.value?.role ?? null)
  const orgs = computed(() => authCtx.value?.orgs ?? [])
  const isPlatformAdmin = computed(() => !!authCtx.value?.user?.is_platform_admin)
  const isAuthenticated = computed(() => !!authCtx.value?.user)
  const isInitialized = computed(() => authInitialized.value || isFetched.value)

  async function login(email: string, password: string): Promise<{ success: boolean; message?: string }> {
    try {
      await loginMutation.mutateAsync({ email, password })
      return { success: true }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Login failed' }
    }
  }

  async function register(name: string, email: string, password: string): Promise<{ success: boolean; message?: string }> {
    try {
      await registerMutation.mutateAsync({ name, email, password })
      return { success: true }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Registration failed' }
    }
  }

  async function logout(): Promise<void> {
    await logoutMutation.mutateAsync()
  }

  async function switchOrg(newOrgId: string): Promise<void> {
    const { authApi } = await import('../lib/api')
    await authApi.switchOrg(newOrgId)
    // Refetch auth context to get updated orgId and role
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
  }

  // For router guard - initialize auth state
  async function initializeAuth(): Promise<void> {
    if (authInitialized.value) return

    try {
      await queryClient.fetchQuery({
        queryKey: queryKeys.auth.me,
        queryFn: async () => {
          const { authApi } = await import('../lib/api')
          return await authApi.getMe()
        },
      })
    } catch {
      queryClient.setQueryData(queryKeys.auth.me, null)
    } finally {
      authInitialized.value = true
    }
  }

  function requireAuth(): boolean {
    return !!user.value
  }

  return {
    user,
    orgId,
    role,
    orgs,
    isPlatformAdmin,
    isAuthenticated,
    isInitialized,
    loading: computed(() => loading.value || loginMutation.isPending.value || registerMutation.isPending.value),
    initializeAuth,
    login,
    register,
    logout,
    switchOrg,
    requireAuth,
  }
}
