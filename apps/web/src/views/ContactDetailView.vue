<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/ui/PageHeader.vue'
import ContactTimeline from '../components/contacts/ContactTimeline.vue'
import ContactPreferences from '../components/contacts/ContactPreferences.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { Button } from '@/components/ui/button'
import {
  Mail, Eye, MousePointer, BarChart3, Link, Clock, Tag, Zap,
  AlertTriangle, ArrowLeft,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const contactId = computed(() => route.params.id as string)

const loading = ref(true)
const profile = ref<any>(null)
const error = ref('')
const activeTab = ref<'overview' | 'activity' | 'preferences'>('overview')

async function loadProfile() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/analytics/contacts/${contactId.value}/profile`, { credentials: 'include' })
    const data = await res.json()
    if (data.success) profile.value = data.data
    else error.value = data.message || 'Failed to load contact'
  } catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}

const contactName = computed(() => {
  if (!profile.value?.contact) return ''
  const c = profile.value.contact
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email
})

const scoreColor = computed(() => {
  const score = profile.value?.contact?.engagement_score || 0
  if (score >= 50) return 'text-green-500'
  if (score >= 20) return 'text-amber-500'
  return 'text-red-500'
})

const scoreBg = computed(() => {
  const score = profile.value?.contact?.engagement_score || 0
  if (score >= 50) return 'bg-green-500/10'
  if (score >= 20) return 'bg-amber-500/10'
  return 'bg-red-500/10'
})

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

function parseTags(tagsJson: string | string[]): string[] {
  if (Array.isArray(tagsJson)) return tagsJson
  try { return JSON.parse(tagsJson || '[]') } catch { return [] }
}

onMounted(loadProfile)
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="space-y-6">
      <Skeleton variant="text" height="32px" />
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Skeleton variant="card" :count="4" />
      </div>
      <Skeleton variant="card" :count="2" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-center py-20">
      <AlertTriangle :size="40" class="text-muted-foreground mx-auto mb-3" />
      <p class="text-sm text-muted-foreground">{{ error }}</p>
      <Button variant="secondary" size="sm" class="mt-4" @click="router.push('/contacts')">
        <ArrowLeft :size="14" /> Back to Contacts
      </Button>
    </div>

    <!-- Content -->
    <div v-else-if="profile">
      <!-- Header -->
      <PageHeader :title="contactName" backTo="/contacts">
        <template #prefix>
          <div class="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent font-bold text-lg shrink-0">
            {{ (profile.contact.first_name || profile.contact.email)?.[0]?.toUpperCase() || '?' }}
          </div>
        </template>
        <template #meta>
          <div class="flex items-center gap-3 flex-wrap">
            <span class="text-sm text-muted-foreground">{{ profile.contact.email }}</span>
            <span v-if="profile.contact.company" class="text-sm text-muted-foreground">{{ profile.contact.company }}</span>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              :class="{
                'bg-green-500/15 text-green-500': profile.contact.status === 'active',
                'bg-amber-500/15 text-amber-500': profile.contact.status === 'unsubscribed',
                'bg-red-500/15 text-red-500': profile.contact.status === 'bounced' || profile.contact.status === 'complained',
              }"
            >{{ profile.contact.status }}</span>
          </div>
        </template>
        <template #actions>
          <div :class="['flex items-center gap-2 px-3 py-1.5 rounded-lg', scoreBg]">
            <span :class="['text-xl font-bold', scoreColor]">{{ profile.contact.engagement_score || 0 }}</span>
            <span class="text-[10px] text-muted-foreground leading-tight">Engagement<br/>Score</span>
          </div>
        </template>
      </PageHeader>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
        <div class="bg-card border border-border rounded-xl p-4 text-center">
          <Mail :size="16" class="mx-auto text-muted-foreground mb-2" />
          <div class="text-2xl font-bold text-foreground">{{ profile.stats.emails_sent }}</div>
          <div class="text-xs text-muted-foreground mt-1">Emails Sent</div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 text-center">
          <Eye :size="16" class="mx-auto text-green-500 mb-2" />
          <div class="text-2xl font-bold text-foreground">{{ profile.stats.open_rate }}%</div>
          <div class="text-xs text-muted-foreground mt-1">Open Rate</div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 text-center">
          <MousePointer :size="16" class="mx-auto text-blue-500 mb-2" />
          <div class="text-2xl font-bold text-foreground">{{ profile.stats.click_rate }}%</div>
          <div class="text-xs text-muted-foreground mt-1">Click Rate</div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 text-center">
          <BarChart3 :size="16" class="mx-auto text-violet-500 mb-2" />
          <div class="text-2xl font-bold text-foreground">{{ profile.stats.campaigns_engaged }}</div>
          <div class="text-xs text-muted-foreground mt-1">Campaigns</div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="mt-6 border-b border-border">
        <div class="flex gap-1">
          <button
            v-for="tab in [
              { key: 'overview', label: 'Overview' },
              { key: 'activity', label: 'Activity' },
              { key: 'preferences', label: 'Preferences' },
            ]"
            :key="tab.key"
            class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer"
            :class="activeTab === tab.key
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'"
            @click="activeTab = tab.key as any"
          >{{ tab.label }}</button>
        </div>
      </div>

      <!-- Tab Content -->
      <div class="mt-6">
        <!-- Overview Tab -->
        <div v-if="activeTab === 'overview'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left: Details + Tags -->
          <div class="lg:col-span-2 space-y-6">
            <!-- Contact Details Card -->
            <div class="bg-card border border-border rounded-xl p-5">
              <h3 class="text-sm font-semibold text-foreground mb-4">Contact Details</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div class="text-xs text-muted-foreground mb-1">Email</div>
                  <div class="text-sm text-foreground font-mono">{{ profile.contact.email }}</div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground mb-1">Name</div>
                  <div class="text-sm text-foreground">{{ contactName }}</div>
                </div>
                <div v-if="profile.contact.company">
                  <div class="text-xs text-muted-foreground mb-1">Company</div>
                  <div class="text-sm text-foreground">{{ profile.contact.company }}</div>
                </div>
                <div v-if="profile.contact.phone">
                  <div class="text-xs text-muted-foreground mb-1">Phone</div>
                  <div class="text-sm text-foreground">{{ profile.contact.phone }}</div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground mb-1">Status</div>
                  <span
                    class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase"
                    :class="{
                      'bg-green-500/15 text-green-500': profile.contact.status === 'active',
                      'bg-amber-500/15 text-amber-500': profile.contact.status === 'unsubscribed',
                      'bg-red-500/15 text-red-500': profile.contact.status === 'bounced' || profile.contact.status === 'complained',
                    }"
                  >{{ profile.contact.status }}</span>
                </div>
                <div v-if="profile.contact.source">
                  <div class="text-xs text-muted-foreground mb-1">Source</div>
                  <div class="text-sm text-foreground">{{ profile.contact.source }}</div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground mb-1">Added</div>
                  <div class="text-sm text-foreground">{{ new Date(profile.contact.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground mb-1">Last Updated</div>
                  <div class="text-sm text-foreground">{{ formatDate(profile.contact.updated_at) }}</div>
                </div>
              </div>
            </div>

            <!-- Tags -->
            <div v-if="profile.contact.tags" class="bg-card border border-border rounded-xl p-5">
              <h3 class="text-sm font-semibold text-foreground mb-3">Tags</h3>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="tag in parseTags(profile.contact.tags)"
                  :key="tag"
                  class="px-2.5 py-1 bg-secondary border border-border rounded-lg text-xs text-foreground"
                >{{ tag }}</span>
                <span v-if="!parseTags(profile.contact.tags).length" class="text-sm text-muted-foreground">No tags</span>
              </div>
            </div>

            <!-- Top Links -->
            <div v-if="profile.top_links?.length > 0" class="bg-card border border-border rounded-xl p-5">
              <h3 class="text-sm font-semibold text-foreground mb-3">Top Clicked Links</h3>
              <div class="space-y-2">
                <div v-for="link in profile.top_links.slice(0, 8)" :key="link.url" class="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <Link :size="14" class="text-muted-foreground shrink-0" />
                  <a :href="link.url" target="_blank" class="text-sm text-muted-foreground hover:text-accent truncate flex-1">{{ link.url }}</a>
                  <span class="text-sm font-semibold text-foreground shrink-0">{{ link.clicks }}x</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Sidebar -->
          <div class="space-y-6">
            <!-- Engagement Score Card -->
            <div class="bg-card border border-border rounded-xl p-5 text-center">
              <h3 class="text-sm font-semibold text-foreground mb-3">Engagement Score</h3>
              <div class="w-20 h-20 mx-auto rounded-full flex items-center justify-center border-4" :class="[scoreBg, scoreColor === 'text-green-500' ? 'border-green-500/30' : scoreColor === 'text-amber-500' ? 'border-amber-500/30' : 'border-red-500/30']">
                <span :class="['text-2xl font-bold', scoreColor]">{{ profile.contact.engagement_score || 0 }}</span>
              </div>
              <div class="text-xs text-muted-foreground mt-3">
                {{ profile.contact.engagement_score >= 50 ? 'Highly engaged' : profile.contact.engagement_score >= 20 ? 'Moderately engaged' : 'Low engagement' }}
              </div>
            </div>

            <!-- Best Open Times -->
            <div v-if="openHours.length > 0" class="bg-card border border-border rounded-xl p-5">
              <h3 class="text-sm font-semibold text-foreground mb-3">Best Open Times</h3>
              <div class="flex items-end gap-px h-20">
                <div
                  v-for="h in openHours" :key="h.hour"
                  class="flex-1 rounded-t transition-all"
                  :style="{ height: h.height + '%', backgroundColor: h.hour === profile.stats.best_open_hour ? 'var(--color-accent)' : h.count > 0 ? 'var(--color-accent-secondary, #6366f140)' : 'var(--color-border)' }"
                  :title="`${formatHour(h.hour)}: ${h.count} opens`"
                />
              </div>
              <div class="flex justify-between text-[10px] text-muted-foreground mt-2">
                <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>
              </div>
              <div v-if="profile.stats.best_open_hour !== undefined" class="mt-3 text-xs text-muted-foreground">
                Peak hour: <span class="text-foreground font-medium">{{ formatHour(profile.stats.best_open_hour) }}</span>
              </div>
            </div>

            <!-- Recent Activity -->
            <div v-if="profile.recent_events?.length > 0" class="bg-card border border-border rounded-xl p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-foreground">Recent Activity</h3>
                <button class="text-xs text-accent hover:text-accent/80 cursor-pointer" @click="activeTab = 'activity'">View all</button>
              </div>
              <div class="space-y-1">
                <div v-for="(event, i) in profile.recent_events.slice(0, 6)" :key="i" class="flex items-center gap-2 py-2 border-b border-border last:border-0">
                  <component :is="eventIcons[event.type] || Clock" :size="12" class="text-muted-foreground shrink-0" />
                  <span class="text-xs text-foreground flex-1 truncate">{{ event.type.replace(/_/g, ' ') }}</span>
                  <span class="text-[10px] text-muted-foreground shrink-0">{{ formatDate(event.created_at) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Activity Tab -->
        <div v-if="activeTab === 'activity'">
          <ContactTimeline :contact-id="contactId" />
        </div>

        <!-- Preferences Tab -->
        <div v-if="activeTab === 'preferences'" class="max-w-lg">
          <ContactPreferences :contact-id="contactId" />
        </div>
      </div>
    </div>
  </div>
</template>
