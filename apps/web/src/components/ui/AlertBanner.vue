<script setup lang="ts">
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-vue-next'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  type?: 'success' | 'error' | 'warning' | 'info'
  dismissible?: boolean
}>()

defineEmits<{
  (e: 'dismiss'): void
}>()

const icon = computed(() => {
  switch (props.type) {
    case 'success': return CheckCircle
    case 'error': return XCircle
    case 'warning': return AlertTriangle
    default: return Info
  }
})

const variantClasses: Record<string, string> = {
  success: 'bg-success/[0.08] border-success/20 text-success',
  error: 'bg-danger/[0.08] border-danger/20 text-danger',
  warning: 'bg-warning/[0.08] border-warning/20 text-warning',
  info: 'bg-info/[0.08] border-info/20 text-info',
}
</script>

<template>
  <div
    class="flex items-start gap-3 px-4 py-3.5 rounded-md border text-sm leading-relaxed"
    :class="variantClasses[type || 'info']"
    role="alert"
  >
    <component :is="icon" :size="18" class="shrink-0 mt-px" />
    <div class="flex-1 min-w-0 text-muted-foreground">
      <slot />
    </div>
    <Button
      v-if="dismissible"
      variant="ghost"
      size="sm"
      class="shrink-0 h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
      @click="$emit('dismiss')"
      aria-label="Dismiss"
    >
      <X :size="16" />
    </Button>
  </div>
</template>
