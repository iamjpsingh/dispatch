<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { AlertTriangle } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  show: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'default'
}>(), {
  variant: 'default',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function handleOpenChange(open: boolean) {
  if (!open) emit('cancel')
}
</script>

<template>
  <AlertDialog :open="show" @update:open="handleOpenChange">
    <AlertDialogContent class="sm:max-w-[420px]">
      <AlertDialogHeader>
        <div v-if="variant === 'danger' || variant === 'warning'" class="flex justify-center mb-3">
          <div :class="[
            'w-12 h-12 rounded-xl flex items-center justify-center',
            variant === 'danger' ? 'bg-red-500/15 text-red-500' : 'bg-amber-500/15 text-amber-500'
          ]">
            <AlertTriangle :size="24" />
          </div>
        </div>
        <AlertDialogTitle class="text-center">{{ title || 'Confirm' }}</AlertDialogTitle>
        <AlertDialogDescription class="text-center">{{ message }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="sm:justify-center gap-3">
        <AlertDialogCancel @click="emit('cancel')">{{ cancelText || 'Cancel' }}</AlertDialogCancel>
        <AlertDialogAction
          :class="variant === 'danger' ? 'bg-destructive text-white hover:bg-destructive/90' : ''"
          @click="emit('confirm')"
        >
          {{ confirmText || 'Confirm' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
