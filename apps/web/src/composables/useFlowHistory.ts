import { ref, computed, type Ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'

interface HistoryEntry {
  nodes: Node[]
  edges: Edge[]
}

const MAX_HISTORY = 50

export function useFlowHistory(nodes: Ref<Node[]>, edges: Ref<Edge[]>) {
  const undoStack = ref<HistoryEntry[]>([])
  const redoStack = ref<HistoryEntry[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function snapshot(): HistoryEntry {
    return {
      nodes: JSON.parse(JSON.stringify(nodes.value)),
      edges: JSON.parse(JSON.stringify(edges.value)),
    }
  }

  function pushState() {
    undoStack.value.push(snapshot())
    if (undoStack.value.length > MAX_HISTORY) {
      undoStack.value.shift()
    }
    // Clear redo stack on new action
    redoStack.value = []
  }

  function applyState(entry: HistoryEntry) {
    nodes.value = JSON.parse(JSON.stringify(entry.nodes))
    edges.value = JSON.parse(JSON.stringify(entry.edges))
  }

  function undo() {
    if (!canUndo.value) return
    const entry = undoStack.value.pop()!
    redoStack.value.push(snapshot())
    applyState(entry)
  }

  function redo() {
    if (!canRedo.value) return
    const entry = redoStack.value.pop()!
    undoStack.value.push(snapshot())
    applyState(entry)
  }

  function clear() {
    undoStack.value = []
    redoStack.value = []
  }

  return { pushState, undo, redo, canUndo, canRedo, clear }
}
