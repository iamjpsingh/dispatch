<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useNotifications } from '../../composables/useNotifications'
import { Mail, Upload, AlertTriangle, Zap, Info, Bell } from 'lucide-vue-next'

const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications()

const typeIcons: Record<string, any> = {
  campaign_sent: Mail,
  import_complete: Upload,
  bounce_alert: AlertTriangle,
  automation_triggered: Zap,
  system: Info,
}

function getIcon(type: string) {
  return typeIcons[type] || Bell
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function handleClick(notif: typeof notifications.value[number]) {
  markAsRead(notif.id)
  if (notif.action_url) {
    router.push(notif.action_url)
  }
  emit('close')
}

// Close on outside click
function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.notification-dropdown-container')) {
    emit('close')
  }
}

onMounted(() => {
  setTimeout(() => document.addEventListener('click', handleOutsideClick), 0)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
})
</script>

<template>
  <div class="notification-dropdown-container absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
      <h3 class="text-sm font-semibold text-foreground">Notifications</h3>
      <button
        v-if="unreadCount > 0"
        class="text-xs text-accent hover:text-accent/80 font-medium cursor-pointer"
        @click="markAllRead"
      >
        Mark all read
      </button>
    </div>

    <!-- List -->
    <div class="max-h-[360px] overflow-y-auto">
      <div v-if="notifications.length === 0" class="py-10 text-center">
        <Bell :size="24" class="mx-auto mb-2 text-muted-foreground opacity-40" />
        <p class="text-sm text-muted-foreground">No notifications</p>
      </div>

      <button
        v-for="notif in notifications"
        :key="notif.id"
        class="flex items-start gap-3 w-full px-4 py-3 text-left transition-colors cursor-pointer"
        :class="notif.read ? 'hover:bg-secondary' : 'bg-accent/5 hover:bg-accent/10'"
        @click="handleClick(notif)"
      >
        <div class="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg bg-secondary mt-0.5">
          <component :is="getIcon(notif.type)" :size="14" class="text-muted-foreground" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-foreground truncate">{{ notif.title }}</span>
            <span
              v-if="!notif.read"
              class="shrink-0 w-1.5 h-1.5 rounded-full bg-accent"
            />
          </div>
          <p class="text-xs text-muted-foreground line-clamp-2 mt-0.5">{{ notif.message }}</p>
          <span class="text-[10px] text-muted-foreground mt-1 block">{{ formatTime(notif.created_at) }}</span>
        </div>
      </button>
    </div>
  </div>
</template>
