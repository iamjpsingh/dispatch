<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { adminApi, type Organization } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ConfirmDialog from '../../components/ui/ConfirmDialog.vue'
import Modal from '../../components/ui/Modal.vue'
import { Building2, Search, Loader2, Users, ChevronLeft, ChevronRight, Ban, CheckCircle, Trash2, Archive } from 'lucide-vue-next'

const toast = useToast()
const loading = ref(true)
const orgs = ref<Organization[]>([])
const total = ref(0)
const page = ref(1)
const limit = 20
const searchQuery = ref('')
const statusFilter = ref('')
const deleteConfirm = ref<{ show: boolean; orgId: string; name: string }>({ show: false, orgId: '', name: '' })
const showOrgDetail = ref(false)
const selectedOrg = ref<Organization | null>(null)

const filtered = computed(() => {
  let result = orgs.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(o => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q))
  }
  if (statusFilter.value) {
    result = result.filter(o => o.status === statusFilter.value)
  }
  return result
})

async function loadOrgs() {
  loading.value = true
  try {
    const data = await adminApi.platformListOrgs(page.value, limit)
    orgs.value = data.orgs
    total.value = data.total
  } catch (e: any) { toast.error(e.message) }
  finally { loading.value = false }
}

async function updateStatus(orgId: string, status: string) {
  try {
    await adminApi.platformUpdateOrgStatus(orgId, status)
    toast.success(`Organization ${status}`)
    loadOrgs()
  } catch (e: any) { toast.error(e.message) }
}

async function confirmDelete() {
  const orgId = deleteConfirm.value.orgId
  deleteConfirm.value.show = false
  try {
    await adminApi.platformDeleteOrg(orgId)
    toast.success('Organization deleted')
    loadOrgs()
  } catch (e: any) { toast.error(e.message) }
}

function promptDelete(org: Organization) {
  deleteConfirm.value = { show: true, orgId: org.id, name: org.name }
}

function viewOrg(org: Organization) {
  selectedOrg.value = org
  showOrgDetail.value = true
}

function nextPage() { if (page.value * limit < total.value) { page.value++; loadOrgs() } }
function prevPage() { if (page.value > 1) { page.value--; loadOrgs() } }

function formatDate(d: string): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

