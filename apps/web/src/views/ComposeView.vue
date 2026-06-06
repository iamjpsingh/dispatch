<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useConfigs, useContactLists } from '../lib/query'
import { emailApi, templatesApi, contactsApi } from '../lib/api'
import type { Template } from '../lib/api'
import { useToast } from '../composables/useToast'
import { parseExcelFile, getContactEmail, getContactName, replacePlaceholders } from '../lib/excelParser'
import EmailEditor from '../components/compose/EmailEditor.vue'
import EmailPreviewModal from '../components/compose/EmailPreviewModal.vue'
import HtmlCodeEditor from '../components/compose/HtmlCodeEditor.vue'
import Stepper from '../components/ui/Stepper.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import InfoTip from '../components/ui/InfoTip.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Send,
  Calendar,
  Loader2,
  CheckCircle,
  Users,
  Settings,
  FileText,
  Eye,
  Code,
  LayoutTemplate,
  Upload,
  ArrowLeft,
  ArrowRight,
  Mail,
  Zap,
  Clock,
  AlertCircle,
  ChevronRight,
} from 'lucide-vue-next'

const toast = useToast()

// ───── Data / Queries ─────
const { data: configsData } = useConfigs()
const smtpConfigs = computed(() => configsData.value || [])
const { data: contactLists } = useContactLists()
const lists = computed(() => contactLists.value || [])

// ───── Wizard Step ─────
const activeStep = ref(0)

// ───── Form Data ─────
const campaignName = ref('')
const subject = ref('')
const htmlContent = ref('')
const excelFile = ref<File | null>(null)
const contacts = ref<any[]>([])
const columns = ref<string[]>([])
const delay = ref(20)
const selectedListId = ref('')
const loadingContacts = ref(false)
const recipientMode = ref<'list' | 'upload'>('list')
const selectedConfigId = ref('')

// Batch
const useBatch = ref(false)
const batchSize = ref(20)
const batchDelay = ref(60)
const emailDelay = ref(45)

// Rotation
const rotationMode = ref('smart')

// Schedule
const useSchedule = ref(false)
const scheduledTime = ref('')
const notifyEmail = ref('')

// Range
const rangeType = ref<'all' | 'first' | 'range'>('all')
const firstN = ref(50)
const rangeFrom = ref(1)
const rangeTo = ref(100)

const sending = ref(false)
const result = ref<any>(null)

// Preview
const showPreview = ref(false)
const previewContactIndex = ref(0)

// Templates
const templates = ref<Template[]>([])
const selectedTemplateId = ref('')
const loadingTemplates = ref(false)
const loadingTemplate = ref(false)
const editorMode = ref<'preview' | 'rich' | 'html'>('rich')

// ───── Step validation ─────
const step1Valid = computed(() => !!selectedConfigId.value && contacts.value.length > 0)
const step2Valid = computed(() => !!subject.value.trim() && !!htmlContent.value.trim())
const step3Valid = computed(() => {
  if (useSchedule.value && !scheduledTime.value) return false
  return true
})

const stepperSteps = computed(() => [
  { label: 'Recipients', completed: step1Valid.value && activeStep.value > 0 },
  { label: 'Content', completed: step2Valid.value && activeStep.value > 1 },
  { label: 'Settings', completed: step3Valid.value && activeStep.value > 2 },
  { label: 'Review & Send', completed: false },
])

const canProceed = computed(() => {
  if (activeStep.value === 0) return step1Valid.value
  if (activeStep.value === 1) return step2Valid.value
  if (activeStep.value === 2) return step3Valid.value
  return true
})

const canSend = computed(() => step1Valid.value && step2Valid.value && step3Valid.value)

function goNext() {
  if (canProceed.value && activeStep.value < 3) activeStep.value++
}
function goBack() {
  if (activeStep.value > 0) activeStep.value--
}
function goToStep(idx: number) {
  // Allow jumping to completed steps or current
  if (idx <= activeStep.value) {
    activeStep.value = idx
  }
}

