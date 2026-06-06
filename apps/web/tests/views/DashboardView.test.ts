import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed } from 'vue'

// Stub lucide icons globally - must define each named export
vi.mock('lucide-vue-next', () => {
  const stub = { template: '<svg />', props: { size: Number } }
  return {
    Mail: stub,
    CheckCircle: stub,
    XCircle: stub,
    TrendingUp: stub,
    Plus: stub,
    PenSquare: stub,
    BarChart3: stub,
    Settings: stub,
    Pause: stub,
    Play: stub,
    X: stub,
    Loader2: stub,
    Clock: stub,
    Inbox: stub,
    Users: stub,
    FileText: stub,
    ArrowUpRight: stub,
  }
})

// Mock MainLayout
vi.mock('../../src/components/layout/MainLayout.vue', () => ({
  default: {
    template: '<div class="main-layout"><slot /></div>',
  },
}))

// Mock auth store
const mockUser = ref<{ id: string; email: string; name: string } | null>(null)
vi.mock('../../src/stores/auth', () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}))

// Mock dashboard query and mutation composables
const mockDashboardData = ref<any>(null)
const mockIsLoading = ref(false)

vi.mock('../../src/lib/query', () => ({
  useDashboardStats: () => ({
    data: mockDashboardData,
    isLoading: mockIsLoading,
  }),
  usePauseJob: () => ({ mutate: vi.fn() }),
  useResumeJob: () => ({ mutate: vi.fn() }),
  useCancelJob: () => ({ mutate: vi.fn() }),
}))

// Mock vue-router
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: {
    template: '<a><slot /></a>',
    props: ['to'],
  },
}))

import DashboardView from '@/views/DashboardView.vue'

