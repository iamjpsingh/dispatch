<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '../../lib/utils'

const props = defineProps<{
  status: string
  type?: 'campaign' | 'automation' | 'email'
}>()

const statusConfig = computed(() => {
  const s = props.status?.toLowerCase()

  const campaignMap: Record<string, { class: string; label: string }> = {
    draft: { class: 'bg-[rgba(148,163,184,0.15)] text-muted-foreground', label: 'Draft' },
    testing: { class: 'bg-info/15 text-info', label: 'Testing' },
    scheduled: { class: 'bg-warning/15 text-warning', label: 'Scheduled' },
    sending: { class: 'bg-info/15 text-info', label: 'Sending' },
    paused: { class: 'bg-warning/15 text-warning', label: 'Paused' },
    completed: { class: 'bg-success/15 text-success', label: 'Completed' },
    cancelled: { class: 'bg-danger/15 text-danger', label: 'Cancelled' },
    archived: { class: 'bg-[rgba(148,163,184,0.15)] text-muted-foreground', label: 'Archived' },
  }

  const automationMap: Record<string, { class: string; label: string }> = {
    active: { class: 'bg-success/15 text-success', label: 'Active' },
    paused: { class: 'bg-warning/15 text-warning', label: 'Paused' },
    draft: { class: 'bg-info/15 text-info', label: 'Draft' },
  }

  const emailMap: Record<string, { class: string; label: string }> = {
    sent: { class: 'bg-success/15 text-success', label: 'Sent' },
    opened: { class: 'bg-info/15 text-info', label: 'Opened' },
    clicked: { class: 'bg-accent/15 text-accent', label: 'Clicked' },
    failed: { class: 'bg-danger/15 text-danger', label: 'Failed' },
    queued: { class: 'bg-warning/15 text-warning', label: 'Queued' },
    bounced: { class: 'bg-danger/15 text-danger', label: 'Bounced' },
  }

  const map = props.type === 'automation' ? automationMap : props.type === 'email' ? emailMap : campaignMap
  return map[s] || { class: 'bg-[rgba(148,163,184,0.15)] text-muted-foreground', label: props.status }
})
</script>

<template>
  <span
    :class="cn(
      'inline-flex items-center gap-1 px-2.5 py-[3px] text-xs font-semibold rounded-full whitespace-nowrap capitalize',
      statusConfig.class
    )"
  >
    {{ statusConfig.label }}
  </span>
</template>
