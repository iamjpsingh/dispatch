<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon?: Component
  title: string
  description?: string
}>()
</script>

<template>
  <div class="flex flex-col items-center text-center py-16 px-6">
    <div
      v-if="icon"
      class="flex items-center justify-center w-14 h-14 rounded-2xl bg-muted mb-5"
    >
      <component :is="icon" :size="28" class="text-muted-foreground" />
    </div>
    <h3 class="text-base font-semibold text-foreground m-0">
      {{ title }}
    </h3>
    <p v-if="description" class="text-sm text-muted-foreground max-w-sm mt-2 m-0 leading-relaxed">
      {{ description }}
    </p>
    <div v-if="$slots.actions" class="flex gap-3 mt-5">
      <slot name="actions" />
    </div>
  </div>
</template>