onMounted(loadOrgs)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Organizations</h1>
        <p class="text-sm text-muted-foreground mt-1">{{ total }} organization{{ total !== 1 ? 's' : '' }} on the platform</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-3 mb-4">
      <div class="relative flex-1 max-w-md">
        <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="searchQuery" type="text" class="pl-10" placeholder="Search organizations..." />
      </div>
      <Select v-model="statusFilter">
        <SelectTrigger class="w-36">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="loading" class="flex justify-center py-12"><Loader2 :size="20" class="animate-spin text-muted-foreground" /></div>

    <div v-else class="space-y-2">
      <!-- Org Cards (not table — avoids overflow issues) -->
      <div
        v-for="org in filtered" :key="org.id"
        class="bg-card border border-border rounded-xl p-4 flex items-center gap-4 cursor-pointer transition hover:border-accent/30"
        @click="viewOrg(org)"
      >
        <!-- Icon + Name -->
        <div class="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <Building2 :size="16" class="text-accent" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-sm font-semibold text-foreground">{{ org.name }}</span>
            <span :class="[
              'px-2 py-0.5 rounded-full text-[10px] font-medium',
              org.status === 'active' ? 'bg-green-500/15 text-green-400' :
              org.status === 'suspended' ? 'bg-red-500/15 text-red-400' :
              'bg-card text-muted-foreground'
            ]">{{ org.status }}</span>
          </div>
          <div class="flex items-center gap-4 text-xs text-muted-foreground">
            <span class="font-mono">@{{ org.slug }}</span>
            <span class="flex items-center gap-1"><Users :size="11" /> {{ org.memberCount || 0 }} members</span>
            <span>{{ formatDate(org.created_at) }}</span>
          </div>
        </div>

        <!-- Actions (stop propagation) -->
        <div class="flex items-center gap-1 shrink-0" @click.stop>
          <button
            v-if="org.status === 'suspended' || org.status === 'archived'"
            class="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition"
            @click="updateStatus(org.id, 'active')"
          ><CheckCircle :size="12" class="inline mr-0.5" /> Activate</button>
          <button
            v-if="org.status === 'active'"
            class="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition"
            @click="updateStatus(org.id, 'suspended')"
          ><Ban :size="12" class="inline mr-0.5" /> Suspend</button>
          <button
            v-if="org.status === 'active'"
            class="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary text-muted-foreground hover:bg-card transition"
            @click="updateStatus(org.id, 'archived')"
          ><Archive :size="12" class="inline mr-0.5" /> Archive</button>
          <button
            class="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
            @click="promptDelete(org)"
          ><Trash2 :size="12" class="inline mr-0.5" /> Delete</button>
        </div>
      </div>

      <div v-if="filtered.length === 0" class="bg-card border border-border rounded-xl px-4 py-12 text-center text-muted-foreground">
        No organizations found
      </div>

      <div v-if="total > limit" class="flex items-center justify-between px-4 py-3 border-t border-border">
        <span class="text-xs text-muted-foreground">Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" :disabled="page <= 1" @click="prevPage"><ChevronLeft :size="14" /></Button>
          <Button variant="ghost" size="sm" :disabled="page * limit >= total" @click="nextPage"><ChevronRight :size="14" /></Button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :show="deleteConfirm.show"
      title="Delete Organization"
      :message="`Delete &quot;${deleteConfirm.name}&quot; and all its data? This removes all members and cannot be undone.`"
      confirmText="Delete"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="deleteConfirm.show = false"
    />

    <!-- Org Detail Modal -->
    <Modal :show="showOrgDetail" :title="selectedOrg?.name || 'Organization'" size="lg" @close="showOrgDetail = false">
      <template v-if="selectedOrg">
        <div class="space-y-5">
          <!-- Org Info -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div class="bg-background rounded-lg p-3">
              <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Slug</div>
              <div class="text-sm font-medium text-foreground font-mono">@{{ selectedOrg.slug }}</div>
            </div>
            <div class="bg-background rounded-lg p-3">
              <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Status</div>
              <span :class="[
                'px-2 py-0.5 rounded-full text-[11px] font-medium',
                selectedOrg.status === 'active' ? 'bg-green-500/15 text-green-400' :
                selectedOrg.status === 'suspended' ? 'bg-red-500/15 text-red-400' :
                'bg-card text-muted-foreground'
              ]">{{ selectedOrg.status }}</span>
            </div>
            <div class="bg-background rounded-lg p-3">
              <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Members</div>
              <div class="text-sm font-medium text-foreground">{{ selectedOrg.memberCount || 0 }}</div>
            </div>
            <div class="bg-background rounded-lg p-3">
              <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Created</div>
              <div class="text-sm font-medium text-foreground">{{ formatDate(selectedOrg.created_at) }}</div>
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="flex gap-2 flex-wrap">
            <Button
              v-if="selectedOrg.status !== 'active'"
              size="sm"
              @click="updateStatus(selectedOrg.id, 'active'); selectedOrg.status = 'active'"
            ><CheckCircle :size="12" /> Activate</Button>
            <Button
              v-if="selectedOrg.status === 'active'"
              variant="secondary" size="sm" class="text-amber-400"
              @click="updateStatus(selectedOrg.id, 'suspended'); selectedOrg.status = 'suspended' as any"
            ><Ban :size="12" /> Suspend</Button>
            <Button
              v-if="selectedOrg.status === 'active'"
              variant="secondary" size="sm"
              @click="updateStatus(selectedOrg.id, 'archived'); selectedOrg.status = 'archived' as any"
            ><Archive :size="12" /> Archive</Button>
            <Button
              variant="ghost" size="sm" class="text-red-400"
              @click="showOrgDetail = false; promptDelete(selectedOrg)"
            ><Trash2 :size="12" /> Delete</Button>
          </div>

          <!-- Org Details -->
          <div class="text-xs text-muted-foreground">
            <p>Organization ID: <code class="text-muted-foreground font-mono">{{ selectedOrg.id }}</code></p>
          </div>
        </div>
      </template>
    </Modal>
  </div>
</template>
