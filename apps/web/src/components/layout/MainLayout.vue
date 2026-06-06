<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuth } from '../../stores/auth'
import { useSidebar } from '../../composables/useSidebar'
import { useTheme } from '../../composables/useTheme'
import { useKeyboardShortcuts } from '../../composables/useKeyboardShortcuts'
import { cn } from '../../lib/utils'
import AppSidebar from './AppSidebar.vue'
import BottomNav from './BottomNav.vue'
import NotificationBell from './NotificationBell.vue'
import CommandPalette from '../command/CommandPalette.vue'
import KeyboardShortcutsModal from '../ui/KeyboardShortcutsModal.vue'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  Search,
  Sun,
  Moon,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { user } = useAuth()
const { collapsed } = useSidebar()
const { theme, toggleTheme } = useTheme()

const showCommandPalette = ref(false)
const showShortcutsModal = ref(false)
provide('commandPalette', { open: () => { showCommandPalette.value = true } })

// Ctrl+S save injection point — views can set their save function
const ctrlSaveHandler = ref<(() => void) | null>(null)
provide('ctrlSave', ctrlSaveHandler)

const userInitial = computed(() => user.value?.name?.charAt(0).toUpperCase() || '?')

// Build breadcrumbs from route.matched meta
const breadcrumbs = computed(() => {
  const crumbs: Array<{ label: string; path?: string }> = []

  // Check for explicit parent breadcrumb
  const parentMeta = route.meta?.parent as { name: string; path: string } | undefined
  if (parentMeta) {
    crumbs.push({ label: parentMeta.name, path: parentMeta.path })
  }

  // Add breadcrumbs from matched routes (skip root layout)
  const matched = route.matched.filter(r => r.meta?.breadcrumb && r.components?.default)
  matched.forEach((r, idx) => {
    const isLast = idx === matched.length - 1
    const label = r.meta.breadcrumb as string

    // Don't duplicate parent
    if (parentMeta && label === parentMeta.name) return

    crumbs.push({
      label,
      path: isLast ? undefined : r.path || undefined,
    })
  })

  return crumbs
})

// Register keyboard shortcuts
const { register } = useKeyboardShortcuts()

// Global shortcuts
register('mod+k', () => { showCommandPalette.value = !showCommandPalette.value }, { scope: 'General', description: 'Command palette' })
register('mod+s', () => { ctrlSaveHandler.value?.() }, { scope: 'General', description: 'Save' })
register('?', () => { showShortcutsModal.value = true }, { scope: 'General', description: 'Show shortcuts' })
register('/', () => { showCommandPalette.value = true }, { scope: 'General', description: 'Focus search' })

// Navigation shortcuts (g then *)
register('g d', () => router.push('/'), { scope: 'Navigation', description: 'Go to Dashboard' })
register('g c', () => router.push('/contacts'), { scope: 'Navigation', description: 'Go to Contacts' })
register('g m', () => router.push('/campaigns'), { scope: 'Navigation', description: 'Go to Campaigns' })
register('g t', () => router.push('/templates'), { scope: 'Navigation', description: 'Go to Templates' })
register('g a', () => router.push('/automations'), { scope: 'Navigation', description: 'Go to Automations' })
register('g r', () => router.push('/reports'), { scope: 'Navigation', description: 'Go to Reports' })
register('g s', () => router.push('/settings'), { scope: 'Navigation', description: 'Go to Settings' })
register('g e', () => router.push('/compose'), { scope: 'Navigation', description: 'Go to Compose' })

// Context-aware "new" shortcut
register('n', () => {
  const path = route.path
  if (path.startsWith('/campaigns')) router.push('/compose')
  else if (path.startsWith('/contacts')) router.push('/contacts')
  else if (path.startsWith('/templates')) router.push('/templates')
  else if (path.startsWith('/automations')) router.push('/automations')
  else router.push('/compose')
}, { scope: 'Actions', description: 'New item (context-aware)' })
</script>

