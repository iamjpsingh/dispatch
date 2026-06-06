<script setup lang="ts">
import { computed } from 'vue'
import { getGroupedShortcuts } from '../../composables/useKeyboardShortcuts'
import Modal from './Modal.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const groups = computed(() => getGroupedShortcuts())

function formatKey(key: string): string[] {
  return key.split(' ').map(part => {
    return part
      .replace('mod+', navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+')
      .replace('shift+', '\u21E7')
      .replace('alt+', navigator.platform.includes('Mac') ? '\u2325' : 'Alt+')
  })
}
</script>

<template>
  <Modal :show="show" title="Keyboard Shortcuts" size="lg" @close="emit('update:show', false)">
    <div class="grid gap-6 sm:grid-cols-2 max-h-[60vh] overflow-y-auto py-2 -mx-1 px-1">
      <div v-for="(shortcuts, scope) in groups" :key="scope">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {{ scope }}
        </h3>
        <div class="space-y-2">
          <div
            v-for="shortcut in shortcuts"
            :key="shortcut.key"
            class="flex items-center justify-between gap-3 py-1.5"
          >
            <span class="text-sm text-foreground">{{ shortcut.description }}</span>
            <div class="flex items-center gap-1 shrink-0">
              <template v-for="(part, i) in formatKey(shortcut.key)" :key="i">
                <span
                  v-if="i > 0"
                  class="text-[10px] text-muted-foreground mx-0.5"
                >then</span>
                <kbd class="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md bg-muted border border-border text-[11px] font-mono font-medium text-muted-foreground uppercase">
                  {{ part }}
                </kbd>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>
