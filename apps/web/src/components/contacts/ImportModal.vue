<script setup lang="ts">
import { ref } from 'vue'
import { X, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  show: boolean
  importing: boolean
  importResult?: { imported: number; duplicates: number; invalid: number } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'import', file: File): void
}>()

const importFile = ref<File | null>(null)

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  importFile.value = input.files?.[0] || null
}

function handleImport() {
  if (!importFile.value) return
  emit('import', importFile.value)
}

function handleClose() {
  importFile.value = null
  emit('close')
}
</script>

<template>
  <Transition name="modal">
    <div
      v-if="show"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] backdrop-blur-[4px]"
      @click.self="handleClose"
    >
      <div class="bg-secondary border border-border rounded-xl w-[480px] max-w-[90vw] max-h-[80vh] overflow-y-auto">
        <div class="flex justify-between items-center px-6 py-5 border-b border-border">
          <h3 class="text-base font-semibold text-foreground m-0">Import Contacts</h3>
          <button
            class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="p-6">
          <p class="text-muted-foreground text-[13px] mb-4">
            Upload a CSV or Excel file. Columns will be auto-mapped (email, first_name, last_name, company, phone).
          </p>
          <div class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2">File</label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              @change="onFileChange"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none"
            />
          </div>
          <div v-if="importResult" class="mt-3 p-3 bg-green-500/[0.08] rounded-lg text-[13px]">
            <p><strong>Import complete:</strong></p>
            <p>
              Imported: {{ importResult.imported }} | Duplicates: {{ importResult.duplicates }} | Invalid:
              {{ importResult.invalid }}
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="ghost" @click="handleClose">
            Cancel
          </Button>
          <Button @click="handleImport" :disabled="!importFile || importing">
            <Loader2 v-if="importing" :size="14" class="animate-spin" />
            Import
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
