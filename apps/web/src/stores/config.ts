/**
 * Config Store
 * Uses TanStack Query for state management
 */
import { ref, computed } from 'vue'
import {
  useConfigs,
  useCreateConfig,
  useUpdateConfig,
  useDeleteConfig,
  useTestConfig,
  useTestConnection,
  useOAuthStatus,
  useConnectOAuth,
  useDisconnectOAuth,
  useTestOAuth,
} from '../lib/query'
import type { SMTPConfig, ProviderStatus } from '../lib/api'

export type { SMTPConfig, ProviderStatus }

/**
 * Config store composable
 */
export function useConfigStore() {
  // Queries
  const { data: configs, isLoading: loading, refetch: loadConfigs } = useConfigs()
  const { data: providers } = useOAuthStatus()

  // Mutations
  const createMutation = useCreateConfig()
  const updateMutation = useUpdateConfig()
  const deleteMutation = useDeleteConfig()
  const testMutation = useTestConfig()
  const testConnectionMutation = useTestConnection()
  const connectOAuthMutation = useConnectOAuth()
  const disconnectOAuthMutation = useDisconnectOAuth()
  const testOAuthMutation = useTestOAuth()

  // Local state
  const selectedConfigId = ref<string | null>(null)

  // Computed
  const smtpConfigs = computed(() => (configs.value || []).filter((c) => c.provider_type === 'smtp'))
  const oauthConfigs = computed(() => (configs.value || []).filter((c) => c.provider_type !== 'smtp'))
  const defaultConfig = computed(() => (configs.value || []).find((c) => c.is_default))

  // Actions
  async function createConfig(config: Partial<SMTPConfig> & { pass?: string }) {
    return createMutation.mutateAsync(config)
  }

  async function updateConfig(id: string, config: Partial<SMTPConfig> & { pass?: string }) {
    return updateMutation.mutateAsync({ id, ...config })
  }

  async function deleteConfig(id: string) {
    await deleteMutation.mutateAsync(id)
    if (selectedConfigId.value === id) {
      selectedConfigId.value = null
    }
  }

  async function testConfig(id: string) {
    return testMutation.mutateAsync(id)
  }

  async function testConnection(config: { host: string; port: number; secure: boolean; user: string; pass: string }) {
    return testConnectionMutation.mutateAsync(config)
  }

  async function connectOAuth(provider: 'google' | 'microsoft') {
    return connectOAuthMutation.mutateAsync(provider)
  }

  async function disconnectOAuth(configId: string) {
    return disconnectOAuthMutation.mutateAsync(configId)
  }

  async function testOAuth(configId: string) {
    return testOAuthMutation.mutateAsync(configId)
  }

  function selectConfig(id: string) {
    selectedConfigId.value = id
  }

  return {
    // Data
    configs: computed(() => configs.value || []),
    smtpConfigs,
    oauthConfigs,
    defaultConfig,
    providers: computed(() => providers.value || {}),
    selectedConfigId,
    loading,

    // Mutation states
    isCreating: computed(() => createMutation.isPending.value),
    isUpdating: computed(() => updateMutation.isPending.value),
    isDeleting: computed(() => deleteMutation.isPending.value),
    isTesting: computed(() => testMutation.isPending.value || testConnectionMutation.isPending.value),
    isConnecting: computed(() => connectOAuthMutation.isPending.value),

    // Actions
    loadConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
    testConfig,
    testConnection,
    connectOAuth,
    disconnectOAuth,
    testOAuth,
    selectConfig,
  }
}
