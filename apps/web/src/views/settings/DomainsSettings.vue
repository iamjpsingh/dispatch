<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi, type SendingDomain, type DnsRecord, type SendingEmailRecord } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Modal from '@/components/ui/Modal.vue'
import {
  Globe, Plus, Trash2, Check, Copy, Loader2, Shield, ShieldCheck, ShieldAlert,
  Mail,
} from 'lucide-vue-next'

const toast = useToast()

const loading = ref(true)
const domains = ref<SendingDomain[]>([])
const emails = ref<SendingEmailRecord[]>([])

// Add domain
const showAddDomain = ref(false)
const newDomain = ref('')
const addingDomain = ref(false)
const dnsRecords = ref<DnsRecord[]>([])
const showDnsModal = ref(false)
const dnsDomainName = ref('')

// Add email
const showAddEmail = ref(false)
const newEmailDomainId = ref('')
const newEmailAddress = ref('')
const newEmailDisplayName = ref('')
const addingEmail = ref(false)

async function loadData() {
  loading.value = true
  try {
    const [d, e] = await Promise.all([adminApi.getDomains(), adminApi.getSendingEmails()])
    domains.value = d
    emails.value = e
  } catch (e: any) { toast.error(e.message) }
  finally { loading.value = false }
}

async function addDomain() {
  if (!newDomain.value.trim()) return
  addingDomain.value = true
  try {
    const result = await adminApi.addDomain(newDomain.value.trim())
    domains.value.unshift(result.domain)
    dnsRecords.value = result.dnsRecords
    dnsDomainName.value = result.domain.domain
    showAddDomain.value = false
    newDomain.value = ''
    showDnsModal.value = true
  } catch (e: any) { toast.error(e.message) }
  finally { addingDomain.value = false }
}

async function viewDns(domain: SendingDomain) {
  try {
    const records = await adminApi.getDnsRecords(domain.id)
    dnsRecords.value = records
    dnsDomainName.value = domain.domain
    showDnsModal.value = true
  } catch (e: any) { toast.error(e.message) }
}

async function verifyDomain(domain: SendingDomain) {
  try {
    await adminApi.verifyDomain(domain.id)
    toast.success(`${domain.domain} verified`)
    loadData()
  } catch (e: any) { toast.error(e.message) }
}

async function deleteDomain(domain: SendingDomain) {
  if (!confirm(`Delete ${domain.domain} and all its sending emails?`)) return
  try {
    await adminApi.deleteDomain(domain.id)
    toast.success('Domain deleted')
    loadData()
  } catch (e: any) { toast.error(e.message) }
}

async function addEmail() {
  if (!newEmailDomainId.value || !newEmailAddress.value.trim()) return
  addingEmail.value = true
  try {
    await adminApi.addSendingEmail(newEmailDomainId.value, newEmailAddress.value.trim(), newEmailDisplayName.value.trim() || undefined)
    toast.success('Sending email added')
    showAddEmail.value = false
    newEmailAddress.value = ''
    newEmailDisplayName.value = ''
    loadData()
  } catch (e: any) { toast.error(e.message) }
  finally { addingEmail.value = false }
}

async function deleteEmail(emailId: string) {
  try {
    await adminApi.deleteSendingEmail(emailId)
    toast.success('Sending email removed')
    loadData()
  } catch (e: any) { toast.error(e.message) }
}

async function setDefault(emailId: string) {
  try {
    await adminApi.updateSendingEmail(emailId, { is_default: true })
    toast.success('Default email updated')
    loadData()
  } catch (e: any) { toast.error(e.message) }
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copied')
}

function domainEmails(domainId: string): SendingEmailRecord[] {
  return emails.value.filter(e => e.domain_id === domainId)
}

