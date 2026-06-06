<script setup lang="ts">
import DateTimeInput from '../ui/DateTimeInput.vue'
import { Zap, Clock } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

const useBatch = defineModel<boolean>('useBatch', { required: true })
const batchSize = defineModel<number>('batchSize', { required: true })
const batchDelay = defineModel<number>('batchDelay', { required: true })
const emailDelay = defineModel<number>('emailDelay', { required: true })
const useSchedule = defineModel<boolean>('useSchedule', { required: true })
const scheduledTime = defineModel<string>('scheduledTime', { required: true })
const notifyEmail = defineModel<string>('notifyEmail', { required: true })
</script>

<template>
  <!-- Batch settings -->
  <div class="bg-card border border-border rounded-xl p-5">
    <h3 class="text-sm font-semibold mb-4 flex items-center gap-2 text-foreground">
      <Zap :size="16" class="text-accent" />
      Batch Settings
    </h3>
    <label class="flex items-center gap-2 cursor-pointer">
      <Checkbox v-model="useBatch" />
      <span class="text-sm text-muted-foreground">Enable batch sending</span>
    </label>

    <div v-if="useBatch" class="mt-4 pt-4 border-t border-border">
      <div class="flex flex-col gap-2">
        <Label>Batch Size</Label>
        <Input :model-value="batchSize" @update:model-value="batchSize = Number($event)" type="number" min="1" max="100" />
      </div>
      <div class="flex flex-col gap-2">
        <Label>Batch Delay (seconds)</Label>
        <Input :model-value="batchDelay" @update:model-value="batchDelay = Number($event)" type="number" min="1" />
      </div>
      <div class="flex flex-col gap-2">
        <Label>Email Delay (seconds)</Label>
        <Input :model-value="emailDelay" @update:model-value="emailDelay = Number($event)" type="number" min="1" />
      </div>
    </div>
  </div>

  <!-- Schedule settings -->
  <div class="bg-card border border-border rounded-xl p-5">
    <h3 class="text-sm font-semibold mb-4 flex items-center gap-2 text-foreground">
      <Clock :size="16" class="text-accent" />
      Schedule Settings
    </h3>
    <label class="flex items-center gap-2 cursor-pointer">
      <Checkbox v-model="useSchedule" />
      <span class="text-sm text-muted-foreground">Schedule for later</span>
    </label>

    <div v-if="useSchedule" class="mt-4 pt-4 border-t border-border">
      <div class="flex flex-col gap-2">
        <Label>Scheduled Time</Label>
        <DateTimeInput v-model="scheduledTime" placeholder="Select date and time" />
      </div>
      <div class="flex flex-col gap-2">
        <Label>Notification Email (optional)</Label>
        <Input v-model="notifyEmail" type="email" placeholder="notify@example.com" />
      </div>
    </div>
  </div>
</template>
