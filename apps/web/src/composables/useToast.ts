import { ref, readonly } from 'vue'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration: number
  action?: ToastAction
  createdAt: number
}

const MAX_TOASTS = 5
const toasts = ref<Toast[]>([])
let nextId = 0

function addToast(
  message: string,
  type: Toast['type'] = 'info',
  duration = 4000,
  action?: ToastAction,
) {
  const id = nextId++
  // Enforce stacking limit — remove oldest first
  while (toasts.value.length >= MAX_TOASTS) {
    toasts.value.shift()
  }
  toasts.value.push({ id, message, type, duration, action, createdAt: Date.now() })
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration)
  }
  return id
}

function removeToast(id: number) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    success: (msg: string, duration?: number) => addToast(msg, 'success', duration),
    error: (msg: string, duration?: number) => addToast(msg, 'error', duration),
    warning: (msg: string, duration?: number) => addToast(msg, 'warning', duration),
    info: (msg: string, duration?: number) => addToast(msg, 'info', duration),
    undo: (msg: string, undoFn: () => void, duration = 5000) =>
      addToast(msg, 'info', duration, { label: 'Undo', onClick: undoFn }),
    remove: removeToast,
  }
}
