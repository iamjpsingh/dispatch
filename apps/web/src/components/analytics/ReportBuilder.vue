<script setup lang="ts">
import { ref } from 'vue'
import { Loader2, Download, Play, Filter, Columns } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const loading = ref(false)
const schemaLoading = ref(true)
const schema = ref<{ columns: { key: string; label: string; type: string }[]; filters: string[] }>({ columns: [], filters: [] })
const selectedColumns = ref<string[]>(['campaign_name', 'total_sent', 'open_rate', 'click_rate', 'bounce_rate'])
const filters = ref<Record<string, string | number>>({})
const sortBy = ref('total_sent')
const sortOrder = ref<'asc' | 'desc'>('desc')
const limit = ref(50)
const rows = ref<Record<string, any>[]>([])
const total = ref(0)
const ran = ref(false)

async function loadSchema() {
  schemaLoading.value = true
  try {
    const res = await fetch('/api/analytics/report-builder/schema', { credentials: 'include' })
    const data = await res.json()
    if (data.success) schema.value = data.data
  } catch { /* ignore */ }
  finally { schemaLoading.value = false }
}

async function runReport() {
  loading.value = true
  ran.value = false
  try {
    const res = await fetch('/api/analytics/custom-report', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columns: selectedColumns.value,
        filters: Object.fromEntries(Object.entries(filters.value).filter(([, v]) => v !== '' && v !== undefined)),
        sort_by: sortBy.value,
        sort_order: sortOrder.value,
        limit: limit.value,
      }),
    })
    const data = await res.json()
    if (data.success) {
      rows.value = data.data.rows
      total.value = data.data.total
    }
    ran.value = true
  } catch { /* ignore */ }
  finally { loading.value = false }
}

function toggleColumn(key: string) {
  const idx = selectedColumns.value.indexOf(key)
  if (idx >= 0) selectedColumns.value.splice(idx, 1)
  else selectedColumns.value.push(key)
}

function exportCsv() {
  if (!rows.value.length) return
  const headers = selectedColumns.value.join(',')
  const csvRows = rows.value.map(row => selectedColumns.value.map(col => {
    const val = row[col]
    return typeof val === 'string' && val.includes(',') ? `"${val}"` : val ?? ''
  }).join(','))
  const csv = [headers, ...csvRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'custom-report.csv'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function colLabel(key: string): string {
  return schema.value.columns.find(c => c.key === key)?.label || key.replace(/_/g, ' ')
}

function formatVal(val: any, key: string): string {
  if (val === null || val === undefined) return '-'
  const col = schema.value.columns.find(c => c.key === key)
  if (col?.type === 'percentage') return `${Number(val).toFixed(1)}%`
  if (col?.type === 'number') return Number(val).toLocaleString()
  if (col?.type === 'date') return val ? new Date(val).toLocaleDateString() : '-'
  return String(val)
}

loadSchema()
</script>

<template>
  <div class="bg-card border border-border rounded-xl overflow-hidden">
    <div class="px-5 py-4 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Columns :size="16" class="text-accent" />
        <h3 class="text-sm font-semibold text-foreground">Custom Report Builder</h3>
      </div>
      <div class="flex gap-2">
        <Button v-if="ran && rows.length" variant="secondary" size="sm" @click="exportCsv">
          <Download :size="12" /> CSV
        </Button>
        <Button size="sm" @click="runReport" :disabled="loading || selectedColumns.length === 0">
          <Loader2 v-if="loading" :size="12" class="animate-spin" />
          <Play v-else :size="12" /> Run
        </Button>
      </div>
    </div>

    <div v-if="schemaLoading" class="flex justify-center py-8"><Loader2 :size="18" class="animate-spin text-muted-foreground" /></div>

    <div v-else class="p-5">
      <!-- Column selector -->
      <div class="mb-4">
        <div class="text-xs font-semibold text-muted-foreground mb-2">Columns</div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="col in schema.columns" :key="col.key"
            @click="toggleColumn(col.key)"
            :class="[
              'px-2.5 py-1 rounded-full text-[11px] font-medium border transition',
              selectedColumns.includes(col.key)
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-background border-border text-muted-foreground hover:border-text-muted'
            ]"
          >{{ col.label }}</button>
        </div>
      </div>

      <!-- Filters -->
      <div class="mb-4">
        <div class="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
          <Filter :size="12" /> Filters
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label class="text-[10px] text-muted-foreground mb-1 block">Min Sent</label>
            <Input :model-value="filters.min_sent" @update:model-value="filters.min_sent = Number($event)" type="number" class="text-xs" placeholder="0" />
          </div>
          <div>
            <label class="text-[10px] text-muted-foreground mb-1 block">Min Open Rate %</label>
            <Input :model-value="filters.min_open_rate" @update:model-value="filters.min_open_rate = Number($event)" type="number" class="text-xs" placeholder="0" />
          </div>
          <div>
            <label class="text-[10px] text-muted-foreground mb-1 block">Date From</label>
            <Input :model-value="filters.date_from as string" @update:model-value="filters.date_from = $event as string" type="date" class="text-xs" />
          </div>
          <div>
            <label class="text-[10px] text-muted-foreground mb-1 block">Date To</label>
            <Input :model-value="filters.date_to as string" @update:model-value="filters.date_to = $event as string" type="date" class="text-xs" />
          </div>
        </div>
      </div>

      <!-- Sort -->
      <div class="mb-4 flex gap-3">
        <div class="flex-1">
          <label class="text-[10px] text-muted-foreground mb-1 block">Sort By</label>
          <Select :model-value="sortBy" @update:model-value="sortBy = $event as string">
            <SelectTrigger class="text-xs" size="sm"><SelectValue placeholder="Sort by..." /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="col in selectedColumns" :key="col" :value="col">{{ colLabel(col) }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="w-28">
          <label class="text-[10px] text-muted-foreground mb-1 block">Order</label>
          <Select :model-value="sortOrder" @update:model-value="sortOrder = $event as 'asc' | 'desc'">
            <SelectTrigger class="text-xs" size="sm"><SelectValue placeholder="Order" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Descending</SelectItem>
              <SelectItem value="asc">Ascending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="w-20">
          <label class="text-[10px] text-muted-foreground mb-1 block">Limit</label>
          <Input :model-value="limit" @update:model-value="limit = Number($event)" type="number" min="1" max="500" class="text-xs" />
        </div>
      </div>

      <!-- Results -->
      <div v-if="ran" class="mt-4">
        <div class="text-xs text-muted-foreground mb-2">{{ total }} result{{ total !== 1 ? 's' : '' }}</div>

        <div v-if="rows.length === 0" class="text-sm text-muted-foreground text-center py-8">No data matches your criteria</div>

        <div v-else class="overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr class="bg-card">
                <th
                  v-for="col in selectedColumns" :key="col"
                  class="py-2 px-3 text-left font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap border-b border-border"
                >{{ colLabel(col) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in rows" :key="i"
                class="border-b border-border hover:bg-background transition"
              >
                <td
                  v-for="col in selectedColumns" :key="col"
                  class="py-2 px-3 whitespace-nowrap text-muted-foreground"
                >{{ formatVal(row[col], col) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
