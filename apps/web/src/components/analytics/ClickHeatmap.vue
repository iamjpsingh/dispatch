<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { analyticsApi, type LinkClickData } from '../../lib/api'
import { Loader2, ExternalLink, MousePointer } from 'lucide-vue-next'

const props = defineProps<{
  campaignId: string
  emailHtml?: string
}>()

const loading = ref(true)
const links = ref<LinkClickData[]>([])
const error = ref('')


const totalClicks = computed(() => links.value.reduce((sum, l) => sum + l.click_count, 0))
const maxClicks = computed(() => Math.max(...links.value.map(l => l.click_count), 1))

function heatColor(clicks: number): string {
  const ratio = clicks / maxClicks.value
  if (ratio >= 0.75) return 'rgba(239, 68, 68, 0.85)'   // red — hot
  if (ratio >= 0.5) return 'rgba(249, 115, 22, 0.8)'     // orange
  if (ratio >= 0.25) return 'rgba(234, 179, 8, 0.75)'    // yellow
  return 'rgba(59, 130, 246, 0.7)'                         // blue — cool
}

function barWidth(clicks: number): string {
  return `${Math.max(4, (clicks / maxClicks.value) * 100)}%`
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    links.value = await analyticsApi.getLinkClicks(props.campaignId)
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname + u.search
    return path.length > 50 ? path.substring(0, 47) + '...' : path
  } catch {
    return url.length > 50 ? url.substring(0, 47) + '...' : url
  }
}

watch(() => props.campaignId, loadData)
onMounted(loadData)
</script>

<template>
  <div class="bg-card border border-border rounded-xl overflow-hidden">
    <div class="px-5 py-4 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-2">
        <MousePointer :size="16" class="text-accent" />
        <h3 class="text-sm font-semibold text-foreground">Click Heatmap</h3>
        <span v-if="!loading" class="text-xs text-muted-foreground">({{ totalClicks.toLocaleString() }} total clicks)</span>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12">
      <Loader2 :size="20" class="animate-spin text-muted-foreground" />
    </div>

    <div v-else-if="error" class="px-5 py-8 text-center text-sm text-muted-foreground">{{ error }}</div>

    <div v-else-if="links.length === 0" class="px-5 py-8 text-center text-sm text-muted-foreground">No click data available</div>

    <div v-else class="p-5">
      <!-- Heatmap bar chart -->
      <div class="space-y-3">
        <div v-for="link in links" :key="link.url" class="group">
          <div class="flex items-center justify-between gap-3 mb-1">
            <a
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-muted-foreground hover:text-accent transition truncate flex-1 flex items-center gap-1"
              :title="link.url"
            >
              {{ shortenUrl(link.url) }}
              <ExternalLink :size="10" class="shrink-0 opacity-0 group-hover:opacity-100 transition" />
            </a>
            <div class="flex items-center gap-3 shrink-0 text-xs">
              <span class="text-muted-foreground">{{ link.unique_clicks }} unique</span>
              <span class="font-semibold text-foreground w-12 text-right">{{ link.click_count }}</span>
            </div>
          </div>
          <div class="h-6 bg-background rounded-md overflow-hidden relative">
            <div
              class="h-full rounded-md transition-all duration-500 flex items-center px-2"
              :style="{ width: barWidth(link.click_count), backgroundColor: heatColor(link.click_count) }"
            >
              <span v-if="link.click_count / maxClicks >= 0.2" class="text-[10px] font-semibold text-white">
                {{ Math.round((link.click_count / totalClicks) * 100) }}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Legend -->
      <div class="flex items-center gap-3 mt-5 pt-4 border-t border-border justify-center">
        <span class="text-[10px] text-muted-foreground">Cool</span>
        <div class="flex gap-0.5">
          <span class="w-6 h-3 rounded-sm" style="background: rgba(59, 130, 246, 0.7)"></span>
          <span class="w-6 h-3 rounded-sm" style="background: rgba(234, 179, 8, 0.75)"></span>
          <span class="w-6 h-3 rounded-sm" style="background: rgba(249, 115, 22, 0.8)"></span>
          <span class="w-6 h-3 rounded-sm" style="background: rgba(239, 68, 68, 0.85)"></span>
        </div>
        <span class="text-[10px] text-muted-foreground">Hot</span>
      </div>
    </div>
  </div>
</template>
