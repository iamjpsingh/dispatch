<script setup lang="ts">
import { computed } from 'vue'
import { useDashboardStats, usePauseJob, useResumeJob, useCancelJob } from '../lib/query'
import { useAuth } from '../stores/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import StatCard from '../components/ui/StatCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import ProgressBar from '../components/ui/ProgressBar.vue'
import {
  Mail, CheckCircle, XCircle, TrendingUp, Plus, PenSquare,
  BarChart3, Settings, Pause, Play, X, Loader2, Clock, Inbox,
  Users, RefreshCw, Zap, ArrowRight,
} from 'lucide-vue-next'

const { user } = useAuth()
const { data: dashboardData, isLoading, error, refetch } = useDashboardStats()

const stats = computed(() => dashboardData.value?.stats || { total: 0, sent: 0, failed: 0 })
const successRate = computed(() => {
  const s = stats.value
  return s.total > 0 ? Math.round((s.sent / s.total) * 100) : 0
})

const queueData = computed(
  () =>
    dashboardData.value?.queue || {
      stats: { pending: 0, running: 0, paused: 0, completed: 0, failed: 0, cancelled: 0, total_sent: 0, total_failed: 0, dead_letters: 0 },
      activeJobs: [],
      pendingJobs: [],
      recentJobs: [],
    }
)
const hasQueueActivity = computed(() => {
  const q = queueData.value.stats
  return q.running > 0 || q.pending > 0 || q.paused > 0
})
const allVisibleJobs = computed(() => {
  const active = queueData.value.activeJobs || []
  const pending = queueData.value.pendingJobs || []
  return [...active, ...pending].slice(0, 5)
})
const recentJobs = computed(() => (queueData.value.recentJobs || []).slice(0, 5))
const hasAnyCampaigns = computed(() => stats.value.total > 0)

const pauseJob = usePauseJob()
const resumeJob = useResumeJob()
const cancelJob = useCancelJob()

function handlePause(jobId: string) { pauseJob.mutate(jobId) }
function handleResume(jobId: string) { resumeJob.mutate(jobId) }
function handleCancel(jobId: string) { cancelJob.mutate(jobId) }

function statusLabel(status: string) {
  const map: Record<string, string> = { running: 'Running', pending: 'Queued', paused: 'Paused', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled' }
  return map[status] || status
}

const statusColorMap: Record<string, string> = {
  running: 'text-accent', pending: 'text-warning', paused: 'text-muted-foreground',
  completed: 'text-success', failed: 'text-danger',
}

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
})

