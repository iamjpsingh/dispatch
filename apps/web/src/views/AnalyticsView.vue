<script setup lang="ts">
import { computed, ref } from 'vue'
import { use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { useAnalyticsSummary, useAnalyticsReports, useDeviceAnalytics, useTimeAnalysis } from '../lib/query'
import { analyticsApi } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import StatCard from '../components/ui/StatCard.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import EmailHealthDashboard from '../components/analytics/EmailHealthDashboard.vue'
import ReportBuilder from '../components/analytics/ReportBuilder.vue'
import {
  BarChart3, Mail, TrendingUp, MousePointer, AlertTriangle, Clock,
  Download,
} from 'lucide-vue-next'

use([CanvasRenderer, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent])

const { data: summaryRaw, isLoading: summaryLoading } = useAnalyticsSummary()
const { data: reportsRaw } = useAnalyticsReports()
const { data: devicesRaw } = useDeviceAnalytics()
const { data: timeRaw } = useTimeAnalysis()

interface SummaryData {
  totalCampaigns: number
  totalEmailsSent: number
  avgOpenRate: number
  avgClickRate: number
  avgBounceRate: number
  bestSendTime?: string
}
interface ReportRow {
  id: string
  name: string
  sent: number
  openRate: number
  clickRate: number
  bounceRate: number
}
interface DeviceRow { name: string; percentage: number }

const defaults: SummaryData = { totalCampaigns: 0, totalEmailsSent: 0, avgOpenRate: 0, avgClickRate: 0, avgBounceRate: 0 }
const summary = computed<SummaryData>(() => {
  const raw = summaryRaw.value
  if (!raw) return defaults
  return {
    totalCampaigns: raw.total_campaigns,
    totalEmailsSent: raw.total_emails_sent,
    avgOpenRate: raw.avg_open_rate,
    avgClickRate: raw.avg_click_rate,
    avgBounceRate: raw.avg_bounce_rate,
    bestSendTime: raw.best_send_time ? `${raw.best_send_time.best_day} ${raw.best_send_time.best_hour}:00` : undefined,
  }
})
const reports = computed<ReportRow[]>(() =>
  (reportsRaw.value || []).map((r) => ({
    id: r.campaign_id,
    name: r.campaign_name,
    sent: r.total_sent,
    openRate: r.open_rate,
    clickRate: r.click_rate,
    bounceRate: r.bounce_rate,
  }))
)
const deviceData = computed<DeviceRow[]>(() => (devicesRaw.value as DeviceRow[]) ?? [])
const timeData = computed<number[][]>(() => (timeRaw.value as number[][]) ?? [])
const bestSendTime = computed(() => summary.value.bestSendTime ?? 'N/A')

// Sorting
type SortField = 'openRate' | 'clickRate' | 'bounceRate'
const sortField = ref<SortField>('openRate')
const sortAsc = ref(false)
function toggleSort(field: SortField) {
  if (sortField.value === field) sortAsc.value = !sortAsc.value
  else { sortField.value = field; sortAsc.value = false }
}
const sortedReports = computed(() => {
  const rows = [...reports.value]
  const dir = sortAsc.value ? 1 : -1
  rows.sort((a, b) => dir * (a[sortField.value] - b[sortField.value]))
  return rows
})

// Chart
const campaignChartOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(30, 36, 51, 0.95)',
    borderColor: 'rgba(148, 163, 184, 0.12)',
    textStyle: { color: '#f8fafc', fontSize: 13 },
  },
  grid: { left: 40, right: 20, top: 20, bottom: 30 },
  xAxis: {
    type: 'category',
    data: reports.value.map(r => r.name.slice(0, 12)),
    axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.12)' } },
    axisLabel: { color: '#94a3b8', fontSize: 11 },
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '{value}%' },
    splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } },
  },
  series: [
    { name: 'Open Rate', type: 'bar', data: reports.value.map(r => r.openRate), itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] }, barWidth: '35%' },
    { name: 'Click Rate', type: 'bar', data: reports.value.map(r => r.clickRate), itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] }, barWidth: '35%' },
  ],
}))

