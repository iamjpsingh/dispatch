<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '../../composables/useTheme'
import {
  Search,
  LayoutDashboard,
  PenSquare,
  Send,
  FileText,
  Users,
  Zap,
  Calendar,
  BarChart2,
  BarChart3,
  Settings,
  Shield,
  FormInput,
  Globe,
  MessageCircle,
  ArrowRight,
  Hash,
  Clock,
  Plus,
  Upload,
  Palette,
} from 'lucide-vue-next'

interface CommandItem {
  label: string
  path: string
  icon: any
  section: string
  action?: () => void
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const router = useRouter()
const { toggleTheme } = useTheme()
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const RECENT_KEY = 'dispatch-recent-commands'
const MAX_RECENT = 5

function getRecent(): CommandItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const paths: string[] = JSON.parse(raw)
    return paths
      .map(p => navItems.find(item => item.path === p))
      .filter(Boolean) as CommandItem[]
  } catch { return [] }
}

function addRecent(path: string) {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    let paths: string[] = raw ? JSON.parse(raw) : []
    paths = paths.filter(p => p !== path)
    paths.unshift(path)
    paths = paths.slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(paths))
  } catch { /* ignore */ }
}

const navItems: CommandItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, section: 'Navigation' },
  { label: 'Compose Email', path: '/compose', icon: PenSquare, section: 'Navigation' },
  { label: 'Campaigns', path: '/campaigns', icon: Send, section: 'Navigation' },
  { label: 'Templates', path: '/templates', icon: FileText, section: 'Navigation' },
  { label: 'Contacts', path: '/contacts', icon: Users, section: 'Navigation' },
  { label: 'Automations', path: '/automations', icon: Zap, section: 'Navigation' },
  { label: 'WhatsApp', path: '/whatsapp', icon: MessageCircle, section: 'Navigation' },
  { label: 'Forms', path: '/forms', icon: FormInput, section: 'Navigation' },
  { label: 'Pages', path: '/pages', icon: Globe, section: 'Navigation' },
  { label: 'Calendar', path: '/calendar', icon: Calendar, section: 'Navigation' },
  { label: 'Analytics', path: '/analytics', icon: BarChart2, section: 'Navigation' },
  { label: 'Reports', path: '/reports', icon: BarChart3, section: 'Navigation' },
  { label: 'Email Settings', path: '/settings/email', icon: Settings, section: 'Settings' },
  { label: 'SMTP Configuration', path: '/settings/smtp', icon: Settings, section: 'Settings' },
  { label: 'API Keys', path: '/settings/api-keys', icon: Hash, section: 'Settings' },
  { label: 'Webhooks', path: '/settings/webhooks', icon: Zap, section: 'Settings' },
  { label: 'Organization', path: '/admin/organization', icon: Shield, section: 'Admin' },
  { label: 'Members', path: '/admin/members', icon: Users, section: 'Admin' },
  { label: 'Teams', path: '/admin/teams', icon: Users, section: 'Admin' },
  { label: 'Roles & Permissions', path: '/admin/roles', icon: Shield, section: 'Admin' },
  { label: 'Audit Logs', path: '/admin/audit', icon: BarChart3, section: 'Admin' },
]

const actionItems: CommandItem[] = [
  { label: 'New Campaign', path: '/compose', icon: Plus, section: 'Actions', action: () => router.push('/compose') },
  { label: 'New Template', path: '/templates', icon: Plus, section: 'Actions', action: () => router.push('/templates') },
  { label: 'Import Contacts', path: '/contacts', icon: Upload, section: 'Actions', action: () => router.push('/contacts') },
  { label: 'Toggle Theme', path: '', icon: Palette, section: 'Actions', action: () => toggleTheme() },
]

const allItems = [...navItems, ...actionItems]

function fuzzyMatch(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase()
  return terms.every(term => lower.includes(term))
}

