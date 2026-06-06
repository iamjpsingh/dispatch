import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, nextTick } from 'vue'

// Mock router
const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

// Mock auth store
const mockLogin = vi.fn()
const mockRegister = vi.fn()
const mockLoading = ref(false)

vi.mock('../../src/stores/auth', () => ({
  useAuth: () => ({
    login: mockLogin,
    register: mockRegister,
    loading: mockLoading,
  }),
}))

// Stub lucide icons
vi.mock('lucide-vue-next', () => {
  const stub = { template: '<svg />', props: { size: Number } }
  return {
    Send: stub,
    Zap: stub,
    BarChart3: stub,
    Clock: stub,
    Loader2: stub,
    AlertCircle: stub,
    Eye: stub,
    EyeOff: stub,
    ArrowRight: stub,
  }
})

import LoginView from '@/views/LoginView.vue'

function mountLogin() {
  return mount(LoginView, {
    global: {
      stubs: {
        Transition: false,
      },
    },
  })
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoading.value = false
    mockLogin.mockResolvedValue({ success: true })
    mockRegister.mockResolvedValue({ success: true })
  })

  describe('rendering', () => {
    it('should render the login form', () => {
      const wrapper = mountLogin()

      expect(wrapper.find('form').exists()).toBe(true)
      expect(wrapper.find('#email-input').exists()).toBe(true)
      expect(wrapper.find('#password-input').exists()).toBe(true)
      expect(wrapper.find('button[type="submit"]').exists()).toBe(true)
    })

    it('should show Dispatch branding', () => {
      const wrapper = mountLogin()
      expect(wrapper.text()).toContain('Dispatch')
    })

    it('should show login mode by default', () => {
      const wrapper = mountLogin()
      expect(wrapper.text()).toContain('Welcome back')
      expect(wrapper.text()).toContain('Sign in to your account')
    })

    it('should not show name field in login mode', () => {
      const wrapper = mountLogin()
      expect(wrapper.find('#name-input').exists()).toBe(false)
    })

    it('should show feature badges', () => {
      const wrapper = mountLogin()
      expect(wrapper.text()).toContain('Batch Processing')
      expect(wrapper.text()).toContain('Real-time Tracking')
      expect(wrapper.text()).toContain('Scheduled Sends')
    })
  })

  describe('form validation', () => {
    it('should disable submit button when fields are empty', () => {
      const wrapper = mountLogin()
      const submitBtn = wrapper.find('button[type="submit"]')
      expect((submitBtn.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('should enable submit button when email and password are filled', async () => {
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')

      const submitBtn = wrapper.find('button[type="submit"]')
      expect((submitBtn.element as HTMLButtonElement).disabled).toBe(false)
    })

    it('should disable submit button when only email is filled', async () => {
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')

      const submitBtn = wrapper.find('button[type="submit"]')
      expect((submitBtn.element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('login flow', () => {
    it('should call login with email and password on submit', async () => {
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockLogin).toHaveBeenCalledWith('test@test.com', 'password123')
    })

    it('should redirect to / on successful login', async () => {
      mockLogin.mockResolvedValue({ success: true })
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('should show error message on failed login', async () => {
      mockLogin.mockResolvedValue({ success: false, message: 'Invalid credentials' })
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('wrongpassword')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      await nextTick()

      expect(wrapper.text()).toContain('Invalid credentials')
    })

    it('should show error on network failure', async () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockLogin.mockRejectedValue(new Error('Network error'))
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      await nextTick()

      expect(wrapper.text()).toContain('Network error')
      consoleSpy.mockRestore()
    })

    it('should show generic error message when login result has no message', async () => {
      mockLogin.mockResolvedValue({ success: false })
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      await nextTick()

      expect(wrapper.text()).toContain('Authentication failed')
    })
  })

  describe('register mode', () => {
    it('should toggle to register mode when Sign Up is clicked', async () => {
      const wrapper = mountLogin()

      // Find and click the Sign Up link
      const toggleBtn = wrapper.findAll('button').find((btn) => btn.text() === 'Sign Up')
      expect(toggleBtn).toBeDefined()
      await toggleBtn!.trigger('click')

      expect(wrapper.text()).toContain('Create account')
      expect(wrapper.find('#name-input').exists()).toBe(true)
    })

    it('should disable submit in register mode when name is empty', async () => {
      const wrapper = mountLogin()

      // Switch to register
      const toggleBtn = wrapper.findAll('button').find((btn) => btn.text() === 'Sign Up')
      await toggleBtn!.trigger('click')

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')
      // Name field is empty

      const submitBtn = wrapper.find('button[type="submit"]')
      expect((submitBtn.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('should call register with name, email and password', async () => {
      const wrapper = mountLogin()

      // Switch to register
      const toggleBtn = wrapper.findAll('button').find((btn) => btn.text() === 'Sign Up')
      await toggleBtn!.trigger('click')

      await wrapper.find('#name-input').setValue('Test User')
      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockRegister).toHaveBeenCalledWith('Test User', 'test@test.com', 'password123')
    })

    it('should clear fields when toggling modes', async () => {
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')

      // Switch to register
      const toggleBtn = wrapper.findAll('button').find((btn) => btn.text() === 'Sign Up')
      await toggleBtn!.trigger('click')

      expect((wrapper.find('#email-input').element as HTMLInputElement).value).toBe('')
      expect((wrapper.find('#password-input').element as HTMLInputElement).value).toBe('')
    })
  })

  describe('password visibility toggle', () => {
    it('should toggle password visibility when eye icon is clicked', async () => {
      const wrapper = mountLogin()

      const passwordInput = wrapper.find('#password-input')
      expect(passwordInput.attributes('type')).toBe('password')

      // Click the toggle button (button with aria-label)
      const toggleBtn = wrapper.find('button[aria-label="Show password"]')
      await toggleBtn.trigger('click')

      expect(passwordInput.attributes('type')).toBe('text')
    })
  })

  describe('loading state', () => {
    it('should disable submit button when loading', async () => {
      mockLoading.value = true
      const wrapper = mountLogin()

      await wrapper.find('#email-input').setValue('test@test.com')
      await wrapper.find('#password-input').setValue('password123')

      const submitBtn = wrapper.find('button[type="submit"]')
      expect((submitBtn.element as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