const firstName = computed(() => {
  const n = user.value?.name
  return n ? n.split(' ')[0] : ''
})

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex justify-between items-start">
      <div>
        <h1 class="text-2xl font-bold text-foreground">{{ greeting }}{{ firstName ? `, ${firstName}` : '' }}</h1>
        <p class="text-sm text-muted-foreground mt-1">Here's what's happening with your email campaigns</p>
      </div>
      <router-link to="/compose" class="no-underline">
        <Button><Plus :size="16" /> New Campaign</Button>
      </router-link>
    </div>

    <!-- Stats Grid: Loading -->
    <div v-if="isLoading" class="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-[480px]:grid-cols-1">
      <Skeleton variant="stat-card" :count="4" />
    </div>

    <!-- Stats Grid: Error -->
    <AlertBanner v-else-if="error" type="error">
      <div class="flex items-center gap-3">
        <span>{{ (error as Error).message || 'Failed to load dashboard data' }}</span>
        <Button variant="ghost" size="sm" @click="refetch()"><RefreshCw :size="14" /> Retry</Button>
      </div>
    </AlertBanner>

    <!-- Stats Grid — clickable cards link to detail pages -->
    <div v-else class="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-[480px]:grid-cols-1">
      <router-link to="/reports" class="no-underline">
        <StatCard :icon="Mail" :value="stats.total" label="Total Sent" />
      </router-link>
      <router-link to="/reports?status=sent" class="no-underline">
        <StatCard :icon="CheckCircle" :value="stats.sent" label="Delivered" color="success" />
      </router-link>
      <router-link to="/reports?status=failed" class="no-underline">
        <StatCard :icon="XCircle" :value="stats.failed" label="Failed" color="danger" />
      </router-link>
      <router-link to="/analytics" class="no-underline">
        <StatCard :icon="TrendingUp" :value="`${successRate}%`" label="Success Rate" color="accent" />
      </router-link>
    </div>

    <!-- Active Jobs -->
    <Card v-if="hasQueueActivity || allVisibleJobs.length > 0">
      <CardHeader class="pb-3">
        <div class="flex justify-between items-center">
          <CardTitle class="text-sm flex items-center gap-2">
            <Inbox :size="16" class="text-accent" /> Active Jobs
          </CardTitle>
          <div class="flex items-center gap-2">
            <span v-if="queueData.stats.running > 0" class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-500/15 text-indigo-400 gap-1">
              <Loader2 :size="12" class="animate-spin" /> {{ queueData.stats.running }} running
            </span>
            <span v-if="queueData.stats.pending > 0" class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-warning/12 text-warning">
              <Clock :size="12" /> {{ queueData.stats.pending }} queued
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent class="pt-0">
        <div v-for="(job, idx) in allVisibleJobs" :key="job.id"
          :class="['flex items-center gap-4 py-3', idx > 0 && 'border-t border-border']"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-foreground truncate">{{ job.subject || 'Untitled' }}</div>
            <div class="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span class="font-semibold uppercase tracking-wider text-[10px]" :class="statusColorMap[job.status]">{{ statusLabel(job.status) }}</span>
              <span class="opacity-40">|</span>
              <span>{{ job.sent_count }}/{{ job.total_count }} sent</span>
            </div>
          </div>
          <div class="flex items-center gap-2.5 w-[140px] shrink-0">
            <ProgressBar :value="job.progress" :variant="job.status === 'running' ? 'accent' : 'warning'" size="sm" class="flex-1" />
            <span class="text-[11px] text-muted-foreground w-9 text-right font-mono">{{ job.progress }}%</span>
          </div>
          <div class="flex gap-1 shrink-0">
            <Button v-if="job.status === 'running'" variant="outline" size="sm" class="h-7 w-7 p-0" title="Pause" @click="handlePause(job.id)"><Pause :size="13" /></Button>
            <Button v-if="job.status === 'paused'" variant="outline" size="sm" class="h-7 w-7 p-0" title="Resume" @click="handleResume(job.id)"><Play :size="13" /></Button>
            <Button v-if="['running', 'paused', 'pending'].includes(job.status)" variant="outline" size="sm" class="h-7 w-7 p-0 hover:text-danger hover:border-danger" title="Cancel" @click="handleCancel(job.id)"><X :size="13" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Onboarding (no campaigns yet) -->
    <Card v-if="!hasAnyCampaigns && !isLoading && !error">
      <EmptyState
        :icon="PenSquare"
        title="Ready to send your first campaign?"
        description="Set up your delivery server, upload contacts, and compose your first email."
      >
        <template #actions>
          <router-link to="/settings" class="no-underline"><Button variant="secondary"><Settings :size="16" /> Setup Server</Button></router-link>
          <router-link to="/compose" class="no-underline"><Button><PenSquare :size="16" /> Create Campaign</Button></router-link>
        </template>
      </EmptyState>
    </Card>

    <!-- Bottom row: Recent Activity + Quick Navigation -->
    <div class="grid grid-cols-[1fr_300px] max-lg:grid-cols-1 gap-6">
      <!-- Recent Completed Jobs -->
      <Card>
        <CardHeader>
          <div class="flex justify-between items-center">
            <CardTitle class="text-sm">Recent Campaigns</CardTitle>
            <router-link to="/campaigns" class="text-xs text-accent hover:underline no-underline">View all →</router-link>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="recentJobs.length === 0" class="py-4 text-center text-sm text-muted-foreground">No recent campaigns</div>
          <div v-else class="flex flex-col">
            <div v-for="(job, idx) in recentJobs" :key="job.id"
              :class="['flex items-center justify-between gap-4 py-2.5', idx > 0 && 'border-t border-border']"
            >
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-foreground truncate">{{ job.subject || 'Untitled' }}</div>
                <div class="text-xs text-muted-foreground mt-0.5">{{ job.sent_count }} sent · {{ statusLabel(job.status) }}</div>
              </div>
              <span class="text-xs text-muted-foreground shrink-0">{{ formatTimeAgo(job?.updated_at || job.created_at) }}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Quick Navigation -->
      <div class="flex flex-col gap-3">
        <router-link to="/compose" class="flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl no-underline transition-all hover:border-accent/30 group">
          <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0"><PenSquare :size="16" class="text-accent" /></div>
          <div class="flex-1"><div class="text-sm font-medium text-foreground">Compose</div><div class="text-xs text-muted-foreground">Create a new campaign</div></div>
          <ArrowRight :size="14" class="text-muted-foreground group-hover:text-accent transition-colors" />
        </router-link>
        <router-link to="/contacts" class="flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl no-underline transition-all hover:border-accent/30 group">
          <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0"><Users :size="16" class="text-accent" /></div>
          <div class="flex-1"><div class="text-sm font-medium text-foreground">Contacts</div><div class="text-xs text-muted-foreground">Manage your audience</div></div>
          <ArrowRight :size="14" class="text-muted-foreground group-hover:text-accent transition-colors" />
        </router-link>
        <router-link to="/automations" class="flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl no-underline transition-all hover:border-accent/30 group">
          <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0"><Zap :size="16" class="text-accent" /></div>
          <div class="flex-1"><div class="text-sm font-medium text-foreground">Automations</div><div class="text-xs text-muted-foreground">Build email workflows</div></div>
          <ArrowRight :size="14" class="text-muted-foreground group-hover:text-accent transition-colors" />
        </router-link>
        <router-link to="/analytics" class="flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl no-underline transition-all hover:border-accent/30 group">
          <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0"><BarChart3 :size="16" class="text-accent" /></div>
          <div class="flex-1"><div class="text-sm font-medium text-foreground">Analytics</div><div class="text-xs text-muted-foreground">Email performance insights</div></div>
          <ArrowRight :size="14" class="text-muted-foreground group-hover:text-accent transition-colors" />
        </router-link>
      </div>
    </div>
  </div>
</template>
