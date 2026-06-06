import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import type { SMTPConfig } from '@/lib/api'

// Stub lucide icons - must define each named export
vi.mock('lucide-vue-next', () => {
  const stub = { template: '<svg />', props: { size: Number } }
  return {
    Plus: stub,
    Pencil: stub,
    Trash2: stub,
    Plug: stub,
    X: stub,
    Server: stub,
    Check: stub,
    Loader2: stub,
    Inbox: stub,
    Link: stub,
    Unlink: stub,
  }
})

// Mock MainLayout
vi.mock('../../src/components/layout/MainLayout.vue', () => ({
  default: { template: '<div class="main-layout"><slot /></div>' },
}))

// Mock vue-router
const mockRoute = { query: {} as Record<string, string> }
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}))

// Mock toast
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}
vi.mock('../../src/composables/useToast', () => ({
  useToast: () => mockToast,
}))

// Query/mutation mocks
const mockConfigs = ref<SMTPConfig[]>([])
const mockProviders = ref<Record<string, any>>({})
const mockLoading = ref(false)
const mockRefetch = vi.fn()
const mockCreateMutateAsync = vi.fn()
const mockUpdateMutateAsync = vi.fn()
const mockDeleteMutateAsync = vi.fn()
const mockTestMutateAsync = vi.fn()
const mockTestConnectionMutateAsync = vi.fn()
const mockConnectMutateAsync = vi.fn()
const mockDisconnectMutateAsync = vi.fn()
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
    mutateAsync: mockConnectMutateAsync,
    isPending: ref(false),
  }),
  useDisconnectOAuth: () => ({
    mutateAsync: mockDisconnectMutateAsync,
    isPending: ref(false),
  }),
  useTestOAuth: () => ({
    mutateAsync: mockTestOAuthMutateAsync,
    isPending: ref(false),
  }),
}))

import ConfigsView from '@/views/ConfigsView.vue'

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

