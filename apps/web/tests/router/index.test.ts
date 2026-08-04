import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'

// Mock the auth store. useAuth must expose everything the navigation guard reads —
// isPlatformAdmin (platform-vs-org routing) and role were added in P7; omitting them
// makes the guard throw `undefined.value`.
const mockIsAuthenticated = ref(false)
const mockIsInitialized = ref(false)
const mockIsPlatformAdmin = ref(false)
const mockRole = ref<string | null>(null)
const mockInitializeAuth = vi.fn()

vi.mock('../../src/stores/auth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    isInitialized: mockIsInitialized,
    initializeAuth: mockInitializeAuth,
    isPlatformAdmin: mockIsPlatformAdmin,
    role: mockRole,
  }),
}))

// We need to mock the view imports since they'd pull in complex dependencies
vi.mock('../../src/views/LoginView.vue', () => ({ default: { template: '<div>Login</div>' } }))
vi.mock('../../src/views/DashboardView.vue', () => ({ default: { template: '<div>Dashboard</div>' } }))
vi.mock('../../src/views/ComposeView.vue', () => ({ default: { template: '<div>Compose</div>' } }))
vi.mock('../../src/views/ReportsView.vue', () => ({ default: { template: '<div>Reports</div>' } }))
vi.mock('../../src/views/ContactsView.vue', () => ({ default: { template: '<div>Contacts</div>' } }))
vi.mock('../../src/views/TemplatesView.vue', () => ({ default: { template: '<div>Templates</div>' } }))
vi.mock('../../src/views/CampaignsView.vue', () => ({ default: { template: '<div>Campaigns</div>' } }))
vi.mock('../../src/views/CampaignDetailView.vue', () => ({ default: { template: '<div>CampaignDetail</div>' } }))
vi.mock('../../src/views/AutomationsView.vue', () => ({ default: { template: '<div>Automations</div>' } }))
vi.mock('../../src/views/CalendarView.vue', () => ({ default: { template: '<div>Calendar</div>' } }))
vi.mock('../../src/views/AnalyticsView.vue', () => ({ default: { template: '<div>Analytics</div>' } }))

import router from '@/router/index'

describe('Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockIsAuthenticated.value = false
    mockIsInitialized.value = false
    mockIsPlatformAdmin.value = false
    mockRole.value = null
    mockInitializeAuth.mockResolvedValue(undefined)
  })

  describe('route definitions', () => {
    it('should have a login route', () => {
      const loginRoute = router.getRoutes().find((r) => r.path === '/login')
      expect(loginRoute).toBeDefined()
      expect(loginRoute?.name).toBe('Login')
      expect(loginRoute?.meta.guest).toBe(true)
    })

    // requiresAuth lives on the MainLayout parent route, so assert on the resolved
    // route (merged meta across matched records), not the leaf record's own meta.
    it('should have a dashboard route at /', () => {
      const resolved = router.resolve('/')
      expect(resolved.name).toBe('Dashboard')
      expect(resolved.meta.requiresAuth).toBe(true)
    })

    it('should have a compose route', () => {
      const resolved = router.resolve('/compose')
      expect(resolved.name).toBe('Compose')
      expect(resolved.meta.requiresAuth).toBe(true)
    })

    it('should have a reports route', () => {
      const resolved = router.resolve('/reports')
      expect(resolved.name).toBe('Reports')
      expect(resolved.meta.requiresAuth).toBe(true)
    })

    it('should have a contacts route', () => {
      const route = router.getRoutes().find((r) => r.path === '/contacts')
      expect(route).toBeDefined()
      expect(route?.name).toBe('Contacts')
    })

    it('should have a settings route (requires auth)', () => {
      // '/configs' was replaced by the unified '/settings/*' section in P7.
      const resolved = router.resolve('/settings/delivery-servers')
      expect(resolved.name).toBe('SettingsDeliveryServers')
      expect(resolved.meta.requiresAuth).toBe(true)
    })

    it('should have a templates route', () => {
      const route = router.getRoutes().find((r) => r.path === '/templates')
      expect(route).toBeDefined()
      expect(route?.name).toBe('Templates')
    })

    it('should have a campaigns route', () => {
      const route = router.getRoutes().find((r) => r.path === '/campaigns')
      expect(route).toBeDefined()
      expect(route?.name).toBe('Campaigns')
    })

    it('should have a campaign detail route', () => {
      const route = router.getRoutes().find((r) => r.path === '/campaigns/:id')
      expect(route).toBeDefined()
      expect(route?.name).toBe('CampaignDetail')
    })

    it('should have an automations route', () => {
      const route = router.getRoutes().find((r) => r.path === '/automations')
      expect(route).toBeDefined()
      expect(route?.name).toBe('Automations')
    })

    it('should have a calendar route', () => {
      const route = router.getRoutes().find((r) => r.path === '/calendar')
      expect(route).toBeDefined()
      expect(route?.name).toBe('Calendar')
    })

    it('should have an analytics route', () => {
      const route = router.getRoutes().find((r) => r.path === '/analytics')
      expect(route).toBeDefined()
      expect(route?.name).toBe('Analytics')
    })

    it('should have a 404 catch-all route', () => {
      const route = router.getRoutes().find((r) => r.name === 'not-found')
      expect(route).toBeDefined()
      // The catch-all uses /:pathMatch(.*)* pattern
      expect(route?.path).toMatch(/pathMatch/)
    })
  })

  describe('navigation guard', () => {
    it('should redirect unauthenticated users to /login for auth-required routes', async () => {
      mockIsInitialized.value = true
      mockIsAuthenticated.value = false

      await router.push('/')
      await nextTick()

      expect(router.currentRoute.value.path).toBe('/login')
    })

    it('should redirect authenticated users away from /login to /', async () => {
      mockIsInitialized.value = true
      mockIsAuthenticated.value = true

      // First ensure we are on a non-login page
      await router.push('/compose')
      await nextTick()

      // Now try to navigate to /login
      await router.push('/login')
      await nextTick()

      // Should redirect to dashboard since user is authenticated
      expect(router.currentRoute.value.path).toBe('/')
    })

    it('should allow authenticated users to access protected routes', async () => {
      mockIsInitialized.value = true
      mockIsAuthenticated.value = true

      await router.push('/compose')
      await nextTick()

      expect(router.currentRoute.value.path).toBe('/compose')
    })

    it('should call initializeAuth on first navigation if not initialized', async () => {
      mockIsInitialized.value = false
      mockIsAuthenticated.value = false

      await router.push('/login')
      await nextTick()

      expect(mockInitializeAuth).toHaveBeenCalled()
    })

    it('should not call initializeAuth if already initialized', async () => {
      mockIsInitialized.value = true
      mockIsAuthenticated.value = true

      await router.push('/compose')
      await nextTick()

      expect(mockInitializeAuth).not.toHaveBeenCalled()
    })
  })
})
