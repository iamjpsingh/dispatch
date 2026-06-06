<script setup lang="ts">
import { computed } from 'vue'
import { Upload } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  contacts: Record<string, any>[]
  columns: string[]
}>()

const emit = defineEmits<{
  (e: 'file-selected', file: File): void
}>()

const contactCount = computed(() => props.contacts.length)

function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    emit('file-selected', file)
  }
}
</script>

<template>
  <div class="bg-card border border-border rounded-xl p-5">
    <h3 class="text-[15px] mb-4 flex items-center gap-2">
      <Upload :size="18" class="text-accent" />
      Upload Contacts
    </h3>
    <Input type="file" accept=".csv,.xlsx,.xls" @change="handleFileUpload" />
    <p v-if="contactCount > 0" class="text-success text-[13px] mt-2">{{ contactCount }} contacts loaded</p>
    <p class="text-muted-foreground text-[13px] mt-2">Upload CSV or Excel file with Name, Email columns</p>
  </div>
</template>