// ───── Contact Loading ─────
async function loadContactsFromList(listId: string) {
  if (!listId) { contacts.value = []; columns.value = []; return }
  loadingContacts.value = true
  try {
    const res = await contactsApi.getContacts(listId, { limit: 10000 })
    contacts.value = res.contacts.map(c => ({
      Email: c.email,
      FirstName: c.first_name || '',
      LastName: c.last_name || '',
      Company: c.company || '',
      Name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
    }))
    columns.value = ['Email', 'FirstName', 'LastName', 'Company', 'Name']
  } catch (err: any) {
    toast.error(err.message || 'Failed to load contacts')
    contacts.value = []
  } finally {
    loadingContacts.value = false
  }
}
watch(selectedListId, (id) => { if (id) loadContactsFromList(id) })

// ───── Templates ─────
async function fetchTemplates() {
  loadingTemplates.value = true
  try {
    const res = await templatesApi.list()
    templates.value = res.templates || []
  } catch (err: any) {
    toast.error(err.message || 'Failed to load templates')
  } finally {
    loadingTemplates.value = false
  }
}

async function applyTemplate(templateId: string) {
  if (!templateId) return
  loadingTemplate.value = true
  try {
    const tpl = await templatesApi.get(templateId)
    htmlContent.value = tpl.html_content || ''
    if (tpl.subject && !subject.value) subject.value = tpl.subject
    toast.success(`Template "${tpl.name}" applied`)
  } catch (err: any) {
    toast.error(err.message || 'Failed to load template')
    selectedTemplateId.value = ''
  } finally {
    loadingTemplate.value = false
  }
}

watch(selectedTemplateId, (id) => {
  if (id) { applyTemplate(id); editorMode.value = 'preview' }
  else { editorMode.value = 'rich' }
})

// ───── File Upload ─────
async function handleFileSelected(file: File) {
  excelFile.value = file
  const parsed = await parseExcelFile(file)
  contacts.value = parsed.contacts
  columns.value = parsed.columns
}

// ───── Preview Helpers ─────
const templatePreviewHtml = computed(() => {
  if (!htmlContent.value) return ''
  return replacePlaceholders(htmlContent.value, previewContact.value)
})

const previewContact = computed(() => {
  if (contacts.value.length > 0) return contacts.value[previewContactIndex.value] || contacts.value[0]
  return { Email: 'john@example.com', FirstName: 'John', LastName: 'Doe', Company: 'Acme Inc', Name: 'John Doe' }
})

const previewToEmail = computed(() => getContactEmail(previewContact.value))
const previewToName = computed(() => getContactName(previewContact.value))
const previewSubject = computed(() => replacePlaceholders(subject.value, previewContact.value))
const previewContent = computed(() => replacePlaceholders(htmlContent.value, previewContact.value))

const previewFromName = computed(() => {
  const cfg = smtpConfigs.value.find(c => c.id === selectedConfigId.value)
  return cfg?.from_name || cfg?.name || 'Your Name'
})
const previewFromEmail = computed(() => {
  const cfg = smtpConfigs.value.find(c => c.id === selectedConfigId.value)
  return cfg?.from_email || cfg?.oauth_email || 'you@example.com'
})

function nextPreviewContact() {
  if (contacts.value.length > 0) previewContactIndex.value = (previewContactIndex.value + 1) % contacts.value.length
}
function prevPreviewContact() {
  if (contacts.value.length > 0) previewContactIndex.value = previewContactIndex.value === 0 ? contacts.value.length - 1 : previewContactIndex.value - 1
}

const selectedCount = computed(() => {
  if (contacts.value.length === 0) return 0
  if (rangeType.value === 'all') return contacts.value.length
  if (rangeType.value === 'first') return Math.min(firstN.value, contacts.value.length)
  return Math.min(rangeTo.value - rangeFrom.value + 1, contacts.value.length)
})

const selectedConfigName = computed(() => {
  const cfg = smtpConfigs.value.find(c => c.id === selectedConfigId.value)
  if (!cfg) return ''
  if (cfg.provider_type === 'google') return `${cfg.name} (Gmail)`
  if (cfg.provider_type === 'microsoft') return `${cfg.name} (Outlook)`
  return `${cfg.name} (${cfg.host})`
})

