<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  useConfigs, useCreateConfig, useUpdateConfig, useDeleteConfig,
  useTestConfig, useConnectOAuth,
} from '../../lib/query'
import { useToast } from '../../composables/useToast'
import type { SMTPConfig } from '../../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import Modal from '../../components/ui/Modal.vue'
import ConfirmDialog from '../../components/ui/ConfirmDialog.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import Skeleton from '../../components/ui/Skeleton.vue'
import InfoTip from '../../components/ui/InfoTip.vue'
import { cloudflareApi, type CloudflareZone } from '../../lib/api/cloudflare'
import {
  Plus, Pencil, Trash2, Plug, Server, Loader2, Inbox, Copy,
  Cloud, Zap, Mail, Globe, Send, MoreVertical, Radio,
  ShieldCheck, ShieldAlert, ExternalLink, Check,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { data: configs, isLoading: loading } = useConfigs()

// Handle OAuth callback query params
onMounted(() => {
  const q = route.query
  if (q.success) {
    const provider = String(q.success).replace('_connected', '')
    toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} account connected successfully`)
    router.replace({ query: {} })
  } else if (q.error) {
    const err = String(q.error)
    if (err.includes('denied')) toast.error('OAuth authorization was denied')
    else if (err.includes('failed')) toast.error('OAuth connection failed. Please try again.')
    else toast.error(`OAuth error: ${err}`)
    router.replace({ query: {} })
  }
})
const createMutation = useCreateConfig()
const updateMutation = useUpdateConfig()
const deleteMutation = useDeleteConfig()
const testMutation = useTestConfig()
const connectOAuth = useConnectOAuth()

const allServers = computed(() => configs.value || [])
const deleteConfirm = ref<{ show: boolean; id: string }>({ show: false, id: '' })
const showAddModal = ref(false)
const showForm = ref(false)
const editingId = ref<string | null>(null)
// actionMenuOpen removed — using shadcn-vue DropdownMenu (no overflow issues)
const verifying = ref<string | null>(null)
const formStep = ref(1) // 1=credentials, 2=sender, 3=verify
const expandedServer = ref<string | null>(null) // which server card is expanded
const addingEmail = ref(false)
const newEmail = ref({ serverId: '', email: '', displayName: '' })
const fetchingDomains = ref(false)
const fetchedDomains = ref<string[]>([])
const domainFetchNote = ref('')

// Tracking (Step 3)
const cfConnected = ref(false)
const cfZones = ref<CloudflareZone[]>([])
const cfLoading = ref(false)
const cfDeploying = ref(false)
const matchingZone = ref<CloudflareZone | null>(null)
const trackingDeployed = ref(false)

const form = ref({
  name: '', provider_type: 'smtp',
  // SMTP
  host: '', port: 587, secure: false, user: '', pass: '',
  // API providers
  api_key: '', api_secret: '', api_region: 'us-east-1', api_domain: '',
  // Sender
  from_email: '', from_name: '',
  // Tracking
  tracking_domain: '',
  // Limits
  hourly_limit: 0, daily_limit: 500,
  // Flags
  is_default: false, force_from: false,
  // Callback
  bounce_webhook_url: '',
})

const providerTypes = [
  { value: 'smtp', label: 'SMTP', icon: Server, desc: 'Any SMTP server', color: 'text-muted-foreground', fields: ['host', 'port', 'user', 'pass'] },
  { value: 'ses', label: 'Amazon SES', icon: Cloud, desc: 'IAM keys — domain-level', color: 'text-amber-400', fields: ['api_key', 'api_secret', 'api_region'] },
  { value: 'sendgrid', label: 'SendGrid', icon: Zap, desc: 'API key', color: 'text-blue-400', fields: ['api_key'] },
  { value: 'mailgun', label: 'Mailgun', icon: Mail, desc: 'API key + domain', color: 'text-red-400', fields: ['api_key', 'api_domain', 'api_region'] },
  { value: 'postmark', label: 'Postmark', icon: Send, desc: 'Server token', color: 'text-amber-400', fields: ['api_key'] },
  { value: 'sparkpost', label: 'SparkPost', icon: Zap, desc: 'API key', color: 'text-orange-400', fields: ['api_key'] },
  { value: 'google', label: 'Gmail', icon: Globe, desc: 'OAuth — one click', color: 'text-green-400', fields: [] },
  { value: 'microsoft', label: 'Outlook', icon: Globe, desc: 'OAuth — one click', color: 'text-blue-400', fields: [] },
]

function selectProvider(type: string) {
  showAddModal.value = false
  if (type === 'google' || type === 'microsoft') {
    connectOAuth.mutate(type as any)
    return
  }
  form.value = {
    name: providerTypes.find(p => p.value === type)?.label || type,
    provider_type: type,
    host: type === 'smtp' ? 'smtp.gmail.com' : '', port: 587, secure: false, user: '', pass: '',
    api_key: '', api_secret: '', api_region: type === 'ses' ? 'us-east-1' : type === 'mailgun' ? 'us' : '', api_domain: '',
    from_email: '', from_name: '',
    tracking_domain: '', hourly_limit: 0,
    daily_limit: type === 'ses' ? 50000 : type === 'sendgrid' ? 100000 : type === 'mailgun' ? 10000 : 500,
    is_default: false, force_from: false, bounce_webhook_url: '',
  }
  editingId.value = null
  formStep.value = 1
  showForm.value = true
}

function editServer(server: SMTPConfig) {
  form.value = {
    name: server.name || '', provider_type: server.provider_type || 'smtp',
    host: server.host || '', port: server.port || 587, secure: !!server.secure,
    user: server.user || '', pass: '',
    api_key: server.api_key || '', api_secret: '', api_region: server.api_region || '',
    api_domain: server.api_domain || '',
    from_email: server.from_email || '', from_name: server.from_name || '',
    tracking_domain: (server as any).tracking_domain || '',
    hourly_limit: (server as any).hourly_limit || 0,
    daily_limit: (server as any).daily_limit || 500,
    is_default: !!server.is_default, force_from: !!(server as any).force_from,
    bounce_webhook_url: (server as any).bounce_webhook_url || '',
  }
  editingId.value = server.id
  formStep.value = 1
  showForm.value = true
}

async function saveServer() {
  try {
    if (editingId.value) {
      await updateMutation.mutateAsync({ id: editingId.value, ...form.value } as any)
      toast.success('Server updated')
    } else {
      await createMutation.mutateAsync(form.value as any)
      toast.success('Server added — verify connection to activate')
    }
    showForm.value = false
  } catch (e: any) { toast.error(e.message) }
}

async function verifyServer(id: string) {
  verifying.value = id
  try {
    await testMutation.mutateAsync(id)
    toast.success('Connection verified — server is ready to send')
  } catch (e: any) { toast.error(`Verification failed: ${e.message}`) }
  finally { verifying.value = null }
}

async function deleteServer() {
  const id = deleteConfirm.value.id
  deleteConfirm.value.show = false
  try { await deleteMutation.mutateAsync(id); toast.success('Server deleted') }
  catch (e: any) { toast.error(e.message) }
}

async function fetchDomains() {
  fetchingDomains.value = true
  fetchedDomains.value = []
  domainFetchNote.value = ''
  try {
    const res = await fetch('/api/config/fetch-domains', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_type: form.value.provider_type,
        api_key: form.value.api_key,
        api_secret: form.value.api_secret,
        api_region: form.value.api_region,
      }),
    })
    const data = await res.json()
    if (data.success) {
      fetchedDomains.value = data.data.domains || []
      domainFetchNote.value = data.data.note || ''
      if (fetchedDomains.value.length === 1) {
        form.value.api_domain = fetchedDomains.value[0] || ''
      }
    } else {
      toast.error(data.message || 'Failed to fetch domains')
    }
  } catch (e: any) { toast.error(e.message) }
  finally { fetchingDomains.value = false }
}

// Tracking: load Cloudflare status + find matching zone for domain
async function loadTrackingStatus() {
  cfLoading.value = true
  try {
    const status = await cloudflareApi.getStatus()
    cfConnected.value = status.connected
    if (status.connected) {
      cfZones.value = await cloudflareApi.listZones()
      // Find zone matching the server's domain
      const domain = form.value.api_domain || form.value.from_email?.split('@')[1] || ''
      matchingZone.value = cfZones.value.find(z => domain.endsWith(z.name)) || null
      trackingDeployed.value = !!matchingZone.value?.deployed
    }
  } catch { cfConnected.value = false }
  finally { cfLoading.value = false }
}

async function connectCloudflare() {
  try {
    const url = await cloudflareApi.getConnectUrl()
    window.location.href = url
  } catch (e: any) { toast.error(e.message || 'Failed to connect') }
}

async function deployTracking() {
  if (!matchingZone.value) return
  cfDeploying.value = true
  try {
    await cloudflareApi.deploy({
      zoneId: matchingZone.value.id,
      domain: matchingZone.value.name,
      openPath: 'o',
      clickPath: 'c',
      unsubPath: 'u',
      useSubdomain: true,
      subdomain: 'e',
    })
    trackingDeployed.value = true
    form.value.tracking_domain = `e.${matchingZone.value.name}`
    toast.success(`Tracking deployed to e.${matchingZone.value.name}`)
  } catch (e: any) { toast.error(e.message || 'Deploy failed') }
  finally { cfDeploying.value = false }
}

const formBounceUrl = computed(() => {
  const type = form.value.provider_type === 'ses' ? 'ses' : form.value.provider_type
  return `${window.location.origin}/api/webhooks/bounce/${type}`
})

function getProvider(type: string) { return providerTypes.find(p => p.value === type) }
function getBounceUrl(server: SMTPConfig) {
  const base = window.location.origin
  const type = server.provider_type === 'ses' ? 'ses' : server.provider_type
  return `${base}/api/webhooks/bounce/${type}`
}

function toggleExpand(serverId: string) {
  expandedServer.value = expandedServer.value === serverId ? null : serverId
}

function getDomain(server: SMTPConfig): string {
  if (server.api_domain) return server.api_domain
  if (server.from_email) return server.from_email.split('@')[1] || ''
  return ''
}

function copyToClipboard(text: string) {
  window.navigator.clipboard.writeText(text)
  toast.success('Copied')
}

function openAddEmail(serverId: string) {
  const server = allServers.value.find(s => s.id === serverId)
  const domain = server ? getDomain(server) : ''
  newEmail.value = { serverId, email: domain ? `@${domain}` : '', displayName: '' }
  addingEmail.value = true
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-foreground">Delivery Servers</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Manage email sending providers. Each server must be verified before sending.
          <InfoTip text="Add your email provider credentials. Bounce webhooks are auto-registered for API providers. You must verify the connection before sending campaigns." />
        </p>
      </div>
      <Button @click="showAddModal = true"><Plus :size="14" /> Add Server</Button>
    </div>

    <div v-if="loading"><Skeleton variant="card" :count="3" /></div>

    <div v-else-if="allServers.length === 0" class="bg-card border border-border rounded-xl">
      <EmptyState :icon="Inbox" title="No delivery servers" description="Add a delivery server to start sending emails">
        <template #actions><Button @click="showAddModal = true"><Plus :size="14" /> Add Server</Button></template>
      </EmptyState>
    </div>

    <!-- Server Cards -->
    <div v-else class="space-y-3">
      <div v-for="server in allServers" :key="server.id" class="bg-card border border-border rounded-xl transition hover:border-primary/25">
        <!-- Server Header (always visible) -->
        <div class="p-4 cursor-pointer" @click="toggleExpand(server.id)">
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3 flex-1 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                <component :is="getProvider(server.provider_type)?.icon || Server" :size="18" :class="getProvider(server.provider_type)?.color || 'text-muted-foreground'" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <span class="text-sm font-semibold text-foreground">{{ server.name || getProvider(server.provider_type)?.label }}</span>
                  <span v-if="server.is_default" class="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">Default</span>
                  <span v-if="(server as any).verified" class="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5"><ShieldCheck :size="10" /> Verified</span>
                  <span v-else class="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5"><ShieldAlert :size="10" /> Unverified</span>
                </div>
                <div class="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                  <span>{{ getProvider(server.provider_type)?.label }}</span>
                  <span v-if="server.from_email">{{ server.from_email }}</span>
                  <span v-if="server.api_domain">{{ server.api_domain }}</span>
                  <span v-if="server.api_region">{{ server.api_region }}</span>
                  <span v-if="server.host">{{ server.host }}:{{ server.port }}</span>
                </div>
              </div>
            </div>

            <!-- Actions (stop propagation so click doesn't toggle expand) -->
            <div class="flex items-center gap-1 shrink-0" @click.stop>
              <button
                v-if="verifying !== server.id"
                @click="verifyServer(server.id)"
                class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition"
                :class="(server as any).verified ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'"
              ><Plug :size="12" /> Verify</button>
              <Loader2 v-else :size="14" class="animate-spin text-muted-foreground" />
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition"><MoreVertical :size="14" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @select="editServer(server)"><Pencil :size="12" /> Edit</DropdownMenuItem>
                  <DropdownMenuItem class="text-red-400" @select="deleteConfirm = { show: true, id: server.id }"><Trash2 :size="12" /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <!-- Expanded: Domain, Sending Emails, Bounce URL -->
        <div v-if="expandedServer === server.id" class="border-t border-border bg-background px-4 py-3 space-y-3">
          <!-- Domain -->
          <div v-if="getDomain(server)" class="flex items-center gap-2 text-xs">
            <Globe :size="13" class="text-muted-foreground" />
            <span class="text-muted-foreground">Sending Domain:</span>
            <span class="text-foreground font-medium">{{ getDomain(server) }}</span>
          </div>

          <!-- From Address -->
          <div v-if="server.from_email" class="flex items-center gap-2 text-xs">
            <Mail :size="13" class="text-muted-foreground" />
            <span class="text-muted-foreground">Default From:</span>
            <span class="text-foreground">{{ server.from_name ? `${server.from_name} <${server.from_email}>` : server.from_email }}</span>
          </div>

          <!-- Sending Emails (additional addresses you can send from on this server) -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sending Emails</span>
              <button class="text-[10px] text-accent hover:text-accent/80 font-medium" @click.stop="openAddEmail(server.id)"><Plus :size="10" class="inline" /> Add Email</button>
            </div>
            <div v-if="!server.from_email && !server.api_domain" class="text-xs text-muted-foreground py-1">Configure a From email when editing this server</div>
            <div v-else class="text-xs text-muted-foreground py-1">Additional sending addresses can be configured per campaign when composing.</div>
          </div>

          <!-- Bounce Webhook URL -->
          <div class="pt-2 border-t border-border">
            <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Bounce/Complaint Webhook</div>
            <div class="flex items-center gap-2">
              <code class="text-[10px] font-mono text-muted-foreground flex-1 break-all">{{ getBounceUrl(server) }}</code>
              <button class="text-muted-foreground hover:text-accent p-0.5" @click.stop="copyToClipboard(getBounceUrl(server))"><Copy :size="11" /></button>
            </div>
            <p class="text-[10px] text-muted-foreground mt-1">For API providers (SES, SendGrid, Mailgun, Postmark, SparkPost), this is auto-registered when you save the server. For SMTP, add it manually in your provider dashboard.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Provider Picker -->
    <Modal :show="showAddModal" title="Add Delivery Server" size="lg" @close="showAddModal = false">
      <p class="text-sm text-muted-foreground mb-4">Choose your email provider. Bounce webhooks are auto-registered for API providers.</p>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          v-for="p in providerTypes" :key="p.value"
          class="flex flex-col items-center gap-2 p-4 bg-background border border-border rounded-xl hover:border-accent/40 hover:bg-accent/5 transition cursor-pointer text-center"
          @click="selectProvider(p.value)"
        >
          <component :is="p.icon" :size="20" :class="p.color" />
          <span class="text-xs font-semibold text-foreground">{{ p.label }}</span>
          <span class="text-[10px] text-muted-foreground leading-tight">{{ p.desc }}</span>
        </button>
      </div>
    </Modal>

    <!-- Server Form (Step-by-Step) -->
    <Modal :show="showForm" :title="editingId ? 'Edit Server' : `Add ${getProvider(form.provider_type)?.label || 'Server'}`" size="md" @close="showForm = false">
      <!-- Step indicators -->
      <div class="flex items-center gap-2 mb-5">
        <button v-for="s in 4" :key="s" @click="formStep = s" :class="['w-7 h-7 rounded-full text-xs font-bold transition', formStep >= s ? 'bg-accent text-white' : 'bg-secondary text-muted-foreground']">{{ s }}</button>
        <div class="flex-1 flex items-center gap-1 text-[10px] text-muted-foreground ml-2">
          <span :class="formStep === 1 ? 'text-accent font-medium' : ''">Credentials</span>
          <span>→</span>
          <span :class="formStep === 2 ? 'text-accent font-medium' : ''">Domain</span>
          <span>→</span>
          <span :class="formStep === 3 ? 'text-accent font-medium' : ''">Tracking</span>
          <span>→</span>
          <span :class="formStep === 4 ? 'text-accent font-medium' : ''">Review</span>
        </div>
      </div>

      <!-- Step 1: Provider Credentials -->
      <div v-if="formStep === 1" class="space-y-4">
        <div class="flex flex-col gap-2"><Label>Server Name <InfoTip text="A name to identify this server in your list" :size="12" /></Label><Input v-model="form.name" placeholder="My SES Server" /></div>

        <template v-if="form.provider_type === 'smtp'">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex flex-col gap-2"><Label>Host</Label><Input v-model="form.host" placeholder="smtp.gmail.com" /></div>
            <div class="flex flex-col gap-2"><Label>Port</Label><Input v-model="form.port" type="number" /></div>
            <div class="flex flex-col gap-2"><Label>Username</Label><Input v-model="form.user" /></div>
            <div class="flex flex-col gap-2"><Label>Password</Label><Input v-model="form.pass" type="password" /></div>
          </div>
          <label class="flex items-center gap-2 text-sm"><Checkbox v-model="form.secure" /> Use SSL/TLS <span class="text-muted-foreground text-xs">(enable for port 465, disable for STARTTLS on 587)</span></label>
          <!-- SMTP: needs from email here since there's no domain auto-fetch -->
          <div class="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex flex-col gap-2"><Label>From Email</Label><Input v-model="form.from_email" placeholder="hello@example.com" /></div>
            <div class="flex flex-col gap-2"><Label>From Name</Label><Input v-model="form.from_name" placeholder="My Company" /></div>
          </div>
        </template>

        <template v-if="form.provider_type === 'ses'">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex flex-col gap-2"><Label>IAM Access Key ID <InfoTip text="Your AWS IAM access key. Must have SES send permission." :size="12" /></Label><Input v-model="form.api_key" placeholder="AKIA..." /></div>
            <div class="flex flex-col gap-2"><Label>IAM Secret Access Key</Label><Input v-model="form.api_secret" type="password" /></div>
          </div>
          <div class="flex flex-col gap-2"><Label>Region</Label>
            <Select v-model="form.api_region">
              <SelectTrigger>
                <SelectValue placeholder="Select region..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us-east-1">us-east-1 -- US East (N. Virginia)</SelectItem>
                <SelectItem value="us-east-2">us-east-2 -- US East (Ohio)</SelectItem>
                <SelectItem value="us-west-1">us-west-1 -- US West (N. California)</SelectItem>
                <SelectItem value="us-west-2">us-west-2 -- US West (Oregon)</SelectItem>
                <SelectItem value="eu-west-1">eu-west-1 -- EU (Ireland)</SelectItem>
                <SelectItem value="eu-west-2">eu-west-2 -- EU (London)</SelectItem>
                <SelectItem value="eu-central-1">eu-central-1 -- EU (Frankfurt)</SelectItem>
                <SelectItem value="eu-south-1">eu-south-1 -- EU (Milan)</SelectItem>
                <SelectItem value="ap-south-1">ap-south-1 -- Asia Pacific (Mumbai)</SelectItem>
                <SelectItem value="ap-southeast-1">ap-southeast-1 -- Asia Pacific (Singapore)</SelectItem>
                <SelectItem value="ap-southeast-2">ap-southeast-2 -- Asia Pacific (Sydney)</SelectItem>
                <SelectItem value="ap-northeast-1">ap-northeast-1 -- Asia Pacific (Tokyo)</SelectItem>
                <SelectItem value="ap-northeast-2">ap-northeast-2 -- Asia Pacific (Seoul)</SelectItem>
                <SelectItem value="ca-central-1">ca-central-1 -- Canada (Central)</SelectItem>
                <SelectItem value="sa-east-1">sa-east-1 -- South America (Sao Paulo)</SelectItem>
                <SelectItem value="me-south-1">me-south-1 -- Middle East (Bahrain)</SelectItem>
                <SelectItem value="af-south-1">af-south-1 -- Africa (Cape Town)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="text-xs text-muted-foreground">After adding, the system will use your IAM keys to send. Enter a verified domain in the next step.</p>
        </template>

        <template v-if="form.provider_type === 'sendgrid' || form.provider_type === 'sparkpost'">
          <div class="flex flex-col gap-2"><Label>API Key <InfoTip text="Full access API key from your provider dashboard" :size="12" /></Label><Input v-model="form.api_key" type="password" /></div>
        </template>

        <template v-if="form.provider_type === 'mailgun'">
          <div class="flex flex-col gap-2"><Label>API Key</Label><Input v-model="form.api_key" type="password" /></div>
          <div class="flex flex-col gap-2"><Label>Region</Label><Select v-model="form.api_region"><SelectTrigger><SelectValue placeholder="Select region..." /></SelectTrigger><SelectContent><SelectItem value="us">US</SelectItem><SelectItem value="eu">EU</SelectItem></SelectContent></Select></div>
          <p class="text-xs text-muted-foreground">After adding, enter your verified Mailgun domain in the next step.</p>
        </template>

        <template v-if="form.provider_type === 'postmark'">
          <div class="flex flex-col gap-2"><Label>Server Token <InfoTip text="Found in Postmark -> Server -> API Tokens" :size="12" /></Label><Input v-model="form.api_key" type="password" /></div>
        </template>
      </div>

      <!-- Step 2: Domain & Sending Identity -->
      <div v-if="formStep === 2" class="space-y-4">
        <!-- For SMTP: already collected from email in step 1, show limits only -->
        <template v-if="form.provider_type === 'smtp'">
          <div class="bg-background rounded-lg p-3 text-xs text-muted-foreground">
            SMTP server — From address set in previous step. Configure limits below.
          </div>
        </template>

        <!-- For API providers: fetch domains + from email -->
        <template v-else>
          <div class="flex flex-col gap-2">
            <Label>Sending Domain <InfoTip text="Select a verified domain from your provider. Click 'Fetch Domains' to load them automatically." :size="12" /></Label>
            <div class="flex gap-2">
              <Select v-if="fetchedDomains.length > 0" v-model="form.api_domain">
                <SelectTrigger class="flex-1">
                  <SelectValue placeholder="Select a domain..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Select a domain...</SelectItem>
                  <SelectItem v-for="d in fetchedDomains" :key="d" :value="d">{{ d }}</SelectItem>
                </SelectContent>
              </Select>
              <Input v-else v-model="form.api_domain" class="flex-1" placeholder="example.com" />
              <Button type="button" variant="secondary" size="sm" class="shrink-0" :disabled="fetchingDomains" @click="fetchDomains">
                <Loader2 v-if="fetchingDomains" :size="12" class="animate-spin" />
                <Globe v-else :size="12" />
                Fetch
              </Button>
            </div>
            <p v-if="domainFetchNote" class="text-[10px] text-amber-400 mt-1">{{ domainFetchNote }}</p>
            <p v-else-if="fetchedDomains.length > 0" class="text-[10px] text-green-400 mt-1">{{ fetchedDomains.length }} verified domain{{ fetchedDomains.length !== 1 ? 's' : '' }} found</p>
            <p v-else class="text-[10px] text-muted-foreground mt-1">Click "Fetch" to auto-load verified domains, or enter manually. One server = one domain.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex flex-col gap-2"><Label>From Email <InfoTip text="Must be an address on the domain above" :size="12" /></Label><Input v-model="form.from_email" :placeholder="form.api_domain ? `hello@${form.api_domain}` : 'hello@example.com'" /></div>
            <div class="flex flex-col gap-2"><Label>From Name</Label><Input v-model="form.from_name" placeholder="My Company" /></div>
          </div>
        </template>

        <!-- Limits (all providers) -->
        <div class="pt-3 border-t border-border">
          <div class="text-xs font-semibold text-muted-foreground mb-2">Sending Limits</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex flex-col gap-2"><Label>Hourly Limit <InfoTip text="Max emails per hour. 0 = unlimited." :size="12" /></Label><Input v-model="form.hourly_limit" type="number" min="0" /></div>
            <div class="flex flex-col gap-2"><Label>Daily Limit <InfoTip text="Max emails per day." :size="12" /></Label><Input v-model="form.daily_limit" type="number" min="0" /></div>
          </div>
        </div>

        <!-- Options -->
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer"><Checkbox v-model="form.is_default" /> Set as default delivery server</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><Checkbox v-model="form.force_from" /> Force From address <InfoTip text="Campaigns using this server cannot override the From email/name" :size="12" /></label>
        </div>
      </div>

      <!-- Step 3: Tracking Deployment -->
      <div v-if="formStep === 3" class="space-y-4">
        <div class="bg-accent/5 border border-accent/20 rounded-lg p-4">
          <div class="flex items-center gap-2 mb-2">
            <Radio :size="16" class="text-accent" />
            <span class="text-sm font-semibold text-foreground">First-Party Tracking</span>
          </div>
          <p class="text-xs text-muted-foreground m-0">
            Deploy a tracking Worker on your sending domain so open/click tracking uses the same domain as your emails.
            This bypasses email client blocking and improves deliverability.
          </p>
        </div>

        <!-- Loading -->
        <div v-if="cfLoading" class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 :size="16" class="animate-spin" /> Checking Cloudflare connection...
        </div>

        <!-- Not connected to Cloudflare -->
        <div v-else-if="!cfConnected" class="space-y-3">
          <div class="bg-background rounded-lg p-4 text-center">
            <Cloud :size="24" class="text-muted-foreground mx-auto mb-2" />
            <p class="text-sm text-foreground font-medium mb-1">Connect Cloudflare</p>
            <p class="text-xs text-muted-foreground mb-3">
              Tracking Workers are deployed via Cloudflare. Connect your account to enable first-party tracking.
            </p>
            <Button size="sm" @click="connectCloudflare">
              <ExternalLink :size="14" /> Connect Cloudflare
            </Button>
          </div>
          <p class="text-xs text-muted-foreground text-center">
            You can skip this step and set up tracking later.
          </p>
        </div>

        <!-- Connected but no matching zone -->
        <div v-else-if="!matchingZone" class="bg-background rounded-lg p-4">
          <p class="text-sm text-foreground font-medium mb-1">No matching zone found</p>
          <p class="text-xs text-muted-foreground">
            Your Cloudflare account doesn't have a zone for <strong>{{ form.api_domain || form.from_email?.split('@')[1] || 'this domain' }}</strong>.
            Add this domain to Cloudflare first, or skip this step.
          </p>
        </div>

        <!-- Connected + matching zone -->
        <div v-else class="space-y-3">
          <div class="bg-background rounded-lg p-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-foreground">{{ matchingZone.name }}</p>
                <p class="text-xs text-muted-foreground">Cloudflare zone matched to your sending domain</p>
              </div>
              <div v-if="trackingDeployed" class="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                <Check :size="14" /> Tracking active
              </div>
            </div>
          </div>

          <div v-if="!trackingDeployed">
            <p class="text-xs text-muted-foreground mb-2">
              This will deploy a Worker at <code class="bg-muted px-1 py-0.5 rounded">e.{{ matchingZone.name }}</code> for tracking opens, clicks, and unsubscribes.
            </p>
            <Button :disabled="cfDeploying" @click="deployTracking">
              <Loader2 v-if="cfDeploying" :size="14" class="animate-spin" />
              <Radio v-else :size="14" />
              Deploy Tracking Worker
            </Button>
          </div>
          <div v-else class="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-xs text-green-400">
            Tracking Worker is live at <code class="font-mono">e.{{ matchingZone.name }}</code>. Opens, clicks, and unsubscribes will be tracked on your domain.
          </div>
        </div>
      </div>

      <!-- Step 4: Review -->
      <div v-if="formStep === 4" class="space-y-3">
        <div class="bg-background rounded-lg p-4 space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-muted-foreground">Provider</span><span class="text-foreground font-medium">{{ getProvider(form.provider_type)?.label }}</span></div>
          <div class="flex justify-between"><span class="text-muted-foreground">Name</span><span class="text-foreground">{{ form.name }}</span></div>
          <div v-if="form.from_email" class="flex justify-between"><span class="text-muted-foreground">From</span><span class="text-foreground">{{ form.from_name }} &lt;{{ form.from_email }}&gt;</span></div>
          <div v-if="form.host" class="flex justify-between"><span class="text-muted-foreground">Host</span><span class="text-foreground font-mono text-xs">{{ form.host }}:{{ form.port }}</span></div>
          <div v-if="form.api_domain" class="flex justify-between"><span class="text-muted-foreground">Domain</span><span class="text-foreground">{{ form.api_domain }}</span></div>
          <div v-if="form.api_region" class="flex justify-between"><span class="text-muted-foreground">Region</span><span class="text-foreground">{{ form.api_region }}</span></div>
          <div v-if="form.tracking_domain" class="flex justify-between"><span class="text-muted-foreground">Tracking Domain</span><span class="text-foreground">{{ form.tracking_domain }}</span></div>
          <div class="flex justify-between"><span class="text-muted-foreground">Daily Limit</span><span class="text-foreground">{{ form.daily_limit || 'Unlimited' }}</span></div>
          <div v-if="form.is_default" class="flex justify-between"><span class="text-muted-foreground">Default</span><span class="text-green-400">Yes</span></div>
        </div>

        <div class="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
          <ShieldAlert :size="14" class="inline mr-1" />
          After saving, click <strong>Verify</strong> to test the connection. You cannot send emails until the server is verified.
        </div>

        <div class="bg-background rounded-lg p-3 text-xs text-muted-foreground">
          <strong class="text-muted-foreground">Bounce Webhook URL:</strong>
          <code class="block mt-1 font-mono text-[11px] text-muted-foreground break-all">{{ formBounceUrl }}</code>
          <p class="mt-1">This URL is auto-registered for API providers. For SMTP, configure bounces in your provider's dashboard.</p>
        </div>
      </div>

      <template #footer>
        <Button v-if="formStep > 1" variant="ghost" @click="formStep--">Back</Button>
        <div class="flex-1"></div>
        <Button variant="ghost" @click="showForm = false">Cancel</Button>
        <Button v-if="formStep < 4" @click="formStep++; if (formStep === 3) loadTrackingStatus()">Next</Button>
        <Button v-else :disabled="!form.name" :loading="createMutation.isPending.value || updateMutation.isPending.value" @click="saveServer">
          {{ editingId ? 'Update Server' : 'Add Server' }}
        </Button>
      </template>
    </Modal>

    <ConfirmDialog :show="deleteConfirm.show" title="Delete Server" message="Delete this delivery server? Campaigns using it will need a different server." confirmText="Delete" variant="danger" @confirm="deleteServer" @cancel="deleteConfirm.show = false" />
  </div>
</template>
