<script setup lang="ts">
import type { Component } from 'vue'
import { cn } from '../../lib/utils'

defineProps<{
  icon: Component
  value: string | number
  label: string
  color?: 'default' | 'success' | 'danger' | 'warning' | 'accent' | 'info'
}>()

const iconStyles: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  accent: 'bg-accent/10 text-accent',
  info: 'bg-info/10 text-info',
}
</script>

<template>
  <div
    :class="cn(
      'flex items-center gap-4 p-5 bg-card border border-border rounded-xl',
      'transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:border-primary/25',
    )"
  >
    <div
      :class="cn(
        'flex items-center justify-center w-11 h-11 rounded-lg shrink-0',
        iconStyles[color || 'default'],
      )"
    >
      <component :is="icon" :size="20" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="text-[24px] font-bold text-foreground leading-none tracking-tight font-mono">
        {{ value }}
      </div>
      <div class="text-[11px] text-muted-foreground mt-1.5 uppercase tracking-[0.05em] font-semibold">
        {{ label }}
      </div>
    </div>
  </div>
</template>
