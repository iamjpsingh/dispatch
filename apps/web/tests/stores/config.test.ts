import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import type { SMTPConfig } from '@/lib/api'

// Mock data
const mockConfigs = ref<SMTPConfig[]>([])
const mockProviders = ref<Record<string, any>>({})
const mockLoading = ref(false)
const mockRefetch = vi.fn()

// Mutation mocks
const mockCreateMutateAsync = vi.fn()
const mockUpdateMutateAsync = vi.fn()
const mockDeleteMutateAsync = vi.fn()
const mockTestMutateAsync = vi.fn()
const mockTestConnectionMutateAsync = vi.fn()
const mockConnectOAuthMutateAsync = vi.fn()
const mockDisconnectOAuthMutateAsync = vi.fn()
const mockTestOAuthMutateAsync = vi.fn()

vi.mock('../../src/lib/query', () => ({
  useConfigs: () => ({
    data: mockConfigs,
    isLoading: mockLoading,
    refetch: mockRefetch,
  }),
  useOAuthStatus: () => ({
    data: mockProviders,
  }),
  useCreateConfig: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: ref(false),
  }),
  useUpdateConfig: () => ({
    mutateAsync: mockUpdateMutateAsync,
    isPending: ref(false),
  }),
  useDeleteConfig: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: ref(false),
  }),
  useTestConfig: () => ({
    mutateAsync: mockTestMutateAsync,
    isPending: ref(false),
  }),
  useTestConnection: () => ({
    mutateAsync: mockTestConnectionMutateAsync,
    isPending: ref(false),
  }),
  useConnectOAuth: () => ({
    mutateAsync: mockConnectOAuthMutateAsync,
    isPending: ref(false),
  }),
  useDisconnectOAuth: () => ({
    mutateAsync: mockDisconnectOAuthMutateAsync,
    isPending: ref(false),
  }),
  useTestOAuth: () => ({
    mutateAsync: mockTestOAuthMutateAsync,
    isPending: ref(false),
  }),
}))

import { useConfigStore } from '@/stores/config'

const smtpConfig: SMTPConfig = {
  id: '1',
  name: 'Gmail SMTP',
  provider_type: 'smtp',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  user: 'user@gmail.com',
  from_email: 'user@gmail.com',
  from_name: 'Test User',
  is_default: true,
}

const googleConfig: SMTPConfig = {
  id: '2',
  name: 'Google OAuth',
  provider_type: 'google',
  from_email: 'user@gmail.com',
  is_default: false,
  oauth_email: 'user@gmail.com',
}