// ───── Send ─────
async function handleSend() {
  if (!canSend.value) return
  sending.value = true
  result.value = null

  const formData = new FormData()
  const config = smtpConfigs.value.find(c => c.id === selectedConfigId.value)
  if (!config) { toast.error('No SMTP config selected'); sending.value = false; return }

  formData.set('configId', config.id)
  formData.set('campaignName', campaignName.value || `Campaign ${new Date().toLocaleDateString()}`)
  formData.set('subject', subject.value)
  formData.set('htmlContent', htmlContent.value)
  formData.set('delay', delay.value.toString())

  if (excelFile.value) formData.set('excelFile', excelFile.value)

  let start = 0, count = contacts.value.length
  if (rangeType.value === 'first') count = Math.min(firstN.value, contacts.value.length)
  else if (rangeType.value === 'range') { start = rangeFrom.value - 1; count = Math.min(rangeTo.value - rangeFrom.value + 1, contacts.value.length - start) }
  formData.set('emailRangeStart', start.toString())
  formData.set('emailRangeCount', count.toString())

  if (useBatch.value) {
    formData.set('useBatch', 'on')
    formData.set('batchSize', batchSize.value.toString())
    formData.set('batchDelay', batchDelay.value.toString())
    formData.set('emailDelay', emailDelay.value.toString())
  }

  if (useSchedule.value && scheduledTime.value) {
    formData.set('scheduleEmail', 'on')
    formData.set('scheduledTime', new Date(scheduledTime.value).toISOString())
    if (notifyEmail.value) formData.set('notifyEmail', notifyEmail.value)
  }

  try {
    const response = await emailApi.send(formData)
    result.value = response
    if (response.success) toast.success(response.message || 'Emails sent successfully!')
    else toast.error(response.message || 'Failed to send emails')
  } catch (err: any) {
    result.value = { success: false, message: err.message || 'Failed to send emails' }
    toast.error(err.message || 'Failed to send emails')
  } finally {
    sending.value = false
  }
}

