<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { adminApi } from '../../lib/api/admin'
import type { AuditLog, ActivityLog } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import EmptyState from '../../components/ui/EmptyState.vue'
import Skeleton from '../../components/ui/Skeleton.vue'
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const toast = useToast()
const auditLogs = ref<AuditLog[]>([])
const activityLogs = ref<ActivityLog[]>([])
const auditTotal = ref(0)
const auditPage = ref(1)
const auditLoading = ref(true)
const auditLogType = ref<'audit' | 'activity'>('audit')

const auditTotalPages = computed(() => Math.ceil(auditTotal.value / 25) || 1)

function formatDate(d: string): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

async function loadAuditLogs(page = 1) {
  auditLoading.value = true
  auditPage.value = page
  try {
    if (auditLogType.value === 'audit') {
      const result = await adminApi.getAuditLogs({ page, limit: 25 })
      auditLogs.value = result.logs
      auditTotal.value = result.total
    } else {
      const result = await adminApi.getActivityLogs({ page, limit: 25 })
      activityLogs.value = result.logs
      auditTotal.value = result.total
    }
  } catch (e: any) {
    toast.error(e.message || 'Failed to load logs')
  } finally {
    auditLoading.value = false
  }
}

function switchLogType(type: 'audit' | 'activity') {
  auditLogType.value = type
  loadAuditLogs(1)
}

onMounted(() => loadAuditLogs(1))
</script>

<template>
  <div>
    <div class="flex items-center gap-4 mb-4">
      <div class="flex bg-muted rounded-lg p-0.5">
        <button
          :class="[
            'px-3 py-1.5 text-sm rounded-md transition-all',
            auditLogType === 'audit' ? 'bg-card text-foreground font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground'
          ]"
          @click="switchLogType('audit')"
        >
          Audit Logs
        </button>
        <button
          :class="[
            'px-3 py-1.5 text-sm rounded-md transition-all',
            auditLogType === 'activity' ? 'bg-card text-foreground font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground'
          ]"
          @click="switchLogType('activity')"
        >
          Activity
        </button>
      </div>
      <span class="text-sm text-muted-foreground">{{ auditTotal }} total</span>
    </div>

    <div v-if="auditLoading" class="space-y-2">
      <Skeleton variant="text" :count="8" />
    </div>

    <div v-else-if="(auditLogType === 'audit' ? auditLogs : activityLogs).length === 0" class="bg-card border border-border rounded-xl">
      <EmptyState :icon="ScrollText" title="No logs yet" description="Actions will appear here as your team works" />
    </div>

    <div v-else class="bg-card border border-border rounded-xl overflow-hidden">
      <!-- Audit Logs Table -->
      <Table v-if="auditLogType === 'audit'">
        <TableHeader>
          <TableRow>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="log in auditLogs" :key="log.id">
            <TableCell><span class="text-sm font-mono text-foreground">{{ log.action }}</span></TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ log.entity_type }}{{ log.entity_id ? `: ${log.entity_id.substring(0, 16)}...` : '' }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ log.actor_email || log.actor_id.substring(0, 12) }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ formatDate(log.created_at) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <!-- Activity Logs Table -->
      <Table v-else>
        <TableHeader>
          <TableRow>
            <TableHead>Action</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="log in activityLogs" :key="log.id">
            <TableCell><span class="text-sm font-mono text-foreground">{{ log.action }}</span></TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ log.description }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ log.actor_email || log.actor_id.substring(0, 12) }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ formatDate(log.created_at) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Pagination -->
    <div v-if="auditTotalPages > 1" class="flex items-center justify-center gap-2 mt-4">
      <Button variant="ghost" size="sm" :disabled="auditPage <= 1" @click="loadAuditLogs(auditPage - 1)">
        <ChevronLeft :size="16" />
      </Button>
      <span class="text-sm text-muted-foreground">Page {{ auditPage }} of {{ auditTotalPages }}</span>
      <Button variant="ghost" size="sm" :disabled="auditPage >= auditTotalPages" @click="loadAuditLogs(auditPage + 1)">
        <ChevronRight :size="16" />
      </Button>
    </div>
  </div>
</template>