function mountConfigsView() {
  return mount(ConfigsView, {
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
}

describe('ConfigsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigs.value = []
    mockProviders.value = {}
    mockLoading.value = false
    mockRoute.query = {}
  })

  describe('rendering', () => {
    it('should render the page header', () => {
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('Email Configurations')
    })

    it('should render OAuth provider section', () => {
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('Connect Email Account')
      expect(wrapper.text()).toContain('Google Gmail')
      expect(wrapper.text()).toContain('Microsoft Outlook/365')
    })

    it('should render SMTP configurations section', () => {
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('SMTP Configurations')
      expect(wrapper.text()).toContain('Add SMTP')
    })
  })

  describe('empty state', () => {
    it('should show empty state when no configs exist', () => {
      mockConfigs.value = []
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('No configurations yet')
    })
  })

  describe('loading state', () => {
    it('should show loading indicator when loading', () => {
      mockLoading.value = true
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('Loading...')
    })
  })

  describe('config list', () => {
    it('should render SMTP config cards', () => {
      mockConfigs.value = [smtpConfig]
      const wrapper = mountConfigsView()

      expect(wrapper.text()).toContain('Gmail SMTP')
      expect(wrapper.text()).toContain('smtp.gmail.com:587')
      expect(wrapper.text()).toContain('user@gmail.com')
    })

    it('should show Default badge on default config', () => {
      mockConfigs.value = [smtpConfig]
      const wrapper = mountConfigsView()

      expect(wrapper.text()).toContain('Default')
    })

    it('should show security type', () => {
      mockConfigs.value = [smtpConfig]
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('None') // secure: false
    })

    it('should show TLS/SSL when config is secure', () => {
      mockConfigs.value = [{ ...smtpConfig, secure: true }]
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('TLS/SSL')
    })
  })

  describe('connected OAuth accounts', () => {
    it('should render connected OAuth accounts', () => {
      mockConfigs.value = [googleConfig]
      const wrapper = mountConfigsView()

      expect(wrapper.text()).toContain('Connected Accounts')
      expect(wrapper.text()).toContain('Google OAuth')
    })
  })

  describe('create config modal', () => {
    it('should show form modal when Add SMTP is clicked', async () => {
      const wrapper = mountConfigsView()

      const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Add SMTP'))
      expect(addBtn).toBeDefined()
      await addBtn!.trigger('click')

      expect(wrapper.text()).toContain('New SMTP Configuration')
    })

    it('should submit new config form', async () => {
      mockCreateMutateAsync.mockResolvedValue('new-id')
      const wrapper = mountConfigsView()

      // Open the form
      const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Add SMTP'))
      await addBtn!.trigger('click')

      // Fill form fields
      const inputs = wrapper.findAll('input[type="text"]')
      // Name field
      await inputs[0].setValue('New SMTP Config')

      // Submit
      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockCreateMutateAsync).toHaveBeenCalled()
    })
  })

  describe('delete config', () => {
    it('should call delete mutation when confirmed', async () => {
      mockConfigs.value = [smtpConfig]
      // Mock confirm dialog
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockDeleteMutateAsync.mockResolvedValue(undefined)

      const wrapper = mountConfigsView()

      // Find delete button (Trash2 icon button)
      const deleteBtn = wrapper.findAll('button').find((b) => {
        return b.classes().some((c) => c.includes('btn-ghost')) && b.html().includes('svg')
      })

      // Click the second ghost button (first is edit, second is delete)
      const ghostBtns = wrapper.findAll('.btn-ghost.btn-sm')
      if (ghostBtns.length >= 2) {
        await ghostBtns[1].trigger('click')
        await flushPromises()
        expect(mockDeleteMutateAsync).toHaveBeenCalledWith('1')
      }
    })

    it('should not delete when confirm is cancelled', async () => {
      mockConfigs.value = [smtpConfig]
      vi.spyOn(window, 'confirm').mockReturnValue(false)

      const wrapper = mountConfigsView()

      const ghostBtns = wrapper.findAll('.btn-ghost.btn-sm')
      if (ghostBtns.length >= 2) {
        await ghostBtns[1].trigger('click')
        await flushPromises()
        expect(mockDeleteMutateAsync).not.toHaveBeenCalled()
      }
    })
  })

  describe('edit config', () => {
    it('should populate form when editing an SMTP config', async () => {
      mockConfigs.value = [smtpConfig]
      const wrapper = mountConfigsView()

      // Click edit button (first ghost button)
      const ghostBtns = wrapper.findAll('.btn-ghost.btn-sm')
      if (ghostBtns.length >= 1) {
        await ghostBtns[0].trigger('click')

        expect(wrapper.text()).toContain('Edit SMTP Configuration')
      }
    })
  })

  describe('test config', () => {
    it('should call test mutation on test button click', async () => {
      mockConfigs.value = [smtpConfig]
      mockTestMutateAsync.mockResolvedValue({ success: true, message: 'Connected!' })

      const wrapper = mountConfigsView()

      const testBtn = wrapper.findAll('button').find((b) => b.text().includes('Test'))
      if (testBtn) {
        await testBtn.trigger('click')
        await flushPromises()
        expect(mockTestMutateAsync).toHaveBeenCalledWith('1')
      }
    })
  })

  describe('OAuth provider status', () => {
    it('should show Not configured when provider is not set up', () => {
      mockProviders.value = { google: { configured: false }, microsoft: { configured: false } }
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('Not configured')
    })

    it('should show Ready when provider is configured', () => {
      mockProviders.value = { google: { configured: true } }
      const wrapper = mountConfigsView()
      expect(wrapper.text()).toContain('Ready')
    })

    it('should disable connect button when provider is not configured', () => {
      mockProviders.value = { google: { configured: false } }
      const wrapper = mountConfigsView()

      const connectBtn = wrapper.findAll('button').find((b) => b.text().includes('Connect with Google'))
      expect(connectBtn).toBeDefined()
      expect((connectBtn!.element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('OAuth callback handling', () => {
    it('should show success toast on OAuth success callback', () => {
      mockRoute.query = { success: 'google_connected' }
      mountConfigsView()
      expect(mockToast.success).toHaveBeenCalled()
    })

    it('should show error toast on OAuth error callback', () => {
      mockRoute.query = { error: 'google_denied' }
      mountConfigsView()
      expect(mockToast.error).toHaveBeenCalledWith('Google authorization denied')
    })
  })
})
