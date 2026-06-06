import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'

// Mock TanStack Vue Query
const mockQueryClient = {
  fetchQuery: vi.fn(),
  setQueryData: vi.fn(),
  clear: vi.fn(),
}
vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => mockQueryClient,
}))

// Mock the query composables
const mockUserData = ref<{ id: string; email: string; name: string } | null>(null)
const mockUserLoading = ref(false)
const mockUserFetched = ref(false)
const mockLoginMutateAsync = vi.fn()
const mockRegisterMutateAsync = vi.fn()
const mockLogoutMutateAsync = vi.fn()

vi.mock('../../src/lib/query', () => ({
  useCurrentUser: () => ({
    data: mockUserData,
    isLoading: mockUserLoading,
    isFetched: mockUserFetched,
  }),
  useLogin: () => ({
    mutateAsync: mockLoginMutateAsync,
    isPending: ref(false),
  }),
  useRegister: () => ({
    mutateAsync: mockRegisterMutateAsync,
    isPending: ref(false),
  }),
  useLogout: () => ({
    mutateAsync: mockLogoutMutateAsync,
    isPending: ref(false),
  }),
  queryKeys: {
    auth: { me: ['auth', 'me'] },
  },
}))

import { useAuth } from '@/stores/auth'

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserData.value = null
    mockUserLoading.value = false
    mockUserFetched.value = false
  })

  describe('isAuthenticated', () => {
    it('should return false when no user is loaded', () => {
      const { isAuthenticated } = useAuth()
      expect(isAuthenticated.value).toBe(false)
    })

    it('should return true when user is loaded', () => {
      mockUserData.value = { id: '1', email: 'test@test.com', name: 'Test User' }
      const { isAuthenticated } = useAuth()
      expect(isAuthenticated.value).toBe(true)
    })
  })

  describe('user', () => {
    it('should return null when no user', () => {
      const { user } = useAuth()
      expect(user.value).toBeNull()
    })

    it('should return user data when available', () => {
      mockUserData.value = { id: '1', email: 'test@test.com', name: 'Test User' }
      const { user } = useAuth()
      expect(user.value).toEqual({ id: '1', email: 'test@test.com', name: 'Test User' })
    })
  })

  describe('loading', () => {
    it('should reflect query loading state', () => {
      mockUserLoading.value = true
      const { loading } = useAuth()
      expect(loading.value).toBe(true)
    })

    it('should be false when not loading', () => {
      mockUserLoading.value = false
      const { loading } = useAuth()
      expect(loading.value).toBe(false)
    })
  })

  describe('login', () => {
    it('should call login mutation and return success', async () => {
      mockLoginMutateAsync.mockResolvedValue({ id: '1', email: 'test@test.com', name: 'Test' })

      const { login } = useAuth()
      const result = await login('test@test.com', 'password123')

      expect(mockLoginMutateAsync).toHaveBeenCalledWith({ email: 'test@test.com', password: 'password123' })
      expect(result).toEqual({ success: true })
    })

    it('should return error message on login failure', async () => {
      mockLoginMutateAsync.mockRejectedValue(new Error('Invalid credentials'))

      const { login } = useAuth()
      const result = await login('test@test.com', 'wrongpassword')

      expect(result).toEqual({ success: false, message: 'Invalid credentials' })
    })

    it('should return generic message for non-Error rejection', async () => {
      mockLoginMutateAsync.mockRejectedValue('unknown error')

      const { login } = useAuth()
      const result = await login('test@test.com', 'password')

      expect(result).toEqual({ success: false, message: 'Login failed' })
    })
  })

  describe('register', () => {
    it('should call register mutation and return success', async () => {
      mockRegisterMutateAsync.mockResolvedValue({ id: '2', email: 'new@test.com', name: 'New User' })

      const { register } = useAuth()
      const result = await register('New User', 'new@test.com', 'password123')

      expect(mockRegisterMutateAsync).toHaveBeenCalledWith({
        name: 'New User',
        email: 'new@test.com',
        password: 'password123',
      })
      expect(result).toEqual({ success: true })
    })

    it('should return error message on registration failure', async () => {
      mockRegisterMutateAsync.mockRejectedValue(new Error('Email already exists'))

      const { register } = useAuth()
      const result = await register('Test', 'existing@test.com', 'password')

      expect(result).toEqual({ success: false, message: 'Email already exists' })
    })

    it('should return generic message for non-Error rejection', async () => {
      mockRegisterMutateAsync.mockRejectedValue(42)

      const { register } = useAuth()
      const result = await register('Test', 'test@test.com', 'pass')

      expect(result).toEqual({ success: false, message: 'Registration failed' })
    })
  })

  describe('logout', () => {
    it('should call logout mutation', async () => {
      mockLogoutMutateAsync.mockResolvedValue(undefined)

      const { logout } = useAuth()
      await logout()

      expect(mockLogoutMutateAsync).toHaveBeenCalled()
    })
  })

  describe('requireAuth', () => {
    it('should return false when not authenticated', () => {
      const { requireAuth } = useAuth()
      expect(requireAuth()).toBe(false)
    })

    it('should return true when authenticated', () => {
      mockUserData.value = { id: '1', email: 'test@test.com', name: 'Test' }
      const { requireAuth } = useAuth()
      expect(requireAuth()).toBe(true)
    })
  })

  describe('initializeAuth', () => {
    it('should call fetchQuery to initialize auth', async () => {
      mockQueryClient.fetchQuery.mockResolvedValue({ id: '1', email: 'test@test.com', name: 'Test' })

      // Re-import to get a fresh module-level ref
      // initializeAuth is idempotent - it only runs once because authInitialized is module-level
      // so we test that fetchQuery is called on the first invocation
      const { initializeAuth } = useAuth()
      await initializeAuth()

      // After the first call in this test suite, authInitialized is true
      // so we check if fetchQuery was ever called
      expect(mockQueryClient.fetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['auth', 'me'],
        })
      )
    })

    it('should not call fetchQuery again on second invocation (idempotent)', async () => {
      mockQueryClient.fetchQuery.mockResolvedValue({ id: '1', email: 'test@test.com', name: 'Test' })

      const { initializeAuth } = useAuth()
      // authInitialized is already true from previous test
      mockQueryClient.fetchQuery.mockClear()
      await initializeAuth()

      // Should not call fetchQuery again since already initialized
      expect(mockQueryClient.fetchQuery).not.toHaveBeenCalled()
    })
  })
})