function mountDashboard() {
  return mount(DashboardView, {
    global: {
      stubs: {
        RouterLink: {
          template: '<a><slot /></a>',
          props: ['to'],
        },
      },
    },
  })
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser.value = { id: '1', email: 'test@test.com', name: 'John Doe' }
    mockDashboardData.value = null
    mockIsLoading.value = false
  })

  describe('rendering', () => {
    it('should render the greeting with user first name', () => {
      const wrapper = mountDashboard()
      // Greeting depends on time of day; first name should appear
      expect(wrapper.text()).toContain('John')
    })

    it('should render campaign description text', () => {
      const wrapper = mountDashboard()
      expect(wrapper.text()).toContain("Here's what's happening with your campaigns")
    })

    it('should render stats with default zeros when no data', () => {
      const wrapper = mountDashboard()
      // With no dashboard data, stats default to 0
      const text = wrapper.text()
      expect(text).toContain('Total Sent')
      expect(text).toContain('Delivered')
      expect(text).toContain('Failed')
      expect(text).toContain('Success Rate')
    })
  })

  describe('stats display', () => {
    it('should render stats from dashboard data', () => {
      mockDashboardData.value = {
        stats: { total: 100, sent: 95, failed: 5 },
        queue: {
          stats: {
            pending: 0,
            running: 0,
            paused: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total_sent: 0,
            total_failed: 0,
            dead_letters: 0,
          },
          activeJobs: [],
          pendingJobs: [],
          recentJobs: [],
        },
      }

      const wrapper = mountDashboard()
      const text = wrapper.text()

      expect(text).toContain('100')
      expect(text).toContain('95')
      expect(text).toContain('5')
      // Success rate: 95/100 * 100 = 95%
      expect(text).toContain('95%')
    })

    it('should show 0% success rate when no emails sent', () => {
      mockDashboardData.value = {
        stats: { total: 0, sent: 0, failed: 0 },
        queue: {
          stats: {
            pending: 0,
            running: 0,
            paused: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total_sent: 0,
            total_failed: 0,
            dead_letters: 0,
          },
          activeJobs: [],
          pendingJobs: [],
          recentJobs: [],
        },
      }

      const wrapper = mountDashboard()
      expect(wrapper.text()).toContain('0%')
    })
  })

  describe('onboarding', () => {
    it('should show onboarding when no campaigns exist', () => {
      mockDashboardData.value = {
        stats: { total: 0, sent: 0, failed: 0 },
        queue: {
          stats: {
            pending: 0,
            running: 0,
            paused: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total_sent: 0,
            total_failed: 0,
            dead_letters: 0,
          },
          activeJobs: [],
          pendingJobs: [],
          recentJobs: [],
        },
      }
      mockIsLoading.value = false

      const wrapper = mountDashboard()
      expect(wrapper.text()).toContain('Ready to send your first campaign?')
      expect(wrapper.text()).toContain('Setup SMTP')
      expect(wrapper.text()).toContain('Create Campaign')
    })

    it('should not show onboarding when campaigns exist', () => {
      mockDashboardData.value = {
        stats: { total: 10, sent: 8, failed: 2 },
        queue: {
          stats: {
            pending: 0,
            running: 0,
            paused: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total_sent: 0,
            total_failed: 0,
            dead_letters: 0,
          },
          activeJobs: [],
          pendingJobs: [],
          recentJobs: [],
        },
      }

      const wrapper = mountDashboard()
      expect(wrapper.text()).not.toContain('Ready to send your first campaign?')
    })

    it('should not show onboarding while loading', () => {
      mockDashboardData.value = null
      mockIsLoading.value = true

      const wrapper = mountDashboard()
      expect(wrapper.text()).not.toContain('Ready to send your first campaign?')
    })
  })

  describe('quick actions', () => {
    it('should render quick action links', () => {
      const wrapper = mountDashboard()
      expect(wrapper.text()).toContain('Quick Actions')
      expect(wrapper.text()).toContain('Compose')
      expect(wrapper.text()).toContain('Campaigns')
      expect(wrapper.text()).toContain('Contacts')
      expect(wrapper.text()).toContain('Reports')
      expect(wrapper.text()).toContain('Templates')
    })
  })

  describe('job queue', () => {
    it('should show active jobs section when there are running jobs', () => {
      mockDashboardData.value = {
        stats: { total: 10, sent: 5, failed: 0 },
        queue: {
          stats: {
            pending: 0,
            running: 1,
            paused: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total_sent: 5,
            total_failed: 0,
            dead_letters: 0,
          },
          activeJobs: [
            {
              id: 'job-1',
              subject: 'Test Email Campaign',
              status: 'running',
              sent_count: 5,
              total_count: 10,
              progress: 50,
            },
          ],
          pendingJobs: [],
          recentJobs: [],
        },
      }

      const wrapper = mountDashboard()
      expect(wrapper.text()).toContain('Active Jobs')
      expect(wrapper.text()).toContain('Test Email Campaign')
      expect(wrapper.text()).toContain('Running')
      expect(wrapper.text()).toContain('5/10 sent')
      expect(wrapper.text()).toContain('50%')
    })

    it('should not show job queue section when no activity', () => {
      mockDashboardData.value = {
        stats: { total: 10, sent: 10, failed: 0 },
        queue: {
          stats: {
            pending: 0,
            running: 0,
            paused: 0,
            completed: 5,
            failed: 0,
            cancelled: 0,
            total_sent: 10,
            total_failed: 0,
            dead_letters: 0,
          },
          activeJobs: [],
          pendingJobs: [],
          recentJobs: [],
        },
      }

      const wrapper = mountDashboard()
      expect(wrapper.text()).not.toContain('Active Jobs')
    })
  })

  describe('greeting', () => {
    it('should show user first name from user data', () => {
      mockUser.value = { id: '1', email: 'jane@test.com', name: 'Jane Smith' }
      const wrapper = mountDashboard()
      expect(wrapper.text()).toContain('Jane')
    })

    it('should handle user with no name', () => {
      mockUser.value = { id: '1', email: 'test@test.com', name: '' }
      const wrapper = mountDashboard()
      // Should not crash, just show greeting without name
      expect(wrapper.find('header').exists()).toBe(true)
    })
  })
})
