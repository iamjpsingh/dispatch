// ReportsView was rebuilt onto the P6 Vue-Query composables (useLogs + clear/delete mutations)
// with a PageHeader, StatCards, a filter bar, a logs table, and an empty state. This suite smoke-
// tests the current view: it mounts, shows the header + stat cards, renders the empty state with
// no logs, and renders log rows when data is present.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// lucide-vue-next icons render fine under jsdom — not stubbed.
vi.mock('../../src/components/ui/DateInput.vue', () => ({
  default: {
    template: '<input type="date" />',
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue', 'change'],
  },
}))

const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('../../src/composables/useToast', () => ({ useToast: () => mockToast }))

const mockLogsData = ref<any>(null)
const mockLoading = ref(false)
vi.mock('../../src/lib/query', () => ({
  useLogs: () => ({ data: mockLogsData, isLoading: mockLoading }),
  useClearLogs: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
  useDeleteLog: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}))

import ReportsView from '@/views/ReportsView.vue'

const sampleLogs = [
  { id: 'log-1', tracking_id: 't1', recipient_email: 'john@test.com', subject: 'Test Email 1', status: 'sent', send_type: 'batch', provider_type: 'smtp', sent_at: '2026-01-15T10:00:00Z', click_count: 0 },
  { id: 'log-2', tracking_id: 't2', recipient_email: 'jane@test.com', subject: 'Test Email 2', status: 'failed', send_type: 'direct', provider_type: 'google', sent_at: '2026-01-15T11:00:00Z', click_count: 0 },
]

const sampleData = {
  logs: sampleLogs,
  stats: { total: 2, sent: 1, failed: 1, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
  pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
}

function mountReportsView() {
  return mount(ReportsView, { global: { stubs: { Teleport: true } } })
}

describe('ReportsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogsData.value = null
    mockLoading.value = false
  })

  it('mounts and renders the page header + stat cards', () => {
    const wrapper = mountReportsView()
    const text = wrapper.text()
    expect(text).toContain('Reports')
    expect(text).toContain('Total Emails')
    expect(text).toContain('Delivered')
    expect(text).toContain('Failed')
  })

  it('shows the empty state when there are no logs', () => {
    mockLogsData.value = null
    const wrapper = mountReportsView()
    expect(wrapper.text()).toContain('No logs found')
  })

  it('renders log rows when data is present', () => {
    mockLogsData.value = sampleData
    const wrapper = mountReportsView()
    const text = wrapper.text()
    expect(text).toContain('john@test.com')
    expect(text).toContain('jane@test.com')
  })
})
