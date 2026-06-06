import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useToast } from '@/composables/useToast'

describe('useToast', () => {
  let toast: ReturnType<typeof useToast>

  beforeEach(() => {
    vi.useFakeTimers()
    toast = useToast()
    // Clear any leftover toasts from previous tests
    // toasts is a readonly ref, so access .value to get the array
    ;[...toast.toasts.value].forEach((t) => toast.remove(t.id))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('success()', () => {
    it('should add a success toast', () => {
      toast.success('Operation completed')

      expect(toast.toasts.value).toHaveLength(1)
      expect(toast.toasts.value[0].type).toBe('success')
      expect(toast.toasts.value[0].message).toBe('Operation completed')
    })

    it('should set default duration of 4000ms', () => {
      toast.success('Done')

      expect(toast.toasts.value[0].duration).toBe(4000)
    })

    it('should accept a custom duration', () => {
      toast.success('Done', 8000)

      expect(toast.toasts.value[0].duration).toBe(8000)
    })
  })

  describe('error()', () => {
    it('should add an error toast', () => {
      toast.error('Something went wrong')

      expect(toast.toasts.value).toHaveLength(1)
      expect(toast.toasts.value[0].type).toBe('error')
      expect(toast.toasts.value[0].message).toBe('Something went wrong')
    })
  })

  describe('warning()', () => {
    it('should add a warning toast', () => {
      toast.warning('Be careful')

      expect(toast.toasts.value).toHaveLength(1)
      expect(toast.toasts.value[0].type).toBe('warning')
      expect(toast.toasts.value[0].message).toBe('Be careful')
    })
  })

  describe('info()', () => {
    it('should add an info toast', () => {
      toast.info('FYI')

      expect(toast.toasts.value).toHaveLength(1)
      expect(toast.toasts.value[0].type).toBe('info')
      expect(toast.toasts.value[0].message).toBe('FYI')
    })
  })

  describe('remove()', () => {
    it('should remove a specific toast by id', () => {
      const id1 = toast.success('First')
      const id2 = toast.error('Second')

      expect(toast.toasts.value).toHaveLength(2)

      toast.remove(id1)

      expect(toast.toasts.value).toHaveLength(1)
      expect(toast.toasts.value[0].message).toBe('Second')
    })

    it('should do nothing if id does not exist', () => {
      toast.success('Exists')

      expect(toast.toasts.value).toHaveLength(1)

      toast.remove(999999)

      expect(toast.toasts.value).toHaveLength(1)
    })
  })

  describe('auto-removal', () => {
    it('should auto-remove toast after its duration', () => {
      toast.success('Temporary', 3000)

      expect(toast.toasts.value).toHaveLength(1)

      vi.advanceTimersByTime(3000)

      expect(toast.toasts.value).toHaveLength(0)
    })

    it('should not auto-remove toast when duration is 0', () => {
      toast.success('Persistent', 0)

      expect(toast.toasts.value).toHaveLength(1)

      vi.advanceTimersByTime(10000)

      expect(toast.toasts.value).toHaveLength(1)
    })

    it('should handle multiple toasts with different durations', () => {
      toast.success('Short', 1000)
      toast.error('Long', 5000)

      expect(toast.toasts.value).toHaveLength(2)

      vi.advanceTimersByTime(1000)
      expect(toast.toasts.value).toHaveLength(1)
      expect(toast.toasts.value[0].message).toBe('Long')

      vi.advanceTimersByTime(4000)
      expect(toast.toasts.value).toHaveLength(0)
    })
  })

  describe('unique ids', () => {
    it('should assign unique ids to each toast', () => {
      const id1 = toast.success('One')
      const id2 = toast.success('Two')
      const id3 = toast.success('Three')

      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })
  })
})
