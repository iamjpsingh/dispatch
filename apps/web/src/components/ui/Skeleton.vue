<script setup lang="ts">
defineProps<{
  variant?: 'text' | 'card' | 'table-row' | 'circle' | 'stat-card' | 'calendar' | 'chart' | 'timeline'
  width?: string
  height?: string
  count?: number
}>()
</script>

<template>
  <template v-if="variant === 'card'">
    <div v-for="i in (count || 1)" :key="i" class="flex flex-col gap-3 p-5 bg-card border border-border rounded-lg">
      <div class="skeleton rounded" style="width: 60%; height: 16px" />
      <div class="skeleton rounded" style="width: 80%; height: 12px" />
      <div class="skeleton rounded" style="width: 40%; height: 12px" />
    </div>
  </template>

  <template v-else-if="variant === 'table-row'">
    <tr v-for="i in (count || 3)" :key="i">
      <td v-for="c in 5" :key="c" class="px-4 py-3 border-b border-border">
        <div class="skeleton rounded" :style="{ width: `${50 + Math.random() * 40}%`, height: '14px' }" />
      </td>
    </tr>
  </template>

  <template v-else-if="variant === 'stat-card'">
    <div v-for="i in (count || 4)" :key="i" class="flex items-center gap-3.5 p-5 bg-secondary border border-border rounded-lg">
      <div class="skeleton rounded-md" style="width: 44px; height: 44px" />
      <div class="flex flex-col gap-2 flex-1">
        <div class="skeleton rounded" style="width: 60%; height: 24px" />
        <div class="skeleton rounded" style="width: 40%; height: 12px" />
      </div>
    </div>
  </template>

  <template v-else-if="variant === 'circle'">
    <div
      class="skeleton rounded-full"
      :style="{ width: width || '40px', height: height || '40px' }"
    />
  </template>

  <template v-else-if="variant === 'calendar'">
    <div class="bg-card border border-border rounded-lg p-5">
      <!-- Header row (day names) -->
      <div class="grid grid-cols-7 gap-2 mb-3">
        <div v-for="d in 7" :key="d" class="skeleton rounded h-4 mx-auto" style="width: 32px" />
      </div>
      <!-- 5 weeks of day cells -->
      <div v-for="w in 5" :key="w" class="grid grid-cols-7 gap-2 mb-2">
        <div v-for="d in 7" :key="d" class="skeleton rounded-md" style="height: 48px" />
      </div>
    </div>
  </template>

  <template v-else-if="variant === 'chart'">
    <div class="bg-card border border-border rounded-lg p-5" :style="{ height: height || '240px' }">
      <div class="skeleton rounded mb-3" style="width: 120px; height: 16px" />
      <div class="flex items-end gap-2 h-[calc(100%-36px)]">
        <div v-for="i in 8" :key="i" class="skeleton rounded flex-1" :style="{ height: `${30 + Math.random() * 60}%` }" />
      </div>
    </div>
  </template>

  <template v-else-if="variant === 'timeline'">
    <div class="space-y-4">
      <div v-for="i in (count || 4)" :key="i" class="flex gap-3 items-start">
        <div class="skeleton rounded-full shrink-0" style="width: 32px; height: 32px" />
        <div class="flex-1 space-y-2">
          <div class="skeleton rounded" style="width: 70%; height: 14px" />
          <div class="skeleton rounded" style="width: 40%; height: 12px" />
        </div>
      </div>
    </div>
  </template>

  <template v-else>
    <div
      v-for="i in (count || 1)"
      :key="i"
      class="skeleton rounded"
      :style="{ width: width || '100%', height: height || '14px' }"
    />
  </template>
</template>
