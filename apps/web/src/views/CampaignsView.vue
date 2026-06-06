<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import PageHeader from '../components/ui/PageHeader.vue'
import AppTabs from '../components/ui/AppTabs.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import AppPagination from '../components/ui/AppPagination.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import Modal from '../components/ui/Modal.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import ProgressBar from '../components/ui/ProgressBar.vue'
import SearchInput from '../components/ui/SearchInput.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { campaignsApi, templatesApi, contactsApi } from '../lib/api'
import type { Campaign as CampaignType } from '../lib/api'
import { useToast } from '../composables/useToast'
import {
  Mail,
  Users,
  Send,
  Plus,
  Pencil,
  Copy,
  Pause,
  X,
  Archive,
  Trash2,
  Loader2,
  Inbox,
  Eye,
  MousePointer,
  Clock,
  Rocket,
  RefreshCw,
  MoreHorizontal,
} from 'lucide-vue-next'
const toast = useToast()
// ============================================================================
// Types
// ============================================================================
interface CampaignForm {
  name: string
  type: string
  subject: string
  from_name: string
  from_email: string
  reply_to: string
  template_id: string
  contact_list_id: string
  batch_size: number
  email_delay: number
  batch_delay: number
}
// ============================================================================
// State
// ============================================================================
const campaigns = ref<CampaignType[]>([])
const loading = ref(false)
const error = ref('')
const statusFilter = ref('all')
const searchQuery = ref('')
const currentPage = ref(1)
const totalPages = ref(1)
const totalCount = ref(0)
const limit = 20
const showCreateModal = ref(false)
const saving = ref(false)
const actionLoading = ref<string | null>(null)
const form = ref<CampaignForm>({
  name: '',
  type: 'one_time',
  subject: '',
  from_name: '',
  from_email: '',
  reply_to: '',
  template_id: '',
  contact_list_id: '',
  batch_size: 50,
  email_delay: 1000,
  batch_delay: 5000,
})
const templates = ref<{ id: string; name: string }[]>([])
const contactLists = ref<{ id: string; name: string; contact_count: number }[]>([])
const statusTabs = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'sending', label: 'Sending' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
]

const deleteConfirm = ref<{ show: boolean; id: string }>({ show: false, id: '' })
const openMenuId = ref<string | null>(null)
// ============================================================================
// Data Loading
// ============================================================================
async function fetchCampaigns() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, any> = { page: currentPage.value, limit }
    if (statusFilter.value !== 'all') params.status = statusFilter.value
    if (searchQuery.value) params.search = searchQuery.value
    const data = await campaignsApi.list(params)
    campaigns.value = data.campaigns || []
    totalPages.value = data.pagination?.totalPages || 1
    totalCount.value = data.pagination?.total || campaigns.value.length
  } catch (err: any) {
    error.value = err.message
    campaigns.value = []
  } finally {
    loading.value = false
  }
}
async function loadFormData() {
  try {
    const [tplRes, listRes] = await Promise.all([
      templatesApi.list().catch(() => ({ templates: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } })),
      contactsApi.getLists().catch(() => []),
    ])
    templates.value = (tplRes as any).templates || []
    contactLists.value = Array.isArray(listRes) ? listRes : []
  } catch {
    /* silently ignore - dropdowns will be empty */
  }
}
// ============================================================================
// Actions
// ============================================================================
async function createCampaign() {
  saving.value = true
  try {
    await campaignsApi.create(form.value as any)
    showCreateModal.value = false
    resetForm()
    await fetchCampaigns()
  } catch (err: any) {
    toast.error(`Failed to create campaign: ${err.message}`)
  } finally {
    saving.value = false
  }
}
function setStatusFilter(value: string) {
  statusFilter.value = value
  currentPage.value = 1
}

async function campaignAction(id: string, action: string) {
  openMenuId.value = null
  actionLoading.value = `${id}-${action}`
  try {
    const actionMap: Record<string, (id: string) => Promise<any>> = {
      launch: campaignsApi.launch,
      pause: campaignsApi.pause,
      cancel: campaignsApi.cancel,
      clone: campaignsApi.clone,
      archive: campaignsApi.archive,
    }
    const fn = actionMap[action]
    if (fn) {
      await fn(id)
    }
    await fetchCampaigns()
  } catch (err: any) {
    toast.error(`Failed to ${action} campaign: ${err.message}`)
  } finally {
    actionLoading.value = null
  }
}
function promptDelete(id: string) {
  openMenuId.value = null
  deleteConfirm.value = { show: true, id }
}

