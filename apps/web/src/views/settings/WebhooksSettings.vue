<script setup lang="ts">
import { ref } from 'vue'
import { webhooksApi } from '../../lib/api'
import { useToast } from '../../composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Modal from '../../components/ui/Modal.vue'
import ConfirmDialog from '../../components/ui/ConfirmDialog.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import Skeleton from '../../components/ui/Skeleton.vue'
import SlidePanel from '../../components/ui/SlidePanel.vue'
import {
  Webhook, Plus, Trash2, Copy, Check, Loader2, Zap, Send as SendIcon,
  Power, PowerOff, Pencil, Activity, Clock,
} from 'lucide-vue-next'

const toast = useToast()

interface WebhookEndpoint {
  id: string
  name: string
  url: string
  secret: string
  events: string
  enabled: number
  last_triggered_at: string | null
  failure_count: number
  created_at: string
}

interface WebhookLog {
  id: string
  event_type: string
  status: string
  status_code: number | null
  error: string | null
  duration_ms: number | null
  created_at: string
}

const webhooks = ref<WebhookEndpoint[]>([])
const loading = ref(false)
const showForm = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const testing = ref<string | null>(null)
const deleteConfirm = ref<{ show: boolean; id: string; name: string }>({ show: false, id: '', name: '' })

// Logs panel
const showLogs = ref(false)
const logsWebhookName = ref('')
const logs = ref<WebhookLog[]>([])
const logsLoading = ref(false)

// Secret display
const visibleSecret = ref<string | null>(null)
const secretCopied = ref(false)

const form = ref({
  name: '',
  url: '',
  events: ['email.sent', 'email.opened', 'email.clicked', 'email.bounced'] as string[],
})

const ALL_EVENTS = [
  { value: 'email.sent', label: 'Email Sent', description: 'When an email is delivered' },
  { value: 'email.opened', label: 'Email Opened', description: 'When a recipient opens' },
  { value: 'email.clicked', label: 'Email Clicked', description: 'When a link is clicked' },
  { value: 'email.bounced', label: 'Email Bounced', description: 'Hard or soft bounce' },
  { value: 'email.complained', label: 'Spam Complaint', description: 'Marked as spam' },
  { value: 'contact.unsubscribed', label: 'Unsubscribed', description: 'Contact opted out' },
  { value: 'contact.created', label: 'Contact Created', description: 'New contact added' },
  { value: 'contact.updated', label: 'Contact Updated', description: 'Contact data changed' },
  { value: 'campaign.completed', label: 'Campaign Completed', description: 'Campaign finished sending' },
]

async function fetchWebhooks() {
  loading.value = true
  try { webhooks.value = await webhooksApi.list() }
  catch { webhooks.value = [] }
  finally { loading.value = false }
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', url: '', events: ['email.sent', 'email.opened', 'email.clicked', 'email.bounced'] }
  showForm.value = true
}

function openEdit(wh: WebhookEndpoint) {
  editingId.value = wh.id
  form.value = {
    name: wh.name,
    url: wh.url,
    events: parseEvents(wh.events),
  }
  showForm.value = true
}

async function saveWebhook() {
  if (!form.value.name.trim() || !form.value.url.trim() || form.value.events.length === 0) return
  saving.value = true
  try {
    if (editingId.value) {
      await webhooksApi.update(editingId.value, form.value)
      toast.success('Webhook updated')
    } else {
      await webhooksApi.create(form.value)
      toast.success('Webhook created')
    }
    showForm.value = false
    await fetchWebhooks()
  } catch (e: any) {
    toast.error(e.message || 'Failed')
  } finally {
    saving.value = false
  }
}

async function toggleWebhook(wh: WebhookEndpoint) {
  try {
    await webhooksApi.toggle(wh.id, !wh.enabled)
    await fetchWebhooks()
  } catch (e: any) { toast.error(e.message || 'Failed') }
}

async function testWebhook(id: string) {
  testing.value = id
  try {
    await webhooksApi.test(id)
    toast.success('Test webhook sent')
  } catch (e: any) {
    toast.error(e.message || 'Test failed')
  } finally {
    testing.value = null
  }
}

async function confirmDelete() {
  const id = deleteConfirm.value.id
  deleteConfirm.value.show = false
  try {
    await webhooksApi.delete(id)
    webhooks.value = webhooks.value.filter(w => w.id !== id)
    toast.success('Webhook deleted')
  } catch (e: any) { toast.error(e.message || 'Failed') }
}

