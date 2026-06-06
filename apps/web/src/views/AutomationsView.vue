<script setup lang="ts">
import { ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import Modal from '../components/ui/Modal.vue'
import SlidePanel from '../components/ui/SlidePanel.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import FlowCanvas from '../components/automation/FlowCanvas.vue'
import { automationsApi } from '../lib/api'
import { useToast } from '../composables/useToast'
import {
  Plus, Trash2, Play, Pause, Square, Loader2, Inbox, Users,
  Clock, Zap, Pencil,
} from 'lucide-vue-next'

const toast = useToast()

interface Automation {
  id: string
  name: string
  description: string
  trigger_type: string
  status: 'draft' | 'active' | 'paused'
  entry_list_id?: string
  enrolled_count: number
  completed_count: number
  flow_json?: string
  steps?: any[]
  created_at: string
  updated_at: string
}

const automations = ref<Automation[]>([])
const loading = ref(false)
const showCreateModal = ref(false)
const createForm = ref({ name: '', description: '', trigger_type: 'manual', entry_list_id: '' })
const creating = ref(false)
const deleteConfirm = ref<{ show: boolean; id: string }>({ show: false, id: '' })
const actionLoading = ref<string | null>(null)

// Flow editor
const showFlowEditor = ref(false)
const editingAutomation = ref<Automation | null>(null)
// @ts-expect-error templateRef used by Vue runtime
const flowCanvasRef = ref<InstanceType<typeof FlowCanvas> | null>(null)

const triggerLabels: Record<string, string> = {
  list_join: 'List Join', tag_added: 'Tag Added', score_change: 'Score Change',
  date_field: 'Date Field', form_submit: 'Form Submit', manual: 'Manual', api: 'API',
}

const statusStyles: Record<string, { class: string; label: string }> = {
  active: { class: 'bg-success/15 text-success', label: 'Active' },
  paused: { class: 'bg-warning/15 text-warning', label: 'Paused' },
  draft: { class: 'bg-muted text-muted-foreground', label: 'Draft' },
}

async function fetchAutomations() {
  loading.value = true
  try { automations.value = (await automationsApi.list()) as any[] } catch { automations.value = [] }
  finally { loading.value = false }
}

async function handleCreate() {
  creating.value = true
  try {
    const created = (await automationsApi.create(createForm.value as any)) as unknown as Automation
    automations.value.push(created)
    showCreateModal.value = false
    createForm.value = { name: '', description: '', trigger_type: 'manual', entry_list_id: '' }
    toast.success('Automation created')
  } catch (e: any) { toast.error(`Failed: ${e.message}`) }
  finally { creating.value = false }
}

async function handleAction(id: string, action: 'activate' | 'pause' | 'deactivate') {
  actionLoading.value = `${id}-${action}`
  try {
    const actionMap: Record<string, (id: string) => Promise<void>> = {
      activate: automationsApi.activate, pause: automationsApi.pause, deactivate: automationsApi.deactivate,
    }
    await actionMap[action]!(id)
    await fetchAutomations()
  } catch (e: any) { toast.error(`Action failed: ${e.message}`) }
  finally { actionLoading.value = null }
}

function promptDelete(id: string) { deleteConfirm.value = { show: true, id } }

async function confirmDelete() {
  const id = deleteConfirm.value.id
  deleteConfirm.value.show = false
  try {
    await automationsApi.delete(id)
    automations.value = automations.value.filter((a) => a.id !== id)
    toast.success('Automation deleted')
  } catch (e: any) { toast.error(`Failed: ${e.message}`) }
}

function openFlowEditor(a: Automation) {
  editingAutomation.value = a
  showFlowEditor.value = true
}

function closeFlowEditor() {
  showFlowEditor.value = false
  editingAutomation.value = null
}

function getFlowNodes(a: Automation): Node[] {
  if (!a.flow_json) return []
  try { return JSON.parse(a.flow_json).nodes || [] } catch { return [] }
}

function getFlowEdges(a: Automation): Edge[] {
  if (!a.flow_json) return []
  try { return JSON.parse(a.flow_json).edges || [] } catch { return [] }
}

async function handleFlowSave(nodes: Node[], edges: Edge[]) {
  if (!editingAutomation.value) return
  try {
    await automationsApi.update(editingAutomation.value.id, {
      name: editingAutomation.value.name,
      description: editingAutomation.value.description,
      trigger_type: editingAutomation.value.trigger_type,
      flow_json: JSON.stringify({ nodes, edges }),
    })
    const idx = automations.value.findIndex(a => a.id === editingAutomation.value!.id)
    if (idx >= 0 && automations.value[idx]) automations.value[idx].flow_json = JSON.stringify({ nodes, edges })
    toast.success('Flow saved')
  } catch (e: any) { toast.error(`Save failed: ${e.message}`) }
}

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

fetchAutomations()
</script>

<template>
  <div>
    <PageHeader title="Automations" subtitle="Build automated email workflows with drag-and-drop">
      <template #actions>
        <Button @click="showCreateModal = true"><Plus :size="16" /> New Automation</Button>
      </template>
    </PageHeader>

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
      <Skeleton variant="card" :count="4" />
    </div>

    <!-- Empty -->
    <div v-else-if="automations.length === 0" class="bg-card border border-border rounded-xl">
      <EmptyState
        :icon="Inbox"
        title="No automations yet"
        description="Create your first automation to start building email workflows"
      >
        <template #actions>
          <Button @click="showCreateModal = true"><Plus :size="16" /> Create Automation</Button>
        </template>
      </EmptyState>
    </div>

    <!-- Automations Grid -->
    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] max-md:grid-cols-1 gap-4">
      <div
        v-for="a in automations"
        :key="a.id"
        class="bg-card border border-border rounded-xl p-5 flex flex-col gap-3 transition-all duration-150 hover:border-primary/25 hover:shadow-sm"
      >
        <!-- Header: Name + Status -->
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-foreground truncate m-0">{{ a.name }}</h3>
            <p v-if="a.description" class="text-xs text-muted-foreground mt-1 m-0 truncate">{{ a.description }}</p>
          </div>
          <span
            class="shrink-0 px-2.5 py-0.5 text-[11px] font-semibold rounded-full"
            :class="(statusStyles[a.status] ?? statusStyles.draft)?.class"
          >{{ (statusStyles[a.status] ?? statusStyles.draft)?.label }}</span>
        </div>

        <!-- Meta -->
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1.5">
            <Zap :size="12" class="text-accent" />
            {{ triggerLabels[a.trigger_type] || a.trigger_type }}
          </span>
          <span class="inline-flex items-center gap-1.5">
            <Users :size="12" />
            {{ a.enrolled_count }} enrolled
          </span>
          <span class="inline-flex items-center gap-1.5">
            <Clock :size="12" />
            {{ formatDate(a.created_at) }}
          </span>
        </div>

        <!-- Actions -->
        <div class="flex justify-between items-center pt-3 border-t border-border mt-auto">
          <div class="flex gap-1">
            <Button variant="ghost" size="sm" title="Edit Flow" @click="openFlowEditor(a)">
              <Pencil :size="14" />
            </Button>
            <Button
              v-if="a.status !== 'active'"
              variant="ghost" size="sm" title="Activate"
              :disabled="!!actionLoading"
              @click="handleAction(a.id, 'activate')"
            >
              <Loader2 v-if="actionLoading === `${a.id}-activate`" :size="14" class="animate-spin" />
              <Play v-else :size="14" class="text-success" />
            </Button>
            <Button
              v-if="a.status === 'active'"
              variant="ghost" size="sm" title="Pause"
              :disabled="!!actionLoading"
              @click="handleAction(a.id, 'pause')"
            >
              <Loader2 v-if="actionLoading === `${a.id}-pause`" :size="14" class="animate-spin" />
              <Pause v-else :size="14" class="text-warning" />
            </Button>
            <Button
              v-if="a.status !== 'draft'"
              variant="ghost" size="sm" title="Deactivate"
              :disabled="!!actionLoading"
              @click="handleAction(a.id, 'deactivate')"
            >
              <Square :size="14" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" class="text-danger" title="Delete" @click="promptDelete(a.id)">
            <Trash2 :size="14" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <Modal :show="showCreateModal" title="New Automation" size="md" @close="showCreateModal = false">
      <div class="space-y-5">
        <div class="flex flex-col gap-2">
          <Label>Name *</Label>
          <Input v-model="createForm.name" placeholder="e.g. Welcome Sequence" />
        </div>
        <div class="flex flex-col gap-2">
          <Label>Description</Label>
          <Input v-model="createForm.description" placeholder="Optional description" />
        </div>
        <div class="flex flex-col gap-2">
          <Label>Trigger Type</Label>
          <Select v-model="createForm.trigger_type">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="list_join">List Join</SelectItem>
              <SelectItem value="tag_added">Tag Added</SelectItem>
              <SelectItem value="score_change">Score Change</SelectItem>
              <SelectItem value="form_submit">Form Submit</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="api">API</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-2">
          <Label>Entry List ID <span class="text-muted-foreground font-normal">(optional)</span></Label>
          <Input v-model="createForm.entry_list_id" placeholder="Contact list to enroll from" />
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="showCreateModal = false">Cancel</Button>
        <Button :disabled="!createForm.name || creating" @click="handleCreate">
          <Loader2 v-if="creating" :size="16" class="animate-spin" /> Create
        </Button>
      </template>
    </Modal>

    <!-- Flow Editor SlidePanel -->
    <SlidePanel
      :show="showFlowEditor"
      :title="editingAutomation ? `Edit Flow — ${editingAutomation.name}` : 'Flow Editor'"
      size="xl"
      @close="closeFlowEditor"
    >
      <div v-if="editingAutomation" class="-m-6 h-[calc(100%+48px)]">
        <FlowCanvas
          ref="flowCanvasRef"
          :key="editingAutomation.id"
          :automation-id="editingAutomation.id"
          :trigger-type="editingAutomation.trigger_type"
          :initial-nodes="getFlowNodes(editingAutomation)"
          :initial-edges="getFlowEdges(editingAutomation)"
          @save="handleFlowSave"
        />
      </div>
    </SlidePanel>

    <ConfirmDialog
      :show="deleteConfirm.show"
      title="Delete Automation"
      message="Delete this automation? All enrolled contacts will be removed. This cannot be undone."
      confirmText="Delete"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="deleteConfirm.show = false"
    />
  </div>
</template>
