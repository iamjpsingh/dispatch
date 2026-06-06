<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuth } from '../../stores/auth'
import { useTheme } from '../../composables/useTheme'
import { cn } from '../../lib/utils'
import {
  LayoutDashboard, PenSquare, Send as SendIcon, FileText, Users, Zap,
  FormInput, Globe, Calendar, BarChart2, BarChart3, Settings, Building2, Activity,
  LogOut, Shield, Sun, Moon, MessageCircle,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { user, logout } = useAuth()
const { theme, toggleTheme } = useTheme()

// Same features as org users — platform admin has everything + platform powers
const mainNav = [
  { path: '/platform', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/platform/compose', label: 'Compose', icon: PenSquare },
  { path: '/platform/campaigns', label: 'Campaigns', icon: SendIcon },
  { path: '/platform/templates', label: 'Templates', icon: FileText },
  { path: '/platform/contacts', label: 'Contacts', icon: Users },
]

const toolsNav = [
  { path: '/platform/automations', label: 'Automations', icon: Zap },
  { path: '/platform/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { path: '/platform/forms', label: 'Forms', icon: FormInput },
  { path: '/platform/pages', label: 'Pages', icon: Globe },
  { path: '/platform/calendar', label: 'Calendar', icon: Calendar },
  { path: '/platform/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/platform/reports', label: 'Reports', icon: BarChart3 },
]

const settingsNav = [
  { path: '/platform/settings', label: 'Settings', icon: Settings },
]

// Platform-only extras (god mode — no org users see these)
const platformNav = [
  { path: '/platform/organizations', label: 'Organizations', icon: Building2 },
  { path: '/platform/users', label: 'Users', icon: Users },
  { path: '/platform/system-settings', label: 'System Settings', icon: Settings },
  { path: '/platform/monitoring', label: 'Monitoring', icon: Activity },
]

function isActive(path: string): boolean {
  if (path === '/platform') return route.path === '/platform'
  return route.path.startsWith(path)
}

const userInitial = computed(() => user.value?.name?.charAt(0).toUpperCase() || '?')

async function handleLogout() {
  await logout()
  router.push('/login')
}
</script>

<template>
  <div class="flex min-h-screen bg-background">
    <!-- Sidebar -->
    <aside class="w-60 bg-sidebar border-r border-border flex flex-col shrink-0">
      <!-- Header -->
      <div class="h-14 flex items-center gap-2.5 px-4 border-b border-border shrink-0">
        <div class="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
          <Shield :size="14" class="text-amber-400" />
        </div>
        <div>
          <div class="text-sm font-semibold text-foreground">Dispatch</div>
          <div class="text-[10px] text-amber-400 font-medium">Platform Admin</div>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 overflow-y-auto py-2 px-2">
        <!-- Main -->
        <div class="flex flex-col gap-0.5">
          <router-link
            v-for="item in mainNav"
            :key="item.path"
            :to="item.path"
            :class="cn(
              'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              isActive(item.path)
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
            )"
          >
            <component :is="item.icon" :size="16" :class="isActive(item.path) ? 'text-accent' : 'text-muted-foreground group-hover:text-muted-foreground'" />
            {{ item.label }}
          </router-link>
        </div>

        <!-- Tools divider -->
        <div class="my-2 mx-3 border-t border-border"></div>
        <div class="px-3 mb-1"><span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tools</span></div>
        <div class="flex flex-col gap-0.5">
          <router-link
            v-for="item in toolsNav"
            :key="item.path"
            :to="item.path"
            :class="cn(
              'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              isActive(item.path)
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
            )"
          >
            <component :is="item.icon" :size="16" :class="isActive(item.path) ? 'text-accent' : 'text-muted-foreground group-hover:text-muted-foreground'" />
            {{ item.label }}
          </router-link>
        </div>

        <!-- Settings -->
        <div class="my-2 mx-3 border-t border-border"></div>
        <div class="flex flex-col gap-0.5">
          <router-link
            v-for="item in settingsNav"
            :key="item.path"
            :to="item.path"
            :class="cn(
              'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              isActive(item.path)
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
            )"
          >
            <component :is="item.icon" :size="16" :class="isActive(item.path) ? 'text-accent' : 'text-muted-foreground group-hover:text-muted-foreground'" />
            {{ item.label }}
          </router-link>
        </div>

        <!-- Platform section (god powers) -->
        <div class="my-2 mx-3 border-t border-border"></div>
        <div class="px-3 mb-1"><span class="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Platform</span></div>
        <div class="flex flex-col gap-0.5">
          <router-link
            v-for="item in platformNav"
            :key="item.path"
            :to="item.path"
            :class="cn(
              'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              isActive(item.path)
                ? 'bg-amber-500/10 text-amber-400'
                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
            )"
          >
            <component :is="item.icon" :size="16" :class="isActive(item.path) ? 'text-amber-400' : 'text-muted-foreground group-hover:text-muted-foreground'" />
            {{ item.label }}
          </router-link>
        </div>
      </nav>

      <!-- Footer -->
      <div class="p-3 border-t border-border shrink-0">
        <div class="flex items-center gap-2.5 px-2 py-2">
          <div class="w-7 h-7 rounded-md bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center text-white text-[10px] font-bold">
            {{ userInitial }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-muted-foreground truncate">{{ user?.name || 'Admin' }}</div>
            <div class="text-[10px] text-muted-foreground truncate">{{ user?.email }}</div>
          </div>
          <button @click="toggleTheme" class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition" :title="theme === 'dark' ? 'Light mode' : 'Dark mode'">
            <Sun v-if="theme === 'dark'" :size="14" />
            <Moon v-else :size="14" />
          </button>
          <button @click="handleLogout" class="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition" title="Logout">
            <LogOut :size="14" />
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-h-screen">
      <main class="flex-1 px-8 py-6">
        <div class="max-w-[1400px] mx-auto">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
