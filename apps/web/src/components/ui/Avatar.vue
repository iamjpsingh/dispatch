<script setup lang="ts">
import { computed, ref } from 'vue'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const avatarVariants = cva(
  'relative inline-flex items-center justify-center overflow-hidden rounded-lg font-semibold shrink-0',
  {
    variants: {
      size: {
        sm: 'h-7 w-7 text-[10px]',
        md: 'h-[34px] w-[34px] text-xs',
        lg: 'h-11 w-11 text-sm',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

type AvatarVariants = VariantProps<typeof avatarVariants>

interface Props {
  name?: string
  src?: string
  size?: NonNullable<AvatarVariants['size']>
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  name: '',
  src: '',
  size: 'md',
})

const imgError = ref(false)

const initials = computed(() => {
  if (!props.name) return '?'
  const parts = props.name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
})

const showImage = computed(() => props.src && !imgError.value)

const classes = computed(() =>
  cn(avatarVariants({ size: props.size }), props.class),
)

function onImageError() {
  imgError.value = true
}
</script>

<template>
  <span :class="classes">
    <img
      v-if="showImage"
      :src="src"
      :alt="name"
      class="h-full w-full object-cover"
      @error="onImageError"
    />
    <span
      v-else
      class="flex h-full w-full items-center justify-center bg-accent text-white"
    >
      {{ initials }}
    </span>
  </span>
</template>
