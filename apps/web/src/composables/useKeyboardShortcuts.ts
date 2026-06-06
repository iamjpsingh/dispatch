import { onUnmounted } from 'vue'

export interface Shortcut {
  key: string
  handler: () => void
  description: string
  scope: string
}

interface SequenceState {
  key: string
  timestamp: number
}

const SEQUENCE_TIMEOUT = 500
const registry: Shortcut[] = []
let sequenceState: SequenceState | null = null
let listenerAttached = false

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function normalizeKey(e: KeyboardEvent): string {
  const parts: string[] = []
  const hasMod = e.metaKey || e.ctrlKey
  if (hasMod) parts.push('mod')
  // Only include shift for modifier combos (mod+shift+z), not for printable chars like ?
  if (e.shiftKey && (hasMod || e.altKey)) parts.push('shift')
  if (e.altKey) parts.push('alt')
  const key = e.key.toLowerCase()
  if (!['control', 'meta', 'shift', 'alt'].includes(key)) {
    parts.push(key)
  }
  return parts.join('+')
}

function handleKeydown(e: KeyboardEvent) {
  if (isInputFocused()) {
    // Allow mod shortcuts even in inputs (Ctrl+S, Ctrl+K)
    const normalized = normalizeKey(e)
    if (!normalized.startsWith('mod+')) return
    const shortcut = registry.find(s => s.key === normalized)
    if (shortcut) {
      e.preventDefault()
      shortcut.handler()
    }
    return
  }

  const normalized = normalizeKey(e)

  // Check for sequence shortcuts (e.g., "g then d")
  if (sequenceState) {
    const elapsed = Date.now() - sequenceState.timestamp
    if (elapsed < SEQUENCE_TIMEOUT) {
      const seqKey = `${sequenceState.key} ${normalized}`
      const shortcut = registry.find(s => s.key === seqKey)
      if (shortcut) {
        e.preventDefault()
        sequenceState = null
        shortcut.handler()
        return
      }
    }
    sequenceState = null
  }

  // Check for direct shortcuts
  const shortcut = registry.find(s => s.key === normalized)
  if (shortcut) {
    e.preventDefault()
    shortcut.handler()
    return
  }

  // Check if this could be the start of a sequence
  const isSequenceStart = registry.some(s => s.key.startsWith(`${normalized} `))
  if (isSequenceStart) {
    e.preventDefault()
    sequenceState = { key: normalized, timestamp: Date.now() }
  }
}

function ensureListener() {
  if (!listenerAttached && typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown)
    listenerAttached = true
  }
}

export function registerShortcut(
  key: string,
  handler: () => void,
  opts: { scope?: string; description?: string } = {},
) {
  ensureListener()
  // Replace existing shortcut with same key (prevents duplicates on re-mount)
  const existing = registry.findIndex(s => s.key === key)
  if (existing >= 0) registry.splice(existing, 1)
  registry.push({
    key,
    handler,
    description: opts.description || key,
    scope: opts.scope || 'General',
  })
}

export function unregisterShortcut(key: string) {
  const idx = registry.findIndex(s => s.key === key)
  if (idx >= 0) registry.splice(idx, 1)
}

export function getShortcuts(): Shortcut[] {
  return [...registry]
}

export function getGroupedShortcuts(): Record<string, Shortcut[]> {
  const groups: Record<string, Shortcut[]> = {}
  for (const s of registry) {
    if (!groups[s.scope]) groups[s.scope] = []
    groups[s.scope].push(s)
  }
  return groups
}

/**
 * Composable version — auto-cleans up registered shortcuts on unmount
 */
export function useKeyboardShortcuts() {
  const localKeys: string[] = []

  function register(
    key: string,
    handler: () => void,
    opts: { scope?: string; description?: string } = {},
  ) {
    registerShortcut(key, handler, opts)
    localKeys.push(key)
  }

  onUnmounted(() => {
    for (const key of localKeys) {
      unregisterShortcut(key)
    }
  })

  return { register, unregister: unregisterShortcut, getShortcuts, getGroupedShortcuts }
}
