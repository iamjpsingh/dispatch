<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { Mail, MousePointer, Eye, AlertTriangle, Clock, Tag, Zap, Link, Loader2, BarChart3 } from 'lucide-vue-next'

const props = defineProps<{
  contactId: string
}>()

const loading = ref(true)
const profile = ref<any>(null)
const error = ref('')

async function loadProfile() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/analytics/contacts/${props.contactId}/profile`, { credentials: 'include' })
    const data = await res.json()
    if (data.success) profile.value = data.data
    else error.value = data.message || 'Failed to load'
  } catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}

const openHours = computed(() => {
  if (!profile.value?.open_hour_distribution) return []
  const dist = profile.value.open_hour_distribution as Record<string, number>
  const max = Math.max(...Object.values(dist), 1)
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: dist[String(h)] || 0,
    height: Math.max(((dist[String(h)] || 0) / max) * 100, 2),
  }))
})

function formatHour(h: number): string {
  if (h === 0) return '12a'
  if (h < 12) return `${h}a`
  if (h === 12) return '12p'
  return `${h - 12}p`
}

function formatDate(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const eventIcons: Record<string, any> = {
  email_sent: Mail, email_opened: Eye, link_clicked: Link,
  tag_added: Tag, score_changed: Zap, bounced: AlertTriangle,
}

watch(() => props.contactId, loadProfile)
onMounted(loadProfile)
</script>

<template>
  <div>
    <div v-if="loading" class="flex justify-center py-12"><Loader2 :size="20" class="animate-spin text-muted-foreground" /></div>
    <div v-else-if="error" class="text-sm text-red-400 text-center py-8">{{ error }}</div>

    <div v-else-if="profile" class="space-y-5">
      <!-- Contact Card -->
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent font-bold text-lg">
          {{ (profile.contact.first_name || profile.contact.email)?.[0]?.toUpperCase() || '?' }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-base font-semibold text-foreground">
            {{ profile.contact.first_name }} {{ profile.contact.last_name }}
          </div>
          <div class="text-sm text-muted-foreground">{{ profile.contact.email }}</div>
          <div v-if="profile.contact.company" class="text-xs text-muted-foreground mt-0.5">{{ profile.contact.company }}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-2xl font-bold" :class="profile.contact.engagement_score >= 50 ? 'text-green-400' : profile.contact.engagement_score >= 20 ? 'text-amber-400' : 'text-red-400'">
            {{ profile.contact.engagement_score || 0 }}
          </div>
          <div class="text-[10px] text-muted-foreground">Engagement</div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="bg-background rounded-lg p-3 text-center">
          <Mail :size="14" class="mx-auto text-muted-foreground mb-1" />
          <div class="text-lg font-bold text-foreground">{{ profile.stats.emails_sent }}</div>
          <div class="text-[10px] text-muted-foreground">Emails Sent</div>
        </div>
        <div class="bg-background rounded-lg p-3 text-center">
          <Eye :size="14" class="mx-auto text-green-400 mb-1" />
          <div class="text-lg font-bold text-foreground">{{ profile.stats.open_rate }}%</div>
          <div class="text-[10px] text-muted-foreground">Open Rate</div>
        </div>
        <div class="bg-background rounded-lg p-3 text-center">
          <MousePointer :size="14" class="mx-auto text-blue-400 mb-1" />
          <div class="text-lg font-bold text-foreground">{{ profile.stats.click_rate }}%</div>
          <div class="text-[10px] text-muted-foreground">Click Rate</div>
        </div>
        <div class="bg-background rounded-lg p-3 text-center">
          <BarChart3 :size="14" class="mx-auto text-violet-400 mb-1" />
          <div class="text-lg font-bold text-foreground">{{ profile.stats.campaigns_engaged }}</div>
          <div class="text-[10px] text-muted-foreground">Campaigns</div>
        </div>
      </div>

      <!-- Open Time Distribution -->
      <div v-if="openHours.length > 0">
        <div class="text-xs font-semibold text-muted-foreground mb-2">Best Open Times</div>
        <div class="flex items-end gap-px h-16 bg-background rounded-lg p-2">
          <div
            v-for="h in openHours" :key="h.hour"
            class="flex-1 rounded-t transition-all"
            :style="{ height: h.height + '%', backgroundColor: h.hour === profile.stats.best_open_hour ? '#6366f1' : h.count > 0 ? '#6366f140' : '#1e243320' }"
            :title="`${formatHour(h.hour)}: ${h.count} opens`"
          />
        </div>
        <div class="flex justify-between text-[9px] text-muted-foreground mt-1 px-2">
          <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>
        </div>
      </div>

      <!-- Top Links -->
      <div v-if="profile.top_links?.length > 0">
        <div class="text-xs font-semibold text-muted-foreground mb-2">Top Clicked Links</div>
        <div class="space-y-1.5">
          <div v-for="link in profile.top_links.slice(0, 5)" :key="link.url" class="flex items-center gap-2 text-xs">
            <Link :size="11" class="text-muted-foreground shrink-0" />
            <a :href="link.url" target="_blank" class="text-muted-foreground hover:text-accent truncate flex-1">{{ link.url }}</a>
            <span class="text-muted-foreground shrink-0">{{ link.clicks }}x</span>
          </div>
        </div>
      </div>

      <!-- Recent Events -->
      <div v-if="profile.recent_events?.length > 0">
        <div class="text-xs font-semibold text-muted-foreground mb-2">Recent Activity</div>
        <div class="space-y-1">
          <div v-for="(event, i) in profile.recent_events.slice(0, 8)" :key="i" class="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0">
            <component :is="eventIcons[event.type] || Clock" :size="11" class="text-muted-foreground shrink-0" />
            <span class="text-muted-foreground flex-1 truncate">{{ event.type.replace(/_/g, ' ') }}</span>
            <span class="text-[10px] text-muted-foreground shrink-0">{{ formatDate(event.created_at) }}</span>
          </div>
        </div>
      </div>

      <!-- Tags -->
      <div v-if="profile.contact.tags">
        <div class="text-xs font-semibold text-muted-foreground mb-2">Tags</div>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="tag in (typeof profile.contact.tags === 'string' ? JSON.parse(profile.contact.tags || '[]') : profile.contact.tags)"
            :key="tag"
            class="px-2 py-0.5 bg-background border border-border rounded text-[11px] text-muted-foreground"
          >{{ tag }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
