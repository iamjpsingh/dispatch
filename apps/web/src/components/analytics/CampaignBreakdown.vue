<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Loader2, Monitor, Smartphone, Tablet, Globe, Mail, ExternalLink } from 'lucide-vue-next'

const props = defineProps<{
  campaignId: string
}>()

const loading = ref(true)
const devices = ref<{ name: string; count: number; percentage: number }[]>([])
const browsers = ref<{ name: string; count: number; percentage: number }[]>([])
const oses = ref<{ name: string; count: number; percentage: number }[]>([])
const clients = ref<{ name: string; count: number; percentage: number }[]>([])
const sources = ref<{ source: string; count: number; medium: string }[]>([])
const activeTab = ref<'devices' | 'clients' | 'sources'>('devices')

async function loadData() {
  loading.value = true
  try {
    const [devRes, clientRes, srcRes] = await Promise.all([
      fetch(`/api/analytics/campaigns/${props.campaignId}/devices`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/analytics/campaigns/${props.campaignId}/clients`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/analytics/campaigns/${props.campaignId}/referrers`, { credentials: 'include' }).then(r => r.json()),
    ])
    if (devRes.success) {
      devices.value = devRes.data.devices || []
      browsers.value = devRes.data.browsers || []
      oses.value = devRes.data.operatingSystems || []
    }
    if (clientRes.success) clients.value = clientRes.data.clients || []
    if (srcRes.success) sources.value = srcRes.data.sources || []
  } catch { /* ignore */ }
  finally { loading.value = false }
}

const deviceIcons: Record<string, any> = { desktop: Monitor, mobile: Smartphone, tablet: Tablet }

function barColor(idx: number): string {
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316']
  return colors[idx % colors.length] ?? '#6366f1'
}

watch(() => props.campaignId, loadData)
onMounted(loadData)
</script>

<template>
  <div class="bg-card border border-border rounded-xl overflow-hidden">
    <!-- Tabs -->
    <div class="flex border-b border-border">
      <button
        v-for="tab in [{ key: 'devices', label: 'Devices' }, { key: 'clients', label: 'Email Clients' }, { key: 'sources', label: 'Sources' }]"
        :key="tab.key"
        class="px-4 py-3 text-xs font-medium transition-all border-b-2"
        :class="activeTab === tab.key ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-muted-foreground'"
        @click="activeTab = tab.key as any"
      >{{ tab.label }}</button>
    </div>

    <div v-if="loading" class="flex justify-center py-10"><Loader2 :size="18" class="animate-spin text-muted-foreground" /></div>

    <div v-else class="p-4">
      <!-- Devices Tab -->
      <div v-if="activeTab === 'devices'" class="space-y-4">
        <!-- Device types -->
        <div>
          <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Device Type</div>
          <div class="flex gap-3">
            <div v-for="d in devices" :key="d.name" class="flex-1 bg-background rounded-lg p-3 text-center">
              <component :is="deviceIcons[d.name] || Monitor" :size="18" class="mx-auto text-muted-foreground mb-1" />
              <div class="text-sm font-bold text-foreground">{{ d.percentage }}%</div>
              <div class="text-[10px] text-muted-foreground capitalize">{{ d.name }} ({{ d.count }})</div>
            </div>
          </div>
          <div v-if="devices.length === 0" class="text-xs text-muted-foreground text-center py-4">No device data yet</div>
        </div>

        <!-- Browsers -->
        <div>
          <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Browsers</div>
          <div class="space-y-1.5">
            <div v-for="(b, i) in browsers.slice(0, 6)" :key="b.name" class="flex items-center gap-2">
              <span class="w-20 text-xs text-muted-foreground truncate">{{ b.name }}</span>
              <div class="flex-1 h-4 bg-background rounded overflow-hidden">
                <div class="h-full rounded" :style="{ width: b.percentage + '%', backgroundColor: barColor(i) }"></div>
              </div>
              <span class="w-12 text-xs text-muted-foreground text-right">{{ b.percentage }}%</span>
            </div>
          </div>
        </div>

        <!-- OS -->
        <div>
          <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Operating Systems</div>
          <div class="space-y-1.5">
            <div v-for="(o, i) in oses.slice(0, 6)" :key="o.name" class="flex items-center gap-2">
              <span class="w-20 text-xs text-muted-foreground truncate">{{ o.name }}</span>
              <div class="flex-1 h-4 bg-background rounded overflow-hidden">
                <div class="h-full rounded" :style="{ width: o.percentage + '%', backgroundColor: barColor(i + 3) }"></div>
              </div>
              <span class="w-12 text-xs text-muted-foreground text-right">{{ o.percentage }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Email Clients Tab -->
      <div v-if="activeTab === 'clients'">
        <div class="space-y-2">
          <div v-for="(cl, i) in clients" :key="cl.name" class="flex items-center gap-2">
            <Mail :size="12" class="text-muted-foreground shrink-0" />
            <span class="w-28 text-xs text-muted-foreground truncate">{{ cl.name }}</span>
            <div class="flex-1 h-5 bg-background rounded overflow-hidden">
              <div class="h-full rounded flex items-center px-2" :style="{ width: Math.max(cl.percentage, 3) + '%', backgroundColor: barColor(i) }">
                <span v-if="cl.percentage > 10" class="text-[9px] text-white font-medium">{{ cl.percentage }}%</span>
              </div>
            </div>
            <span class="w-10 text-xs text-muted-foreground text-right">{{ cl.count }}</span>
          </div>
          <div v-if="clients.length === 0" class="text-xs text-muted-foreground text-center py-6">No email client data yet. Deploy tracking Worker for detailed analytics.</div>
        </div>
      </div>

      <!-- Sources Tab -->
      <div v-if="activeTab === 'sources'">
        <div class="space-y-2">
          <div v-for="(s, i) in sources" :key="s.source" class="flex items-center gap-2">
            <Globe v-if="s.medium === 'search'" :size="12" class="text-blue-400 shrink-0" />
            <ExternalLink v-else-if="s.medium === 'social'" :size="12" class="text-pink-400 shrink-0" />
            <Mail v-else-if="s.medium === 'email'" :size="12" class="text-green-400 shrink-0" />
            <Globe v-else :size="12" class="text-muted-foreground shrink-0" />
            <span class="w-28 text-xs text-muted-foreground truncate">{{ s.source }}</span>
            <div class="flex-1 h-5 bg-background rounded overflow-hidden">
              <div class="h-full rounded" :style="{ width: Math.max((s.count / Math.max(sources[0]?.count || 1, 1)) * 100, 3) + '%', backgroundColor: barColor(i) }"></div>
            </div>
            <span class="w-10 text-xs text-muted-foreground text-right">{{ s.count }}</span>
          </div>
          <div v-if="sources.length === 0" class="text-xs text-muted-foreground text-center py-6">No referral data yet. Click tracking captures referral sources.</div>
        </div>
      </div>
    </div>
  </div>
</template>
