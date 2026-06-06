<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { HandleDef, NodeCategory } from './index'

const props = defineProps<{
  label: string
  icon: any
  color: string
  bgColor: string
  borderColor: string
  category: NodeCategory
  selected?: boolean
  hasTargetHandle: boolean
  outputs: HandleDef[]
  configured?: boolean
}>()

const hasMultipleOutputs = computed(() => props.outputs.length > 1)
const hasSingleOutput = computed(() => props.outputs.length === 1)

const categoryBadge = computed(() => {
  switch (props.category) {
    case 'trigger': return { label: 'Trigger', class: 'bg-green-500/15 text-green-500' }
    case 'action': return { label: 'Action', class: 'bg-indigo-500/15 text-indigo-400' }
    case 'decision': return { label: 'Decision', class: 'bg-green-500/15 text-green-500' }
    case 'condition': return { label: 'Condition', class: 'bg-amber-500/15 text-amber-400' }
    case 'timing': return { label: 'Timing', class: 'bg-violet-500/15 text-violet-400' }
    case 'end': return { label: 'End', class: 'bg-red-500/15 text-red-400' }
  }
})
</script>

<template>
  <div
    class="rounded-xl border-2 shadow-sm min-w-[190px] max-w-[230px] transition-all"
    :class="[
      selected ? 'ring-2 ring-accent/40 shadow-md scale-[1.02]' : '',
      borderColor,
      configured === false ? 'border-dashed opacity-70' : '',
    ]"
    :style="{ backgroundColor: bgColor }"
  >
    <!-- Target handle (input) -->
    <Handle
      v-if="hasTargetHandle"
      type="target"
      :position="Position.Top"
      class="!w-3.5 !h-3.5 !bg-muted-foreground/50 !border-2 !border-card !-top-[7px]"
    />

    <div class="px-4 py-3">
      <!-- Category badge -->
      <div class="mb-2">
        <span :class="['text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', categoryBadge.class]">
          {{ categoryBadge.label }}
        </span>
      </div>

      <!-- Icon + Label -->
      <div class="flex items-center gap-2.5">
        <div
          class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          :style="{ backgroundColor: color + '20' }"
        >
          <component :is="icon" :size="16" :style="{ color }" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-foreground truncate leading-tight">{{ label }}</div>
          <div class="text-[10px] text-muted-foreground truncate mt-0.5 leading-tight"><slot /></div>
        </div>
      </div>

      <!-- Configuration status indicator -->
      <div v-if="configured === false" class="mt-2 text-[9px] text-warning font-medium">
        Click to configure
      </div>
    </div>

    <!-- Single output handle -->
    <Handle
      v-if="hasSingleOutput"
      type="source"
      :position="Position.Bottom"
      :id="outputs[0].id"
      class="!w-3.5 !h-3.5 !border-2 !border-card !-bottom-[7px]"
      :style="{ backgroundColor: outputs[0].color }"
    />

    <!-- Multiple output handles (Yes/No or multi-split) -->
    <template v-if="hasMultipleOutputs">
      <div class="flex justify-between px-3 pb-1">
        <Handle
          v-for="(handle, i) in outputs"
          :key="handle.id"
          type="source"
          :position="Position.Bottom"
          :id="handle.id"
          class="!relative !transform-none !w-3.5 !h-3.5 !border-2 !border-card !-bottom-0"
          :style="{ backgroundColor: handle.color }"
        />
      </div>
      <div class="flex justify-between px-4 pb-2 -mt-0.5">
        <span
          v-for="handle in outputs"
          :key="handle.id + '-label'"
          class="text-[9px] font-semibold"
          :style="{ color: handle.color }"
        >
          {{ handle.label }}
        </span>
      </div>
    </template>
  </div>
</template>
