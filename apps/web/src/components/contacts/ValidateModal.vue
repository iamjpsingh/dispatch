<script setup lang="ts">
import { ref } from 'vue'
import { X, Loader2, Check, AlertTriangle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  show: boolean
  validating: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'validate', emails: string[]): void
}>()

const emailsInput = ref('')
const results = ref<any>(null)

function handleValidate() {
  const emails = emailsInput.value
    .split('\n')
    .map((e) => e.trim())
    .filter(Boolean)
  if (!emails.length) return
  emit('validate', emails)
}

function handleClose() {
  emailsInput.value = ''
  results.value = null
  emit('close')
}

defineExpose({ setResults: (r: any) => (results.value = r) })
</script>

<template>
  <Transition name="modal">
    <div
      v-if="show"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] backdrop-blur-[4px]"
      @click.self="handleClose"
    >
      <div class="bg-secondary border border-border rounded-xl w-[640px] max-w-[90vw] max-h-[80vh] overflow-y-auto">
        <div class="flex justify-between items-center px-6 py-5 border-b border-border">
          <h3 class="text-base font-semibold text-foreground m-0">Validate Emails</h3>
          <button
            class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="p-6">
          <div class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2"
              >Emails (one per line, max 100)</label
            >
            <textarea
              v-model="emailsInput"
              rows="6"
              placeholder="user1@example.com&#10;user2@example.com"
              class="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent resize-y font-mono"
            ></textarea>
          </div>
          <div v-if="results" class="mt-4">
            <div class="flex gap-2 mb-3">
              <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-500"
                >Valid: {{ results.valid }}</span
              >
              <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-red-500/15 text-red-500"
                >Invalid: {{ results.invalid }}</span
              >
              <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-amber-500/15 text-amber-500"
                >Risky: {{ results.risky }}</span
              >
            </div>
            <div class="max-h-[300px] overflow-y-auto border border-border rounded-lg">
              <div
                v-for="r in results.results"
                :key="r.email"
                class="flex items-center gap-2 px-3 py-2 text-[13px] border-b border-border last:border-b-0"
              >
                <Check v-if="r.valid" :size="14" class="text-green-500 shrink-0" />
                <AlertTriangle v-else :size="14" class="text-red-500 shrink-0" />
                <span class="font-mono flex-1">{{ r.email }}</span>
                <span class="text-muted-foreground text-xs">{{ r.score }}/100</span>
                <span v-if="r.reason" class="text-muted-foreground text-xs italic">{{ r.reason }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="ghost" @click="handleClose">
            Close
          </Button>
          <Button @click="handleValidate" :disabled="validating">
            <Loader2 v-if="validating" :size="14" class="animate-spin" />
            Validate
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