async function confirmDelete() {
  const id = deleteConfirm.value.id
  deleteConfirm.value = { show: false, id: '' }
  actionLoading.value = `${id}-delete`
  try {
    await campaignsApi.delete(id)
    await fetchCampaigns()
  } catch (err: any) {
    toast.error(`Failed to delete campaign: ${err.message}`)
  } finally {
    actionLoading.value = null
  }
}
function resetForm() {
  form.value = {
    name: '',
    type: 'one_time',
    subject: '',
    from_name: '',
    from_email: '',
    reply_to: '',
    template_id: '',
    contact_list_id: '',
    batch_size: 50,
    email_delay: 1000,
    batch_delay: 5000,
  }
}
function openCreateModal() {
  resetForm()
  loadFormData()
  showCreateModal.value = true
}
// ============================================================================
// Dropdown Menu
// ============================================================================
function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('[data-menu-trigger]') && !target.closest('[data-menu-panel]')) {
    openMenuId.value = null
  }
}
onMounted(() => {
  document.addEventListener('click', handleOutsideClick)
  fetchCampaigns()
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
})
// ============================================================================
// Helpers
// ============================================================================
function formatDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function pct(value: number, total: number): string {
  if (!total) return '0'
  return Math.round((value / total) * 100).toString()
}
function changePage(p: number) {
  currentPage.value = p
}
// ============================================================================
// Watchers & Init
// ============================================================================
watch([statusFilter, currentPage], () => fetchCampaigns())
watch(searchQuery, () => {
  currentPage.value = 1
  fetchCampaigns()
})
</script>
<template>
  <div>
    <PageHeader title="Campaigns" subtitle="Create and manage email campaigns">
      <template #actions>
        <Button @click="openCreateModal"><Plus :size="16" /> New Campaign</Button>
      </template>
    </PageHeader>

    <!-- Filter Row -->
    <div class="flex items-center gap-2 mb-6 flex-wrap">
      <AppTabs
        :tabs="statusTabs"
        :model-value="statusFilter"
        variant="pill"
        @update:model-value="setStatusFilter"
      />
      <SearchInput v-model="searchQuery" placeholder="Search campaigns..." class="ml-auto w-60" />
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-col gap-4">
      <Skeleton variant="card" :count="3" />
    </div>

    <!-- Error -->
    <AlertBanner v-else-if="error" type="error">
      {{ error }}
      <Button variant="ghost" size="sm" class="ml-2" @click="fetchCampaigns()"><RefreshCw :size="14" /> Retry</Button>
    </AlertBanner>

    <!-- Empty -->
    <EmptyState
      v-else-if="campaigns.length === 0"
      :icon="Inbox"
      title="No campaigns found"
      description="Create your first campaign to get started"
    />

    <!-- Campaign Cards -->
    <div v-else class="flex flex-col gap-3">
      <div
        v-for="c in campaigns"
        :key="c.id"
        class="group relative bg-card border border-border rounded-lg transition-all duration-200 hover:border-accent/50 hover:shadow-sm"
      >
        <div class="p-5">
          <!-- Top Row: Name + Status + Actions Trigger -->
          <div class="flex items-start justify-between gap-4 mb-2">
            <div class="flex items-center gap-3 min-w-0">
              <router-link
                :to="`/campaigns/${c.id}`"
                class="text-[15px] font-semibold text-foreground no-underline hover:text-accent transition-colors truncate"
              >{{ c.name }}</router-link>
              <StatusBadge :status="c.status" type="campaign" />
            </div>

            <!-- Actions Dropdown (radix-vue with portal — no overflow issues) -->
            <div class="shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="outline" size="sm" class="h-8 w-8 p-0" :disabled="!!actionLoading">
                    <Loader2 v-if="actionLoading && actionLoading.startsWith(c.id)" :size="15" class="spin" />
                    <MoreHorizontal v-else :size="15" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @select="campaignAction(c.id, 'edit')">
                    <Pencil :size="14" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="campaignAction(c.id, 'clone')">
                    <Copy :size="14" /> Clone
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="c.status === 'draft' || c.status === 'scheduled'" @select="campaignAction(c.id, 'launch')">
                    <Rocket :size="14" /> Launch
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="c.status === 'sending'" @select="campaignAction(c.id, 'pause')">
                    <Pause :size="14" /> Pause
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="c.status === 'sending' || c.status === 'scheduled'" @select="campaignAction(c.id, 'cancel')">
                    <X :size="14" /> Cancel
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="c.status === 'completed' || c.status === 'cancelled'" @select="campaignAction(c.id, 'archive')">
                    <Archive :size="14" /> Archive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem class="text-danger" @select="promptDelete(c.id)">
                    <Trash2 :size="14" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <!-- Subject + Meta -->
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span class="inline-flex items-center gap-1.5"><Mail :size="13" /> {{ c.subject || 'No subject' }}</span>
            <span class="inline-flex items-center gap-1.5"><Users :size="13" /> {{ c.total_recipients }} recipients</span>
            <span class="inline-flex items-center gap-1.5"><Clock :size="13" /> {{ formatDate(c.created_at) }}</span>
            <span v-if="c.scheduled_at" class="inline-flex items-center gap-1.5 text-warning">
              <Clock :size="13" /> Scheduled: {{ formatDate(c.scheduled_at) }}
            </span>
          </div>

          <!-- Stats Bar -->
          <div
            v-if="c.sent_count > 0 || c.status !== 'draft'"
            class="flex items-center gap-5 pt-4 mt-4 border-t border-border text-[13px] flex-wrap"
          >
            <div class="inline-flex items-center gap-1 text-muted-foreground">
              <Send :size="13" />
              <span class="font-semibold text-foreground">{{ c.sent_count }}</span>
              <span>sent</span>
              <span v-if="c.total_recipients" class="text-muted-foreground text-xs">({{ pct(c.sent_count, c.total_recipients) }}%)</span>
            </div>
            <div class="inline-flex items-center gap-1 text-blue-500">
              <Eye :size="13" />
              <span class="font-semibold">{{ c.open_count }}</span>
              <span class="text-muted-foreground">opened</span>
              <span v-if="c.sent_count" class="text-muted-foreground text-xs">({{ pct(c.open_count, c.sent_count) }}%)</span>
            </div>
            <div class="inline-flex items-center gap-1 text-accent">
              <MousePointer :size="13" />
              <span class="font-semibold">{{ c.click_count }}</span>
              <span class="text-muted-foreground">clicked</span>
              <span v-if="c.sent_count" class="text-muted-foreground text-xs">({{ pct(c.click_count, c.sent_count) }}%)</span>
            </div>
            <ProgressBar
              v-if="c.total_recipients"
              :value="Number(pct(c.sent_count, c.total_recipients))"
              variant="accent"
              size="sm"
              class="flex-1 min-w-20"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <AppPagination
      v-if="totalPages > 1"
      class="mt-6"
      :page="currentPage"
      :total-pages="totalPages"
      :total="totalCount"
      :showing="campaigns.length"
      @update:page="changePage"
    />

    <!-- Delete Confirm Dialog -->
    <ConfirmDialog
      :show="deleteConfirm.show"
      title="Delete Campaign"
      message="Are you sure you want to delete this campaign? This action cannot be undone."
      confirm-text="Delete"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="deleteConfirm = { show: false, id: '' }"
    />

    <!-- Create Campaign Modal -->
    <Modal :show="showCreateModal" title="New Campaign" size="lg" @close="showCreateModal = false">
      <form @submit.prevent="createCampaign" class="space-y-5">
        <div class="grid grid-cols-2 gap-x-4 gap-y-5">
          <div class="flex flex-col gap-2 col-span-2">
            <Label>Campaign Name *</Label>
            <Input v-model="form.name" type="text" required placeholder="e.g. March Newsletter" />
          </div>
          <div class="flex flex-col gap-2">
            <Label>Type</Label>
            <Select v-model="form.type">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="one_time">One-time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-2">
            <Label>Subject *</Label>
            <Input v-model="form.subject" type="text" required placeholder="Email subject line" />
          </div>
          <div class="flex flex-col gap-2">
            <Label>From Name</Label>
            <Input v-model="form.from_name" type="text" placeholder="Sender name" />
          </div>
          <div class="flex flex-col gap-2">
            <Label>From Email *</Label>
            <Input
              v-model="form.from_email"
              type="email"
              required
              placeholder="sender@example.com"
            />
          </div>
          <div class="flex flex-col gap-2 col-span-2">
            <Label>Reply-To</Label>
            <Input
              v-model="form.reply_to"
              type="email"
              placeholder="reply@example.com (optional)"
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label>Template</Label>
            <Select v-model="form.template_id">
              <SelectTrigger><SelectValue placeholder="-- No template --" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">-- No template --</SelectItem>
                <SelectItem v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-2">
            <Label>Contact List</Label>
            <Select v-model="form.contact_list_id">
              <SelectTrigger><SelectValue placeholder="-- Select list --" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">-- Select list --</SelectItem>
                <SelectItem v-for="l in contactLists" :key="l.id" :value="l.id">
                  {{ l.name }} ({{ l.contact_count }})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <fieldset class="border border-border rounded-lg p-4">
          <legend class="text-[13px] font-semibold text-muted-foreground px-2">Batch Settings</legend>
          <div class="grid grid-cols-3 gap-4">
            <div class="flex flex-col gap-2">
              <Label>Batch Size</Label>
              <Input v-model="form.batch_size" type="number" min="1" max="500" />
            </div>
            <div class="flex flex-col gap-2">
              <Label>Email Delay (ms)</Label>
              <Input v-model="form.email_delay" type="number" min="0" step="100" />
            </div>
            <div class="flex flex-col gap-2">
              <Label>Batch Delay (ms)</Label>
              <Input v-model="form.batch_delay" type="number" min="0" step="1000" />
            </div>
          </div>
        </fieldset>
      </form>
      <template #footer>
        <Button variant="ghost" @click="showCreateModal = false">Cancel</Button>
        <Button :disabled="saving" @click="createCampaign">
          <Loader2 v-if="saving" :size="16" class="spin" /> {{ saving ? 'Creating...' : 'Create Campaign' }}
        </Button>
      </template>
    </Modal>
  </div>
</template>