onMounted(loadData)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-foreground">Sending Domains</h2>
        <p class="text-sm text-muted-foreground mt-1">Add your domains, configure DNS, and create sending email addresses.</p>
      </div>
      <Button size="sm" @click="showAddDomain = true"><Plus :size="14" /> Add Domain</Button>
    </div>

    <div v-if="loading" class="flex justify-center py-12"><Loader2 :size="20" class="animate-spin text-muted-foreground" /></div>

    <div v-else-if="domains.length === 0" class="bg-secondary border border-border rounded-xl p-8 text-center">
      <Globe :size="36" class="mx-auto text-muted-foreground mb-3" />
      <p class="text-sm text-muted-foreground">No sending domains yet. Add one to start sending from your own domain.</p>
    </div>

    <div v-else class="space-y-4">
      <div v-for="domain in domains" :key="domain.id" class="bg-secondary border border-border rounded-xl">
        <!-- Domain header -->
        <div class="px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <ShieldCheck v-if="domain.verification_status === 'verified'" :size="16" class="text-green-400" />
            <ShieldAlert v-else :size="16" class="text-amber-400" />
            <span class="font-medium text-sm text-foreground">{{ domain.domain }}</span>
            <span :class="['text-[10px] px-2 py-0.5 rounded-full font-medium',
              domain.verification_status === 'verified' ? 'bg-green-500/15 text-green-400' :
              domain.verification_status === 'failed' ? 'bg-red-500/15 text-red-400' :
              'bg-amber-500/15 text-amber-400']">
              {{ domain.verification_status }}
            </span>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="sm" class="px-2 py-1" @click="viewDns(domain)" title="DNS Records">
              <Shield :size="13" />
            </Button>
            <Button v-if="domain.verification_status !== 'verified'" variant="ghost" size="sm" class="px-2 py-1 text-green-400" @click="verifyDomain(domain)" title="Verify">
              <Check :size="13" />
            </Button>
            <Button variant="ghost" size="sm" class="px-2 py-1 text-red-400" @click="deleteDomain(domain)" title="Delete">
              <Trash2 :size="13" />
            </Button>
          </div>
        </div>

        <!-- Sending emails under this domain -->
        <div class="border-t border-border px-4 py-2 bg-background">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Sending Emails</span>
            <button class="text-[11px] text-accent hover:text-accent/80 font-medium" @click="newEmailDomainId = domain.id; showAddEmail = true">
              <Plus :size="11" class="inline" /> Add
            </button>
          </div>
          <div v-if="domainEmails(domain.id).length === 0" class="text-xs text-muted-foreground py-2">No sending emails yet</div>
          <div v-for="email in domainEmails(domain.id)" :key="email.id" class="flex items-center justify-between py-1.5 text-xs">
            <div class="flex items-center gap-2">
              <Mail :size="12" class="text-muted-foreground" />
              <span class="text-foreground">{{ email.display_name ? `${email.display_name} <${email.email}>` : email.email }}</span>
              <span v-if="email.is_default" class="text-[9px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">Default</span>
            </div>
            <div class="flex items-center gap-1">
              <button v-if="!email.is_default" class="text-muted-foreground hover:text-accent text-[10px]" @click="setDefault(email.id)">Set Default</button>
              <button class="text-muted-foreground hover:text-red-400 p-0.5" @click="deleteEmail(email.id)"><Trash2 :size="11" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Domain Modal -->
    <Modal :show="showAddDomain" title="Add Sending Domain" size="sm" @close="showAddDomain = false">
      <div class="flex flex-col gap-2">
        <Label>Domain</Label>
        <Input v-model="newDomain" placeholder="example.com" @keyup.enter="addDomain" />
        <p class="text-xs text-muted-foreground mt-1">Enter your domain name. You'll need to add DNS records to verify ownership.</p>
      </div>
      <template #footer>
        <Button variant="ghost" @click="showAddDomain = false">Cancel</Button>
        <Button :disabled="!newDomain.trim() || addingDomain" @click="addDomain">
          <Loader2 v-if="addingDomain" :size="14" class="animate-spin" />
          Add Domain
        </Button>
      </template>
    </Modal>

    <!-- DNS Records Modal -->
    <Modal :show="showDnsModal" :title="`DNS Records — ${dnsDomainName}`" size="lg" @close="showDnsModal = false">
      <p class="text-sm text-muted-foreground mb-4">Add these DNS records to your domain to enable email sending. After adding, click "Verify" to confirm.</p>
      <div class="space-y-3">
        <div v-for="(record, i) in dnsRecords" :key="i" class="bg-background border border-border rounded-lg p-3">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-semibold text-muted-foreground">{{ record.type }} Record — {{ record.purpose }}</span>
            <button class="text-muted-foreground hover:text-accent" @click="copyText(record.value)"><Copy :size="12" /></button>
          </div>
          <div class="text-[11px] text-muted-foreground mb-0.5">Name: <code class="text-muted-foreground">{{ record.name }}</code></div>
          <div class="text-[11px] text-muted-foreground">Value: <code class="text-muted-foreground break-all">{{ record.value }}</code></div>
        </div>
      </div>
    </Modal>

    <!-- Add Email Modal -->
    <Modal :show="showAddEmail" title="Add Sending Email" size="sm" @close="showAddEmail = false">
      <div class="flex flex-col gap-2">
        <Label>Email Address</Label>
        <Input v-model="newEmailAddress" placeholder="hello@example.com" />
      </div>
      <div class="flex flex-col gap-2">
        <Label>Display Name (optional)</Label>
        <Input v-model="newEmailDisplayName" placeholder="My Company" />
      </div>
      <template #footer>
        <Button variant="ghost" @click="showAddEmail = false">Cancel</Button>
        <Button :disabled="!newEmailAddress.trim() || addingEmail" @click="addEmail">
          <Loader2 v-if="addingEmail" :size="14" class="animate-spin" /> Add Email
        </Button>
      </template>
    </Modal>
  </div>
</template>
