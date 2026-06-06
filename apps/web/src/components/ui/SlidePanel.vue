<script setup lang="ts">
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'

interface Props {
  show: boolean
  title?: string
  size?: 'md' | 'lg' | 'xl' | 'full'
  flush?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'lg',
  flush: false,
})

const emit = defineEmits<{
  close: []
}>()

const sizeClasses: Record<string, string> = {
  md: 'sm:max-w-[500px]',
  lg: 'sm:max-w-[640px]',
  xl: 'sm:max-w-[800px]',
  full: 'sm:max-w-[90vw]',
}

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}
</script>

<template>
  <Sheet :open="show" @update:open="handleOpenChange">
    <SheetContent :class="['flex flex-col', sizeClasses[size]]" side="right">
      <SheetHeader v-if="title">
        <SheetTitle>{{ title }}</SheetTitle>
      </SheetHeader>

      <div :class="['flex-1 overflow-y-auto', flush ? '' : 'p-6']">
        <slot />
      </div>

      <SheetFooter v-if="$slots.footer" class="border-t border-border px-6 py-4">
        <slot name="footer" />
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
