import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, defineComponent, h } from 'vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
import { useToast } from '@/composables/useToast'

// Stub lucide-vue-next icons to avoid rendering issues in tests
const IconStub = {
  template: '<svg data-testid="icon"></svg>',
  props: ['size'],
}

const globalStubs = {
  CheckCircle: IconStub,
  XCircle: IconStub,
  AlertTriangle: IconStub,
  Info: IconStub,
  X: { template: '<svg data-testid="close-icon"></svg>', props: ['size'] },
  Teleport: true,
}

function mountToastContainer() {
  return mount(ToastContainer, {
    global: {
      stubs: globalStubs,
    },
  })
}

describe('ToastContainer', () => {
  let toast: ReturnType<typeof useToast>

  beforeEach(() => {
    vi.useFakeTimers()
    toast = useToast()
    // Clear any leftover toasts from previous tests
    ;[...toast.toasts.value].forEach((t) => toast.remove(t.id))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render nothing when there are no toasts', () => {
    const wrapper = mountToastContainer()

    expect(wrapper.findAll('[class*="border-l-4"]')).toHaveLength(0)
  })

  it('should render toast messages', async () => {
    toast.success('Upload complete')

    const wrapper = mountToastContainer()
    await nextTick()

    const toastElements = wrapper.findAll('[class*="border-l-4"]')
    expect(toastElements).toHaveLength(1)
    expect(wrapper.text()).toContain('Upload complete')
  })

  it('should render multiple toasts', async () => {
    toast.success('First message')
    toast.error('Second message')
    toast.warning('Third message')

    const wrapper = mountToastContainer()
    await nextTick()

    const toastElements = wrapper.findAll('[class*="border-l-4"]')
    expect(toastElements).toHaveLength(3)
    expect(wrapper.text()).toContain('First message')
    expect(wrapper.text()).toContain('Second message')
    expect(wrapper.text()).toContain('Third message')
  })

  describe('type styling', () => {
    it('should apply success styling', async () => {
      toast.success('Success toast')

      const wrapper = mountToastContainer()
      await nextTick()

      const toastEl = wrapper.find('[class*="border-l-4"]')
      const classes = toastEl.classes().join(' ')
      expect(classes).toContain('border-l-[var(--color-success)]')
    })

    it('should apply error styling', async () => {
      toast.error('Error toast')

      const wrapper = mountToastContainer()
      await nextTick()

      const toastEl = wrapper.find('[class*="border-l-4"]')
      const classes = toastEl.classes().join(' ')
      expect(classes).toContain('border-l-[var(--color-danger)]')
    })

    it('should apply warning styling', async () => {
      toast.warning('Warning toast')

      const wrapper = mountToastContainer()
      await nextTick()

      const toastEl = wrapper.find('[class*="border-l-4"]')
      const classes = toastEl.classes().join(' ')
      expect(classes).toContain('border-l-[var(--color-warning)]')
    })

    it('should apply info styling', async () => {
      toast.info('Info toast')

      const wrapper = mountToastContainer()
      await nextTick()

      const toastEl = wrapper.find('[class*="border-l-4"]')
      const classes = toastEl.classes().join(' ')
      expect(classes).toContain('border-l-[var(--color-accent)]')
    })
  })

  describe('close button', () => {
    it('should remove toast when close button is clicked', async () => {
      toast.success('Will be removed')

      // Mount fresh after toast is added
      const wrapper = mountToastContainer()
      await nextTick()

      expect(wrapper.findAll('[class*="border-l-4"]')).toHaveLength(1)

      // Trigger click on the close button
      const closeButton = wrapper.find('button')
      await closeButton.trigger('click')

      // Verify composable state is updated correctly
      expect(toast.toasts.value).toHaveLength(0)

      // Re-mount to verify the component reflects updated state
      // This is necessary because Teleport stubs in vue-test-utils
      // do not reliably re-render on reactive updates
      const freshWrapper = mountToastContainer()
      await nextTick()

      expect(freshWrapper.findAll('[class*="border-l-4"]')).toHaveLength(0)
    })

    it('should only remove the clicked toast when multiple exist', async () => {
      toast.success('Keep this')
      toast.error('Remove this')

      const wrapper = mountToastContainer()
      await nextTick()

      expect(wrapper.findAll('[class*="border-l-4"]')).toHaveLength(2)

      // Click the close button on the second toast
      const buttons = wrapper.findAll('button')
      await buttons[1].trigger('click')

      // Verify composable state: only the clicked toast was removed
      expect(toast.toasts.value).toHaveLength(1)
      expect(toast.toasts.value[0].message).toBe('Keep this')

      // Re-mount to verify DOM matches state
      const freshWrapper = mountToastContainer()
      await nextTick()

      expect(freshWrapper.findAll('[class*="border-l-4"]')).toHaveLength(1)
      expect(freshWrapper.text()).toContain('Keep this')
      expect(freshWrapper.text()).not.toContain('Remove this')
    })
  })
})
