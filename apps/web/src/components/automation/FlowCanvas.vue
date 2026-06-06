<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow, type Node, type Edge, type Connection, MarkerType } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '@vue-flow/controls/dist/style.css'
import BaseNode from './nodes/BaseNode.vue'
import { NODE_TYPES, NODE_PALETTE, getNodeSummary, isConnectionAllowed, type NodeTypeName } from './nodes'
import { useFlowHistory } from '../../composables/useFlowHistory'
import { Plus, Save, Loader2, Undo2, Redo2, AlignVerticalSpaceAround } from 'lucide-vue-next'

const props = defineProps<{
  automationId: string
  triggerType: string
  initialNodes?: Node[]
  initialEdges?: Edge[]
}>()

const emit = defineEmits<{
  save: [nodes: Node[], edges: Edge[]]
  nodeSelect: [nodeId: string | null]
}>()

const saving = ref(false)
const showPalette = ref(false)

const { nodes, edges, addNodes, addEdges, removeNodes, removeEdges, onConnect, onNodeClick, onPaneClick, onNodesChange, fitView, getNode } = useVueFlow({
  nodes: props.initialNodes || [],
  edges: props.initialEdges || [],
  defaultEdgeOptions: {
    animated: true,
    style: { stroke: 'var(--color-border)', strokeWidth: 2 },
    markerEnd: MarkerType.ArrowClosed,
  },
})

// Undo/redo history
const { pushState, undo, redo, canUndo, canRedo } = useFlowHistory(nodes, edges)

// Push initial state
pushState()

// Track node changes for undo
onNodesChange(() => {
  // We'll push state on meaningful actions (add/delete), not every drag
})

// Keyboard shortcuts for undo/redo
const handleFlowKey = (e: KeyboardEvent) => {
  if (!(e.metaKey || e.ctrlKey)) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
  if (e.key === 'z' && e.shiftKey) { e.preventDefault(); redo() }
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleFlowKey)
}
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleFlowKey)
})

// Auto-layout: simple vertical tree layout
function autoLayout() {
  pushState()
  const sorted = [...nodes.value].sort((a, b) => a.position.y - b.position.y)
  const xCenter = 250
  sorted.forEach((node, idx) => {
    node.position = { x: xCenter, y: 50 + idx * 130 }
  })
  nextTick(() => fitView({ padding: 0.2 }))
}

// Ensure trigger node exists
if (!nodes.value.find(n => n.type === 'trigger')) {
  addNodes([{
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 250, y: 50 },
    data: { label: 'Trigger', triggerType: props.triggerType },
  }])
}

