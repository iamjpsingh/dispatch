<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/vue-query'
import { useApiQuery, useApiMutation } from '../composables/useApiQuery'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import SlidePanel from '../components/ui/SlidePanel.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import Modal from '../components/ui/Modal.vue'
import StatCard from '../components/ui/StatCard.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import AppTabs from '../components/ui/AppTabs.vue'
import SearchInput from '../components/ui/SearchInput.vue'
import { whatsappApi } from '../lib/api'
import type { WhatsAppConfig, WhatsAppConfigInput, WhatsAppTemplate } from '../lib/api'
import { useToast } from '../composables/useToast'
import {
  Plus, Pencil, Trash2, Send, RefreshCw, MessageCircle, Smartphone, Loader2,
  Eye, EyeOff, Copy, FileText, CheckCircle, Clock, XCircle, Megaphone, Shield, Key,
  Phone, Globe, Hash, BarChart3,
} from 'lucide-vue-next'

const toast = useToast()
const queryClient = useQueryClient()

// ============================================================================
// Schemas
// ============================================================================

const ConfigFormSchema = z.object({
  name: z.string().min(1, 'Account name is required'),
  phone_number_id: z.string().min(1, 'Phone Number ID is required'),
  access_token: z.string(),
  business_account_id: z.string().optional(),
  phone_display: z.string().optional(),
  daily_limit: z.number().int().min(1).max(100000).default(1000),
})

// ============================================================================
// State
// ============================================================================

const activeTab = ref('accounts')
const tabs = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'templates', label: 'Templates' },
  { key: 'messages', label: 'Messages' },
]
const selectedConfigId = ref('')
const templateSearch = ref('')

// Config editor
const showConfigEditor = ref(false)
const editingConfigId = ref<string | null>(null)
const configForm = ref<WhatsAppConfigInput>({
  name: '', provider: 'meta', phone_number_id: '',
  business_account_id: '', access_token: '', phone_display: '', daily_limit: 1000,
})
const showToken = ref(false)
const formErrors = ref<Record<string, string>>({})

// Template creator
const showTemplateCreator = ref(false)
const templateForm = ref({
  name: '',
  language: 'en',
  category: 'MARKETING' as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
  headerText: '',
  bodyText: '',
  footerText: '',
  buttons: [] as { type: string; text: string; url?: string; phone_number?: string }[],
})
const creatingTemplate = ref(false)

// Send modal
const showSendModal = ref(false)
const sendForm = ref({ phone: '', templateName: '', language: 'en', params: [] as string[] })
const sendTemplateBody = ref('')

// Template detail modal
const showTemplateDetail = ref(false)
const detailTemplate = ref<WhatsAppTemplate | null>(null)

// Delete
const deleteConfirm = ref<{ show: boolean; type: 'config' | 'template'; id: string }>({ show: false, type: 'config', id: '' })

// ============================================================================
// Queries
// ============================================================================

const { data: configs, isLoading: loadingConfigs } = useApiQuery(
  ['wa-configs'],
  () => whatsappApi.getConfigs(),
)

const { data: templates, isLoading: loadingTemplates } = useApiQuery(
  computed(() => ['wa-templates', selectedConfigId.value]),
  () => whatsappApi.getTemplates(selectedConfigId.value),
  { enabled: computed(() => !!selectedConfigId.value) }
)

const { data: messagesData } = useApiQuery(
  computed(() => ['wa-messages', selectedConfigId.value]),
  () => whatsappApi.getMessages({ configId: selectedConfigId.value || undefined, limit: 100 }),
)

const { data: stats } = useApiQuery(
  computed(() => ['wa-stats', selectedConfigId.value]),
  () => whatsappApi.getStats(selectedConfigId.value || undefined),
)

// ============================================================================
// Mutations
// ============================================================================

const syncMutation = useApiMutation(
  (configId: string) => whatsappApi.syncTemplates(configId),
  { invalidate: [['wa-templates']], success: 'Templates synced from Meta' }
)

const deleteMutation = useApiMutation(
  async ({ type, id }: { type: 'config' | 'template'; id: string }) => {
    if (type === 'config') await whatsappApi.deleteConfig(id)
    else await whatsappApi.deleteTemplate(id)
  },
  { invalidate: [['wa-configs'], ['wa-templates']], success: 'Deleted successfully' }
)

const sendMutation = useApiMutation(
  async (input: { configId: string; phone: string; templateName: string; language: string; components?: any[] }) => {
    await whatsappApi.sendTemplate(input.configId, input.phone, input.templateName, input.language, input.components)
  },
  { invalidate: [['wa-messages'], ['wa-stats']], success: 'Message sent' }
)

