<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../../stores/auth'
import { useSidebar } from '../../composables/useSidebar'
import { usePermissions } from '../../composables/usePermissions'
import { cn } from '../../lib/utils'
import {
  LayoutDashboard,
  PenSquare,
  Send as SendIcon,
  FileText,
  Users,
  Zap,
  Calendar,
  BarChart3,
  BarChart2,
  Settings,
  Shield,
  LogOut,
  Menu,
  X,
  ChevronsLeft,
  FormInput,
  Globe,
  MessageCircle,
  ChevronsUpDown,
  Building2,
  Check,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { user, logout, orgs, orgId, isPlatformAdmin, switchOrg } = useAuth()
const { collapsed, mobileOpen, toggle: toggleCollapse, closeMobile, toggleMobile } = useSidebar()
const headerHovered = ref(false)
const { isAdmin, can } = usePermissions()
const orgSwitcherOpen = ref(false)

const currentOrg = computed(() => orgs.value.find(o => o.id === orgId.value))

async function handleSwitchOrg(id: string) {
  orgSwitcherOpen.value = false
  if (id === orgId.value) return
  await switchOrg(id)
  router.replace('/')
}

// Org user nav — platform admin uses PlatformLayout with its own sidebar, never sees this
const mainNav = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/compose', label: 'Compose', icon: PenSquare },
  { path: '/campaigns', label: 'Campaigns', icon: SendIcon },
  { path: '/templates', label: 'Templates', icon: FileText },
  { path: '/contacts', label: 'Contacts', icon: Users },
]

