<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  show: boolean
  mode: 'create' | 'edit'
  listData?: { id?: string; name: string; description: string }
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', data: { id?: string; name: string; description: string }): void
}>()

const form = ref({ id: '', name: '', description: '' })

watch(
  () => props.listData,
  (data) => {
    if (data) {
      form.value = { id: data.id || '', name: data.name, description: data.description }
    }
  },
  { immediate: true }
)

watch(
  () => props.show,
  (visible) => {
    if (visible && props.mode === 'create') {
      form.value = { id: '', name: '', description: '' }
    }
  }
)

function handleSave() {
  if (!form.value.name.trim()) return
  emit('save', { ...form.value })
}
</script>

<template>
  <Transition name="modal">
    <div
      v-if="show"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] backdrop-blur-[4px]"
      @click.self="emit('close')"
    >
      <div class="bg-secondary border border-border rounded-xl w-[480px] max-w-[90vw] max-h-[80vh] overflow-y-auto">
        <div class="flex justify-between items-center px-6 py-5 border-b border-border">
          <h3 class="text-base font-semibold text-foreground m-0">
            {{ mode === 'create' ? 'New Contact List' : 'Edit List' }}
          </h3>
          <button
            class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
            @click="emit('close')"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="p-6">
          <div class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2">Name</label>
            <input
              v-model="form.name"
              type="text"
              :placeholder="mode === 'create' ? 'e.g. Newsletter Subscribers' : ''"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
            />
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2">
              Description{{ mode === 'create' ? ' (optional)' : '' }}
            </label>
            <input
              v-model="form.description"
              type="text"
              :placeholder="mode === 'create' ? 'Brief description' : ''"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
            />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="ghost" @click="emit('close')">
            Cancel
          </Button>
          <Button @click="handleSave" :disabled="saving">
            <Loader2 v-if="saving" :size="14" class="animate-spin" />
            {{ mode === 'create' ? 'Create' : 'Save' }}
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
