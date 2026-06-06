<script setup lang="ts">
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import type { ContactList } from '../../lib/api'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  show: boolean
  mode: 'tag' | 'move'
  selectedCount: number
  lists?: ContactList[]
  activeListId?: string
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'tag', tags: string[]): void
  (e: 'move', targetListId: string): void
}>()

const tagInput = ref('')
const moveTarget = ref('')

watch(
  () => props.show,
  (visible) => {
    if (!visible) {
      tagInput.value = ''
      moveTarget.value = ''
    }
  }
)

function handleSubmit() {
  if (props.mode === 'tag') {
    const tags = tagInput.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tags.length) emit('tag', tags)
  } else {
    if (moveTarget.value) emit('move', moveTarget.value)
  }
}
</script>

<template>
  <Transition name="modal">
    <div
      v-if="show"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] backdrop-blur-[4px]"
      @click.self="emit('close')"
    >
      <div class="bg-secondary border border-border rounded-xl w-[380px] max-w-[90vw] max-h-[80vh] overflow-y-auto">
        <div class="flex justify-between items-center px-6 py-5 border-b border-border">
          <h3 class="text-base font-semibold text-foreground m-0">
            {{ mode === 'tag' ? 'Tag' : 'Move' }} {{ selectedCount }} Contact(s)
          </h3>
          <button
            class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
            @click="emit('close')"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="p-6">
          <!-- Tag mode -->
          <div v-if="mode === 'tag'" class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2">Tags (comma-separated)</label>
            <input
              v-model="tagInput"
              type="text"
              placeholder="vip, newsletter, lead"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
            />
          </div>
          <!-- Move mode -->
          <div v-if="mode === 'move'" class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2">Target List</label>
            <select
              v-model="moveTarget"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
            >
              <option value="" disabled>Select list...</option>
              <option v-for="list in lists" :key="list.id" :value="list.id" :disabled="list.id === activeListId">
                {{ list.name }}
              </option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="ghost" @click="emit('close')">
            Cancel
          </Button>
          <Button @click="handleSubmit" :disabled="saving || (mode === 'move' && !moveTarget)">
            {{ mode === 'tag' ? 'Apply' : 'Move' }}
          </Button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
