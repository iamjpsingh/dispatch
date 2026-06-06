<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ContactInput } from '../../lib/api'
import { X, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  show: boolean
  mode: 'create' | 'edit'
  contact?: { id: string } & Partial<ContactInput> & { status?: string }
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', data: { id?: string } & Partial<ContactInput> & { status?: string }): void
}>()

const form = ref<{ id?: string } & Partial<ContactInput> & { status?: string }>({
  email: '',
  first_name: '',
  last_name: '',
  company: '',
  phone: '',
})

// Sync form when contact prop changes (edit mode)
watch(
  () => props.contact,
  (c) => {
    if (c) {
      form.value = { ...c }
    } else {
      form.value = { email: '', first_name: '', last_name: '', company: '', phone: '' }
    }
  },
  { immediate: true }
)

// Reset form when modal opens in create mode
watch(
  () => props.show,
  (visible) => {
    if (visible && props.mode === 'create') {
      form.value = { email: '', first_name: '', last_name: '', company: '', phone: '' }
    }
  }
)

function handleSave() {
  if (!form.value.email?.trim()) return
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
            {{ mode === 'create' ? 'Add Contact' : 'Edit Contact' }}
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
            <label class="block text-sm font-medium text-muted-foreground mb-2">
              Email {{ mode === 'create' ? '*' : '' }}
            </label>
            <input
              v-model="form.email"
              type="email"
              :placeholder="mode === 'create' ? 'email@example.com' : ''"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
            />
          </div>
          <div class="flex gap-3 max-md:flex-col max-md:gap-0">
            <div class="flex-1 mb-4">
              <label class="block text-sm font-medium text-muted-foreground mb-2">First Name</label>
              <input
                v-model="form.first_name"
                type="text"
                class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
              />
            </div>
            <div class="flex-1 mb-4">
              <label class="block text-sm font-medium text-muted-foreground mb-2">Last Name</label>
              <input
                v-model="form.last_name"
                type="text"
                class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
              />
            </div>
          </div>
          <div class="flex gap-3 max-md:flex-col max-md:gap-0">
            <div class="flex-1 mb-4">
              <label class="block text-sm font-medium text-muted-foreground mb-2">Company</label>
              <input
                v-model="form.company"
                type="text"
                class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
              />
            </div>
            <div class="flex-1 mb-4">
              <label class="block text-sm font-medium text-muted-foreground mb-2">Phone</label>
              <input
                v-model="form.phone"
                type="text"
                class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
              />
            </div>
          </div>
          <!-- Status field only in edit mode -->
          <div v-if="mode === 'edit'" class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2">Status</label>
            <select
              v-model="form.status"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent"
            >
              <option value="active">Active</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="bounced">Bounced</option>
              <option value="complained">Complained</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="ghost" @click="emit('close')">
            Cancel
          </Button>
          <Button @click="handleSave" :disabled="saving">
            <Loader2 v-if="saving" :size="14" class="animate-spin" />
            {{ mode === 'create' ? 'Add Contact' : 'Save' }}
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
