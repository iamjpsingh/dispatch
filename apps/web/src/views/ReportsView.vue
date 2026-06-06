<script setup lang="ts">
import { ref, computed } from 'vue'
import { useLogs, useClearLogs, useDeleteLog } from '../lib/query'
import { useToast } from '../composables/useToast'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import DateInput from '../components/ui/DateInput.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatCard from '../components/ui/StatCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import AppPagination from '../components/ui/AppPagination.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import SearchInput from '../components/ui/SearchInput.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import {
  Mail,
  CheckCircle,
  XCircle,
  Download,
  Trash2,
  X,
  Check,
  Inbox,
  Eye,
  MousePointer,
} from 'lucide-vue-next'

const toast = useToast()

// Filters
const searchQuery = ref('')
const statusFilter = ref('all')
const sendTypeFilter = ref('all')
const providerFilter = ref('all')
const dateFrom = ref('')
const dateTo = ref('')
const page = ref(1)
const limit = ref(50)

// Selection
const selectedIds = ref<Set<string>>(new Set())
const selectAll = ref(false)
const deleteConfirm = ref<{ show: boolean; type: 'single' | 'bulk'; id: string }>({ show: false, type: 'single', id: '' })

const filters = computed(() => ({
  page: page.value,
  limit: limit.value,
  ...(statusFilter.value !== 'all' && { status: statusFilter.value }),
  ...(sendTypeFilter.value !== 'all' && { send_type: sendTypeFilter.value }),
  ...(providerFilter.value !== 'all' && { provider: providerFilter.value }),
  ...(searchQuery.value && { search: searchQuery.value }),
  ...(dateFrom.value && { start_date: dateFrom.value }),
  ...(dateTo.value && { end_date: dateTo.value }),
}))

const { data: logsData, isLoading: loading } = useLogs(filters)
const deleteLogsMutation = useClearLogs()
const deleteLogMutation = useDeleteLog()

const logs = computed(() => logsData.value?.logs || [])
const stats = computed(
  () => logsData.value?.stats || { total: 0, sent: 0, failed: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 }
)
const pagination = computed(() => logsData.value?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 })
const openRate = computed(() => stats.value.openRate || 0)
const clickRate = computed(() => stats.value.clickRate || 0)
const hasSelection = computed(() => selectedIds.value.size > 0)
const selectionCount = computed(() => selectedIds.value.size)

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

function getSendTypeLabel(type: string) {
  switch (type) {
    case 'batch':
      return 'Batch'
    case 'scheduled':
      return 'Scheduled'
    default:
      return 'Direct'
  }
}

function getProviderLabel(provider: string) {
  switch (provider) {
    case 'google':
      return 'Gmail'
    case 'microsoft':
      return 'Outlook'
    default:
      return 'SMTP'
  }
}

function toggleSelectAll() {
  if (selectAll.value) {
    selectedIds.value = new Set()
    selectAll.value = false
  } else {
    selectedIds.value = new Set(logs.value.map((log) => log.id || log.tracking_id || ''))
    selectAll.value = true
  }
}

function toggleSelect(id: string) {
  const newSet = new Set(selectedIds.value)
  if (newSet.has(id)) newSet.delete(id)
  else newSet.add(id)
  selectedIds.value = newSet
  selectAll.value = newSet.size === logs.value.length
}

function isSelected(id: string) {
  return selectedIds.value.has(id)
}

function handleDeleteSelected() {
  if (selectedIds.value.size === 0) {
    toast.warning('No items selected')
    return
  }
  deleteConfirm.value = { show: true, type: 'bulk', id: '' }
}

async function confirmDeleteSelected() {
  deleteConfirm.value.show = false
  const count = selectedIds.value.size
  try {
    await deleteLogsMutation.mutateAsync(Array.from(selectedIds.value))
    selectedIds.value = new Set()
    selectAll.value = false
    toast.success(`${count} log${count > 1 ? 's' : ''} deleted`)
  } catch (err: any) {
    toast.error(`Failed to delete: ${err.message || 'Unknown error'}`)
  }
}

