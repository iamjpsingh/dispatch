<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface Props {
  show: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closable?: boolean
  fullscreenOnMobile?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  closable: true,
  fullscreenOnMobile: false,
})

const emit = defineEmits<{
  close: []
}>()

const sizeClasses: Record<string, string> = {
  sm: 'sm:max-w-[400px]',
  md: 'sm:max-w-[500px]',
  lg: 'sm:max-w-[700px]',
  xl: 'sm:max-w-[900px]',
}

function handleOpenChange(open: boolean) {
  if (!open && props.closable) {
    emit('close')
  }
}
</script>

<template>
  <Dialog :open="show" @update:open="handleOpenChange">
    <DialogContent
      :class="[sizeClasses[size], fullscreenOnMobile && 'max-sm:!max-w-none max-sm:!w-screen max-sm:!h-screen max-sm:!rounded-none max-sm:!m-0']"
      :show-close-button="closable"
      @pointer-down-outside="closable ? undefined : $event.preventDefault()"
      @escape-key-down="closable ? undefined : $event.preventDefault()"
    >
      <DialogHeader v-if="title">
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>

      <slot />

      <DialogFooter v-if="$slots.footer">
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
