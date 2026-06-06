<script setup lang="ts">
import SearchInput from './SearchInput.vue'

withDefaults(defineProps<{
  searchQuery?: string
  searchPlaceholder?: string
  showSearch?: boolean
}>(), {
  searchQuery: '',
  searchPlaceholder: 'Search...',
  showSearch: true,
})

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void
  (e: 'search'): void
}>()
</script>

<template>
  <div class="flex items-center gap-3 mb-5 flex-wrap">
    <!-- Left: Filters slot (tabs, dropdowns, etc.) -->
    <div v-if="$slots.filters" class="flex items-center gap-2 min-w-0">
      <slot name="filters" />
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Search -->
    <SearchInput
      v-if="showSearch"
      :model-value="searchQuery"
      :placeholder="searchPlaceholder"
      :debounce="300"
      class="w-60 max-w-full"
      @update:model-value="emit('update:searchQuery', $event)"
      @search="emit('search')"
    />

    <!-- Right: Action buttons slot -->
    <div v-if="$slots.actions" class="flex items-center gap-2 shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
