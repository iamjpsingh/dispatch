<script setup lang="ts">
import { ref } from 'vue'
import { apiKeysApi } from '../../lib/api'
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
import {
  Hash, Plus, Trash2, Copy, Check, Loader2, Key,
  AlertTriangle, Shield, Clock,
} from 'lucide-vue-next'

const toast = useToast()

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  scopes: string
  last_used_at: string | null
  expires_at: string | null
  enabled: number
  created_at: string
}

const keys = ref<ApiKey[]>([])
const loading = ref(false)
const showCreate = ref(false)
const creating = ref(false)
const deleteConfirm = ref<{ show: boolean; id: string; name: string }>({ show: false, id: '', name: '' })

// Created key (shown once)
const createdKey = ref<{ key: string; name: string } | null>(null)
const keyCopied = ref(false)

// Form
const form = ref({
  name: '',
  scopes: ['read'] as string[],
})

const ALL_SCOPES = ['read', 'send', 'contacts', 'campaigns', 'templates', 'admin'] as const

async function fetchKeys() {
  loading.value = true
  try {
    keys.value = await apiKeysApi.list()
  } catch { keys.value = [] }
  finally { loading.value = false }
}

async function createKey() {
  if (!form.value.name.trim()) return
  creating.value = true
  try {
    const result = await apiKeysApi.create({
      name: form.value.name,
      scopes: form.value.scopes,
    })
    createdKey.value = { key: result.key, name: result.name }
    showCreate.value = false
    form.value = { name: '', scopes: ['read'] }
    await fetchKeys()
    toast.success('API key created')
  } catch (e: any) {
    toast.error(e.message || 'Failed to create key')
  } finally {
    creating.value = false
  }
}

async function toggleKey(key: ApiKey) {
  try {
    await apiKeysApi.toggle(key.id, !key.enabled)
    await fetchKeys()
  } catch (e: any) { toast.error(e.message || 'Failed') }
}

async function confirmDelete() {
  const id = deleteConfirm.value.id
  deleteConfirm.value.show = false
  try {
    await apiKeysApi.delete(id)
    keys.value = keys.value.filter(k => k.id !== id)
    toast.success('API key revoked')
  } catch (e: any) { toast.error(e.message || 'Failed') }
}

function copyKey(text: string) {
  navigator.clipboard.writeText(text)
  keyCopied.value = true
  toast.success('Key copied to clipboard')
  setTimeout(() => { keyCopied.value = false }, 3000)
}

function toggleScope(scope: string) {
  const idx = form.value.scopes.indexOf(scope)
  if (idx >= 0) form.value.scopes.splice(idx, 1)
  else form.value.scopes.push(scope)
}

function parseScopes(scopesJson: string): string[] {
  try { return JSON.parse(scopesJson) } catch { return [] }
}