// ============================================================================
// Computed
// ============================================================================

const configsList = computed(() => configs.value || [])
const templatesList = computed(() => {
  const list = templates.value || []
  if (!templateSearch.value.trim()) return list
  const q = templateSearch.value.toLowerCase()
  return list.filter(t =>
    t.meta_template_name.toLowerCase().includes(q) ||
    (t.body_text || '').toLowerCase().includes(q) ||
    t.category.toLowerCase().includes(q)
  )
})
const messagesList = computed(() => messagesData.value?.messages || [])

const templateCounts = computed(() => {
  const all = templates.value || []
  return {
    total: all.length,
    approved: all.filter(t => t.status === 'APPROVED').length,
    pending: all.filter(t => t.status === 'PENDING').length,
    rejected: all.filter(t => t.status === 'REJECTED').length,
  }
})

const templateParams = computed(() => {
  const matches = sendTemplateBody.value.match(/\{\{(\d+)\}\}/g)
  if (!matches) return []
  return [...new Set(matches)].sort()
})

// ============================================================================
// Handlers
// ============================================================================

watch(configsList, (list) => {
  if (list.length && !selectedConfigId.value) {
    selectedConfigId.value = list[0]?.id ?? ''
  }
}, { immediate: true })

function openAddConfig() {
  configForm.value = { name: '', provider: 'meta', phone_number_id: '', business_account_id: '', access_token: '', phone_display: '', daily_limit: 1000 }
  editingConfigId.value = null
  showToken.value = false
  formErrors.value = {}
  showConfigEditor.value = true
}

function openEditConfig(cfg: WhatsAppConfig) {
  configForm.value = {
    name: cfg.name, provider: cfg.provider, phone_number_id: cfg.phone_number_id,
    business_account_id: cfg.business_account_id || '', access_token: '',
    phone_display: cfg.phone_display || '', daily_limit: cfg.daily_limit,
  }
  editingConfigId.value = cfg.id
  showToken.value = false
  formErrors.value = {}
  showConfigEditor.value = true
}

async function saveConfig() {
  formErrors.value = {}
  const schema = editingConfigId.value
    ? ConfigFormSchema.extend({ access_token: z.string().optional() })
    : ConfigFormSchema.extend({ access_token: z.string().min(1, 'Access Token is required') })

  const result = schema.safeParse(configForm.value)
  if (!result.success) {
    for (const issue of result.error.issues) {
      formErrors.value[issue.path[0] as string] = issue.message
    }
    return
  }

  try {
    if (editingConfigId.value) {
      await whatsappApi.updateConfig(editingConfigId.value, configForm.value)
      toast.success('Account updated')
    } else {
      await whatsappApi.createConfig(configForm.value)
      toast.success('WhatsApp account connected')
    }
    showConfigEditor.value = false
    queryClient.invalidateQueries({ queryKey: ['wa-configs'] })
  } catch (err: any) {
    toast.error(err.message)
  }
}

// Template Creator
function openTemplateCreator() {
  templateForm.value = { name: '', language: 'en', category: 'MARKETING', headerText: '', bodyText: '', footerText: '', buttons: [] }
  showTemplateCreator.value = true
}

function addButton(type: string) {
  if (templateForm.value.buttons.length >= 3) return
  templateForm.value.buttons.push({
    type,
    text: '',
    ...(type === 'URL' ? { url: '' } : {}),
    ...(type === 'PHONE_NUMBER' ? { phone_number: '' } : {}),
  })
}

function removeButton(index: number) {
  templateForm.value.buttons.splice(index, 1)
}

async function createTemplate() {
  if (!selectedConfigId.value) { toast.error('Select an account first'); return }
  if (!templateForm.value.name.trim()) { toast.error('Template name is required'); return }
  if (!templateForm.value.bodyText.trim()) { toast.error('Body text is required'); return }

  creatingTemplate.value = true
  try {
    const components: any[] = []

    if (templateForm.value.headerText.trim()) {
      components.push({ type: 'HEADER', format: 'TEXT', text: templateForm.value.headerText })
    }

    components.push({ type: 'BODY', text: templateForm.value.bodyText })

    if (templateForm.value.footerText.trim()) {
      components.push({ type: 'FOOTER', text: templateForm.value.footerText })
    }

    if (templateForm.value.buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: templateForm.value.buttons.map(b => ({
          type: b.type,
          text: b.text,
          ...(b.url ? { url: b.url } : {}),
          ...(b.phone_number ? { phone_number: b.phone_number } : {}),
        })),
      })
    }

    await whatsappApi.createTemplate({
      config_id: selectedConfigId.value,
      name: templateForm.value.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      language: templateForm.value.language,
      category: templateForm.value.category,
      components,
    })

    toast.success('Template submitted to Meta for approval')
    showTemplateCreator.value = false
    queryClient.invalidateQueries({ queryKey: ['wa-templates'] })
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    creatingTemplate.value = false
  }
}

