import { ref, watch } from 'vue'

const STORAGE_KEY = 'dispatch-dashboard-layout'
const DEFAULT_ORDER = ['stats', 'activeJobs', 'recentCampaigns', 'quickNav']

const widgetOrder = ref<string[]>(loadOrder())
const hiddenWidgets = ref<string[]>(loadHidden())

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.order)) return parsed.order
    }
  } catch { /* ignore */ }
  return [...DEFAULT_ORDER]
}

function loadHidden(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.hidden)) return parsed.hidden
    }
  } catch { /* ignore */ }
  return []
}

function saveLayout() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      order: widgetOrder.value,
      hidden: hiddenWidgets.value,
    }))
  } catch { /* ignore */ }
}

watch([widgetOrder, hiddenWidgets], saveLayout, { deep: true })

export function useDashboardLayout() {
  function moveWidget(fromIndex: number, toIndex: number) {
    const item = widgetOrder.value.splice(fromIndex, 1)[0]
    if (item) widgetOrder.value.splice(toIndex, 0, item)
  }

  function hideWidget(id: string) {
    if (!hiddenWidgets.value.includes(id)) {
      hiddenWidgets.value.push(id)
    }
  }

  function showWidget(id: string) {
    hiddenWidgets.value = hiddenWidgets.value.filter(w => w !== id)
  }

  function resetLayout() {
    widgetOrder.value = [...DEFAULT_ORDER]
    hiddenWidgets.value = []
  }

  function isVisible(id: string): boolean {
    return !hiddenWidgets.value.includes(id)
  }

  return { widgetOrder, moveWidget, hideWidget, showWidget, resetLayout, isVisible }
}
