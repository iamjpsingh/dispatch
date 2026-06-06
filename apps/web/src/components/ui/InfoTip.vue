<script setup lang="ts">
import { HelpCircle } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

withDefaults(defineProps<{
  text: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  size?: number
}>(), {
  side: 'top',
  size: 14,
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="inline-flex items-center text-muted-foreground hover:text-foreground cursor-help transition-colors">
          <HelpCircle :size="size" />
        </span>
      </TooltipTrigger>
      <TooltipContent :side="side">
        {{ text }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
