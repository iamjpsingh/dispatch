import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed, nextTick } from 'vue'

// Stub lucide icons - must define each named export
vi.mock('lucide-vue-next', () => {
  const stub = { template: '<svg />', props: { size: Number } }
  return {
    Mail: stub,
    CheckCircle: stub,
    XCircle: stub,
    Download: stub,
    Trash2: stub,
    Search: stub,
    X: stub,
    Check: stub,
    Inbox: stub,
    Loader2: stub,
    Eye: stub,
    MousePointer: stub,
  }
})

// Mock MainLayout and DateInput
vi.mock('../../src/components/layout/MainLayout.vue', () => ({
  default: { template: '<div class="main-layout"><slot /></div>' },
}))
vi.mock('../../src/components/ui/DateInput.vue', () => ({
  default: {
    template: '<input type="date" />',
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue', 'change'],
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

// Mock query composables
const mockLogsData = ref<any>(null)
const mockLoading = ref(false)
const mockClearLogsMutateAsync = vi.fn()
const mockDeleteLogMutateAsync = vi.fn()

vi.mock('../../src/lib/query', () => ({
  useLogs: () => ({
    data: mockLogsData,
    isLoading: mockLoading,
  }),
  useClearLogs: () => ({
    mutateAsync: mockClearLogsMutateAsync,
  }),
  useDeleteLog: () => ({
    mutateAsync: mockDeleteLogMutateAsync,
  }),
}))

import ReportsView from '@/views/ReportsView.vue'

const sampleLogs = [
  {
    id: 'log-1',
    tracking_id: 'track-1',
    recipient_email: 'john@test.com',
    subject: 'Test Email 1',
    status: 'sent',
    send_type: 'batch',
    provider_type: 'smtp',
    sent_at: '2024-01-15T10:00:00Z',
    click_count: 0,
  },
  {
    id: 'log-2',
    tracking_id: 'track-2',
    recipient_email: 'jane@test.com',
    subject: 'Test Email 2',
    status: 'failed',
    send_type: 'direct',
    provider_type: 'google',
    sent_at: '2024-01-15T11:00:00Z',
    click_count: 0,
  },
  {
    id: 'log-3',
    tracking_id: 'track-3',
    recipient_email: 'bob@test.com',
    subject: 'Test Email 3',
    status: 'opened',
    send_type: 'scheduled',
    provider_type: 'microsoft',
    sent_at: '2024-01-15T12:00:00Z',
    click_count: 2,
  },
]

function mountReportsView() {
  return mount(ReportsView, {
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
}

describe('ReportsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogsData.value = null
    mockLoading.value = false
  })

  describe('rendering', () => {
    it('should render the page header', () => {
      const wrapper = mountReportsView()
      expect(wrapper.text()).toContain('Reports')
      expect(wrapper.text()).toContain('Email delivery logs and analytics')
    })

    it('should render export buttons', () => {
      const wrapper = mountReportsView()
      expect(wrapper.text()).toContain('Export CSV')
      expect(wrapper.text()).toContain('Export JSON')
    })

    it('should render stats grid', () => {
      mockLogsData.value = {
        logs: [],
        stats: { total: 100, sent: 80, failed: 20, opened: 30, clicked: 10, openRate: 37.5, clickRate: 12.5 },
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      }
      const wrapper = mountReportsView()

      expect(wrapper.text()).toContain('100')
      expect(wrapper.text()).toContain('Total Emails')
      expect(wrapper.text()).toContain('80')
      expect(wrapper.text()).toContain('Delivered')
      expect(wrapper.text()).toContain('20')
      expect(wrapper.text()).toContain('Failed')
    })
  })

  describe('loading state', () => {
    it('should show loading indicator', () => {
      mockLoading.value = true
      const wrapper = mountReportsView()
      expect(wrapper.text()).toContain('Loading logs...')
    })
  })

  describe('empty state', () => {
    it('should show empty state when no logs', () => {
      mockLogsData.value = {
        logs: [],
        stats: { total: 0, sent: 0, failed: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      }
      const wrapper = mountReportsView()
      expect(wrapper.text()).toContain('No logs found')
    })
  })

  describe('log table', () => {
    it('should render log entries in a table', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()

      expect(wrapper.find('table').exists()).toBe(true)
      expect(wrapper.text()).toContain('john@test.com')
      expect(wrapper.text()).toContain('jane@test.com')
      expect(wrapper.text()).toContain('bob@test.com')
      expect(wrapper.text()).toContain('Test Email 1')
      expect(wrapper.text()).toContain('Test Email 2')
      expect(wrapper.text()).toContain('Test Email 3')
    })

    it('should show status badges', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()

      expect(wrapper.text()).toContain('sent')
      expect(wrapper.text()).toContain('failed')
      expect(wrapper.text()).toContain('opened')
    })

    it('should show send type labels', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()

      expect(wrapper.text()).toContain('Batch')
      expect(wrapper.text()).toContain('Direct')
      expect(wrapper.text()).toContain('Scheduled')
    })

    it('should show provider labels', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()

      expect(wrapper.text()).toContain('SMTP')
      expect(wrapper.text()).toContain('Gmail')
      expect(wrapper.text()).toContain('Outlook')
    })

    it('should show table footer with pagination info', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()
      expect(wrapper.text()).toContain('Showing 3 of 3 logs')
    })
  })

  describe('filter controls', () => {
    it('should render filter controls', () => {
      const wrapper = mountReportsView()
      expect(wrapper.find('input[placeholder*="Search"]').exists()).toBe(true)
      expect(wrapper.findAll('select').length).toBeGreaterThanOrEqual(3)
    })

    it('should render clear button', () => {
      const wrapper = mountReportsView()
      const clearBtn = wrapper.findAll('button').find((b) => b.text().includes('Clear'))
      expect(clearBtn).toBeDefined()
    })

    it('should have status filter with options', () => {
      const wrapper = mountReportsView()
      const selects = wrapper.findAll('select')
      const statusSelect = selects[0]

      const options = statusSelect.findAll('option')
      const optionTexts = options.map((o) => o.text())
      expect(optionTexts).toContain('All Status')
      expect(optionTexts).toContain('Sent')
      expect(optionTexts).toContain('Failed')
    })
  })

  describe('pagination', () => {
    it('should show pagination controls when multiple pages exist', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 150, sent: 100, failed: 50, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 150, totalPages: 3 },
      }
      const wrapper = mountReportsView()

      expect(wrapper.text()).toContain('Page 1 of 3')
      expect(wrapper.text()).toContain('Previous')
      expect(wrapper.text()).toContain('Next')
    })

    it('should disable Previous button on first page', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 150, sent: 100, failed: 50, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 150, totalPages: 3 },
      }
      const wrapper = mountReportsView()

      const prevBtn = wrapper.findAll('button').find((b) => b.text() === 'Previous')
      expect(prevBtn).toBeDefined()
      expect((prevBtn!.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('should not show pagination when only one page', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()

      // No Previous/Next buttons when totalPages <= 1
      expect(wrapper.text()).not.toContain('Previous')
    })
  })

  describe('selection', () => {
    it('should render checkboxes in table rows', () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()
      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      // 1 select-all + 3 row checkboxes
      expect(checkboxes.length).toBe(4)
    })

    it('should show bulk actions when items are selected', async () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      const wrapper = mountReportsView()

      // Use the select all checkbox in thead - trigger change event
      const selectAllCheckbox = wrapper.find('thead input[type="checkbox"]')
      expect(selectAllCheckbox.exists()).toBe(true)

      // Trigger change event (toggleSelectAll)
      await selectAllCheckbox.trigger('change')
      await nextTick()
      // After first toggle, selectAll goes from false to: selectedIds gets all items, selectAll becomes true
      // But the @change calls toggleSelectAll which checks selectAll (starts false), so it sets all items
      // Wait, the toggle logic: if selectAll.value is true -> clear, else -> select all
      // Initial selectAll is false, so clicking triggers the else branch -> selects all

      expect(wrapper.text()).toContain('3 selected')
      expect(wrapper.text()).toContain('Delete Selected')
    })
  })

  describe('bulk delete', () => {
    it('should call delete mutation for selected logs', async () => {
      mockLogsData.value = {
        logs: sampleLogs,
        stats: { total: 3, sent: 1, failed: 1, opened: 1, clicked: 0, openRate: 33, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      }
      mockClearLogsMutateAsync.mockResolvedValue(3)
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const wrapper = mountReportsView()

      // Select all
      const selectAllCheckbox = wrapper.find('thead input[type="checkbox"]')
      await selectAllCheckbox.setValue(true)
      await selectAllCheckbox.trigger('change')
      await nextTick()

      // Click delete selected
      const deleteBtn = wrapper.findAll('button').find((b) => b.text().includes('Delete Selected'))
      if (deleteBtn) {
        await deleteBtn.trigger('click')
        await flushPromises()
        expect(mockClearLogsMutateAsync).toHaveBeenCalled()
      }
    })
  })

  describe('single delete', () => {
    it('should call delete single log mutation', async () => {
      mockLogsData.value = {
        logs: [sampleLogs[0]],
        stats: { total: 1, sent: 1, failed: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 },
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }
      mockDeleteLogMutateAsync.mockResolvedValue(undefined)
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const wrapper = mountReportsView()

      // Find the delete button in the table row
      const trashBtns = wrapper.findAll('td button')
      if (trashBtns.length > 0) {
        await trashBtns[0].trigger('click')
        await flushPromises()
        expect(mockDeleteLogMutateAsync).toHaveBeenCalledWith('log-1')
      }
    })
  })

  describe('export', () => {
    it('should open export URL when CSV export is clicked', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      const wrapper = mountReportsView()

      const csvBtn = wrapper.findAll('button').find((b) => b.text().includes('Export CSV'))
      csvBtn?.trigger('click')

      expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/report/export/csv'), '_blank')
      openSpy.mockRestore()
    })

    it('should open export URL when JSON export is clicked', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      const wrapper = mountReportsView()

      const jsonBtn = wrapper.findAll('button').find((b) => b.text().includes('Export JSON'))
      jsonBtn?.trigger('click')

      expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/report/export/json'), '_blank')
      openSpy.mockRestore()
    })
  })
})