<template>
  <div class="flex min-h-screen bg-background">
    <!-- Skip link for accessibility -->
    <a
      href="#main-content"
      :class="cn(
        'absolute -top-full left-4 z-99999',
        'px-4 py-2 rounded-b-md',
        'bg-accent text-white text-[13px] font-semibold no-underline',
        'transition-[top] duration-200',
        'focus:top-0'
      )"
    >
      Skip to content
    </a>

    <!-- Sidebar -->
    <AppSidebar />

    <!-- Main content wrapper -->
    <div
      :class="cn(
        'flex flex-col flex-1 min-h-screen',
        'transition-[margin-left] duration-200 ease-out',
        'ml-0 md:ml-60',
        collapsed && 'md:ml-16'
      )"
    >
      <!-- Top bar -->
      <header
        :class="cn(
          'sticky top-0 z-30 shrink-0',
          'flex items-center justify-between',
          'h-14 px-6',
          'bg-background border-b border-border'
        )"
      >
        <!-- Left: Breadcrumbs -->
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink as-child>
                <router-link to="/" class="text-muted-foreground hover:text-foreground">Dispatch</router-link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <template v-for="(crumb, index) in breadcrumbs" :key="index">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink v-if="crumb.path" as-child>
                  <router-link :to="crumb.path">{{ crumb.label }}</router-link>
                </BreadcrumbLink>
                <BreadcrumbPage v-else>{{ crumb.label }}</BreadcrumbPage>
              </BreadcrumbItem>
            </template>
          </BreadcrumbList>
        </Breadcrumb>

        <!-- Right: Search + User -->
        <div class="flex items-center gap-3">
          <!-- Search trigger (Cmd+K) -->
          <button
            :class="cn(
              'hidden sm:flex items-center gap-2',
              'h-8 pl-3 pr-2 rounded-lg',
              'bg-secondary border border-border',
              'text-muted-foreground text-[13px]',
              'hover:border-primary/25 hover:text-muted-foreground',
              'transition-all duration-fast cursor-pointer'
            )"
            @click="showCommandPalette = true"
          >
            <Search :size="14" class="shrink-0" />
            <span class="hidden lg:inline">Search...</span>
            <kbd
              :class="cn(
                'hidden lg:flex items-center gap-0.5',
                'h-5 px-1.5 rounded',
                'bg-background/60 border border-border',
                'text-[10px] font-mono font-medium text-muted-foreground'
              )"
            >
              <span class="text-[11px]">&#8984;</span>K
            </kbd>
          </button>

          <!-- Mobile search icon -->
          <button
            :class="cn(
              'sm:hidden flex items-center justify-center',
              'w-8 h-8 rounded-lg',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-secondary',
              'transition-colors duration-fast cursor-pointer'
            )"
            @click="showCommandPalette = true"
          >
            <Search :size="16" />
          </button>

          <!-- Notifications -->
          <NotificationBell />

          <!-- Theme toggle -->
          <button
            @click="toggleTheme"
            :class="cn(
              'flex items-center justify-center',
              'w-8 h-8 rounded-lg',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-muted',
              'transition-colors cursor-pointer'
            )"
            :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <Sun v-if="theme === 'dark'" :size="16" />
            <Moon v-else :size="16" />
          </button>

          <!-- Separator -->
          <div class="hidden sm:block w-px h-5 bg-border" />

          <!-- User dropdown trigger -->
          <button
            v-if="user"
            :class="cn(
              'flex items-center gap-2 rounded-lg',
              'h-8 px-1.5',
              'hover:bg-secondary',
              'transition-colors duration-fast cursor-pointer'
            )"
          >
            <div
              :class="cn(
                'flex items-center justify-center shrink-0',
                'w-6 h-6 rounded-md',
                'bg-linear-to-br from-accent to-accent-secondary',
                'text-white text-[10px] font-bold'
              )"
            >
              {{ userInitial }}
            </div>
            <span class="hidden md:block text-[13px] font-medium text-muted-foreground max-w-[120px] truncate">
              {{ user.name || 'User' }}
            </span>
          </button>
        </div>
      </header>

      <!-- Page content — RouterView replaces <slot> -->
      <main
        id="main-content"
        class="flex-1 px-6 py-6 pb-20 md:pb-6"
      >
        <div class="max-w-[1400px] mx-auto">
          <RouterView />
        </div>
      </main>
    </div>

    <!-- Bottom nav for mobile -->
    <BottomNav />

    <!-- Command Palette -->
    <CommandPalette v-model:open="showCommandPalette" />

    <!-- Keyboard Shortcuts Help -->
    <KeyboardShortcutsModal v-model:show="showShortcutsModal" />
  </div>
</template>
