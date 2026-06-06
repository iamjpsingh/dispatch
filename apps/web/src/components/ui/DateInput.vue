<script setup lang="ts">
import { ref, computed } from 'vue'
import { Calendar } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import DatePickerModal from './DatePickerModal.vue'

interface Props {
  modelValue: string
  placeholder?: string
  disabled?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'change'): void
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: 'Select date...'
})

const emit = defineEmits<Emits>()

const showModal = ref(false)

const displayValue = computed(() => {
  const value = props.modelValue
  if (!value) return ''

  try {
    const date = new Date(value)
    if (isNaN(date.getTime())) return ''
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return ''
  }
})

function handleInputClick() {
  if (!props.disabled) {
    showModal.value = true
  }
}

function handleDateUpdate(value: string) {
  emit('update:modelValue', value)
  emit('change')
}

function handleModalClose() {
  showModal.value = false
}
</script>

<template>
  <div class="relative">
    <Input
      :model-value="displayValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="pr-10 cursor-pointer"
      readonly
      @click="handleInputClick"
    />
    <Calendar :size="16" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />

    <DatePickerModal
      :show="showModal"
      :model-value="modelValue"
      @update:model-value="handleDateUpdate"
      @close="handleModalClose"
    />
  </div>
</template>
