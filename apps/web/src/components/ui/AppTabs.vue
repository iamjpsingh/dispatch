<script setup lang="ts">
import { cn } from '../../lib/utils'

defineProps<{
  tabs: Array<{ key: string; label: string; count?: number }>
  modelValue: string
  variant?: 'underline' | 'pill'
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <div
    :class="cn(
      'flex gap-1 flex-wrap',
      variant !== 'pill' && 'border-b border-border px-1'
    )"
    role="tablist"
  >
    <button
      v-for="tab in tabs"
      :key="tab.key"
      role="tab"
      :aria-selected="modelValue === tab.key"
      :class="cn(
        'inline-flex items-center gap-1.5 font-medium cursor-pointer transition-all duration-150 bg-transparent border-none font-sans',
        variant === 'pill'
          ? cn(
              'px-4 py-2 rounded-md text-[13px]',
              modelValue === tab.key
                ? 'bg-accent text-white font-semibold'
                : 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground'
            )
          : cn(
              'px-4 py-2.5 text-sm border-b-2 -mb-px',
              modelValue === tab.key
                ? 'text-accent border-accent'
                : 'text-muted-foreground border-transparent hover:text-foreground'
            )
      )"
      @click="$emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
      <span
        v-if="tab.count !== undefined"
        :class="cn(
          'text-xs font-semibold px-[7px] py-px rounded-[10px]',
          modelValue === tab.key && variant === 'pill'
            ? 'bg-white/20 text-white'
            : modelValue === tab.key
              ? 'bg-accent/15 text-accent'
              : 'bg-muted text-muted-foreground'
        )"
      >
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>
