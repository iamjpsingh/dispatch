<script setup lang="ts">
import { type Component } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import StatusBadge from './StatusBadge.vue'

defineProps<{
  title: string
  subtitle?: string
  icon?: Component
  backTo?: string
  status?: string
  statusType?: 'campaign' | 'automation' | 'email'
}>()
</script>

<template>
  <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
    <div class="flex items-start gap-3 min-w-0">
      <!-- Back button -->
      <router-link
        v-if="backTo"
        :to="backTo"
        class="flex items-center justify-center shrink-0 w-8 h-8 mt-0.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <ArrowLeft :size="18" />
      </router-link>

      <!-- Optional prefix slot (avatar, icon, etc.) -->
      <slot name="prefix">
        <div
          v-if="icon"
          class="flex items-center justify-center shrink-0 w-10 h-10 mt-0.5 rounded-lg bg-accent/10 text-accent"
        >
          <component :is="icon" :size="20" />
        </div>
      </slot>

      <div class="min-w-0">
        <div class="flex items-center gap-2.5 flex-wrap">
          <h1 class="text-[24px] font-bold text-foreground leading-tight tracking-[-0.02em] m-0">
            {{ title }}
          </h1>
          <StatusBadge v-if="status" :status="status" :type="statusType || 'campaign'" />
        </div>
        <p v-if="subtitle" class="text-sm text-muted-foreground mt-1 m-0">
          {{ subtitle }}
        </p>
        <!-- Meta slot for dates, types, secondary info -->
        <div v-if="$slots.meta" class="mt-1">
          <slot name="meta" />
        </div>
      </div>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-3 shrink-0">
      <slot name="actions" />
    </div>
  </header>
</template>