// Send
function openSendModal(tpl: WhatsAppTemplate) {
  sendForm.value = { phone: '', templateName: tpl.meta_template_name, language: tpl.language, params: [] }
  sendTemplateBody.value = tpl.body_text || ''
  const count = (tpl.body_text || '').match(/\{\{(\d+)\}\}/g)?.length || 0
  sendForm.value.params = Array(count).fill('')
  showSendModal.value = true
}

async function sendMessage() {
  if (!sendForm.value.phone || sendForm.value.phone.length < 7) {
    toast.error('Enter a valid phone number with country code')
    return
  }

  const components = sendForm.value.params.length ? [{
    type: 'body',
    parameters: sendForm.value.params.map(p => ({ type: 'text', text: p })),
  }] : undefined

  await sendMutation.mutateAsync({
    configId: selectedConfigId.value,
    phone: sendForm.value.phone,
    templateName: sendForm.value.templateName,
    language: sendForm.value.language,
    components,
  })
  showSendModal.value = false
}

function openTemplateDetail(tpl: WhatsAppTemplate) {
  detailTemplate.value = tpl
  showTemplateDetail.value = true
}

function getComponents(tpl: WhatsAppTemplate): any[] {
  try { return JSON.parse(tpl.components_json || '[]') } catch { return [] }
}

function confirmDelete() {
  const { type, id } = deleteConfirm.value
  deleteConfirm.value.show = false
  deleteMutation.mutate({ type, id })
}

function statusColor(status: string): string {
  switch (status) {
    case 'APPROVED': case 'active': case 'delivered': case 'read': case 'sent': return 'bg-success/15 text-success'
    case 'PENDING': case 'queued': return 'bg-warning/15 text-warning'
    case 'REJECTED': case 'DISABLED': case 'error': case 'failed': return 'bg-danger/15 text-danger'
    case 'PAUSED': case 'paused': return 'bg-muted text-muted-foreground'
    default: return 'bg-muted text-muted-foreground'
  }
}

function categoryIcon(cat: string) {
  switch (cat) {
    case 'MARKETING': return Megaphone
    case 'UTILITY': return Key
    case 'AUTHENTICATION': return Shield
    default: return FileText
  }
}

function formatDate(d: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function copyText(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text)
  toast.success(label)
}