// Handle new connections
onConnect((connection: Connection) => {
  addEdges([{
    id: `e-${connection.source}-${connection.target}-${connection.sourceHandle || 'default'}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle || undefined,
    targetHandle: connection.targetHandle || undefined,
    animated: true,
    style: { stroke: connection.sourceHandle === 'false' ? '#ef4444' : connection.sourceHandle === 'true' ? '#22c55e' : 'var(--color-border)', strokeWidth: 2 },
    markerEnd: MarkerType.ArrowClosed,
  }])
})

// Node click → emit for config panel
onNodeClick(({ node }) => {
  emit('nodeSelect', node.id)
})

onPaneClick(() => {
  emit('nodeSelect', null)
})

// Add node from palette
function addFlowNode(type: NodeTypeName) {
  const id = `${type}-${Date.now()}`
  const cfg = NODE_TYPES[type]

  // Find a good position: below the last node
  const yPositions = nodes.value.map(n => n.position.y)
  const maxY = yPositions.length ? Math.max(...yPositions) : 0
  const xCenter = 250

  pushState()
  addNodes([{
    id,
    type,
    position: { x: xCenter, y: maxY + 120 },
    data: { label: cfg.label, config: {} },
  }])

  showPalette.value = false
  nextTick(() => {
    emit('nodeSelect', id)
  })
}

function deleteNode(nodeId: string) {
  // Don't delete trigger
  const node = getNode.value(nodeId)
  if (!node || node.type === 'trigger') return

  pushState()
  // Remove connected edges
  const connectedEdges = edges.value.filter(e => e.source === nodeId || e.target === nodeId)
  removeEdges(connectedEdges.map(e => e.id))
  removeNodes([nodeId])
  emit('nodeSelect', null)
}

async function handleSave() {
  saving.value = true
  emit('save', nodes.value, edges.value)
  setTimeout(() => { saving.value = false }, 500)
}

// Expose for parent
defineExpose({ deleteNode, addFlowNode, fitView })
</script>

<template>
  <div class="relative w-full h-full min-h-[500px] bg-background rounded-xl border border-border overflow-hidden">
    <!-- Toolbar -->
    <div class="absolute top-3 left-3 z-10 flex items-center gap-2">
      <button
        @click="showPalette = !showPalette"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs font-medium text-muted-foreground hover:border-accent hover:text-accent transition shadow-sm"
      >
        <Plus :size="14" /> Add Node
      </button>
      <button
        @click="handleSave"
        :disabled="saving"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 transition shadow-sm disabled:opacity-50"
      >
        <Loader2 v-if="saving" :size="14" class="animate-spin" />
        <Save v-else :size="14" />
        Save
      </button>
      <div class="w-px h-5 bg-border" />
      <button
        @click="undo"
        :disabled="!canUndo"
        class="p-1.5 bg-secondary border border-border rounded-lg text-muted-foreground hover:text-foreground transition shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 :size="14" />
      </button>
      <button
        @click="redo"
        :disabled="!canRedo"
        class="p-1.5 bg-secondary border border-border rounded-lg text-muted-foreground hover:text-foreground transition shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 :size="14" />
      </button>
      <div class="w-px h-5 bg-border" />
      <button
        @click="autoLayout"
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-secondary border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition shadow-sm"
        title="Auto Layout"
      >
        <AlignVerticalSpaceAround :size="14" />
        Layout
      </button>
      <button
        @click="fitView({ padding: 0.2 })"
        class="px-2.5 py-1.5 bg-secondary border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition shadow-sm"
      >
        Fit
      </button>
    </div>

    <!-- Node Palette -->
    <div v-if="showPalette" class="absolute top-12 left-3 z-20 bg-card border border-border rounded-xl shadow-xl p-3 w-64 max-h-[70vh] overflow-y-auto">
      <div class="text-xs font-semibold text-foreground mb-2">Add Node</div>
      <div v-for="group in NODE_PALETTE" :key="group.category" class="mb-3 last:mb-0">
        <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{{ group.category }}</div>
        <div class="text-[9px] text-muted-foreground mb-1.5">{{ group.description }}</div>
        <div class="flex flex-col gap-1">
          <button
            v-for="type in group.items"
            :key="type"
            @click="addFlowNode(type as NodeTypeName)"
            class="flex items-center gap-2.5 px-2.5 py-2 bg-background border border-border rounded-lg text-left hover:border-accent/40 hover:bg-accent/5 transition cursor-pointer group"
          >
            <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" :style="{ backgroundColor: NODE_TYPES[type as NodeTypeName].color + '15' }">
              <component :is="NODE_TYPES[type as NodeTypeName].icon" :size="12" :style="{ color: NODE_TYPES[type as NodeTypeName].color }" />
            </div>
            <div class="min-w-0">
              <div class="text-[11px] font-medium text-foreground group-hover:text-accent truncate">{{ NODE_TYPES[type as NodeTypeName].label }}</div>
              <div class="text-[9px] text-muted-foreground truncate">{{ NODE_TYPES[type as NodeTypeName].description }}</div>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- Vue Flow Canvas -->
    <VueFlow
      :default-viewport="{ zoom: 1, x: 0, y: 0 }"
      :min-zoom="0.3"
      :max-zoom="2"
      :snap-to-grid="true"
      :snap-grid="[20, 20]"
      :nodes-draggable="true"
      :nodes-connectable="true"
      :edges-updatable="true"
      class="w-full h-full"
    >
      <!-- Dynamic node rendering for all types -->
      <template v-for="(cfg, type) in NODE_TYPES" :key="type" #[`node-${type}`]="{ data, selected }">
        <BaseNode
          :label="data.label || cfg.label"
          :icon="cfg.icon"
          :color="cfg.color"
          :bg-color="cfg.bgColor"
          :border-color="cfg.borderColor"
          :category="cfg.category"
          :selected="selected"
          :has-target-handle="cfg.hasTargetHandle"
          :outputs="[...cfg.outputs]"
          :configured="data.config && Object.keys(data.config).length > 0"
        >
          {{ data.summary || (type === 'trigger' ? (data.triggerType || 'Manual') : '') }}
        </BaseNode>
      </template>

      <MiniMap
        :pannable="true"
        :zoomable="true"
        class="!bg-secondary !border-border"
      />
      <Controls class="!bg-secondary !border-border !shadow-sm" />
    </VueFlow>
  </div>
</template>

<style>
/* Override Vue Flow theme for dark mode compatibility */
.vue-flow {
  --vf-node-bg: var(--color-secondary);
  --vf-node-text: var(--color-foreground);
  --vf-handle: var(--color-muted-foreground);
  --vf-box-shadow: none;
}
.vue-flow__minimap {
  border-radius: 8px;
  overflow: hidden;
}
.vue-flow__controls {
  border-radius: 8px;
  overflow: hidden;
}
.vue-flow__controls button {
  background: var(--color-secondary);
  color: var(--color-muted-foreground);
  border-color: var(--color-border);
}
.vue-flow__controls button:hover {
  background: var(--color-card);
}
</style>