function handleDeleteOne(id: string) {
  deleteConfirm.value = { show: true, type: 'single', id }
}

async function confirmDeleteOne() {
  const id = deleteConfirm.value.id
  deleteConfirm.value.show = false
  try {
    await deleteLogMutation.mutateAsync(id)
    selectedIds.value.delete(id)
    toast.success('Log deleted')
  } catch (err: any) {
    toast.error(`Failed to delete: ${err.message || 'Unknown error'}`)
  }
}

function clearFilters() {
  searchQuery.value = ''
  statusFilter.value = 'all'
  sendTypeFilter.value = 'all'
  providerFilter.value = 'all'
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
}

function clearSelection() {
  selectedIds.value = new Set()
  selectAll.value = false
}

function applyFilters() {
  page.value = 1
  selectedIds.value = new Set()
  selectAll.value = false
}

function changePage(newPage: number) {
  page.value = newPage
  selectedIds.value = new Set()
  selectAll.value = false
}

function exportLogs(format: 'csv' | 'json') {
  const params = new URLSearchParams()
  if (statusFilter.value !== 'all') params.set('status', statusFilter.value)
  if (sendTypeFilter.value !== 'all') params.set('send_type', sendTypeFilter.value)
  if (providerFilter.value !== 'all') params.set('provider', providerFilter.value)
  if (dateFrom.value) params.set('start_date', dateFrom.value)
  if (dateTo.value) params.set('end_date', dateTo.value)
  window.open(`/api/report/export/${format}?${params}`, '_blank')
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <PageHeader title="Reports" subtitle="Email delivery logs and analytics">
      <template #actions>
        <Button variant="secondary" @click="exportLogs('csv')"><Download :size="16" />Export CSV</Button>
        <Button variant="secondary" @click="exportLogs('json')"><Download :size="16" />Export JSON</Button>
      </template>
    </PageHeader>

    <!-- Stats Grid -->
    <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-3 max-md:grid-cols-2">
      <StatCard :icon="Mail" :value="stats.total" label="Total Emails" />
      <StatCard :icon="CheckCircle" :value="stats.sent" label="Delivered" color="success" />
      <StatCard :icon="XCircle" :value="stats.failed" label="Failed" color="danger" />
      <StatCard :icon="Eye" :value="stats.opened || 0" :label="`Opened (${openRate}%)`" color="info" />
      <StatCard :icon="MousePointer" :value="stats.clicked || 0" :label="`Clicked (${clickRate}%)`" color="accent" />
    </div>

    <!-- Filters -->
    <div class="bg-card border border-border rounded-xl flex flex-col gap-3.5 p-5">
      <SearchInput
        v-model="searchQuery"
        placeholder="Search by email, name, or subject..."
        class="w-full"
        @search="applyFilters"
      />
      <div class="flex items-center gap-3 max-[900px]:flex-wrap">
        <div class="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
          <Select v-model="statusFilter" @update:model-value="applyFilters">
            <SelectTrigger class="w-[150px] shrink-0 max-[900px]:w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="opened">Opened</SelectItem>
              <SelectItem value="clicked">Clicked</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="sendTypeFilter" @update:model-value="applyFilters">
            <SelectTrigger class="w-[150px] shrink-0 max-[900px]:w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
              <SelectItem value="batch">Batch</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="providerFilter" @update:model-value="applyFilters">
            <SelectTrigger class="w-[150px] shrink-0 max-[900px]:w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
              <SelectItem value="smtp">SMTP</SelectItem>
              <SelectItem value="google">Gmail</SelectItem>
              <SelectItem value="microsoft">Outlook</SelectItem>
            </SelectContent>
          </Select>
          <DateInput v-model="dateFrom" placeholder="From date" @change="applyFilters" />
          <DateInput v-model="dateTo" placeholder="To date" @change="applyFilters" />
        </div>
        <Button variant="ghost" class="shrink-0 ml-auto whitespace-nowrap text-[13px] opacity-70 hover:opacity-100" @click="clearFilters"><X :size="14" />Clear filters</Button>
      </div>
    </div>

    <!-- Bulk Actions -->
    <div
      v-if="hasSelection"
      class="flex items-center justify-between gap-4 px-5 py-3 bg-accent/[0.05] border border-accent/20 rounded-lg transition-all duration-200"
    >
      <span class="text-sm font-semibold text-foreground">{{ selectionCount }} selected</span>
      <div class="flex items-center gap-2">
        <Button variant="destructive" size="sm" @click="handleDeleteSelected"><Trash2 :size="14" />Delete Selected</Button>
        <Button variant="ghost" size="sm" @click="clearSelection"><X :size="14" />Clear</Button>
      </div>
    </div>

    <!-- Logs Table -->
    <div class="bg-card border border-border rounded-xl overflow-hidden">
      <!-- Loading -->
      <Table v-if="loading">
        <TableHeader>
          <TableRow>
            <TableHead class="w-12 text-center pl-4 pr-1"></TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Clicked</TableHead>
            <TableHead>Sent At</TableHead>
            <TableHead class="w-[60px] text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <Skeleton variant="table-row" :count="8" />
        </TableBody>
      </Table>

      <!-- Empty -->
      <EmptyState
        v-else-if="logs.length === 0"
        :icon="Inbox"
        title="No logs found"
        description="Send some emails to see reports here"
      />

      <!-- Table -->
      <Table v-else>
        <TableHeader>
          <TableRow>
            <TableHead class="w-12 text-center pl-4 pr-1">
              <Checkbox :checked="selectAll" @update:checked="toggleSelectAll" />
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Clicked</TableHead>
            <TableHead>Sent At</TableHead>
            <TableHead class="w-[60px] text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="log in logs"
            :key="log.id || log.tracking_id || ''"
            class="group"
            :class="{ 'bg-accent/[0.08]': isSelected(log.id || log.tracking_id || '') }"
          >
            <TableCell class="w-12 text-center pl-4 pr-1">
              <Checkbox
                :checked="isSelected(log.id || log.tracking_id || '')"
                @update:checked="toggleSelect(log.id || log.tracking_id || '')"
              />
            </TableCell>
            <TableCell>
              <StatusBadge :status="log.status" type="email" />
            </TableCell>
            <TableCell class="font-mono text-[13px] max-w-[220px] truncate">{{ log.recipient_email }}</TableCell>
            <TableCell class="max-w-[200px] truncate">{{ log.subject || '-' }}</TableCell>
            <TableCell class="text-[13px] text-muted-foreground">{{ getSendTypeLabel(log.send_type) }}</TableCell>
            <TableCell class="text-[13px] text-muted-foreground">{{ getProviderLabel(log.provider_type) }}</TableCell>
            <TableCell class="text-center">
              <Check v-if="(log.click_count || 0) > 0 || log.status === 'clicked'" :size="16" class="text-accent" />
              <span v-else class="text-muted-foreground text-[13px]">-</span>
            </TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground whitespace-nowrap">{{ formatDate(log.sent_at) }}</TableCell>
            <TableCell class="w-[60px] text-center">
              <Button
                variant="ghost"
                size="sm"
                class="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-danger hover:bg-danger/10 h-7 w-7 p-0"
                @click="handleDeleteOne(log.id || log.tracking_id || '')"
                title="Delete"
              >
                <Trash2 :size="14" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <!-- Table Footer -->
      <AppPagination
        v-if="logs.length > 0"
        :page="pagination.page"
        :total-pages="pagination.totalPages"
        :total="pagination.total"
        :showing="logs.length"
        @update:page="changePage"
      />
    </div>

    <ConfirmDialog
      :show="deleteConfirm.show"
      :title="deleteConfirm.type === 'bulk' ? 'Delete Selected Logs' : 'Delete Log'"
      :message="deleteConfirm.type === 'bulk' ? `Delete ${selectedIds.size} selected log${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.` : 'Delete this log? This cannot be undone.'"
      confirmText="Delete"
      variant="danger"
      @confirm="deleteConfirm.type === 'bulk' ? confirmDeleteSelected() : confirmDeleteOne()"
      @cancel="deleteConfirm.show = false"
    />
  </div>
</template>