const languages = [
  { code: 'en', label: 'English' }, { code: 'en_US', label: 'English (US)' },
  { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' }, { code: 'pt_BR', label: 'Portuguese (BR)' },
  { code: 'hi', label: 'Hindi' }, { code: 'ar', label: 'Arabic' },
  { code: 'id', label: 'Indonesian' }, { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' }, { code: 'ko', label: 'Korean' },
  { code: 'zh_CN', label: 'Chinese (CN)' }, { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' }, { code: 'nl', label: 'Dutch' },
]
</script>

<template>
  <div>
    <PageHeader title="WhatsApp" subtitle="WhatsApp Business API — accounts, templates, and messaging">
      <template #actions>
        <Button variant="secondary" @click="openAddConfig"><Plus :size="16" /> Connect Account</Button>
      </template>
    </PageHeader>

    <!-- Stats row -->
    <div v-if="stats && stats.total_messages > 0" class="grid grid-cols-4 max-md:grid-cols-2 gap-3 mb-5">
      <StatCard :icon="Send" :value="stats.sent" label="Sent" color="accent" />
      <StatCard :icon="CheckCircle" :value="`${stats.delivered} (${stats.delivery_rate}%)`" label="Delivered" color="success" />
      <StatCard :icon="Eye" :value="`${stats.read} (${stats.read_rate}%)`" label="Read" color="info" />
      <StatCard :icon="XCircle" :value="stats.failed" label="Failed" color="danger" />
    </div>

    <!-- Tabs -->
    <AppTabs :tabs="tabs" v-model="activeTab" variant="pill" class="mb-5" />

    <!-- ================================================================ -->
    <!-- ACCOUNTS TAB -->
    <!-- ================================================================ -->
    <div v-if="activeTab === 'accounts'">
      <div v-if="loadingConfigs" class="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
        <Skeleton variant="card" :count="3" />
      </div>

      <div v-else-if="configsList.length === 0" class="bg-card border border-border rounded-xl">
        <EmptyState :icon="MessageCircle" title="No WhatsApp accounts" description="Connect your WhatsApp Business account to start sending messages">
          <template #actions>
            <Button @click="openAddConfig"><Plus :size="16" /> Connect Account</Button>
          </template>
        </EmptyState>
      </div>

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] max-md:grid-cols-1 gap-4">
        <div v-for="cfg in configsList" :key="cfg.id" class="bg-card border border-border rounded-xl p-5 flex flex-col gap-3 transition-all hover:border-primary/25 hover:shadow-sm">
          <!-- Header -->
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3 min-w-0">
              <div class="flex items-center justify-center shrink-0 w-10 h-10 rounded-lg bg-[#25d366]/10">
                <MessageCircle :size="18" class="text-[#25d366]" />
              </div>
              <div class="min-w-0">
                <h3 class="text-sm font-semibold text-foreground truncate m-0">{{ cfg.name }}</h3>
                <p class="text-xs text-muted-foreground mt-0.5 m-0 flex items-center gap-1">
                  <Smartphone :size="11" /> {{ cfg.phone_display || cfg.phone_number_id }}
                </p>
              </div>
            </div>
            <span :class="['shrink-0 px-2.5 py-0.5 text-xs font-semibold rounded-full', statusColor(cfg.status)]">{{ cfg.status }}</span>
          </div>

          <!-- Info grid -->
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="bg-secondary rounded-md px-2.5 py-2 text-center">
              <div class="font-semibold text-foreground">{{ cfg.provider }}</div>
              <div class="text-muted-foreground">Provider</div>
            </div>
            <div class="bg-secondary rounded-md px-2.5 py-2 text-center">
              <div class="font-semibold text-foreground">{{ cfg.sent_today }}</div>
              <div class="text-muted-foreground">Sent Today</div>
            </div>
            <div class="bg-secondary rounded-md px-2.5 py-2 text-center">
              <div class="font-semibold text-foreground">{{ cfg.daily_limit }}</div>
              <div class="text-muted-foreground">Daily Limit</div>
            </div>
          </div>

          <!-- Webhook token -->
          <div v-if="cfg.webhook_verify_token" class="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
            <Key :size="12" class="text-muted-foreground shrink-0" />
            <span class="text-[11px] text-muted-foreground truncate flex-1 font-mono">{{ cfg.webhook_verify_token.substring(0, 24) }}...</span>
            <button class="text-muted-foreground hover:text-accent shrink-0 cursor-pointer" @click="copyText(cfg.webhook_verify_token!, 'Verify token copied')"><Copy :size="11" /></button>
          </div>

          <!-- Webhook URL hint -->
          <div class="text-[10px] text-muted-foreground">
            Webhook URL: <span class="font-mono text-accent/70">{{ window.location.origin }}/api/whatsapp/webhook</span>
          </div>

          <!-- Actions -->
          <div class="flex justify-between items-center pt-3 border-t border-border mt-auto">
            <div class="flex gap-1">
              <Button variant="ghost" size="sm" title="Edit" @click="openEditConfig(cfg)"><Pencil :size="14" /></Button>
              <Button variant="ghost" size="sm" title="View Templates" @click="selectedConfigId = cfg.id; activeTab = 'templates'"><FileText :size="14" /></Button>
            </div>
            <Button variant="ghost" size="sm" class="text-danger" title="Delete" @click="deleteConfirm = { show: true, type: 'config', id: cfg.id }"><Trash2 :size="14" /></Button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- TEMPLATES TAB -->
    <!-- ================================================================ -->
    <div v-if="activeTab === 'templates'">
      <!-- Toolbar -->
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <Select v-model="selectedConfigId" class="w-56">
          <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="cfg in configsList" :key="cfg.id" :value="cfg.id">{{ cfg.name }}</SelectItem>
          </SelectContent>
        </Select>

        <div class="flex-1" />

        <SearchInput v-model="templateSearch" placeholder="Search templates..." class="w-52" :debounce="200" />

        <Button variant="secondary" size="sm" :disabled="!selectedConfigId || syncMutation.isPending.value" @click="syncMutation.mutate(selectedConfigId)">
          <RefreshCw :size="14" :class="{ 'animate-spin': syncMutation.isPending.value }" /> Sync
        </Button>
        <Button size="sm" :disabled="!selectedConfigId" @click="openTemplateCreator">
          <Plus :size="14" /> Create Template
        </Button>
      </div>

      <!-- Template status counts -->
      <div v-if="templateCounts.total > 0" class="flex gap-4 mb-4 text-xs">
        <span class="text-muted-foreground">{{ templateCounts.total }} templates</span>
        <span class="text-success">{{ templateCounts.approved }} approved</span>
        <span v-if="templateCounts.pending" class="text-warning">{{ templateCounts.pending }} pending</span>
        <span v-if="templateCounts.rejected" class="text-danger">{{ templateCounts.rejected }} rejected</span>
      </div>

      <div v-if="!selectedConfigId" class="text-sm text-muted-foreground py-8 text-center">Select an account to view templates</div>

      <div v-else-if="loadingTemplates" class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
        <Skeleton variant="card" :count="4" />
      </div>

      <div v-else-if="templatesList.length === 0" class="bg-card border border-border rounded-xl">
        <EmptyState :icon="FileText" title="No templates" description="Create a new template or sync existing ones from Meta Business Manager">
          <template #actions>
            <div class="flex gap-2">
              <Button variant="secondary" :disabled="syncMutation.isPending.value" @click="syncMutation.mutate(selectedConfigId)">
                <RefreshCw :size="16" /> Sync from Meta
              </Button>
              <Button @click="openTemplateCreator">
                <Plus :size="16" /> Create Template
              </Button>
            </div>
          </template>
        </EmptyState>
      </div>

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] max-md:grid-cols-1 gap-3">
        <div
          v-for="tpl in templatesList"
          :key="tpl.id"
          class="bg-card border border-border rounded-xl p-4 flex flex-col gap-2.5 hover:border-primary/25 transition-all cursor-pointer"
          @click="openTemplateDetail(tpl)"
        >
          <!-- Header row -->
          <div class="flex justify-between items-start gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="flex items-center justify-center shrink-0 w-8 h-8 rounded-md bg-secondary">
                <component :is="categoryIcon(tpl.category)" :size="14" class="text-muted-foreground" />
              </div>
              <div class="min-w-0">
                <h4 class="text-sm font-semibold text-foreground truncate m-0">{{ tpl.meta_template_name }}</h4>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[10px] text-muted-foreground">{{ tpl.language }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium">{{ tpl.category }}</span>
                </div>
              </div>
            </div>
            <span :class="['shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full', statusColor(tpl.status)]">{{ tpl.status }}</span>
          </div>

          <!-- Body preview -->
          <p v-if="tpl.body_text" class="text-xs text-muted-foreground line-clamp-2 m-0 leading-relaxed">{{ tpl.body_text }}</p>

          <!-- Component indicators -->
          <div class="flex gap-1.5 flex-wrap">
            <span v-for="comp in getComponents(tpl)" :key="comp.type" class="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase">
              {{ comp.type }}
            </span>
          </div>

          <!-- Actions -->
          <div class="flex justify-between items-center pt-2 border-t border-border mt-auto" @click.stop>
            <Button v-if="tpl.status === 'APPROVED'" variant="ghost" size="sm" class="text-success" @click.stop="openSendModal(tpl)">
              <Send :size="13" /> Send
            </Button>
            <span v-else class="text-[10px] text-muted-foreground">{{ tpl.status === 'PENDING' ? 'Awaiting Meta approval' : '' }}</span>
            <Button variant="ghost" size="sm" class="text-danger" @click.stop="deleteConfirm = { show: true, type: 'template', id: tpl.id }"><Trash2 :size="13" /></Button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- MESSAGES TAB -->
    <!-- ================================================================ -->
    <div v-if="activeTab === 'messages'">
      <div class="flex items-center gap-3 mb-4">
        <Select v-model="selectedConfigId" class="w-56">
          <SelectTrigger><SelectValue placeholder="All accounts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All accounts</SelectItem>
            <SelectItem v-for="cfg in configsList" :key="cfg.id" :value="cfg.id">{{ cfg.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div v-if="messagesList.length === 0" class="bg-card border border-border rounded-xl">
        <EmptyState :icon="Send" title="No messages yet" description="Send your first WhatsApp message from the Templates tab" />
      </div>

      <div v-else class="bg-card border border-border rounded-xl overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left text-xs text-muted-foreground">
              <th class="px-4 py-3 font-medium">Phone</th>
              <th class="px-4 py-3 font-medium">Type</th>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="px-4 py-3 font-medium max-md:hidden">Sent</th>
              <th class="px-4 py-3 font-medium max-md:hidden">Delivered</th>
              <th class="px-4 py-3 font-medium max-md:hidden">Read</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="msg in messagesList" :key="msg.id" class="border-b border-border last:border-0 hover:bg-secondary/30">
              <td class="px-4 py-3 font-mono text-foreground text-xs">{{ msg.phone_number }}</td>
              <td class="px-4 py-3 text-muted-foreground text-xs">{{ msg.message_type }}</td>
              <td class="px-4 py-3"><span :class="['px-2 py-0.5 text-[10px] font-bold rounded-full', statusColor(msg.status)]">{{ msg.status }}</span></td>
              <td class="px-4 py-3 text-muted-foreground text-xs max-md:hidden">{{ formatDate(msg.sent_at) }}</td>
              <td class="px-4 py-3 text-muted-foreground text-xs max-md:hidden">{{ formatDate(msg.delivered_at) }}</td>
              <td class="px-4 py-3 text-muted-foreground text-xs max-md:hidden">{{ formatDate(msg.read_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- MODALS / PANELS -->
    <!-- ================================================================ -->

    <ConfirmDialog
      :show="deleteConfirm.show"
      :title="deleteConfirm.type === 'config' ? 'Remove Account' : 'Delete Template'"
      :message="deleteConfirm.type === 'config' ? 'Remove this WhatsApp account? All templates and messages will be deleted.' : 'Delete this template? It will also be removed from Meta.'"
      confirmText="Delete"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="deleteConfirm.show = false"
    />

    <!-- Config Editor Panel -->
    <SlidePanel :show="showConfigEditor" :title="editingConfigId ? 'Edit Account' : 'Connect WhatsApp Business Account'" size="md" @close="showConfigEditor = false">
      <form @submit.prevent="saveConfig" class="flex flex-col gap-4">
        <div>
          <Label>Account Name *</Label>
          <Input v-model="configForm.name" type="text" :class="{ 'border-danger!': formErrors.name }" placeholder="My WhatsApp Business" />
          <p v-if="formErrors.name" class="text-xs text-danger mt-1">{{ formErrors.name }}</p>
        </div>

        <div>
          <Label>Provider</Label>
          <Select v-model="configForm.provider">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="meta">Meta Cloud API (Direct)</SelectItem>
              <SelectItem value="twilio">Twilio WhatsApp</SelectItem>
              <SelectItem value="360dialog">360dialog</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Phone Number ID *</Label>
          <Input v-model="configForm.phone_number_id" type="text" :class="{ 'border-danger!': formErrors.phone_number_id }" placeholder="From Meta Developer Dashboard" />
          <p v-if="formErrors.phone_number_id" class="text-xs text-danger mt-1">{{ formErrors.phone_number_id }}</p>
          <p v-else class="text-xs text-muted-foreground mt-1">Meta Developer Portal > WhatsApp > API Setup</p>
        </div>

        <div>
          <Label>Business Account ID *</Label>
          <Input v-model="configForm.business_account_id" type="text" placeholder="Required for templates" />
          <p class="text-xs text-muted-foreground mt-1">Required to sync and create templates. Found in Business Settings > WhatsApp Accounts.</p>
        </div>

        <div>
          <Label>{{ editingConfigId ? 'New Access Token (blank = keep current)' : 'Permanent Access Token *' }}</Label>
          <div class="relative">
            <Input v-model="configForm.access_token" :type="showToken ? 'text' : 'password'" class="pr-10" :class="{ 'border-danger!': formErrors.access_token }" placeholder="System User token with whatsapp_business_messaging permission" />
            <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground cursor-pointer" @click="showToken = !showToken">
              <Eye v-if="!showToken" :size="16" /><EyeOff v-else :size="16" />
            </button>
          </div>
          <p v-if="formErrors.access_token" class="text-xs text-danger mt-1">{{ formErrors.access_token }}</p>
        </div>

        <div>
          <Label>Display Phone Number</Label>
          <Input v-model="configForm.phone_display" type="text" placeholder="+1 234 567 8900 (shown in UI)" />
        </div>

        <div>
          <Label>Daily Message Limit</Label>
          <Input v-model="configForm.daily_limit" type="number" min="1" max="100000" />
          <p class="text-xs text-muted-foreground mt-1">Meta default: 1,000/day for new numbers, increases with quality.</p>
        </div>

        <div class="flex justify-end gap-3 pt-4 border-t border-border">
          <Button variant="ghost" type="button" @click="showConfigEditor = false">Cancel</Button>
          <Button type="submit">{{ editingConfigId ? 'Update' : 'Connect' }}</Button>
        </div>
      </form>
    </SlidePanel>

    <!-- Template Creator Panel -->
    <SlidePanel :show="showTemplateCreator" title="Create WhatsApp Template" size="lg" @close="showTemplateCreator = false">
      <form @submit.prevent="createTemplate" class="flex flex-col gap-4">
        <div class="bg-warning/10 border border-warning/20 rounded-lg px-4 py-3 text-xs text-warning">
          Templates must be approved by Meta before they can be used. This usually takes a few minutes to 24 hours.
        </div>

        <div class="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div>
            <Label>Template Name *</Label>
            <Input v-model="templateForm.name" type="text" placeholder="welcome_message" />
            <p class="text-[10px] text-muted-foreground mt-1">Lowercase, underscores only. Auto-formatted.</p>
          </div>
          <div>
            <Label>Language *</Label>
            <Select v-model="templateForm.language">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="lang in languages" :key="lang.code" :value="lang.code">{{ lang.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Category *</Label>
          <div class="grid grid-cols-3 gap-2 mt-1">
            <button
              v-for="cat in (['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const)"
              :key="cat"
              type="button"
              :class="[
                'flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all cursor-pointer text-center',
                templateForm.category === cat
                  ? 'border-accent bg-accent/5 text-accent'
                  : 'border-border bg-card text-muted-foreground hover:border-border/80'
              ]"
              @click="templateForm.category = cat"
            >
              <component :is="categoryIcon(cat)" :size="18" />
              <span class="text-xs font-medium">{{ cat }}</span>
            </button>
          </div>
        </div>

        <div>
          <Label>Header (optional)</Label>
          <Input v-model="templateForm.headerText" type="text" placeholder="E.g. Welcome to {{1}}!" />
          <p class="text-[10px] text-muted-foreground mt-1">Use {{1}}, {{2}} for dynamic parameters</p>
        </div>

        <div>
          <Label>Body Text *</Label>
          <Textarea
            v-model="templateForm.bodyText"
            placeholder="Hi {{1}}, thank you for signing up! Your order {{2}} is confirmed."
            rows="4"
            class="resize-none"
          />
          <div class="flex justify-between mt-1">
            <p class="text-[10px] text-muted-foreground">Use {{1}}, {{2}}, {{3}} for variable placeholders</p>
            <span class="text-[10px] text-muted-foreground">{{ templateForm.bodyText.length }}/1024</span>
          </div>
        </div>

        <div>
          <Label>Footer (optional)</Label>
          <Input v-model="templateForm.footerText" type="text" placeholder="E.g. Reply STOP to unsubscribe" />
        </div>

        <!-- Buttons -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <Label class="mb-0">Buttons (optional, max 3)</Label>
            <div v-if="templateForm.buttons.length < 3" class="flex gap-1">
              <Button type="button" variant="ghost" size="sm" class="text-xs h-6" @click="addButton('QUICK_REPLY')">+ Quick Reply</Button>
              <Button type="button" variant="ghost" size="sm" class="text-xs h-6" @click="addButton('URL')">+ URL</Button>
              <Button type="button" variant="ghost" size="sm" class="text-xs h-6" @click="addButton('PHONE_NUMBER')">+ Phone</Button>
            </div>
          </div>

          <div v-for="(btn, i) in templateForm.buttons" :key="i" class="flex items-start gap-2 mb-2 bg-secondary rounded-lg p-3">
            <div class="flex-1 space-y-2">
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-medium text-muted-foreground uppercase px-1.5 py-0.5 rounded bg-muted">{{ btn.type.replace('_', ' ') }}</span>
              </div>
              <Input v-model="btn.text" type="text" placeholder="Button text" class="text-sm" />
              <Input v-if="btn.type === 'URL'" v-model="btn.url" type="url" placeholder="https://example.com/{{1}}" class="text-sm" />
              <Input v-if="btn.type === 'PHONE_NUMBER'" v-model="btn.phone_number" type="tel" placeholder="+14155552671" class="text-sm" />
            </div>
            <button type="button" class="mt-6 p-1 text-danger hover:bg-danger/10 rounded cursor-pointer" @click="removeButton(i)"><Trash2 :size="14" /></button>
          </div>
        </div>

        <!-- Preview -->
        <div class="bg-secondary rounded-lg p-4">
          <div class="text-xs font-semibold text-muted-foreground mb-2">Preview</div>
          <div class="bg-[#e5ddd5] dark:bg-[#0b141a] rounded-lg p-4 max-w-sm">
            <div class="bg-white dark:bg-[#1f2c34] rounded-lg p-3 shadow-sm">
              <div v-if="templateForm.headerText" class="text-sm font-bold text-foreground mb-1">{{ templateForm.headerText }}</div>
              <div class="text-sm text-foreground whitespace-pre-wrap">{{ templateForm.bodyText || 'Your message body...' }}</div>
              <div v-if="templateForm.footerText" class="text-xs text-muted-foreground mt-2">{{ templateForm.footerText }}</div>
            </div>
            <div v-if="templateForm.buttons.length" class="mt-1 space-y-1">
              <div v-for="(btn, i) in templateForm.buttons" :key="i" class="bg-white dark:bg-[#1f2c34] rounded-lg p-2 text-center text-sm text-accent font-medium shadow-sm">
                {{ btn.text || 'Button' }}
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-3 pt-4 border-t border-border">
          <Button variant="ghost" type="button" @click="showTemplateCreator = false">Cancel</Button>
          <Button type="submit" :disabled="creatingTemplate || !templateForm.name || !templateForm.bodyText">
            <Loader2 v-if="creatingTemplate" :size="16" class="animate-spin" />
            Submit for Approval
          </Button>
        </div>
      </form>
    </SlidePanel>

    <!-- Template Detail Modal -->
    <Modal :show="showTemplateDetail" :title="detailTemplate?.meta_template_name || 'Template'" size="lg" @close="showTemplateDetail = false">
      <div v-if="detailTemplate" class="space-y-4">
        <div class="flex items-center gap-3">
          <span :class="['px-2.5 py-0.5 text-xs font-bold rounded-full', statusColor(detailTemplate.status)]">{{ detailTemplate.status }}</span>
          <span class="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground font-medium">{{ detailTemplate.category }}</span>
          <span class="text-xs text-muted-foreground">{{ detailTemplate.language }}</span>
        </div>

        <div v-for="comp in getComponents(detailTemplate)" :key="comp.type" class="border border-border rounded-lg p-3">
          <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{{ comp.type }}</div>
          <div v-if="comp.text" class="text-sm text-foreground whitespace-pre-wrap">{{ comp.text }}</div>
          <div v-if="comp.format && comp.format !== 'TEXT'" class="text-xs text-muted-foreground">Format: {{ comp.format }}</div>
          <div v-if="comp.buttons" class="space-y-1 mt-2">
            <div v-for="(btn, i) in comp.buttons" :key="i" class="text-xs bg-secondary px-2 py-1 rounded">
              <span class="font-medium">{{ btn.type }}:</span> {{ btn.text }} {{ btn.url || btn.phone_number || '' }}
            </div>
          </div>
        </div>

        <div class="flex justify-between items-center pt-3 border-t border-border">
          <div class="text-xs text-muted-foreground">
            ID: <span class="font-mono">{{ detailTemplate.meta_template_id || detailTemplate.id }}</span>
          </div>
          <div class="flex gap-2">
            <Button v-if="detailTemplate.status === 'APPROVED'" variant="secondary" size="sm" @click="showTemplateDetail = false; openSendModal(detailTemplate)">
              <Send :size="14" /> Send Message
            </Button>
          </div>
        </div>
      </div>
    </Modal>

    <!-- Send Template Modal -->
    <Modal :show="showSendModal" title="Send WhatsApp Message" size="md" @close="showSendModal = false">
      <form @submit.prevent="sendMessage" class="flex flex-col gap-4">
        <div>
          <Label>Template</Label>
          <Input :model-value="sendForm.templateName" type="text" disabled />
        </div>

        <div>
          <Label>Recipient Phone Number *</Label>
          <Input v-model="sendForm.phone" type="tel" placeholder="14155552671 (with country code, no +)" />
          <p class="text-xs text-muted-foreground mt-1">Include country code without + sign</p>
        </div>

        <div v-if="templateParams.length > 0" class="flex flex-col gap-2">
          <Label>Template Parameters</Label>
          <div v-for="(param, i) in templateParams" :key="param" class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground w-12 shrink-0 font-mono">{{ param }}</span>
            <Input v-model="sendForm.params[i]" type="text" class="flex-1" :placeholder="`Value for ${param}`" />
          </div>
        </div>

        <div class="flex justify-end gap-3 pt-3 border-t border-border">
          <Button variant="ghost" type="button" @click="showSendModal = false">Cancel</Button>
          <Button type="submit" :disabled="sendMutation.isPending.value">
            <Loader2 v-if="sendMutation.isPending.value" :size="16" class="animate-spin" />
            <Send v-else :size="16" />
            Send Message
          </Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
