<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

defineProps<{
  page: number
  totalPages: number
  total?: number
  showing?: number
}>()

defineEmits<{
  (e: 'update:page', value: number): void
}>()
</script>

<template>
  <div class="flex justify-between items-center py-4 px-5 border-t border-border text-[13px] text-muted-foreground">
    <span v-if="total !== undefined && showing !== undefined">
      Showing {{ showing }} of {{ total }}
    </span>
    <div v-if="totalPages > 1" class="flex items-center gap-3">
      <button
        class="inline-flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium text-muted-foreground bg-transparent border border-border rounded-md cursor-pointer transition-all duration-150 hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="page <= 1"
        @click="$emit('update:page', page - 1)"
      >
        <ChevronLeft :size="16" />
        Previous
      </button>
      <span class="text-[13px] text-muted-foreground">Page {{ page }} of {{ totalPages }}</span>
      <button
        class="inline-flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium text-muted-foreground bg-transparent border border-border rounded-md cursor-pointer transition-all duration-150 hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="page >= totalPages"
        @click="$emit('update:page', page + 1)"
      >
        Next
        <ChevronRight :size="16" />
      </button>
    </div>
  </div>
</template>