function formatDate(d: string | null) {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function relativeTime(d: string | null) {
  if (!d) return 'Never'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

fetchKeys()
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex justify-between items-start">
      <div>
        <h2 class="flex items-center gap-2.5 text-base font-semibold text-foreground mb-1">
          <Hash :size="18" class="text-accent" /> API Keys
        </h2>
        <p class="text-muted-foreground text-sm">Generate keys for programmatic access to the Dispatch API</p>
      </div>
      <Button @click="showCreate = true"><Plus :size="16" /> Create Key</Button>
    </div>

    <!-- Created Key Banner (shown once after creation) -->
    <Card v-if="createdKey" class="border-amber-500/30 bg-amber-500/5">
      <CardContent class="p-4">
        <div class="flex items-start gap-3">
          <AlertTriangle :size="20" class="text-amber-500 shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-foreground mb-1">Copy your API key now</p>
            <p class="text-xs text-muted-foreground mb-3">This is the only time you'll see the full key. Store it securely — it cannot be retrieved later.</p>
            <div class="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
              <code class="text-sm font-mono text-foreground flex-1 truncate select-all">{{ createdKey.key }}</code>
              <Button variant="ghost" size="sm" @click="copyKey(createdKey.key)">
                <Check v-if="keyCopied" :size="14" class="text-success" />
                <Copy v-else :size="14" />
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="sm" @click="createdKey = null" class="shrink-0 text-muted-foreground">&times;</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Loading -->
    <div v-if="loading">
      <Skeleton variant="table-row" :count="3" />
    </div>

    <!-- Empty State -->
    <Card v-else-if="keys.length === 0 && !createdKey">
      <EmptyState
        :icon="Key"
        title="No API keys"
        description="Create an API key to access the Dispatch API programmatically"
      >
        <template #actions>
          <Button @click="showCreate = true"><Plus :size="16" /> Create Key</Button>
        </template>
      </EmptyState>
    </Card>

    <!-- Keys Table -->
    <Card v-else-if="keys.length > 0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead>Last Used</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="w-[80px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="key in keys" :key="key.id" class="group">
            <TableCell class="font-medium">{{ key.name }}</TableCell>
            <TableCell>
              <code class="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{{ key.key_prefix }}••••••••</code>
            </TableCell>
            <TableCell>
              <div class="flex flex-wrap gap-1">
                <Badge v-for="s in parseScopes(key.scopes)" :key="s" variant="secondary" class="text-[10px]">{{ s }}</Badge>
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground text-xs">{{ relativeTime(key.last_used_at) }}</TableCell>
            <TableCell class="text-muted-foreground text-xs">{{ formatDate(key.created_at) }}</TableCell>
            <TableCell>
              <Badge
                :variant="key.enabled ? 'default' : 'secondary'"
                class="cursor-pointer"
                @click="toggleKey(key)"
              >
                {{ key.enabled ? 'Active' : 'Disabled' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button
                variant="ghost"
                size="sm"
                class="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-danger hover:bg-danger/10 h-7 w-7 p-0"
                title="Revoke"
                @click="deleteConfirm = { show: true, id: key.id, name: key.name }"
              >
                <Trash2 :size="14" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- Usage Info -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm">Using your API key</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-xs text-muted-foreground">Include your key in the <code class="bg-muted px-1.5 py-0.5 rounded text-foreground">Authorization</code> header:</p>
        <div class="bg-muted rounded-lg p-3">
          <code class="text-xs font-mono text-foreground">Authorization: Bearer dsp_your_api_key_here</code>
        </div>
        <div class="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2">
          <span class="flex items-center gap-1.5"><Shield :size="12" /> Keys are hashed with Argon2</span>
          <span class="flex items-center gap-1.5"><Clock :size="12" /> Rate limited per key</span>
        </div>
      </CardContent>
    </Card>

    <!-- Create Modal -->
    <Modal :show="showCreate" title="Create API Key" size="md" @close="showCreate = false">
      <div class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <Label>Key Name *</Label>
          <Input v-model="form.name" placeholder="e.g. Production, Staging, CI/CD" />
          <p class="text-xs text-muted-foreground">A label to identify this key</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>Permissions</Label>
          <p class="text-xs text-muted-foreground mb-1">Select what this key can access</p>
          <div class="grid grid-cols-2 gap-2">
            <label
              v-for="scope in ALL_SCOPES"
              :key="scope"
              class="flex items-center gap-2.5 px-3 py-2.5 bg-muted/50 border border-border rounded-lg cursor-pointer hover:border-accent/30 transition-colors"
              :class="form.scopes.includes(scope) && 'border-accent/40 bg-accent/5'"
            >
              <Checkbox :checked="form.scopes.includes(scope)" @update:checked="toggleScope(scope)" />
              <span class="text-sm capitalize">{{ scope }}</span>
            </label>
          </div>
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="showCreate = false">Cancel</Button>
        <Button :disabled="!form.name.trim() || form.scopes.length === 0 || creating" @click="createKey">
          <Loader2 v-if="creating" :size="16" class="animate-spin" />
          Create Key
        </Button>
      </template>
    </Modal>

    <ConfirmDialog
      :show="deleteConfirm.show"
      title="Revoke API Key"
      :message="`Revoke '${deleteConfirm.name}'? Any integrations using this key will stop working immediately.`"
      confirmText="Revoke"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="deleteConfirm.show = false"
    />
  </div>
</template>