const filtered = computed(() => {
  const q = query.value.trim()
  if (!q) {
    // Show recent items + all nav items
    const recent = getRecent()
    const recentWithSection = recent.map(r => ({ ...r, section: 'Recent' }))
    return [...recentWithSection, ...navItems, ...actionItems]
  }
  const terms = q.toLowerCase().split(/\s+/)
  return allItems.filter(item =>
    fuzzyMatch(item.label, terms) ||
    fuzzyMatch(item.section, terms) ||
    fuzzyMatch(item.path, terms)
  )
})

const groupedResults = computed(() => {
  const groups: Record<string, CommandItem[]> = {}
  // Maintain section order: Recent, Actions, Navigation, Settings, Admin
  const sectionOrder = ['Recent', 'Actions', 'Navigation', 'Settings', 'Admin']
  for (const item of filtered.value) {
    if (!groups[item.section]) groups[item.section] = []
    groups[item.section]!.push(item)
  }
  const ordered: Record<string, CommandItem[]> = {}
  for (const section of sectionOrder) {
    if (groups[section]) ordered[section] = groups[section]
  }
  // Any remaining sections
  for (const key of Object.keys(groups)) {
    if (!ordered[key]) ordered[key] = groups[key]
  }
  return ordered
})

const flatResults = computed(() => filtered.value)

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    selectedIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  }
})

watch(query, () => {
  selectedIndex.value = 0
})

function close() {
  emit('update:open', false)
}

function executeItem(item: CommandItem) {
  if (item.action) {
    item.action()
  } else {
    addRecent(item.path)
    router.push(item.path)
  }
  close()
}

function handleKeydown(e: KeyboardEvent) {
  const items = flatResults.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % items.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + items.length) % items.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = items[selectedIndex.value]
    if (item) executeItem(item)
  } else if (e.key === 'Escape') {
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-100"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
        @click.self="close"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="close" />

        <!-- Palette -->
        <div
          class="relative w-full max-w-[560px] mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
          @keydown="handleKeydown"
        >
          <!-- Search input -->
          <div class="flex items-center gap-3 px-4 border-b border-border">
            <Search :size="18" class="text-muted-foreground shrink-0" />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              class="flex-1 h-12 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground outline-none border-none"
              placeholder="Type a command or search..."
            />
            <kbd class="hidden sm:flex items-center h-5 px-1.5 rounded bg-muted border border-border text-[10px] font-mono text-muted-foreground">
              ESC
            </kbd>
          </div>

          <!-- Results -->
          <div class="max-h-[360px] overflow-y-auto py-2">
            <template v-if="flatResults.length === 0">
              <div class="px-4 py-8 text-center text-sm text-muted-foreground">
                No results for "{{ query }}"
              </div>
            </template>

            <template v-for="(items, section) in groupedResults" :key="section">
              <div class="px-3 pt-2 pb-1">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                  {{ section }}
                </span>
              </div>
              <div
                v-for="item in items"
                :key="`${section}-${item.path}-${item.label}`"
                :class="[
                  'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
                  flatResults.indexOf(item) === selectedIndex
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted-foreground hover:bg-secondary'
                ]"
                @click="executeItem(item)"
                @mouseenter="selectedIndex = flatResults.indexOf(item)"
              >
                <component
                  :is="item.icon"
                  :size="16"
                  :class="flatResults.indexOf(item) === selectedIndex ? 'text-accent' : 'text-muted-foreground'"
                />
                <span class="flex-1 text-sm font-medium">{{ item.label }}</span>
                <ArrowRight
                  v-if="flatResults.indexOf(item) === selectedIndex"
                  :size="14"
                  class="text-accent/60"
                />
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="flex items-center gap-4 px-4 py-2.5 border-t border-border bg-muted/50">
            <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <kbd class="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">&uarr;&darr;</kbd>
              Navigate
            </div>
            <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <kbd class="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">&crarr;</kbd>
              Open
            </div>
            <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <kbd class="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">esc</kbd>
              Close
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
