<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { contactsApi, type TimelineEvent } from '../../lib/api'
import { Mail, AlertTriangle, Tag, UserCog, Clock, Link, FormInput, Zap, MessageSquare, Filter, ChevronDown, ChevronUp } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import Skeleton from '../ui/Skeleton.vue'

const props = defineProps<{
  contactId: string
}>()

const loading = ref(true)
const allEvents = ref<TimelineEvent[]>([])
const error = ref('')
const typeFilter = ref<string>('all')
const expandedId = ref<string | null>(null)
const displayLimit = ref(10)

const eventIcons: Record<string, any> = {
  email_sent: Mail,
  email_opened: Mail,
  link_clicked: Link,
  form_submitted: FormInput,
  tag_added: Tag,
  tag_removed: Tag,
  score_changed: Zap,
  contact_updated: UserCog,
  bounced: AlertTriangle,
  unsubscribed: AlertTriangle,
  automation_enrolled: Clock,
  automation_completed: Clock,
  whatsapp_sent: MessageSquare,
}

const eventColors: Record<string, string> = {
  email_sent: '#6366f1',
  email_opened: '#10b981',
  link_clicked: '#3b82f6',
  form_submitted: '#8b5cf6',
  tag_added: '#14b8a6',
  tag_removed: '#f97316',
  score_changed: '#f59e0b',
  contact_updated: '#6366f1',
  bounced: '#ef4444',
  unsubscribed: '#ef4444',
  automation_enrolled: '#8b5cf6',
  automation_completed: '#22c55e',
  whatsapp_sent: '#25d366',
}

const eventTypeLabels: Record<string, string> = {
  email_sent: 'Email Sent',
  email_opened: 'Email Opened',
  link_clicked: 'Link Clicked',
  form_submitted: 'Form Submitted',
  tag_added: 'Tag Added',
  tag_removed: 'Tag Removed',
  score_changed: 'Score Changed',
  contact_updated: 'Contact Updated',
  bounced: 'Bounced',
  unsubscribed: 'Unsubscribed',
  automation_enrolled: 'Automation Enrolled',
  automation_completed: 'Automation Completed',
  whatsapp_sent: 'WhatsApp Sent',
}

// Unique event types present in the data (for filter dropdown)
const availableTypes = computed(() => {
  const types = new Set(allEvents.value.map(e => e.type))
  return Array.from(types).sort()
})

const filteredEvents = computed(() => {
  const filtered = typeFilter.value === 'all'
    ? allEvents.value
    : allEvents.value.filter(e => e.type === typeFilter.value)
  return filtered.slice(0, displayLimit.value)
})

const hasMore = computed(() => {
  const total = typeFilter.value === 'all'
    ? allEvents.value.length
    : allEvents.value.filter(e => e.type === typeFilter.value).length
  return total > displayLimit.value
})

async function loadTimeline() {
  loading.value = true
  error.value = ''
  try {
    allEvents.value = await contactsApi.getTimeline(props.contactId)
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function toggleExpand(eventId: string) {
  expandedId.value = expandedId.value === eventId ? null : eventId
}

function loadMore() {
  displayLimit.value += 10
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getIcon(type: string) {
  return eventIcons[type] || Clock
}

function getColor(type: string) {
  return eventColors[type] || '#64748b'
}

watch(() => props.contactId, () => {
  displayLimit.value = 10
  loadTimeline()
})
onMounted(loadTimeline)
</script>

<template>
  <div>
    <!-- Filter bar -->
    <div v-if="!loading && allEvents.length > 0" class="flex items-center gap-2 mb-4">
      <Filter :size="14" class="text-muted-foreground" />
      <select
        v-model="typeFilter"
        class="text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground cursor-pointer"
      >
        <option value="all">All events ({{ allEvents.length }})</option>
        <option v-for="t in availableTypes" :key="t" :value="t">
          {{ eventTypeLabels[t] || t }} ({{ allEvents.filter(e => e.type === t).length }})
        </option>
      </select>
    </div>

    <div v-if="loading">
      <Skeleton variant="timeline" :count="4" />
    </div>

    <div v-else-if="error" class="text-sm text-muted-foreground text-center py-6">{{ error }}</div>

    <div v-else-if="allEvents.length === 0" class="text-sm text-muted-foreground text-center py-6">No activity yet</div>

    <div v-else class="relative pl-6">
      <!-- Timeline line -->
      <div class="absolute left-[11px] top-2 bottom-2 w-px bg-border"></div>

      <div v-for="event in filteredEvents" :key="event.id" class="relative mb-4 last:mb-0">
        <!-- Dot -->
        <div
          class="absolute -left-6 top-1 w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 border-surface-0"
          :style="{ backgroundColor: getColor(event.type) + '20' }"
        >
          <component :is="getIcon(event.type)" :size="10" :style="{ color: getColor(event.type) }" />
        </div>

        <!-- Content (clickable to expand) -->
        <div
          class="bg-secondary border border-border rounded-lg px-3 py-2.5 cursor-pointer transition-colors hover:border-border/80"
          @click="toggleExpand(event.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm text-foreground">{{ event.description }}</span>
            <div class="flex items-center gap-1.5 shrink-0">
              <span
                class="text-[10px] text-muted-foreground whitespace-nowrap"
                :title="formatFullDate(event.created_at)"
              >
                {{ formatDate(event.created_at) }}
              </span>
              <component
                :is="expandedId === event.id ? ChevronUp : ChevronDown"
                :size="12"
                class="text-muted-foreground"
              />
            </div>
          </div>

          <!-- Brief metadata (always shown) -->
          <div v-if="event.metadata && expandedId !== event.id" class="mt-1 text-[11px] text-muted-foreground">
            <template v-if="event.metadata.subject">Subject: {{ event.metadata.subject }}</template>
            <template v-else-if="event.metadata.url">URL: {{ event.metadata.url }}</template>
            <template v-else-if="event.metadata.tag">Tag: {{ event.metadata.tag }}</template>
            <template v-else-if="event.metadata.amount">Score: {{ Number(event.metadata.amount) > 0 ? '+' : '' }}{{ event.metadata.amount }}</template>
          </div>

          <!-- Expanded metadata -->
          <div v-if="expandedId === event.id && event.metadata" class="mt-2 pt-2 border-t border-border">
            <div class="space-y-1">
              <div v-for="(value, key) in event.metadata" :key="key" class="flex gap-2 text-[11px]">
                <span class="text-muted-foreground capitalize shrink-0">{{ String(key).replace(/_/g, ' ') }}:</span>
                <span class="text-foreground break-all">{{ value }}</span>
              </div>
            </div>
            <div class="mt-2 text-[10px] text-muted-foreground">
              {{ formatFullDate(event.created_at) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Load more -->
      <div v-if="hasMore" class="mt-4 text-center">
        <Button variant="ghost" size="sm" @click="loadMore">
          Load more events...
        </Button>
      </div>
    </div>
  </div>
</template>
