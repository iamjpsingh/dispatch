<script setup lang="ts">
import { ref } from 'vue'
import { Bell } from 'lucide-vue-next'
import { useNotifications } from '../../composables/useNotifications'
import NotificationDropdown from './NotificationDropdown.vue'

const { unreadCount } = useNotifications()
const showDropdown = ref(false)
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
      @click="showDropdown = !showDropdown"
      aria-label="Notifications"
    >
      <Bell :size="16" />
      <!-- Unread badge -->
      <span
        v-if="unreadCount > 0"
        class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-destructive text-white text-[9px] font-bold"
      >
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>

    <NotificationDropdown
      v-if="showDropdown"
      @close="showDropdown = false"
    />
  </div>
</template>
