import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export interface AppNotification {
  id: string
  type: 'campaign_sent' | 'import_complete' | 'bounce_alert' | 'automation_triggered' | 'system' | string
  title: string
  message: string
  read: boolean
  created_at: string
  action_url?: string
}

const notifications = ref<AppNotification[]>([])
const isLoading = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let usageCount = 0

async function fetchNotifications() {
  try {
    const res = await fetch('/api/notifications', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        notifications.value = data.data
      }
    }
  } catch {
    // Gracefully degrade — endpoint may not exist yet
  }
}

export function useNotifications() {
  const unreadCount = computed(() => notifications.value.filter(n => !n.read).length)

  async function markAsRead(id: string) {
    const notif = notifications.value.find(n => n.id === id)
    if (notif) notif.read = true
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    notifications.value.forEach(n => { n.read = true })
    try {
      await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
  }

  function startPolling() {
    if (pollTimer) return
    fetchNotifications()
    pollTimer = setInterval(fetchNotifications, 60_000)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onMounted(() => {
    usageCount++
    startPolling()
  })

  onBeforeUnmount(() => {
    usageCount--
    if (usageCount <= 0) {
      stopPolling()
      usageCount = 0
    }
  })

  return {
    notifications: computed(() => notifications.value),
    unreadCount,
    isLoading,
    markAsRead,
    markAllRead,
    refresh: fetchNotifications,
    stopPolling,
  }
}