async function viewLogs(wh: WebhookEndpoint) {
  logsWebhookName.value = wh.name
  showLogs.value = true
  logsLoading.value = true
  try {
    const result = await webhooksApi.getLogs(wh.id)
    logs.value = result.logs || []
  } catch { logs.value = [] }
  finally { logsLoading.value = false }
}

function toggleEvent(event: string) {
  const idx = form.value.events.indexOf(event)
  if (idx >= 0) form.value.events.splice(idx, 1)
  else form.value.events.push(event)
}

function parseEvents(eventsJson: string): string[] {
  try { return JSON.parse(eventsJson) } catch { return [] }
}

function copySecret(secret: string) {
  navigator.clipboard.writeText(secret)
  secretCopied.value = true
  toast.success('Secret copied')
  setTimeout(() => { secretCopied.value = false }, 2000)
}

function formatDate(d: string | null) {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

fetchWebhooks()
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex justify-between items-start">
      <div>
        <h2 class="flex items-center gap-2.5 text-base font-semibold text-foreground mb-1">
          <Webhook :size="18" class="text-accent" /> Webhooks
        </h2>
        <p class="text-muted-foreground text-sm">Get notified via HTTP when events happen in Dispatch</p>
      </div>
      <Button @click="openCreate"><Plus :size="16" /> Add Endpoint</Button>
    </div>

    <!-- Loading -->
    <div v-if="loading">
      <Skeleton variant="card" :count="2" />
    </div>

    <!-- Empty -->
    <Card v-else-if="webhooks.length === 0">
      <EmptyState
        :icon="Zap"
        title="No webhooks configured"
        description="Create a webhook endpoint to receive real-time notifications for email events"
      >
        <template #actions>
          <Button @click="openCreate"><Plus :size="16" /> Add Endpoint</Button>
        </template>
      </EmptyState>
    </Card>

    <!-- Webhook Cards -->
    <div v-else class="flex flex-col gap-4">
      <Card v-for="wh in webhooks" :key="wh.id" class="transition-all hover:border-primary/20">
        <CardContent class="p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2.5 mb-1">
                <h3 class="text-sm font-semibold text-foreground">{{ wh.name }}</h3>
                <Badge :variant="wh.enabled ? 'default' : 'secondary'" class="text-[10px]">
                  {{ wh.enabled ? 'Active' : 'Disabled' }}
                </Badge>
                <Badge v-if="wh.failure_count > 0" variant="destructive" class="text-[10px]">
                  {{ wh.failure_count }} failures
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground font-mono truncate mb-2">{{ wh.url }}</p>
              <div class="flex flex-wrap gap-1.5">
                <Badge v-for="ev in parseEvents(wh.events)" :key="ev" variant="outline" class="text-[10px]">
                  {{ ev }}
                </Badge>
              </div>
              <div class="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span class="flex items-center gap-1"><Clock :size="11" /> Last: {{ formatDate(wh.last_triggered_at) }}</span>
                <span class="flex items-center gap-1"><Activity :size="11" /> Created: {{ formatDate(wh.created_at) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" title="Test" :disabled="testing === wh.id" @click="testWebhook(wh.id)">
                <Loader2 v-if="testing === wh.id" :size="14" class="animate-spin" />
                <SendIcon v-else :size="14" />
              </Button>
              <Button variant="ghost" size="sm" title="Logs" @click="viewLogs(wh)">
                <Activity :size="14" />
              </Button>
              <Button variant="ghost" size="sm" title="Edit" @click="openEdit(wh)">
                <Pencil :size="14" />
              </Button>
              <Button
                variant="ghost" size="sm"
                :title="wh.enabled ? 'Disable' : 'Enable'"
                @click="toggleWebhook(wh)"
              >
                <PowerOff v-if="wh.enabled" :size="14" class="text-warning" />
                <Power v-else :size="14" class="text-success" />
              </Button>
              <Button
                variant="ghost" size="sm"
                class="hover:text-danger hover:bg-danger/10"
                title="Delete"
                @click="deleteConfirm = { show: true, id: wh.id, name: wh.name }"
              >
                <Trash2 :size="14" />
              </Button>
            </div>
          </div>

          <!-- Secret (expandable) -->
          <div v-if="visibleSecret === wh.id" class="mt-3 pt-3 border-t border-border">
            <div class="flex items-center gap-2">
              <Label class="text-xs shrink-0">HMAC Secret:</Label>
              <code class="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded flex-1 truncate">{{ wh.secret }}</code>
              <Button variant="ghost" size="sm" @click="copySecret(wh.secret)">
                <Check v-if="secretCopied" :size="12" class="text-success" />
                <Copy v-else :size="12" />
              </Button>
            </div>
          </div>
          <button
            class="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none"
            @click="visibleSecret = visibleSecret === wh.id ? null : wh.id"
          >
            {{ visibleSecret === wh.id ? 'Hide secret' : 'Show signing secret' }}
          </button>
        </CardContent>
      </Card>
    </div>

    <!-- Payload Info -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm">Webhook payload format</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="bg-muted rounded-lg p-3">
          <pre class="text-xs font-mono text-foreground whitespace-pre-wrap">{{ JSON.stringify({ event: 'email.opened', timestamp: '2026-03-24T12:00:00Z', data: { email: 'user@example.com', campaign_id: '...', tracking_id: '...' } }, null, 2) }}</pre>
        </div>
        <p class="text-xs text-muted-foreground mt-2">Verify authenticity using the <code class="bg-muted px-1.5 py-0.5 rounded">X-Dispatch-Signature</code> header (HMAC-SHA256).</p>
      </CardContent>
    </Card>

    <!-- Create/Edit Modal -->
    <Modal :show="showForm" :title="editingId ? 'Edit Webhook' : 'New Webhook'" size="md" @close="showForm = false">
      <div class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <Label>Name *</Label>
          <Input v-model="form.name" placeholder="e.g. CRM Sync, Analytics Pipeline" />
        </div>

        <div class="flex flex-col gap-2">
          <Label>Endpoint URL *</Label>
          <Input v-model="form.url" type="url" placeholder="https://api.example.com/webhooks/dispatch" />
        </div>

        <div class="flex flex-col gap-2">
          <Label>Events *</Label>
          <p class="text-xs text-muted-foreground">Select which events trigger this webhook</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label
              v-for="ev in ALL_EVENTS"
              :key="ev.value"
              class="flex items-start gap-2.5 px-3 py-2.5 bg-muted/50 border border-border rounded-lg cursor-pointer hover:border-accent/30 transition-colors"
              :class="form.events.includes(ev.value) && 'border-accent/40 bg-accent/5'"
            >
              <Checkbox :checked="form.events.includes(ev.value)" @update:checked="toggleEvent(ev.value)" class="mt-0.5" />
              <div>
                <span class="text-sm font-medium">{{ ev.label }}</span>
                <p class="text-[11px] text-muted-foreground m-0">{{ ev.description }}</p>
              </div>
            </label>
          </div>
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="showForm = false">Cancel</Button>
        <Button :disabled="!form.name.trim() || !form.url.trim() || form.events.length === 0 || saving" @click="saveWebhook">
          <Loader2 v-if="saving" :size="16" class="animate-spin" />
          {{ editingId ? 'Update' : 'Create' }}
        </Button>
      </template>
    </Modal>

    <!-- Logs SlidePanel -->
    <SlidePanel :show="showLogs" :title="`Delivery Logs — ${logsWebhookName}`" size="lg" @close="showLogs = false">
      <div v-if="logsLoading" class="py-8 text-center text-muted-foreground text-sm">Loading...</div>
      <div v-else-if="logs.length === 0" class="py-8 text-center text-muted-foreground text-sm">No delivery logs yet</div>
      <Table v-else>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="log in logs" :key="log.id">
            <TableCell><Badge variant="outline" class="text-[10px]">{{ log.event_type }}</Badge></TableCell>
            <TableCell>
              <Badge :variant="log.status === 'success' ? 'default' : 'destructive'" class="text-[10px]">
                {{ log.status }}
              </Badge>
            </TableCell>
            <TableCell class="text-xs text-muted-foreground">{{ log.status_code || '-' }}</TableCell>
            <TableCell class="text-xs text-muted-foreground">{{ log.duration_ms ? `${log.duration_ms}ms` : '-' }}</TableCell>
            <TableCell class="text-xs text-muted-foreground">{{ formatDate(log.created_at) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </SlidePanel>

    <ConfirmDialog
      :show="deleteConfirm.show"
      title="Delete Webhook"
      :message="`Delete '${deleteConfirm.name}'? This will stop all event deliveries to this endpoint.`"
      confirmText="Delete"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="deleteConfirm.show = false"
    />
  </div>
</template>