onMounted(() => { fetchTemplates() })
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Header -->
    <header class="mb-8">
      <div class="flex items-start justify-between gap-4 max-md:flex-col">
        <div class="flex-1 min-w-0">
          <input
            v-model="campaignName"
            type="text"
            class="text-2xl font-semibold text-foreground bg-transparent border-none outline-none w-full placeholder:text-muted-foreground/60"
            placeholder="Untitled Campaign"
          />
          <p class="text-muted-foreground text-sm mt-0.5">Name your campaign so you can find it later in reports</p>
        </div>
      </div>
      <Stepper :steps="stepperSteps" :currentStep="activeStep" class="mt-5" @step-click="goToStep" />
    </header>

    <!-- Result banner -->
    <AlertBanner v-if="result" :type="result.success ? 'success' : 'error'" dismissible class="mb-6" @dismiss="result = null">
      <strong class="block mb-1">{{ result.success ? 'Success!' : 'Error' }}</strong>
      <p class="text-sm opacity-80 m-0">{{ result.message }}</p>
    </AlertBanner>

    <!-- ═══════════════ STEP 1: Recipients ═══════════════ -->
    <div v-show="activeStep === 0" class="wizard-step">
      <div class="step-header">
        <div>
          <h2 class="step-title"><Users :size="20" class="text-accent" /> Choose Recipients</h2>
          <p class="step-desc">Select who will receive this campaign. Pick a contact list or upload a file.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- Email Config -->
        <div class="card">
          <h3 class="card-title">
            <Settings :size="16" class="text-accent" />
            Email Provider
            <InfoTip text="Choose the SMTP configuration or connected email account to send from" side="right" />
          </h3>
          <Select v-model="selectedConfigId">
            <SelectTrigger><SelectValue placeholder="Select provider..." /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="config in smtpConfigs" :key="config.id" :value="config.id">
                {{ config.name }}
                <template v-if="config.provider_type === 'google'">(Gmail)</template>
                <template v-else-if="config.provider_type === 'microsoft'">(Outlook)</template>
                <template v-else>({{ config.host }})</template>
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="smtpConfigs.length === 0" class="text-muted-foreground text-[13px] mt-2">
            No providers configured. <router-link to="/settings/smtp" class="text-accent hover:underline">Add one</router-link>
          </p>
          <div v-else-if="selectedConfigId" class="mt-2 flex items-center gap-1.5 text-[13px] text-success">
            <CheckCircle :size="14" /> Provider selected
          </div>
        </div>

        <!-- Recipients -->
        <div class="card">
          <h3 class="card-title">
            <Users :size="16" class="text-accent" />
            Recipients
            <InfoTip text="Choose a saved contact list or upload a CSV/Excel file with email addresses" side="right" />
          </h3>

          <!-- Mode toggle -->
          <div class="flex gap-1 mb-4 p-0.5 bg-muted rounded-lg">
            <button
              class="flex-1 text-[13px] font-medium py-1.5 rounded-md transition-all"
              :class="recipientMode === 'list' ? 'bg-accent text-white shadow-sm' : 'text-muted-foreground hover:text-muted-foreground'"
              @click="recipientMode = 'list'"
            >Contact List</button>
            <button
              class="flex-1 text-[13px] font-medium py-1.5 rounded-md transition-all"
              :class="recipientMode === 'upload' ? 'bg-accent text-white shadow-sm' : 'text-muted-foreground hover:text-muted-foreground'"
              @click="recipientMode = 'upload'"
            ><Upload :size="13" class="inline -mt-px mr-1" />Upload File</button>
          </div>

          <!-- Contact list -->
          <div v-if="recipientMode === 'list'">
            <Select v-model="selectedListId" :disabled="loadingContacts">
              <SelectTrigger><SelectValue placeholder="Select a contact list..." /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="list in lists" :key="list.id" :value="list.id">
                  {{ list.name }} ({{ list.contact_count }} contacts)
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="lists.length === 0" class="text-muted-foreground text-[13px] mt-2">
              No lists yet. <router-link to="/contacts" class="text-accent hover:underline">Create one</router-link>
            </p>
            <p v-if="loadingContacts" class="text-muted-foreground text-[13px] mt-2 flex items-center gap-1">
              <Loader2 :size="12" class="animate-spin" /> Loading contacts...
            </p>
            <div v-else-if="contacts.length > 0 && selectedListId" class="mt-2 flex items-center gap-1.5 text-[13px] text-success">
              <CheckCircle :size="14" /> <strong>{{ contacts.length }}</strong> contacts loaded
            </div>
          </div>

          <!-- File upload -->
          <div v-else>
            <label class="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-border rounded-xl bg-background cursor-pointer transition-all hover:border-accent hover:bg-accent/3 group">
              <Upload :size="24" class="text-muted-foreground group-hover:text-accent transition-colors" />
              <span class="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                Click to upload <span class="text-muted-foreground">CSV, XLSX, or XLS</span>
              </span>
              <input type="file" class="hidden" accept=".csv,.xlsx,.xls"
                @change="(e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFileSelected(f) }" />
            </label>
            <div v-if="contacts.length > 0 && !selectedListId" class="mt-2 flex items-center gap-1.5 text-[13px] text-success">
              <CheckCircle :size="14" /> <strong>{{ contacts.length }}</strong> contacts from file
            </div>
          </div>
        </div>
      </div>

      <!-- Validation hint -->
      <div v-if="!step1Valid" class="mt-4 p-3 bg-warning/8 border border-warning/20 rounded-lg text-[13px] text-warning flex items-start gap-2">
        <AlertCircle :size="16" class="shrink-0 mt-0.5" />
        <span>
          <template v-if="!selectedConfigId">Select an email provider to continue.</template>
          <template v-else>Add recipients by choosing a contact list or uploading a file.</template>
        </span>
      </div>
    </div>

    <!-- ═══════════════ STEP 2: Content ═══════════════ -->
    <div v-show="activeStep === 1" class="wizard-step">
      <div class="step-header">
        <div>
          <h2 class="step-title"><Mail :size="20" class="text-accent" /> Write Your Email</h2>
          <p class="step-desc">Compose your email content. Start from a template or write from scratch.</p>
        </div>
      </div>

      <!-- Template selector -->
      <div class="card mb-5">
        <h3 class="card-title">
          <FileText :size="16" class="text-accent" />
          Start from Template
          <InfoTip text="Templates pre-fill your email content. You can edit it after applying." side="right" />
          <span class="text-[11px] font-normal text-muted-foreground ml-auto">(optional)</span>
        </h3>
        <Select v-model="selectedTemplateId" :disabled="loadingTemplates">
          <SelectTrigger><SelectValue :placeholder="loadingTemplates ? 'Loading...' : 'Choose a template or start blank...'" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="tpl in templates" :key="tpl.id" :value="tpl.id">
              {{ tpl.name }}
              <template v-if="tpl.category !== 'general'"> ({{ tpl.category }})</template>
            </SelectItem>
          </SelectContent>
        </Select>
        <p v-if="loadingTemplate" class="text-muted-foreground text-[13px] mt-2 flex items-center gap-1">
          <Loader2 :size="12" class="animate-spin" /> Applying template...
        </p>
      </div>

      <!-- Mode switcher -->
      <div class="flex justify-between items-center mb-3" v-if="selectedTemplateId">
        <span class="text-[13px] text-muted-foreground">Editor mode:</span>
        <div class="flex gap-1.5">
          <Button variant="ghost" size="sm" :class="{ '!text-accent !bg-accent/8': editorMode === 'preview' }" @click="editorMode = 'preview'">
            <LayoutTemplate :size="14" /> Preview
          </Button>
          <Button variant="ghost" size="sm" :class="{ '!text-accent !bg-accent/8': editorMode === 'rich' }" @click="editorMode = 'rich'">
            <Send :size="14" /> Rich Editor
          </Button>
          <Button variant="ghost" size="sm" :class="{ '!text-accent !bg-accent/8': editorMode === 'html' }" @click="editorMode = 'html'">
            <Code :size="14" /> HTML
          </Button>
        </div>
      </div>

      <!-- Template preview mode -->
      <div v-if="editorMode === 'preview'" class="card">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <p class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1">Template Preview</p>
            <h3 class="text-base font-semibold m-0 text-foreground">{{ previewSubject || subject || 'Untitled Subject' }}</h3>
            <p class="text-sm text-muted-foreground mt-1">
              Showing preview with {{ contacts.length > 0 ? 'first contact' : 'sample data' }}.
            </p>
          </div>
          <div class="flex gap-2 shrink-0">
            <Button variant="secondary" size="sm" @click="showPreview = true"><Eye :size="14" /> Full Preview</Button>
            <Button size="sm" @click="editorMode = 'rich'">Edit Content</Button>
          </div>
        </div>
        <div class="border border-border rounded-xl overflow-hidden bg-white text-[#0f172a]">
          <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between text-[13px] bg-gray-50">
            <span><strong>From:</strong> {{ previewFromName }} &lt;{{ previewFromEmail }}&gt;</span>
            <span><strong>To:</strong> {{ previewToName }} &lt;{{ previewToEmail }}&gt;</span>
          </div>
          <div class="px-4 py-3 border-b border-gray-200 text-[13px]"><strong>Subject:</strong> {{ previewSubject }}</div>
          <div class="p-5 text-[14px] leading-[1.7]" v-html="templatePreviewHtml || previewContent"></div>
        </div>
        <div class="flex items-center justify-between mt-3 text-[12px] text-muted-foreground">
          <span>Template content is locked. Click "Edit Content" to modify.</span>
          <Button variant="ghost" size="sm" @click="editorMode = 'rich'">Switch to Editor</Button>
        </div>
      </div>

      <!-- Rich editor -->
      <div v-else-if="editorMode === 'rich'" class="flex flex-col gap-2">
        <div v-if="selectedTemplateId" class="flex justify-end gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" @click="editorMode = 'preview'">View HTML Preview</Button>
          <Button variant="secondary" size="sm" @click="showPreview = true"><Eye :size="14" /> Full Preview</Button>
        </div>
        <EmailEditor v-model:subject="subject" v-model:content="htmlContent" v-model:delay="delay" :columns="columns" @preview="showPreview = true" />
      </div>

      <!-- HTML editor -->
      <div v-else-if="editorMode === 'html'" class="flex flex-col gap-3">
        <div class="flex items-center justify-between text-sm text-muted-foreground">
          <span v-text="'Raw HTML editor (placeholders like {{FirstName}} stay intact)'" />
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" @click="editorMode = 'preview'">Preview</Button>
            <Button variant="secondary" size="sm" @click="showPreview = true"><Eye :size="14" /> Full Preview</Button>
          </div>
        </div>
        <HtmlCodeEditor v-model:content="htmlContent" />
      </div>

      <!-- Validation hint -->
      <div v-if="!step2Valid" class="mt-4 p-3 bg-warning/8 border border-warning/20 rounded-lg text-[13px] text-warning flex items-start gap-2">
        <AlertCircle :size="16" class="shrink-0 mt-0.5" />
        <span>
          <template v-if="!subject.trim()">Enter a subject line for your email.</template>
          <template v-else>Add some email content using the editor above.</template>
        </span>
      </div>
    </div>

    <!-- ═══════════════ STEP 3: Settings ═══════════════ -->
    <div v-show="activeStep === 2" class="wizard-step">
      <div class="step-header">
        <div>
          <h2 class="step-title"><Settings :size="20" class="text-accent" /> Sending Settings</h2>
          <p class="step-desc">Configure how and when your emails are sent. All settings are optional — defaults work great for most campaigns.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- Range selector -->
        <div class="card" v-if="contacts.length > 0">
          <h3 class="card-title">
            <Users :size="16" class="text-accent" />
            Recipient Range
            <InfoTip text="Choose to send to all contacts, only the first N, or a specific range. Useful for testing with a small batch first." side="right" />
          </h3>
          <div class="flex flex-col gap-3 mb-4">
            <label class="flex items-center gap-2.5 cursor-pointer py-1">
              <input type="radio" v-model="rangeType" value="all" class="accent-accent w-4 h-4" />
              <span class="text-sm text-muted-foreground">Send to all ({{ contacts.length }})</span>
            </label>
            <label class="flex items-center gap-2.5 cursor-pointer py-1">
              <input type="radio" v-model="rangeType" value="first" class="accent-accent w-4 h-4" />
              <span class="text-sm text-muted-foreground">First N contacts</span>
            </label>
            <label class="flex items-center gap-2.5 cursor-pointer py-1">
              <input type="radio" v-model="rangeType" value="range" class="accent-accent w-4 h-4" />
              <span class="text-sm text-muted-foreground">Specific range</span>
            </label>
          </div>
          <div v-if="rangeType === 'first'" class="mb-3">
            <Input type="number" :model-value="firstN" @update:model-value="firstN = Number($event)" min="1" :max="contacts.length" placeholder="Number of contacts" />
          </div>
          <div v-if="rangeType === 'range'" class="flex items-center gap-3 mb-3">
            <Input type="number" :model-value="rangeFrom" @update:model-value="rangeFrom = Number($event)" class="w-[100px]" min="1" placeholder="From" />
            <span class="text-muted-foreground text-sm">to</span>
            <Input type="number" :model-value="rangeTo" @update:model-value="rangeTo = Number($event)" class="w-[100px]" min="1" placeholder="To" />
          </div>
          <div class="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
            Will send to <strong class="text-accent">{{ selectedCount }}</strong> contacts
          </div>
        </div>

        <!-- Batch settings -->
        <div class="card">
          <h3 class="card-title">
            <Zap :size="16" class="text-accent" />
            Batch Sending
            <InfoTip text="Split your campaign into smaller batches with delays between them. Helps avoid rate limits and improves deliverability." side="right" />
          </h3>
          <label class="flex items-center gap-2 cursor-pointer">
            <Checkbox v-model="useBatch" />
            <span class="text-sm text-muted-foreground">Enable batch sending</span>
          </label>
          <div v-if="useBatch" class="mt-4 pt-4 border-t border-border flex flex-col gap-3">
            <div class="!mb-0">
              <Label class="flex items-center gap-1.5">
                Batch Size
                <InfoTip text="Number of emails to send in each batch before pausing" :size="12" />
              </Label>
              <Input type="number" :model-value="batchSize" @update:model-value="batchSize = Number($event)" min="1" max="100" />
            </div>
            <div class="!mb-0">
              <Label class="flex items-center gap-1.5">
                Batch Delay (seconds)
                <InfoTip text="Wait time between batches. 60+ seconds recommended." :size="12" />
              </Label>
              <Input type="number" :model-value="batchDelay" @update:model-value="batchDelay = Number($event)" min="1" />
            </div>
            <div class="!mb-0">
              <Label class="flex items-center gap-1.5">
                Email Delay (seconds)
                <InfoTip text="Wait time between individual emails within a batch" :size="12" />
              </Label>
              <Input type="number" :model-value="emailDelay" @update:model-value="emailDelay = Number($event)" min="1" />
            </div>
          </div>
        </div>

        <!-- Schedule settings -->
        <div class="card">
          <h3 class="card-title">
            <Clock :size="16" class="text-accent" />
            Schedule
            <InfoTip text="Schedule your campaign to send at a specific date and time instead of sending immediately" side="right" />
          </h3>
          <label class="flex items-center gap-2 cursor-pointer">
            <Checkbox v-model="useSchedule" />
            <span class="text-sm text-muted-foreground">Schedule for later</span>
          </label>
          <div v-if="useSchedule" class="mt-4 pt-4 border-t border-border flex flex-col gap-3">
            <div class="!mb-0">
              <Label>Scheduled Time</Label>
              <Input v-model="scheduledTime" type="datetime-local" />
            </div>
            <div class="!mb-0">
              <Label class="flex items-center gap-1.5">
                Notification Email
                <InfoTip text="Get notified by email when the scheduled campaign finishes sending" :size="12" />
                <span class="text-[11px] font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input v-model="notifyEmail" type="email" placeholder="you@example.com" />
            </div>
          </div>
        </div>

        <!-- Server Rotation -->
        <div class="card">
          <h3 class="card-title">
            <Zap :size="16" class="text-accent" />
            Server Rotation
            <InfoTip text="When you have multiple sending providers, choose how to distribute emails across them. Smart mode picks the best provider automatically." side="right" />
          </h3>
          <div class="flex flex-col gap-2">
            <label v-for="mode in [
              { value: 'smart', label: 'Smart (Auto)', desc: 'Score-based selection — picks best provider by quota, speed, and success rate' },
              { value: 'round_robin', label: 'Round Robin', desc: 'Distribute evenly across all configured providers' },
              { value: 'manual', label: 'Manual', desc: 'Use only the selected provider above' },
            ]" :key="mode.value" class="flex items-start gap-2.5 p-2.5 rounded-lg border border-border cursor-pointer hover:border-accent/30 transition" :class="rotationMode === mode.value ? 'border-accent/40 bg-accent/5' : ''">
              <input type="radio" :value="mode.value" v-model="rotationMode" class="mt-0.5 accent-accent" />
              <div>
                <div class="text-xs font-medium" :class="rotationMode === mode.value ? 'text-accent' : 'text-foreground'">{{ mode.label }}</div>
                <div class="text-[10px] text-muted-foreground">{{ mode.desc }}</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Delay between emails (standalone, outside batch) -->
        <div class="card" v-if="!useBatch">
          <h3 class="card-title">
            <Clock :size="16" class="text-accent" />
            Email Delay
            <InfoTip text="Wait time between sending individual emails. 15-30 seconds recommended to avoid rate limits." side="right" />
          </h3>
          <div class="!mb-0">
            <Label>Delay Between Emails (seconds)</Label>
            <Input type="number" :model-value="delay" @update:model-value="delay = Number($event)" min="15" max="60" />
            <p class="text-muted-foreground text-[12px] mt-1.5">15-30 seconds recommended to avoid rate limits</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ STEP 4: Review & Send ═══════════════ -->
    <div v-show="activeStep === 3" class="wizard-step">
      <div class="step-header">
        <div>
          <h2 class="step-title"><CheckCircle :size="20" class="text-accent" /> Review & Send</h2>
          <p class="step-desc">Double-check everything before sending. Click any section to go back and edit.</p>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <!-- Summary cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Provider -->
          <button class="card text-left hover:border-accent/40 transition-colors" @click="activeStep = 0">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Provider</span>
              <ChevronRight :size="14" class="text-muted-foreground" />
            </div>
            <p class="text-sm font-medium text-foreground truncate">{{ selectedConfigName || 'Not selected' }}</p>
          </button>

          <!-- Recipients -->
          <button class="card text-left hover:border-accent/40 transition-colors" @click="activeStep = 0">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Recipients</span>
              <ChevronRight :size="14" class="text-muted-foreground" />
            </div>
            <p class="text-sm font-medium text-foreground">
              <span class="text-accent">{{ selectedCount }}</span> contacts
              <span v-if="rangeType !== 'all'" class="text-muted-foreground font-normal">({{ rangeType === 'first' ? `first ${firstN}` : `${rangeFrom}-${rangeTo}` }})</span>
            </p>
          </button>

          <!-- Schedule -->
          <button class="card text-left hover:border-accent/40 transition-colors" @click="activeStep = 2">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Delivery</span>
              <ChevronRight :size="14" class="text-muted-foreground" />
            </div>
            <p class="text-sm font-medium text-foreground">
              <template v-if="useSchedule && scheduledTime">Scheduled: {{ new Date(scheduledTime).toLocaleString() }}</template>
              <template v-else>Send immediately</template>
            </p>
            <p v-if="useBatch" class="text-[12px] text-muted-foreground mt-0.5">Batch: {{ batchSize }} per batch, {{ batchDelay }}s delay</p>
          </button>
        </div>

        <!-- Email preview -->
        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="card-title !mb-0">
              <Eye :size="16" class="text-accent" />
              Email Preview
            </h3>
            <div class="flex gap-2">
              <Button variant="ghost" size="sm" @click="activeStep = 1">Edit Content</Button>
              <Button variant="secondary" size="sm" @click="showPreview = true"><Eye :size="14" /> Full Preview</Button>
            </div>
          </div>
          <div class="border border-border rounded-xl overflow-hidden bg-white text-[#0f172a]">
            <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between text-[13px] bg-gray-50 flex-wrap gap-2">
              <span><strong>From:</strong> {{ previewFromName }} &lt;{{ previewFromEmail }}&gt;</span>
              <span><strong>To:</strong> {{ previewToName }} &lt;{{ previewToEmail }}&gt;</span>
            </div>
            <div class="px-4 py-3 border-b border-gray-200 text-[13px]"><strong>Subject:</strong> {{ previewSubject }}</div>
            <div class="p-5 text-[14px] leading-[1.7] max-h-[300px] overflow-y-auto" v-html="templatePreviewHtml || previewContent"></div>
          </div>
        </div>

        <!-- Send button -->
        <div class="card !p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="text-sm text-muted-foreground">
              <span v-if="canSend" class="text-success flex items-center gap-1.5">
                <CheckCircle :size="16" /> Ready to send
              </span>
              <span v-else class="text-warning flex items-center gap-1.5">
                <AlertCircle :size="16" /> Some required fields are missing
              </span>
            </div>
          </div>
          <Button size="lg" class="w-full" :disabled="!canSend || sending" @click="handleSend">
            <Loader2 v-if="sending" :size="18" class="animate-spin" />
            <Calendar v-else-if="useSchedule" :size="18" />
            <Send v-else :size="18" />
            {{ useSchedule ? 'Schedule' : 'Send' }} Campaign to {{ selectedCount }} contacts
          </Button>
          <p class="text-[12px] text-muted-foreground text-center mt-3">
            <template v-if="useSchedule">Your campaign will be queued and sent at the scheduled time.</template>
            <template v-else>Emails will start sending immediately after you click the button.</template>
          </p>
        </div>
      </div>
    </div>

    <!-- ═══════════════ Navigation ═══════════════ -->
    <div class="flex items-center justify-between mt-8 pt-5 border-t border-border">
      <Button v-if="activeStep > 0" variant="secondary" @click="goBack">
        <ArrowLeft :size="16" /> Back
      </Button>
      <div v-else />

      <div class="flex items-center gap-3">
        <span class="text-[13px] text-muted-foreground">Step {{ activeStep + 1 }} of 4</span>
        <Button
          v-if="activeStep < 3"
          :disabled="!canProceed"
          @click="goNext"
        >
          Continue <ArrowRight :size="16" />
        </Button>
      </div>
    </div>

    <!-- Email Preview Modal -->
    <EmailPreviewModal
      :show="showPreview"
      :contacts="contacts"
      :contactIndex="previewContactIndex"
      :fromName="previewFromName"
      :fromEmail="previewFromEmail"
      :toName="previewToName"
      :toEmail="previewToEmail"
      :previewSubject="previewSubject"
      :previewContent="previewContent"
      @close="showPreview = false"
      @prev="prevPreviewContact"
      @next="nextPreviewContact"
    />
  </div>
</template>

<style scoped>
.wizard-step {
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.step-header {
  margin-bottom: 24px;
}
.step-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-foreground);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px 0;
}
.step-desc {
  font-size: 14px;
  color: var(--color-muted-foreground);
  margin: 0;
}
.card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-foreground);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
}
</style>
