<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { analyticsApi, type EmailHealth } from '../../lib/api'
import { Heart, CheckCircle, Info, Loader2, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-vue-next'

const loading = ref(true)
const health = ref<EmailHealth | null>(null)
const error = ref('')

async function loadHealth() {
  loading.value = true
  error.value = ''
  try {
    health.value = await analyticsApi.getEmailHealth()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const scoreColor = computed(() => {
  if (!health.value) return 'text-muted-foreground'
  if (health.value.score >= 90) return 'text-green-400'
  if (health.value.score >= 70) return 'text-blue-400'
  if (health.value.score >= 50) return 'text-amber-400'
  return 'text-red-400'
})

const scoreBg = computed(() => {
  if (!health.value) return 'bg-secondary'
  if (health.value.score >= 90) return 'bg-green-500/10'
  if (health.value.score >= 70) return 'bg-blue-500/10'
  if (health.value.score >= 50) return 'bg-amber-500/10'
  return 'bg-red-500/10'
})

const scoreIcon = computed(() => {
  if (!health.value) return ShieldAlert
  if (health.value.score >= 90) return ShieldCheck
  if (health.value.score >= 70) return ShieldCheck
  if (health.value.score >= 50) return ShieldAlert
  return ShieldX
})

const ratingBadge = computed(() => {
  if (!health.value) return { text: 'Unknown', class: 'bg-card text-muted-foreground' }
  switch (health.value.rating) {
    case 'Excellent': return { text: 'Excellent', class: 'bg-green-500/15 text-green-400' }
    case 'Good': return { text: 'Good', class: 'bg-blue-500/15 text-blue-400' }
    case 'Needs Improvement': return { text: 'Needs Work', class: 'bg-amber-500/15 text-amber-400' }
    case 'Poor': return { text: 'Poor', class: 'bg-red-500/15 text-red-400' }
    default: return { text: health.value.rating, class: 'bg-card text-muted-foreground' }
  }
})

function metricStatus(value: number, goodBelow: number, warnBelow: number): 'good' | 'warn' | 'bad' {
  if (value <= goodBelow) return 'good'
  if (value <= warnBelow) return 'warn'
  return 'bad'
}

function engagementStatus(value: number, goodAbove: number, warnAbove: number): 'good' | 'warn' | 'bad' {
  if (value >= goodAbove) return 'good'
  if (value >= warnAbove) return 'warn'
  return 'bad'
}

const statusColors = { good: 'text-green-400', warn: 'text-amber-400', bad: 'text-red-400' }
const statusBgs = { good: 'bg-green-500/10', warn: 'bg-amber-500/10', bad: 'bg-red-500/10' }

onMounted(loadHealth)
</script>

<template>
  <div class="bg-card border border-border rounded-xl overflow-hidden">
    <div class="px-5 py-4 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Heart :size="16" class="text-accent" />
        <h3 class="text-sm font-semibold text-foreground">Email Health Score</h3>
      </div>
      <button v-if="!loading" @click="loadHealth" class="text-xs text-muted-foreground hover:text-muted-foreground transition">Refresh</button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12">
      <Loader2 :size="20" class="animate-spin text-muted-foreground" />
    </div>

    <div v-else-if="error" class="px-5 py-8 text-center text-sm text-muted-foreground">{{ error }}</div>

    <div v-else-if="health" class="p-5">
      <!-- Score + Rating -->
      <div class="flex items-center gap-5 mb-6">
        <div :class="[scoreBg, 'w-20 h-20 rounded-2xl flex flex-col items-center justify-center']">
          <component :is="scoreIcon" :size="20" :class="scoreColor" />
          <span :class="[scoreColor, 'text-2xl font-bold mt-0.5']">{{ health.score }}</span>
        </div>
        <div>
          <span :class="[ratingBadge.class, 'px-2.5 py-1 rounded-full text-xs font-semibold']">
            {{ ratingBadge.text }}
          </span>
          <p class="text-xs text-muted-foreground mt-2">Based on {{ health.metrics.total_sent.toLocaleString() }} emails sent</p>
        </div>
      </div>

      <!-- Metrics Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <div :class="[statusBgs[metricStatus(health.metrics.bounce_rate, 2, 5)], 'rounded-lg p-3 text-center']">
          <div class="text-lg font-bold" :class="statusColors[metricStatus(health.metrics.bounce_rate, 2, 5)]">{{ health.metrics.bounce_rate.toFixed(1) }}%</div>
          <div class="text-[10px] text-muted-foreground mt-0.5">Bounce Rate</div>
          <div class="text-[9px] text-muted-foreground">target: &lt;2%</div>
        </div>
        <div :class="[statusBgs[metricStatus(health.metrics.complaint_rate, 0.1, 0.5)], 'rounded-lg p-3 text-center']">
          <div class="text-lg font-bold" :class="statusColors[metricStatus(health.metrics.complaint_rate, 0.1, 0.5)]">{{ health.metrics.complaint_rate.toFixed(2) }}%</div>
          <div class="text-[10px] text-muted-foreground mt-0.5">Complaint Rate</div>
          <div class="text-[9px] text-muted-foreground">target: &lt;0.1%</div>
        </div>
        <div :class="[statusBgs[metricStatus(health.metrics.unsubscribe_rate, 0.5, 2)], 'rounded-lg p-3 text-center']">
          <div class="text-lg font-bold" :class="statusColors[metricStatus(health.metrics.unsubscribe_rate, 0.5, 2)]">{{ health.metrics.unsubscribe_rate.toFixed(1) }}%</div>
          <div class="text-[10px] text-muted-foreground mt-0.5">Unsub Rate</div>
          <div class="text-[9px] text-muted-foreground">target: &lt;0.5%</div>
        </div>
        <div :class="[statusBgs[engagementStatus(health.metrics.open_rate, 20, 10)], 'rounded-lg p-3 text-center']">
          <div class="text-lg font-bold" :class="statusColors[engagementStatus(health.metrics.open_rate, 20, 10)]">{{ health.metrics.open_rate.toFixed(1) }}%</div>
          <div class="text-[10px] text-muted-foreground mt-0.5">Open Rate</div>
          <div class="text-[9px] text-muted-foreground">benchmark: &gt;20%</div>
        </div>
        <div :class="[statusBgs[engagementStatus(health.metrics.click_rate, 3, 1)], 'rounded-lg p-3 text-center']">
          <div class="text-lg font-bold" :class="statusColors[engagementStatus(health.metrics.click_rate, 3, 1)]">{{ health.metrics.click_rate.toFixed(1) }}%</div>
          <div class="text-[10px] text-muted-foreground mt-0.5">Click Rate</div>
          <div class="text-[9px] text-muted-foreground">benchmark: &gt;3%</div>
        </div>
      </div>

      <!-- Recommendations -->
      <div v-if="health.recommendations.length > 0" class="space-y-2">
        <div class="text-xs font-semibold text-muted-foreground mb-1">Recommendations</div>
        <div
          v-for="(rec, i) in health.recommendations" :key="i"
          class="flex items-start gap-2 text-xs text-muted-foreground bg-background rounded-lg px-3 py-2"
        >
          <Info :size="14" class="text-amber-400 shrink-0 mt-0.5" />
          <span>{{ rec }}</span>
        </div>
      </div>
      <div v-else class="flex items-center gap-2 text-xs text-green-400 bg-green-500/5 rounded-lg px-3 py-2">
        <CheckCircle :size="14" />
        All metrics look healthy. Keep up the good work.
      </div>
    </div>
  </div>
</template>
