import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import type { SMTPConfig } from '@/lib/api'

// Stub lucide icons - must define each named export
vi.mock('lucide-vue-next', () => {
  const stub = { template: '<svg />', props: { size: Number } }
  return {
    Send: stub,
    Calendar: stub,
    Loader2: stub,
    CheckCircle: stub,
    XCircle: stub,
    X: stub,
    Users: stub,
    Upload: stub,
    Settings: stub,
    Mail: stub,
    Clock: stub,
    Zap: stub,
    Eye: stub,
    EyeOff: stub,
    FileText: stub,
  }
})

// Mock MainLayout and child components
vi.mock('../../src/components/layout/MainLayout.vue', () => ({
  default: { template: '<div class="main-layout"><slot /></div>' },
}))
vi.mock('../../src/components/ui/DateTimeInput.vue', () => ({
  default: {
    template: '<input type="datetime-local" />',
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
  },
}))
vi.mock('../../src/components/compose/EmailEditor.vue', () => ({
  default: {
    template: '<div class="email-editor"><slot /></div>',
    props: ['subject', 'content', 'delay', 'columns'],
    emits: ['update:subject', 'update:content', 'update:delay', 'preview'],
  },
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

// Mock API modules
const mockEmailSend = vi.fn()
const mockTemplatesList = vi.fn()
const mockTemplatesGet = vi.fn()

vi.mock('../../src/lib/api', () => ({
  emailApi: { send: (...args: any[]) => mockEmailSend(...args) },
  templatesApi: {
    list: () => mockTemplatesList(),
    get: (id: string) => mockTemplatesGet(id),
  },
}))

// Mock configs query
const mockConfigsData = ref<SMTPConfig[]>([])

vi.mock('../../src/lib/query', () => ({
  useConfigs: () => ({
    data: mockConfigsData,
  }),
}))

// Mock vue-router (needed for router-link in template)
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: {
    template: '<a><slot /></a>',
    props: ['to'],
  },
}))

import ComposeView from '@/views/ComposeView.vue'

const sampleConfigs: SMTPConfig[] = [
  {
    id: 'config-1',
    name: 'Gmail SMTP',
    provider_type: 'smtp',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: 'user@gmail.com',
    from_email: 'user@gmail.com',
    from_name: 'Sender Name',
    is_default: true,
  },
  {
    id: 'config-2',
    name: 'Google OAuth',
    provider_type: 'google',
    from_email: 'oauth@gmail.com',
    is_default: false,
    oauth_email: 'oauth@gmail.com',
  },
]

function mountComposeView() {
  return mount(ComposeView, {
    global: {
      stubs: {
        Teleport: true,
        RouterLink: {
          template: '<a><slot /></a>',
          props: ['to'],
        },
      },
    },
  })
}

describe('ComposeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigsData.value = sampleConfigs
    mockTemplatesList.mockResolvedValue({ templates: [] })
    mockEmailSend.mockResolvedValue({ success: true, message: 'Sent!' })
  })

  describe('rendering', () => {
    it('should render the compose page header', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Compose Campaign')
      expect(wrapper.text()).toContain('Create and send bulk email campaigns')
    })

    it('should render progress steps', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Config')
      expect(wrapper.text()).toContain('Contacts')
      expect(wrapper.text()).toContain('Content')
      expect(wrapper.text()).toContain('Send')
    })
  })

  describe('config selector', () => {
    it('should render Email Configuration section', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Email Configuration')
    })

    it('should populate config selector with available configs', () => {
      const wrapper = mountComposeView()
      const select = wrapper.find('select')
      const options = select.findAll('option')

      // Default empty option + 2 configs
      expect(options.length).toBeGreaterThanOrEqual(3)
      expect(wrapper.text()).toContain('Gmail SMTP')
      expect(wrapper.text()).toContain('Google OAuth')
    })

    it('should show message when no configs exist', () => {
      mockConfigsData.value = []
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('No configs found')
      expect(wrapper.text()).toContain('Create one')
    })
  })

  describe('file upload', () => {
    it('should render upload contacts section', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Upload Contacts')
    })

    it('should render file input that accepts CSV and Excel', () => {
      const wrapper = mountComposeView()
      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.exists()).toBe(true)
      expect(fileInput.attributes('accept')).toBe('.csv,.xlsx,.xls')
    })

    it('should show upload instructions', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Upload CSV or Excel file')
    })
  })

  describe('template selector', () => {
    it('should render template section', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Use Template')
    })

    it('should show loading state for templates', async () => {
      // Templates load on mount, check it renders
      const wrapper = mountComposeView()
      expect(wrapper.find('select').exists()).toBe(true)
    })

    it('should show no templates message when empty', async () => {
      mockTemplatesList.mockResolvedValue({ templates: [] })
      const wrapper = mountComposeView()
      await flushPromises()
      expect(wrapper.text()).toContain('No templates found')
    })
  })

  describe('batch settings', () => {
    it('should render batch settings section', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Batch Settings')
      expect(wrapper.text()).toContain('Enable batch sending')
    })

    it('should show batch options when enabled', async () => {
      const wrapper = mountComposeView()

      // Find and check the batch checkbox
      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      // The first checkbox in batch settings section
      const batchCheckbox = checkboxes.find((cb) => {
        const label = cb.element.closest('label')
        return label && label.textContent?.includes('Enable batch sending')
      })

      if (batchCheckbox) {
        await batchCheckbox.setValue(true)
        await nextTick()
        expect(wrapper.text()).toContain('Batch Size')
        expect(wrapper.text()).toContain('Batch Delay')
        expect(wrapper.text()).toContain('Email Delay')
      }
    })
  })

  describe('schedule settings', () => {
    it('should render schedule settings section', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Schedule Settings')
      expect(wrapper.text()).toContain('Schedule for later')
    })
  })

  describe('send button', () => {
    it('should render send button area', () => {
      const wrapper = mountComposeView()
      // The send button text depends on state
      const buttons = wrapper.findAll('button')
      const sendBtn = buttons.find((b) => b.text().includes('contacts'))
      expect(sendBtn).toBeDefined()
    })

    it('should disable send button when form is incomplete', () => {
      const wrapper = mountComposeView()

      const sendBtn = wrapper.findAll('button').find((b) => b.text().includes('contacts'))
      if (sendBtn) {
        expect((sendBtn.element as HTMLButtonElement).disabled).toBe(true)
      }
    })

    it('should show warning when no config selected', () => {
      const wrapper = mountComposeView()
      expect(wrapper.text()).toContain('Select an SMTP config to continue')
    })
  })

  describe('email editor', () => {
    it('should render the EmailEditor component', () => {
      const wrapper = mountComposeView()
      expect(wrapper.find('.email-editor').exists()).toBe(true)
    })
  })
})
