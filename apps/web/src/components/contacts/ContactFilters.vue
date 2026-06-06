<script setup lang="ts">
import { Search, Upload, Plus } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const searchQuery = defineModel<string>('searchQuery', { required: true })

const emit = defineEmits<{
  (e: 'search-input'): void
  (e: 'import'): void
  (e: 'add'): void
}>()
</script>

<template>
  <div class="flex justify-between items-center mb-4 gap-3">
    <div class="flex-1">
      <div class="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2 max-w-[360px]">
        <Search :size="16" class="text-muted-foreground" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search contacts..."
          class="flex-1 bg-transparent border-none outline-none text-foreground text-sm"
          @input="emit('search-input')"
        />
      </div>
    </div>
    <div class="flex gap-2">
      <Button variant="ghost" size="sm" @click="emit('import')">
        <Upload :size="14" />
        Import
      </Button>
      <Button size="sm" @click="emit('add')">
        <Plus :size="14" />
        Add
      </Button>
    </div>
  </div>
</template>
