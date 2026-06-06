<script setup lang="ts">
import { ref, computed } from 'vue'
import { Calendar } from 'lucide-vue-next'

interface DateRange {
  from: string
  to: string
  label?: string
}

const props = defineProps<{
  modelValue: DateRange
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: DateRange): void
}>()

const showCustom = ref(false)
const customFrom = ref('')
const customTo = ref('')

const presets = [
  { label: 'Today', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

const activeLabel = computed(() => props.modelValue.label || 'All time')

function selectPreset(preset: { label: string; days: number }) {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - preset.days)

  emit('update:modelValue', {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
    label: preset.label,
  })
  showCustom.value = false
}

function applyCustom() {
  if (customFrom.value && customTo.value) {
    emit('update:modelValue', {
      from: customFrom.value,
      to: customTo.value,
      label: 'Custom',
    })
    showCustom.value = false
  }
}

function clearRange() {
  emit('update:modelValue', { from: '', to: '', label: 'All time' })
  showCustom.value = false
}
</script>

<template>
  <div class="relative inline-flex items-center gap-1">
    <!-- Preset buttons -->
    <button
      v-for="preset in presets"
      :key="preset.label"
      class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer"
      :class="activeLabel === preset.label
        ? 'bg-accent/10 text-accent'
        : 'text-muted-foreground hover:text-foreground hover:bg-secondary'"
      @click="selectPreset(preset)"
    >
      {{ preset.label }}
    </button>

    <!-- Custom trigger -->
    <button
      class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer"
      :class="activeLabel === 'Custom'
        ? 'bg-accent/10 text-accent'
        : 'text-muted-foreground hover:text-foreground hover:bg-secondary'"
      @click="showCustom = !showCustom"
    >
      <Calendar :size="12" />
      Custom
    </button>

    <!-- All time / clear -->
    <button
      v-if="modelValue.from"
      class="px-2 py-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
      @click="clearRange"
    >
      Clear
    </button>

    <!-- Custom date picker dropdown -->
    <div
      v-if="showCustom"
      class="absolute top-full right-0 mt-1 p-3 bg-card border border-border rounded-lg shadow-lg z-10"
    >
      <div class="flex items-center gap-2">
        <input
          v-model="customFrom"
          type="date"
          class="px-2 py-1.5 text-xs bg-secondary border border-border rounded-md text-foreground"
        />
        <span class="text-xs text-muted-foreground">to</span>
        <input
          v-model="customTo"
          type="date"
          class="px-2 py-1.5 text-xs bg-secondary border border-border rounded-md text-foreground"
        />
        <button
          class="px-2.5 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/90 transition cursor-pointer"
          @click="applyCustom"
        >
          Apply
        </button>
      </div>
    </div>
  </div>
</template>
