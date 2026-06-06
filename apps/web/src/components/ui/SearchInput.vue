<script setup lang="ts">
import { ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  debounce?: number
}>(), {
  debounce: 0,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'search'): void
}>()

const localValue = ref(props.modelValue)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.modelValue, (v) => { localValue.value = v })

function handleInput(value: string | number) {
  localValue.value = String(value)
  if (props.debounce > 0) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => emit('update:modelValue', localValue.value), props.debounce)
  } else {
    emit('update:modelValue', localValue.value)
  }
}

function clear() {
  localValue.value = ''
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="relative">
    <Search :size="18" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
    <Input
      type="text"
      class="pl-[42px]"
      :class="localValue ? 'pr-9' : ''"
      :model-value="localValue"
      :placeholder="placeholder || 'Search...'"
      @update:model-value="handleInput"
      @keyup.enter="$emit('search')"
    />
    <button
      v-if="localValue"
      class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
      @click="clear"
      aria-label="Clear search"
    >
      <X :size="14" />
    </button>
  </div>
</template>
