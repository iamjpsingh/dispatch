<script setup lang="ts">
import { ref, computed } from 'vue'
import { Calendar } from 'lucide-vue-next'
import DateTimePickerModal from './DateTimePickerModal.vue'

interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select date and time...'
})

const emit = defineEmits<Emits>()

const showModal = ref(false)

const displayValue = computed(() => {
  if (!props.modelValue) return ''

  try {
    const date = new Date(props.modelValue)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return props.modelValue
  }
})

function handleInputClick() {
  if (!props.disabled) {
    showModal.value = true
  }
}

function handleDateTimeUpdate(value: string) {
  emit('update:modelValue', value)
}

function handleModalClose() {
  showModal.value = false
}
</script>

<template>
  <div class="date-input-wrapper">
    <input
      :value="displayValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="date-input"
      readonly
      @click="handleInputClick"
    />
    <div class="date-icon">
      <Calendar :size="16" />
    </div>

    <DateTimePickerModal
      :show="showModal"
      :model-value="modelValue"
      @update:model-value="handleDateTimeUpdate"
      @close="handleModalClose"
    />
  </div>
</template>
