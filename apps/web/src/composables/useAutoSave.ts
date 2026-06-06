import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'

interface AutoSaveOptions {
  interval?: number // ms, default 30000
  debounce?: number // ms, default 2000
}

export function useAutoSave<T>(key: string, data: Ref<T>, opts: AutoSaveOptions = {}) {
  const interval = opts.interval ?? 30000
  const debounce = opts.debounce ?? 2000
  const storageKey = `dispatch-draft-${key}`

  const hasDraft = ref(false)
  const lastSavedAt = ref<Date | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data.value))
      lastSavedAt.value = new Date()
      hasDraft.value = true
    } catch { /* quota exceeded or disabled */ }
  }

  function restoreDraft(): T | null {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return null
      return JSON.parse(raw) as T
    } catch { return null }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(storageKey)
      hasDraft.value = false
      lastSavedAt.value = null
    } catch { /* ignore */ }
  }

  // Debounced save on data change
  watch(data, () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(save, debounce)
  }, { deep: true })

  // Interval save
  onMounted(() => {
    hasDraft.value = !!localStorage.getItem(storageKey)
    timer = setInterval(save, interval)
  })

  // Cleanup timers on unmount
  onBeforeUnmount(() => {
    if (timer) { clearInterval(timer); timer = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  })

  return { hasDraft, lastSavedAt, restoreDraft, clearDraft, save }
}
