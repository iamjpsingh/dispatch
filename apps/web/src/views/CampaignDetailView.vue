<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatCard from '../components/ui/StatCard.vue'
import ClickHeatmap from '../components/analytics/ClickHeatmap.vue'
import CampaignBreakdown from '../components/analytics/CampaignBreakdown.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import ProgressBar from '../components/ui/ProgressBar.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import { Button } from '@/components/ui/button'
import { useToast } from '../composables/useToast'
import {
  useCampaign,
  useCampaignStats,
  useLaunchCampaign,
  usePauseCampaign,
  useCancelCampaign,
  useCloneCampaign,
  useArchiveCampaign,
} from '../lib/query'
import {
  ArrowLeft,
  Rocket,
  Pause,
  X,
  Copy,
  Archive,
  Loader2,
  Send,
  Eye,
  MousePointer,
  AlertTriangle,
  UserMinus,
  Users,
  Mail,
  Clock,
  CalendarDays,
  Tag,
  RefreshCw,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const campaignId = computed(() => String(route.params.id || ''))

// Queries
const { data: campaign, isLoading, error: campaignError, refetch: refetchCampaign } = useCampaign(campaignId)
const { data: stats, refetch: refetchStats } = useCampaignStats(campaignId)

// Mutations
const launchMutation = useLaunchCampaign()
const pauseMutation = usePauseCampaign()
const cancelMutation = useCancelCampaign()
const cloneMutation = useCloneCampaign()
const archiveMutation = useArchiveCampaign()

const actionInProgress = ref<string | null>(null)

// ============================================================================
// Actions
// ============================================================================

async function handleAction(action: string) {
  actionInProgress.value = action
  try {
    switch (action) {
      case 'launch':
        await launchMutation.mutateAsync(campaignId.value)
        toast.success('Campaign launched successfully')
        break
      case 'pause':
        await pauseMutation.mutateAsync(campaignId.value)
        toast.success('Campaign paused')
        break
      case 'cancel':
        await cancelMutation.mutateAsync(campaignId.value)
        toast.success('Campaign cancelled')
        break
      case 'clone':
        const cloned = await cloneMutation.mutateAsync(campaignId.value)
        toast.success('Campaign cloned')
        if (cloned?.id) {
          router.push(`/campaigns/${cloned.id}`)
        }
        return
      case 'archive':
        await archiveMutation.mutateAsync(campaignId.value)
        toast.success('Campaign archived')
        break
    }
    refetchCampaign()
    refetchStats()
  } catch (err: any) {
    toast.error(`Failed to ${action} campaign: ${err.message}`)
  } finally {
    actionInProgress.value = null
  }
}

function refreshData() {
  refetchCampaign()
  refetchStats()
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(d: string | null | undefined): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatNumber(n: number | undefined | null): string {
  if (n == null) return '0'
  return n.toLocaleString()
}

function formatRate(rate: number | undefined | null): string {
  if (rate == null) return '0.0'
  return (rate * 100).toFixed(1)
}

const progressPercent = computed(() => {
  const c = campaign.value
  if (!c || !c.total_recipients) return 0
  return Math.round((c.sent_count / c.total_recipients) * 100)
})

const canLaunch = computed(() => {
  const s = campaign.value?.status
  return s === 'draft' || s === 'scheduled'
})

const canPause = computed(() => {
  return campaign.value?.status === 'sending'
})

const canCancel = computed(() => {
  const s = campaign.value?.status
  return s === 'sending' || s === 'scheduled' || s === 'paused'
})

const canArchive = computed(() => {
  const s = campaign.value?.status
  return s === 'completed' || s === 'cancelled'
})

function campaignTypeLabel(type: string | undefined): string {
  const labels: Record<string, string> = {
    one_time: 'One-time',
    recurring: 'Recurring',
    ab_test: 'A/B Test',
    automation: 'Automation',
  }
  return labels[type || ''] || type || '-'
}
</script>

<template>
  <div>
    <!-- Back Button -->
    <router-link
      to="/campaigns"
      class="inline-flex items-center gap-2 text-muted-foreground text-sm mb-6 hover:text-foreground transition-colors duration-150 no-underline"
    >
      <ArrowLeft :size="16" />
      Back to Campaigns
    </router-link>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex flex-col gap-4">
      <Skeleton variant="text" width="40%" height="32px" />
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Skeleton variant="stat-card" :count="6" />
      </div>
    </div>

    <!-- Error State -->
    <AlertBanner v-else-if="campaignError" type="error">
      <div class="flex items-center gap-3">
        <span>{{ (campaignError as Error).message || 'Failed to load campaign' }}</span>
        <Button variant="ghost" size="sm" @click="refreshData"><RefreshCw :size="14" /> Retry</Button>
      </div>
    </AlertBanner>

    <!-- Campaign Content -->
    <template v-else-if="campaign">
      <!-- Header -->
      <header class="flex justify-between items-start mb-8 flex-wrap gap-4">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <h1 class="text-2xl font-semibold m-0 text-foreground">{{ campaign.name }}</h1>
            <StatusBadge :status="campaign.status" type="campaign" />
          </div>
          <p class="text-muted-foreground text-sm m-0">
            {{ campaignTypeLabel(campaign.type) }} campaign
            <span v-if="campaign.created_at"> &middot; Created {{ formatDate(campaign.created_at) }}</span>
          </p>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" :disabled="!!actionInProgress" @click="refreshData">
            <RefreshCw :size="14" />
          </Button>

          <Button
            v-if="canLaunch"
            size="sm"
            :disabled="!!actionInProgress"
            @click="handleAction('launch')"
          >
            <Loader2 v-if="actionInProgress === 'launch'" :size="14" class="spin" />
            <Rocket v-else :size="14" />
            Launch
          </Button>

          <Button
            v-if="canPause"
            variant="secondary"
            size="sm"
            :disabled="!!actionInProgress"
            @click="handleAction('pause')"
          >
            <Loader2 v-if="actionInProgress === 'pause'" :size="14" class="spin" />
            <Pause v-else :size="14" />
            Pause
          </Button>

          <Button
            v-if="canCancel"
            variant="destructive"
            size="sm"
            :disabled="!!actionInProgress"
            @click="handleAction('cancel')"
          >
            <Loader2 v-if="actionInProgress === 'cancel'" :size="14" class="spin" />
            <X v-else :size="14" />
            Cancel
          </Button>

          <Button variant="ghost" size="sm" :disabled="!!actionInProgress" @click="handleAction('clone')">
            <Loader2 v-if="actionInProgress === 'clone'" :size="14" class="spin" />
            <Copy v-else :size="14" />
            Clone
          </Button>

          <Button
            v-if="canArchive"
            variant="ghost"
            size="sm"
            :disabled="!!actionInProgress"
            @click="handleAction('archive')"
          >
            <Loader2 v-if="actionInProgress === 'archive'" :size="14" class="spin" />
            <Archive v-else :size="14" />
            Archive
          </Button>
        </div>
      </header>

      <!-- Progress Bar -->
      <div class="bg-card border border-border rounded-xl p-5 mb-6">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm text-muted-foreground font-medium">Send Progress</span>
          <span class="text-sm font-semibold text-foreground">
            {{ formatNumber(campaign.sent_count) }} / {{ formatNumber(campaign.total_recipients) }}
            <span class="text-muted-foreground font-normal ml-1">({{ progressPercent }}%)</span>
          </span>
        </div>
        <ProgressBar :value="progressPercent" variant="accent" size="md" />
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard :icon="Users" :value="formatNumber(stats?.total_recipients ?? campaign.total_recipients)" label="Recipients" />
        <StatCard :icon="Send" :value="formatNumber(stats?.sent ?? campaign.sent_count)" label="Sent" color="success" />
        <StatCard :icon="Eye" :value="formatNumber(stats?.opened ?? campaign.open_count)" :label="`Opens (${formatRate(stats?.open_rate)}%)`" color="info" />
        <StatCard :icon="MousePointer" :value="formatNumber(stats?.clicked ?? campaign.click_count)" :label="`Clicks (${formatRate(stats?.click_rate)}%)`" color="accent" />
        <StatCard :icon="AlertTriangle" :value="formatNumber(stats?.bounced ?? campaign.bounce_count)" label="Bounced" color="danger" />
        <StatCard :icon="UserMinus" :value="formatNumber(stats?.unsubscribed ?? campaign.unsubscribe_count)" label="Unsubscribed" color="warning" />
      </div>

      <!-- Click Heatmap + Breakdown -->
      <div v-if="campaign.status === 'completed' || campaign.status === 'sending'" class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ClickHeatmap :campaign-id="campaign.id" />
        <CampaignBreakdown :campaign-id="campaign.id" />
      </div>

      <!-- Campaign Details -->
      <div class="bg-card border border-border rounded-xl p-6">
        <h2 class="text-sm font-semibold text-foreground mb-5">Campaign Details</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Mail :size="14" class="text-muted-foreground" />
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Subject</div>
              <div class="text-sm text-foreground">{{ campaign.subject || '-' }}</div>
            </div>
          </div>

          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Tag :size="14" class="text-muted-foreground" />
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Type</div>
              <div class="text-sm text-foreground">{{ campaignTypeLabel(campaign.type) }}</div>
            </div>
          </div>

          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Send :size="14" class="text-muted-foreground" />
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">From</div>
              <div class="text-sm text-foreground">
                {{ campaign.from_name || '-' }}
                <span class="text-muted-foreground">&lt;{{ campaign.from_email }}&gt;</span>
              </div>
            </div>
          </div>

          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Mail :size="14" class="text-muted-foreground" />
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Reply-To</div>
              <div class="text-sm text-foreground">
                {{ (campaign as any).reply_to || campaign.from_email || '-' }}
              </div>
            </div>
          </div>

          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Clock :size="14" class="text-muted-foreground" />
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Created</div>
              <div class="text-sm text-foreground">{{ formatDate(campaign.created_at) }}</div>
            </div>
          </div>

          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <CalendarDays :size="14" class="text-muted-foreground" />
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Scheduled At</div>
              <div class="text-sm text-foreground">{{ formatDate(campaign.scheduled_at) }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