const toolsNav = [
  { path: '/automations', label: 'Automations', icon: Zap },
  { path: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { path: '/forms', label: 'Forms', icon: FormInput },
  { path: '/pages', label: 'Pages', icon: Globe },
  { path: '/calendar', label: 'Calendar', icon: Calendar },
  { path: '/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/reports', label: 'Reports', icon: BarChart3 },
]

const settingsNav = computed(() => {
  const items: Array<{ path: string; label: string; icon: any }> = []
  if (can('settings.view') || can('smtp.view')) {
    items.push({ path: '/settings', label: 'Settings', icon: Settings })
  }
  if (isAdmin.value) {
    items.push({ path: '/admin', label: 'Admin', icon: Shield })
  }
  return items
})

const userInitial = computed(() => user.value?.name?.charAt(0).toUpperCase() || '?')

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

async function handleLogout() {
  await logout()
  router.replace('/login')
}

function handleNavClick() {
  closeMobile()
  orgSwitcherOpen.value = false
}

// Close org switcher on outside click
function handleDocClick(e: MouseEvent) {
  if (orgSwitcherOpen.value) {
    const target = e.target as HTMLElement
    if (!target.closest('[data-org-switcher]')) {
      orgSwitcherOpen.value = false
    }
  }
}

onMounted(() => document.addEventListener('click', handleDocClick))
onUnmounted(() => document.removeEventListener('click', handleDocClick))
</script>

<template>
  <!-- Mobile hamburger button -->
  <button
    :class="cn(
      'fixed top-4 left-4 z-200 flex items-center justify-center',
      'w-10 h-10 rounded-lg',
      'bg-secondary border border-border text-foreground',
      'transition-colors duration-fast',
      'hover:bg-card',
      'md:hidden'
    )"
    @click="toggleMobile()"
    :aria-label="mobileOpen ? 'Close menu' : 'Open menu'"
  >
    <X v-if="mobileOpen" :size="18" />
    <Menu v-else :size="18" />
  </button>

  <!-- Mobile overlay -->
  <Transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="mobileOpen"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm z-149 md:hidden"
      @click="closeMobile()"
    />
  </Transition>

  <!-- Sidebar -->
  <aside
    :class="cn(
      'fixed left-0 top-0 z-150 flex flex-col h-screen',
      'bg-sidebar border-r border-sidebar-border',
      'transition-all duration-200 ease-out',
      collapsed ? 'w-16' : 'w-60',
      mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
    )"
    role="navigation"
    aria-label="Main navigation"
  >
    <!-- Header -->
    <div
      :class="cn(
        'flex items-center h-14 px-3 border-b border-sidebar-border shrink-0',
        collapsed ? 'justify-center' : 'justify-between'
      )"
      @mouseenter="headerHovered = true"
      @mouseleave="headerHovered = false"
    >
      <router-link
        to="/"
        :class="cn(
          'flex items-center gap-2.5 no-underline overflow-hidden',
          collapsed && 'justify-center'
        )"
        @click="handleNavClick"
      >
        <div
          :class="cn(
            'flex items-center justify-center shrink-0',
            'w-8 h-8 rounded-lg',
            'bg-accent/15'
          )"
        >
          <SendIcon class="text-accent" :size="16" />
        </div>
        <span
          v-if="!collapsed"
          class="text-lg font-bold tracking-tight text-foreground whitespace-nowrap"
        >
          Dispatch
        </span>
      </router-link>

      <Transition
        enter-active-class="transition-opacity duration-150"
        leave-active-class="transition-opacity duration-100"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <button
          v-if="!collapsed && headerHovered"
          :class="cn(
            'hidden md:flex items-center justify-center shrink-0',
            'w-6 h-6 rounded-md',
            'text-sidebar-muted hover:text-foreground',
            'hover:bg-white/[0.06]',
            'transition-all duration-fast cursor-pointer'
          )"
          @click="toggleCollapse"
          :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        >
          <ChevronsLeft :size="14" />
        </button>
      </Transition>

      <button
        v-if="collapsed"
        :class="cn(
          'hidden md:flex items-center justify-center absolute -right-3',
          'w-6 h-6 rounded-full',
          'bg-sidebar border border-sidebar-border',
          'text-sidebar-muted hover:text-foreground',
          'hover:bg-card',
          'transition-all duration-fast cursor-pointer',
          'shadow-xs'
        )"
        @click="toggleCollapse"
        title="Expand sidebar"
        aria-label="Expand sidebar"
      >
        <ChevronsLeft :size="12" class="rotate-180" />
      </button>
    </div>

    <!-- Org Switcher -->
    <div v-if="orgs.length > 0" class="px-2 pt-2 shrink-0" data-org-switcher>
      <div class="relative">
        <button
          :class="cn(
            'flex items-center w-full rounded-lg',
            'transition-all duration-fast cursor-pointer',
            collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-2',
            'hover:bg-white/[0.06]',
            orgSwitcherOpen && 'bg-white/[0.06]'
          )"
          @click="orgSwitcherOpen = !orgSwitcherOpen"
          :title="collapsed ? (currentOrg?.name || 'Select org') : undefined"
        >
          <div
            :class="cn(
              'flex items-center justify-center shrink-0',
              'w-7 h-7 rounded-md',
              'bg-accent/15 text-accent'
            )"
          >
            <Building2 :size="14" />
          </div>
          <template v-if="!collapsed">
            <span class="flex-1 text-left text-[13px] font-medium text-foreground truncate">
              {{ currentOrg?.name || 'Select org' }}
            </span>
            <ChevronsUpDown :size="14" class="shrink-0 text-sidebar-muted" />
          </template>
        </button>

        <!-- Dropdown -->
        <Transition
          enter-active-class="transition-all duration-150"
          leave-active-class="transition-all duration-100"
          enter-from-class="opacity-0 scale-95"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="orgSwitcherOpen"
            :class="cn(
              'absolute z-200 mt-1 rounded-lg overflow-hidden',
              'bg-card border border-border shadow-dropdown',
              collapsed ? 'left-full ml-2 top-0 w-52' : 'left-0 right-0'
            )"
          >
            <div class="py-1 max-h-48 overflow-y-auto">
              <button
                v-for="org in orgs"
                :key="org.id"
                :class="cn(
                  'flex items-center gap-2.5 w-full px-3 py-2',
                  'text-[13px] text-left transition-colors cursor-pointer',
                  org.id === orgId
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                )"
                @click="handleSwitchOrg(org.id)"
              >
                <Building2 :size="14" class="shrink-0" />
                <span class="flex-1 truncate">{{ org.name }}</span>
                <Check v-if="org.id === orgId" :size="14" class="shrink-0 text-accent" />
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Platform admin indicator -->
    <div v-if="isPlatformAdmin" :class="cn('px-2 pt-2 shrink-0', collapsed && 'flex justify-center')">
      <div
        :class="cn(
          'flex items-center rounded-lg',
          collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-2',
          'bg-warning/10'
        )"
        :title="collapsed ? 'Platform Admin' : undefined"
      >
        <Shield :size="14" class="shrink-0 text-warning" />
        <span v-if="!collapsed" class="text-[12px] font-semibold text-warning">Platform Admin</span>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2">
      <!-- Main section -->
      <div class="flex flex-col gap-0.5">
        <router-link
          v-for="item in mainNav"
          :key="item.path"
          :to="item.path"
          :class="cn(
            'group relative flex items-center gap-3 rounded-md text-sm font-medium',
            'transition-all duration-fast whitespace-nowrap overflow-hidden',
            collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-[7px]',
            isActive(item.path)
              ? 'bg-sidebar-accent text-accent'
              : 'text-sidebar-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
          )"
          :title="collapsed ? item.label : undefined"
          @click="handleNavClick"
        >
          <!-- Active indicator bar -->
          <div
            v-if="isActive(item.path)"
            class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-accent"
          />
          <component :is="item.icon" :size="18" class="shrink-0" />
          <span v-if="!collapsed">{{ item.label }}</span>

          <!-- Collapsed tooltip -->
          <div
            v-if="collapsed"
            :class="cn(
              'absolute left-full ml-2 px-2.5 py-1.5 rounded-md',
              'bg-muted text-foreground text-xs font-medium',
              'shadow-dropdown whitespace-nowrap',
              'opacity-0 invisible group-hover:opacity-100 group-hover:visible',
              'transition-all duration-fast pointer-events-none',
              'z-200'
            )"
          >
            {{ item.label }}
          </div>
        </router-link>
      </div>

      <!-- Tools divider -->
      <div class="my-3 mx-1">
        <div v-if="!collapsed" class="flex items-center gap-2 mb-1">
          <span class="text-[11px] font-semibold uppercase tracking-[0.06em] text-sidebar-muted px-1.5">
            Tools
          </span>
          <div class="flex-1 h-px bg-sidebar-border" />
        </div>
        <div v-else class="h-px bg-sidebar-border" />
      </div>

      <!-- Tools section -->
      <div class="flex flex-col gap-0.5">
        <router-link
          v-for="item in toolsNav"
          :key="item.path"
          :to="item.path"
          :class="cn(
            'group relative flex items-center gap-3 rounded-md text-sm font-medium',
            'transition-all duration-fast whitespace-nowrap overflow-hidden',
            collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-[7px]',
            isActive(item.path)
              ? 'bg-sidebar-accent text-accent'
              : 'text-sidebar-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
          )"
          :title="collapsed ? item.label : undefined"
          @click="handleNavClick"
        >
          <div
            v-if="isActive(item.path)"
            class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-accent"
          />
          <component :is="item.icon" :size="18" class="shrink-0" />
          <span v-if="!collapsed">{{ item.label }}</span>

          <div
            v-if="collapsed"
            :class="cn(
              'absolute left-full ml-2 px-2.5 py-1.5 rounded-md',
              'bg-muted text-foreground text-xs font-medium',
              'shadow-dropdown whitespace-nowrap',
              'opacity-0 invisible group-hover:opacity-100 group-hover:visible',
              'transition-all duration-fast pointer-events-none',
              'z-200'
            )"
          >
            {{ item.label }}
          </div>
        </router-link>
      </div>

      <!-- Settings divider -->
      <div class="my-3 mx-1 h-px bg-sidebar-border" />

      <!-- Settings section -->
      <div class="flex flex-col gap-0.5">
        <router-link
          v-for="item in settingsNav"
          :key="item.path"
          :to="item.path"
          :class="cn(
            'group relative flex items-center gap-3 rounded-md text-sm font-medium',
            'transition-all duration-fast whitespace-nowrap overflow-hidden',
            collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-[7px]',
            isActive(item.path)
              ? 'bg-sidebar-accent text-accent'
              : 'text-sidebar-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
          )"
          :title="collapsed ? item.label : undefined"
          @click="handleNavClick"
        >
          <div
            v-if="isActive(item.path)"
            class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-accent"
          />
          <component :is="item.icon" :size="18" class="shrink-0" />
          <span v-if="!collapsed">{{ item.label }}</span>

          <div
            v-if="collapsed"
            :class="cn(
              'absolute left-full ml-2 px-2.5 py-1.5 rounded-md',
              'bg-muted text-foreground text-xs font-medium',
              'shadow-dropdown whitespace-nowrap',
              'opacity-0 invisible group-hover:opacity-100 group-hover:visible',
              'transition-all duration-fast pointer-events-none',
              'z-200'
            )"
          >
            {{ item.label }}
          </div>
        </router-link>
      </div>
    </nav>

    <!-- Footer -->
    <div
      :class="cn(
        'shrink-0 border-t border-sidebar-border',
        collapsed ? 'p-2' : 'p-3'
      )"
    >
      <div v-if="user" :class="cn('flex items-center', collapsed ? 'justify-center' : 'gap-2.5')">
        <!-- User avatar + info -->
        <div
          :class="cn(
            'group relative flex items-center flex-1 min-w-0',
            collapsed ? 'justify-center' : 'gap-2.5'
          )"
        >
          <div
            :class="cn(
              'flex items-center justify-center shrink-0',
              'w-8 h-8 rounded-lg',
              'bg-linear-to-br from-accent to-accent-secondary',
              'text-white text-xs font-bold'
            )"
            :title="collapsed ? (user.name || 'User') : undefined"
          >
            {{ userInitial }}
          </div>

          <div v-if="!collapsed" class="flex-1 min-w-0">
            <div class="text-[13px] font-semibold text-foreground truncate leading-tight">
              {{ user.name || 'User' }}
            </div>
            <div class="text-[11px] text-sidebar-muted truncate leading-tight mt-0.5">
              {{ user.email || '' }}
            </div>
          </div>

          <!-- Collapsed tooltip for user -->
          <div
            v-if="collapsed"
            :class="cn(
              'absolute left-full ml-2 px-2.5 py-1.5 rounded-md',
              'bg-muted text-foreground text-xs font-medium',
              'shadow-dropdown whitespace-nowrap',
              'opacity-0 invisible group-hover:opacity-100 group-hover:visible',
              'transition-all duration-fast pointer-events-none',
              'z-200'
            )"
          >
            <div class="font-semibold">{{ user.name || 'User' }}</div>
            <div class="text-sidebar-muted-foreground text-[10px] mt-0.5">{{ user.email || '' }}</div>
          </div>
        </div>

        <!-- Logout button -->
        <button
          :class="cn(
            'group/logout relative flex items-center justify-center shrink-0',
            'w-8 h-8 rounded-md',
            'text-sidebar-muted hover:text-danger',
            'hover:bg-danger/10',
            'transition-all duration-fast cursor-pointer',
            collapsed && 'mt-2'
          )"
          @click="handleLogout"
          :title="collapsed ? 'Logout' : 'Logout'"
          aria-label="Logout"
        >
          <LogOut :size="15" />

          <div
            v-if="collapsed"
            :class="cn(
              'absolute left-full ml-2 px-2.5 py-1.5 rounded-md',
              'bg-muted text-foreground text-xs font-medium',
              'shadow-dropdown whitespace-nowrap',
              'opacity-0 invisible group-hover/logout:opacity-100 group-hover/logout:visible',
              'transition-all duration-fast pointer-events-none',
              'z-200'
            )"
          >
            Logout
          </div>
        </button>
      </div>

      <!-- Collapsed: stack avatar and logout vertically -->
      <div v-if="user && collapsed" class="hidden" />
    </div>
  </aside>
</template>