// Heatmap
const hmDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hmHours = ['6a', '8a', '10a', '12p', '2p', '4p', '6p', '8p']
function hmVal(di: number, hi: number): number { return timeData.value?.[di]?.[hi] ?? 0 }
function hmColor(v: number): string {
  if (v <= 0) return 'rgba(30, 36, 51, 0.8)'
  if (v < 10) return 'rgba(99, 102, 241, 0.15)'
  if (v < 20) return 'rgba(99, 102, 241, 0.3)'
  if (v < 35) return 'rgba(99, 102, 241, 0.5)'
  if (v < 50) return 'rgba(99, 102, 241, 0.7)'
  return 'rgba(99, 102, 241, 0.9)'
}

function fmtNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

async function exportData(format: 'csv' | 'json') {
  try {
    const blob = await analyticsApi.export(format)
    downloadBlob(blob, `analytics-export.${format}`)
  } catch {
    const payload = { summary: summary.value, reports: reports.value, devices: deviceData.value }
    let content: string, mime: string
    if (format === 'json') { content = JSON.stringify(payload, null, 2); mime = 'application/json' }
    else {
      const rows = reports.value.map(r => `"${r.name}",${r.sent},${r.openRate},${r.clickRate},${r.bounceRate}`)
      content = ['Campaign,Sent,Open Rate,Click Rate,Bounce Rate', ...rows].join('\n')
      mime = 'text/csv'
    }
    downloadBlob(new Blob([content], { type: mime }), `analytics-export.${format}`)
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex justify-between items-start">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Analytics</h1>
        <p class="text-sm text-muted-foreground mt-1">Performance insights across all campaigns</p>
      </div>
      <div class="flex gap-2">
        <Button variant="secondary" size="sm" @click="exportData('csv')"><Download :size="14" /> CSV</Button>
        <Button variant="secondary" size="sm" @click="exportData('json')"><Download :size="14" /> JSON</Button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="summaryLoading" class="grid grid-cols-3 gap-4 max-md:grid-cols-2">
      <Skeleton variant="stat-card" :count="6" />
    </div>

    <template v-else>
      <!-- Stats Grid — 6 cards, 2 rows -->
      <div class="grid grid-cols-3 max-lg:grid-cols-2 gap-4">
        <router-link to="/campaigns" class="no-underline">
          <StatCard :icon="BarChart3" :value="summary.totalCampaigns" label="Total Campaigns" />
        </router-link>
        <router-link to="/reports" class="no-underline">
          <StatCard :icon="Mail" :value="fmtNum(summary.totalEmailsSent)" label="Emails Sent" />
        </router-link>
        <StatCard :icon="TrendingUp" :value="`${summary.avgOpenRate.toFixed(1)}%`" label="Avg Open Rate" color="success" />
        <StatCard :icon="MousePointer" :value="`${summary.avgClickRate.toFixed(1)}%`" label="Avg Click Rate" color="success" />
        <StatCard :icon="AlertTriangle" :value="`${summary.avgBounceRate.toFixed(1)}%`" label="Avg Bounce Rate" :color="summary.avgBounceRate > 5 ? 'danger' : 'success'" />
        <StatCard :icon="Clock" :value="bestSendTime" label="Best Send Time" color="accent" />
      </div>

      <!-- Tabs: Overview / Campaigns / Engagement / Reports -->
      <Tabs default-value="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="reports">Custom Reports</TabsTrigger>
        </TabsList>

        <!-- Overview Tab -->
        <TabsContent value="overview" class="space-y-6 mt-4">
          <!-- Email Health -->
          <EmailHealthDashboard />

          <!-- Campaign Performance Chart -->
          <Card v-if="reports.length > 0">
            <CardHeader>
              <CardTitle class="text-sm">Campaign Performance</CardTitle>
              <CardDescription>Open rate vs click rate by campaign</CardDescription>
            </CardHeader>
            <CardContent>
              <VChart :option="campaignChartOption" style="height: 280px" autoresize />
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Campaigns Tab -->
        <TabsContent value="campaigns" class="mt-4">
          <Card>
            <CardHeader>
              <CardTitle class="text-sm">Campaign Performance Table</CardTitle>
              <CardDescription>Click column headers to sort</CardDescription>
            </CardHeader>
            <CardContent class="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead
                      v-for="col in [{ key: 'openRate', label: 'Open Rate' }, { key: 'clickRate', label: 'Click Rate' }, { key: 'bounceRate', label: 'Bounce Rate' }]"
                      :key="col.key"
                      class="cursor-pointer select-none hover:text-foreground transition-colors"
                      :class="sortField === col.key ? 'text-accent' : ''"
                      @click="toggleSort(col.key as SortField)"
                    >
                      {{ col.label }} {{ sortField === col.key ? (sortAsc ? '▲' : '▼') : '' }}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="r in sortedReports" :key="r.id" class="cursor-pointer hover:bg-accent/5">
                    <TableCell>
                      <router-link :to="`/campaigns/${r.id}`" class="text-foreground font-medium hover:text-accent no-underline">
                        {{ r.name }}
                      </router-link>
                    </TableCell>
                    <TableCell class="text-muted-foreground">{{ fmtNum(r.sent) }}</TableCell>
                    <TableCell><span class="text-success font-medium">{{ r.openRate.toFixed(1) }}%</span></TableCell>
                    <TableCell><span class="text-success font-medium">{{ r.clickRate.toFixed(1) }}%</span></TableCell>
                    <TableCell>
                      <span :class="r.bounceRate > 5 ? 'text-danger' : 'text-success'" class="font-medium">
                        {{ r.bounceRate.toFixed(1) }}%
                      </span>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="!sortedReports.length">
                    <TableCell colspan="5" class="text-center text-muted-foreground py-10">No campaign data yet</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Engagement Tab -->
        <TabsContent value="engagement" class="space-y-6 mt-4">
          <div class="grid grid-cols-2 max-lg:grid-cols-1 gap-6">
            <!-- Device Breakdown -->
            <Card>
              <CardHeader>
                <CardTitle class="text-sm">Device / Client Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div v-if="deviceData.length === 0" class="text-center text-muted-foreground text-sm py-8">No device data available</div>
                <div v-else class="flex flex-col gap-3">
                  <div v-for="d in deviceData" :key="d.name" class="flex items-center gap-3">
                    <span class="w-24 text-sm text-muted-foreground shrink-0 text-right">{{ d.name }}</span>
                    <div class="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div class="h-full bg-accent rounded-full transition-[width] duration-500" :style="{ width: d.percentage + '%' }" />
                    </div>
                    <span class="w-14 text-sm font-semibold text-foreground text-right shrink-0">{{ d.percentage.toFixed(1) }}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <!-- Send Time Heatmap -->
            <Card>
              <CardHeader>
                <CardTitle class="text-sm">Best Send Times</CardTitle>
                <CardDescription>Open rates by day and hour</CardDescription>
              </CardHeader>
              <CardContent>
                <div class="overflow-x-auto">
                  <div class="flex gap-1 mb-1.5">
                    <span class="w-10 shrink-0" />
                    <span v-for="h in hmHours" :key="h" class="flex-1 text-center text-[11px] text-muted-foreground min-w-9">{{ h }}</span>
                  </div>
                  <div v-for="(day, di) in hmDays" :key="day" class="flex gap-1 mb-1">
                    <span class="w-10 shrink-0 text-xs text-muted-foreground flex items-center">{{ day }}</span>
                    <span
                      v-for="hi in 8" :key="hi"
                      class="flex-1 min-w-9 h-7 rounded cursor-default hover:opacity-80 transition-opacity"
                      :style="{ backgroundColor: hmColor(hmVal(di, hi - 1)) }"
                      :title="`${day} ${hmHours[hi - 1]}: ${hmVal(di, hi - 1)}% open rate`"
                    />
                  </div>
                  <div class="flex items-center gap-1.5 mt-4 justify-center">
                    <span class="text-[11px] text-muted-foreground">Low</span>
                    <span v-for="c in ['rgba(30,36,51,0.8)', 'rgba(99,102,241,0.15)', 'rgba(99,102,241,0.3)', 'rgba(99,102,241,0.6)', 'rgba(99,102,241,0.9)']" :key="c" class="w-5 h-3 rounded-sm" :style="{ background: c }" />
                    <span class="text-[11px] text-muted-foreground">High</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <!-- Custom Reports Tab -->
        <TabsContent value="reports" class="mt-4">
          <ReportBuilder />
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>
