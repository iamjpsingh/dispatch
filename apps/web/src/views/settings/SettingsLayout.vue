<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import PageHeader from '../../components/ui/PageHeader.vue'
import { cn } from '../../lib/utils'
import {
  Server,
  Hash,
  Webhook,
} from 'lucide-vue-next'

const route = useRoute()

// Detect if we're under /platform/settings or /settings
const basePath = computed(() => {
  return route.path.startsWith('/platform') ? '/platform/settings' : '/settings'
})

const navItems = computed(() => [
  { path: `${basePath.value}/delivery-servers`, label: 'Delivery Servers', icon: Server },
  { path: `${basePath.value}/api-keys`, label: 'API Keys', icon: Hash },
  { path: `${basePath.value}/webhooks`, label: 'Webhooks', icon: Webhook },
])

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + '/')
}
</script>

<template>
  <div>
    <PageHeader title="Settings" subtitle="Manage your account configuration and integrations" />

    <div class="flex gap-8 mt-6">
      <!-- Settings sidebar navigation -->
      <aside class="w-56 shrink-0 hidden md:block">
        <nav class="flex flex-col gap-1">
          <router-link
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            :class="cn(
              'group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
              isActive(item.path)
                ? 'bg-accent/8 text-accent font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )"
          >
            <component
              :is="item.icon"
              :size="16"
              :class="isActive(item.path) ? 'text-accent' : 'text-muted-foreground group-hover:text-muted-foreground'"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm">{{ item.label }}</div>
            </div>
          </router-link>
        </nav>
      </aside>

      <!-- Mobile navigation (horizontal tabs) -->
      <div class="md:hidden w-full mb-4">
        <div class="flex gap-1 overflow-x-auto pb-2 -mx-2 px-2">
          <router-link
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            :class="cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-all',
              isActive(item.path)
                ? 'bg-accent/8 text-accent font-medium'
                : 'text-muted-foreground hover:bg-secondary'
            )"
          >
            <component :is="item.icon" :size="14" />
            {{ item.label }}
          </router-link>
        </div>
      </div>

      <!-- Content area -->
      <div class="flex-1 min-w-0">
        <RouterView />
      </div>
    </div>
  </div>
</template>
