// DashboardView was rebuilt onto the P6 Vue-Query composables (useDashboardStats + job
// mutations) with a greeting header, live queue panel, onboarding empty state, and a recent-
// campaigns list. This suite smoke-tests the current view: it mounts, greets the user, shows the
// onboarding + "no recent campaigns" states with no data, and renders recent jobs when present.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// lucide-vue-next icons render fine under jsdom — not stubbed.
vi.mock('../../src/components/layout/MainLayout.vue', () => ({
  default: { template: '<div class="main-layout"><slot /></div>' },
}))

const mockUser = ref<{ id: string; email: string; name: string } | null>(null)
vi.mock('../../src/stores/auth', () => ({ useAuth: () => ({ user: mockUser }) }))

const mockDashboardData = ref<any>(null)
const mockIsLoading = ref(false)
const mockError = ref<unknown>(null)
vi.mock('../../src/lib/query', () => ({
  useDashboardStats: () => ({
    data: mockDashboardData,
    isLoading: mockIsLoading,
    error: mockError,
    refetch: vi.fn(),
  }),
  usePauseJob: () => ({ mutate: vi.fn(), isPending: ref(false) }),
  useResumeJob: () => ({ mutate: vi.fn(), isPending: ref(false) }),
  useCancelJob: () => ({ mutate: vi.fn(), isPending: ref(false) }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}))

import DashboardView from '@/views/DashboardView.vue'

function mountDashboard() {
  return mount(DashboardView, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>', props: ['to'] } } },
  })
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser.value = { id: 'u1', email: 'ada@test.com', name: 'Ada' }
    mockDashboardData.value = null
    mockIsLoading.value = false
    mockError.value = null
  })

  it('mounts and greets the user in the header', () => {
    const wrapper = mountDashboard()
    const h1 = wrapper.find('h1')
    expect(h1.exists()).toBe(true)
    expect(h1.text()).toContain('Ada')
  })

  it('shows onboarding + no-recent-campaigns states when there is no data', () => {
    mockDashboardData.value = null // stats default to total 0
    const wrapper = mountDashboard()
    const text = wrapper.text()
    expect(text).toContain('Ready to send your first campaign?')
    expect(text).toContain('No recent campaigns')
  })

  it('renders recent campaign jobs when data is present', () => {
    mockDashboardData.value = {
      stats: { total: 3, sent: 2, failed: 1 },
      queue: {
        stats: { pending: 0, running: 0, paused: 0, completed: 3, failed: 0, cancelled: 0, total_sent: 2, total_failed: 1, dead_letters: 0 },
        activeJobs: [],
        pendingJobs: [],
        recentJobs: [
          { id: 'job-1', subject: 'Spring Newsletter', status: 'completed', sent_count: 100, total_count: 100, progress: 100, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        ],
      },
    }
    const wrapper = mountDashboard()
    expect(wrapper.text()).toContain('Spring Newsletter')
  })
})