describe('useConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigs.value = []
    mockProviders.value = {}
    mockLoading.value = false
  })

  describe('configs', () => {
    it('should return empty array when no configs', () => {
      const store = useConfigStore()
      expect(store.configs.value).toEqual([])
    })

    it('should return configs when available', () => {
      mockConfigs.value = [smtpConfig, googleConfig]
      const store = useConfigStore()
      expect(store.configs.value).toHaveLength(2)
    })
  })

  describe('smtpConfigs', () => {
    it('should filter only SMTP configs', () => {
      mockConfigs.value = [smtpConfig, googleConfig]
      const store = useConfigStore()
      expect(store.smtpConfigs.value).toHaveLength(1)
      expect(store.smtpConfigs.value[0].provider_type).toBe('smtp')
    })
  })

  describe('oauthConfigs', () => {
    it('should filter only OAuth configs', () => {
      mockConfigs.value = [smtpConfig, googleConfig]
      const store = useConfigStore()
      expect(store.oauthConfigs.value).toHaveLength(1)
      expect(store.oauthConfigs.value[0].provider_type).toBe('google')
    })
  })

  describe('defaultConfig', () => {
    it('should return the default config', () => {
      mockConfigs.value = [smtpConfig, googleConfig]
      const store = useConfigStore()
      expect(store.defaultConfig.value?.id).toBe('1')
    })

    it('should return undefined when no default config', () => {
      mockConfigs.value = [{ ...smtpConfig, is_default: false }]
      const store = useConfigStore()
      expect(store.defaultConfig.value).toBeUndefined()
    })
  })

  describe('createConfig', () => {
    it('should call create mutation', async () => {
      mockCreateMutateAsync.mockResolvedValue('new-id')
      const store = useConfigStore()

      await store.createConfig({
        name: 'New Config',
        host: 'smtp.test.com',
        port: 587,
        from_email: 'test@test.com',
      })

      expect(mockCreateMutateAsync).toHaveBeenCalledWith({
        name: 'New Config',
        host: 'smtp.test.com',
        port: 587,
        from_email: 'test@test.com',
      })
    })
  })

  describe('updateConfig', () => {
    it('should call update mutation with id', async () => {
      mockUpdateMutateAsync.mockResolvedValue(undefined)
      const store = useConfigStore()

      await store.updateConfig('1', { name: 'Updated Config' })

      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: '1', name: 'Updated Config' })
    })
  })

  describe('deleteConfig', () => {
    it('should call delete mutation', async () => {
      mockDeleteMutateAsync.mockResolvedValue(undefined)
      const store = useConfigStore()

      await store.deleteConfig('1')

      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('1')
    })

    it('should clear selectedConfigId if deleted config was selected', async () => {
      mockDeleteMutateAsync.mockResolvedValue(undefined)
      const store = useConfigStore()
      store.selectConfig('1')
      expect(store.selectedConfigId.value).toBe('1')

      await store.deleteConfig('1')

      expect(store.selectedConfigId.value).toBeNull()
    })

    it('should not clear selectedConfigId if a different config was deleted', async () => {
      mockDeleteMutateAsync.mockResolvedValue(undefined)
      const store = useConfigStore()
      store.selectConfig('1')

      await store.deleteConfig('2')

      expect(store.selectedConfigId.value).toBe('1')
    })
  })

  describe('testConfig', () => {
    it('should call test mutation', async () => {
      mockTestMutateAsync.mockResolvedValue({ success: true, message: 'Connected!' })
      const store = useConfigStore()

      const result = await store.testConfig('1')

      expect(mockTestMutateAsync).toHaveBeenCalledWith('1')
      expect(result).toEqual({ success: true, message: 'Connected!' })
    })
  })

  describe('testConnection', () => {
    it('should call test connection mutation with config data', async () => {
      mockTestConnectionMutateAsync.mockResolvedValue({ success: true, message: 'OK' })
      const store = useConfigStore()

      const config = { host: 'smtp.gmail.com', port: 587, secure: false, user: 'test', pass: 'pass' }
      await store.testConnection(config)

      expect(mockTestConnectionMutateAsync).toHaveBeenCalledWith(config)
    })
  })

  describe('selectConfig', () => {
    it('should set selectedConfigId', () => {
      const store = useConfigStore()
      store.selectConfig('42')
      expect(store.selectedConfigId.value).toBe('42')
    })
  })

  describe('connectOAuth', () => {
    it('should call connect mutation with provider', async () => {
      mockConnectOAuthMutateAsync.mockResolvedValue('https://auth.url')
      const store = useConfigStore()

      await store.connectOAuth('google')

      expect(mockConnectOAuthMutateAsync).toHaveBeenCalledWith('google')
    })
  })

  describe('disconnectOAuth', () => {
    it('should call disconnect mutation with config id', async () => {
      mockDisconnectOAuthMutateAsync.mockResolvedValue(undefined)
      const store = useConfigStore()

      await store.disconnectOAuth('2')

      expect(mockDisconnectOAuthMutateAsync).toHaveBeenCalledWith('2')
    })
  })

  describe('testOAuth', () => {
    it('should call test OAuth mutation', async () => {
      mockTestOAuthMutateAsync.mockResolvedValue({ success: true, message: 'OK' })
      const store = useConfigStore()

      const result = await store.testOAuth('2')

      expect(mockTestOAuthMutateAsync).toHaveBeenCalledWith('2')
      expect(result).toEqual({ success: true, message: 'OK' })
    })
  })

  describe('loading', () => {
    it('should reflect loading state', () => {
      mockLoading.value = true
      const store = useConfigStore()
      expect(store.loading.value).toBe(true)
    })
  })

  describe('providers', () => {
    it('should return empty object when no providers', () => {
      const store = useConfigStore()
      expect(store.providers.value).toEqual({})
    })

    it('should return providers when available', () => {
      mockProviders.value = { google: { configured: true } }
      const store = useConfigStore()
      expect(store.providers.value).toEqual({ google: { configured: true } })
    })
  })
})
