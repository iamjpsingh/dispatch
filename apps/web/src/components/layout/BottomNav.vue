<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutDashboard, PenSquare, Users, Menu } from 'lucide-vue-next'
import { useSidebar } from '../../composables/useSidebar'

const route = useRoute()
const router = useRouter()
const { openMobile } = useSidebar()

const navItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Compose', path: '/compose', icon: PenSquare },
  { label: 'Contacts', path: '/contacts', icon: Users },
]

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

function navigate(path: string) {
  router.push(path)
}
</script>

<template>
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border safe-area-bottom">
    <div class="flex items-center justify-around h-14">
      <button
        v-for="item in navItems"
        :key="item.path"
        class="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors cursor-pointer"
        :class="isActive(item.path) ? 'text-accent' : 'text-muted-foreground'"
        @click="navigate(item.path)"
      >
        <component :is="item.icon" :size="20" />
        <span class="text-[10px] font-medium">{{ item.label }}</span>
      </button>

      <!-- More button opens sidebar -->
      <button
        class="flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-muted-foreground transition-colors cursor-pointer"
        @click="openMobile"
      >
        <Menu :size="20" />
        <span class="text-[10px] font-medium">More</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
