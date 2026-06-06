<script setup lang="ts">
import { cn } from '../../lib/utils'

defineProps<{
  value: number
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'accent'
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}>()

const sizes: Record<string, string> = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2.5',
}

const colors: Record<string, string> = {
  default: 'bg-accent',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  accent: 'bg-accent',
}
</script>

<template>
  <div
    :class="cn(
      'relative w-full bg-muted rounded-full overflow-hidden',
      sizes[size || 'md'],
    )"
  >
    <div
      :class="cn(
        'h-full rounded-full transition-[width] duration-500 ease-out',
        colors[variant || 'default'],
      )"
      role="progressbar"
      :aria-valuenow="value"
      aria-valuemin="0"
      aria-valuemax="100"
      :style="{ width: `${Math.min(Math.max(value, 0), 100)}%` }"
    />
    <span
      v-if="showLabel && size === 'lg'"
      class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-white"
    >
      {{ Math.round(value) }}%
    </span>
  </div>
</template>
