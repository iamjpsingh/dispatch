<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{
  selectedCount: number
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'deselect'): void
}>()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      leave-active-class="transition-all duration-200 ease-in"
      enter-from-class="opacity-0 translate-y-4"
      leave-to-class="opacity-0 translate-y-4"
    >
      <div
        v-if="show"
        class="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-card border border-border shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-xl"
      >
        <span class="text-sm font-semibold text-foreground whitespace-nowrap">
          {{ selectedCount }} selected
        </span>

        <div class="w-px h-5 bg-border" />

        <!-- Action buttons slot -->
        <div class="flex items-center gap-2">
          <slot name="actions" />
        </div>

        <div class="w-px h-5 bg-border" />

        <button
          class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          @click="emit('deselect')"
        >
          <X :size="14" />
          <span>Deselect</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
