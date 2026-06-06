<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../../lib/api/admin'
import type { PlatformUser, Organization } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import { useAuth } from '../../stores/auth'
import EmptyState from '../../components/ui/EmptyState.vue'
import Skeleton from '../../components/ui/Skeleton.vue'
import InfoTip from '../../components/ui/InfoTip.vue'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Users, Building2, Shield, Loader2, Trash2, RefreshCw, Crown,
} from 'lucide-vue-next'

const toast = useToast()
const { switchOrg } = useAuth()

// Users
const loadingUsers = ref(true)
const users = ref<PlatformUser[]>([])
const usersTotal = ref(0)

// Orgs
const loadingOrgs = ref(true)
const orgs = ref<Organization[]>([])
const orgsTotal = ref(0)

// Cleanup
const cleaningUp = ref(false)

function formatDate(d: string | null): string {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

async function loadUsers() {
  try {
    const res = await adminApi.platformListUsers(1, 200)
    users.value = res.users
    usersTotal.value = res.total
  } catch (e: any) {
    toast.error(e.message || 'Failed to load users')
  } finally {
    loadingUsers.value = false
  }
}

async function loadOrgs() {
  try {
    const res = await adminApi.platformListOrgs(1, 200)
    orgs.value = res.orgs
    orgsTotal.value = res.total
  } catch (e: any) {
    toast.error(e.message || 'Failed to load organizations')
  } finally {
    loadingOrgs.value = false
  }
}

async function handleCleanup() {
  cleaningUp.value = true
  try {
    await adminApi.platformCleanupSessions()
    toast.success('Expired sessions cleaned up')
  } catch (e: any) {
    toast.error(e.message || 'Cleanup failed')
  } finally {
    cleaningUp.value = false
  }
}

async function handleSwitchToOrg(orgId: string) {
  try {
    await switchOrg(orgId)
    toast.success('Switched to organization')
  } catch (e: any) {
    toast.error(e.message || 'Failed to switch org')
  }
}

onMounted(() => { loadUsers(); loadOrgs() })
</script>

<template>
  <div>
    <!-- Header with actions -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
          <Crown :size="18" class="text-warning" />
          Platform Administration
        </h2>
        <p class="text-sm text-muted-foreground mt-0.5">
          Manage all users and organizations across the entire platform
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="secondary" size="sm" :disabled="cleaningUp" @click="handleCleanup">
          <Loader2 v-if="cleaningUp" :size="14" class="animate-spin" />
          <Trash2 v-else :size="14" />
          Cleanup Sessions
        </Button>
      </div>
    </div>

    <!-- Stats row -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-card border border-border rounded-xl p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Total Users</p>
        <p class="text-2xl font-bold text-foreground">{{ usersTotal }}</p>
      </div>
      <div class="bg-card border border-border rounded-xl p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Platform Admins</p>
        <p class="text-2xl font-bold text-warning">{{ users.filter(u => u.is_platform_admin).length }}</p>
      </div>
      <div class="bg-card border border-border rounded-xl p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Organizations</p>
        <p class="text-2xl font-bold text-foreground">{{ orgsTotal }}</p>
      </div>
      <div class="bg-card border border-border rounded-xl p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Active Orgs</p>
        <p class="text-2xl font-bold text-success">{{ orgs.filter(o => o.status === 'active').length }}</p>
      </div>
    </div>

    <!-- All Users -->
    <section class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users :size="16" class="text-accent" />
          All Users
          <InfoTip text="Every registered user across all organizations" side="right" />
        </h3>
        <Button variant="ghost" size="sm" @click="loadingUsers = true; loadUsers()">
          <RefreshCw :size="14" /> Refresh
        </Button>
      </div>

      <div v-if="loadingUsers"><Skeleton variant="card" :count="3" /></div>
      <div v-else-if="users.length === 0" class="bg-card border border-border rounded-xl">
        <EmptyState :icon="Users" title="No users" description="No users have registered yet" />
      </div>
      <div v-else class="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in users" :key="u.id">
              <TableCell class="font-medium text-foreground">
                {{ u.name || '-' }}
              </TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ u.email }}</TableCell>
              <TableCell>
                <span :class="['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', u.status === 'active' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500']">
                  {{ u.status }}
                </span>
              </TableCell>
              <TableCell>
                <span v-if="u.is_platform_admin" class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-500 gap-1 w-fit">
                  <Shield :size="12" /> Platform Admin
                </span>
                <span v-else class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">User</span>
              </TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ formatDate(u.last_login_at) }}</TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ formatDate(u.created_at) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>

    <!-- All Organizations -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-foreground flex items-center gap-2">
          <Building2 :size="16" class="text-accent" />
          All Organizations
          <InfoTip text="Every organization on the platform. Click 'Switch' to manage an org." side="right" />
        </h3>
        <Button variant="ghost" size="sm" @click="loadingOrgs = true; loadOrgs()">
          <RefreshCw :size="14" /> Refresh
        </Button>
      </div>

      <div v-if="loadingOrgs"><Skeleton variant="card" :count="2" /></div>
      <div v-else-if="orgs.length === 0" class="bg-card border border-border rounded-xl">
        <EmptyState :icon="Building2" title="No organizations" description="No organizations have been created yet" />
      </div>
      <div v-else class="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Created</TableHead>
              <TableHead class="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="org in orgs" :key="org.id">
              <TableCell class="font-medium text-foreground">{{ org.name }}</TableCell>
              <TableCell class="text-muted-foreground text-sm font-mono">{{ org.slug }}</TableCell>
              <TableCell>
                <span :class="['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', org.status === 'active' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500']">
                  {{ org.status }}
                </span>
              </TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ org.memberCount ?? '-' }}</TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ formatDate(org.created_at) }}</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" @click="handleSwitchToOrg(org.id)">
                  Switch
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  </div>
</template>
