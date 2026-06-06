<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Contact } from '../../lib/api'
import { Pencil, Loader2, CheckSquare, Square, Mail, Eye } from 'lucide-vue-next'

const router = useRouter()

const props = defineProps<{
  contacts: Contact[]
  loading: boolean
  selectedIds: string[]
}>()

const emit = defineEmits<{
  (e: 'toggle-select', id: string): void
  (e: 'toggle-select-all'): void
  (e: 'edit', contact: Contact): void
  (e: 'timeline', contact: Contact): void
}>()

const allSelected = computed(() => props.contacts.length > 0 && props.selectedIds.length === props.contacts.length)

function parseTags(tagsJson: string): string[] {
  try {
    return JSON.parse(tagsJson)
  } catch {
    return []
  }
}
</script>

<template>
  <div v-if="loading" class="flex flex-col items-center justify-center gap-3 py-12 px-4 text-muted-foreground text-center">
    <Loader2 :size="24" class="animate-spin" /><span>Loading contacts...</span>
  </div>
  <div
    v-else-if="!contacts.length"
    class="flex flex-col items-center justify-center gap-3 py-12 px-4 text-muted-foreground text-center"
  >
    <Mail :size="40" />
    <p class="m-0">No contacts in this list</p>
    <p class="text-muted-foreground text-[13px] m-0">Add contacts manually or import from a file</p>
  </div>
  <div v-else class="overflow-x-auto border border-border rounded-xl">
    <table class="w-full border-collapse">
      <thead>
        <tr>
          <th
            class="w-10 px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] bg-secondary text-muted-foreground border-b border-border"
          >
            <button
              class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
              @click="emit('toggle-select-all')"
            >
              <CheckSquare v-if="allSelected" :size="16" /><Square v-else :size="16" />
            </button>
          </th>
          <th
            class="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] bg-secondary text-muted-foreground border-b border-border"
          >
            Email
          </th>
          <th
            class="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] bg-secondary text-muted-foreground border-b border-border"
          >
            Name
          </th>
          <th
            class="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] bg-secondary text-muted-foreground border-b border-border"
          >
            Company
          </th>
          <th
            class="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] bg-secondary text-muted-foreground border-b border-border"
          >
            Status
          </th>
          <th
            class="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] bg-secondary text-muted-foreground border-b border-border"
          >
            Tags
          </th>
          <th
            class="w-[60px] px-3.5 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.04em] bg-secondary text-muted-foreground border-b border-border"
          >
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="contact in contacts"
          :key="contact.id"
          class="transition-colors duration-100 border-b border-border last:border-b-0 cursor-pointer"
          :class="selectedIds.includes(contact.id) ? 'bg-accent/[0.06]' : 'hover:bg-accent/[0.03]'"
          @click="router.push(`/contacts/${contact.id}`)"
        >
          <td class="w-10 px-3.5 py-2.5 text-left text-[13px]" @click.stop>
            <button
              class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
              @click="emit('toggle-select', contact.id)"
            >
              <CheckSquare v-if="selectedIds.includes(contact.id)" :size="16" /><Square v-else :size="16" />
            </button>
          </td>
          <td class="px-3.5 py-2.5 text-left text-[13px] font-mono text-accent">{{ contact.email }}</td>
          <td class="px-3.5 py-2.5 text-left text-[13px]">
            {{ [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '-' }}
          </td>
          <td class="px-3.5 py-2.5 text-left text-[13px]">{{ contact.company || '-' }}</td>
          <td class="px-3.5 py-2.5 text-left text-[13px]">
            <span
              class="inline-block px-2.5 py-0.5 rounded-[10px] text-[11px] font-semibold uppercase"
              :class="{
                'bg-green-500/15 text-green-500': contact.status === 'active',
                'bg-amber-500/15 text-amber-500': contact.status === 'unsubscribed',
                'bg-red-500/15 text-red-500': contact.status === 'bounced' || contact.status === 'complained',
              }"
              >{{ contact.status }}</span
            >
          </td>
          <td class="px-3.5 py-2.5 text-left text-[13px]">
            <span
              v-for="tag in parseTags(contact.tags)"
              :key="tag"
              class="inline-block px-2 py-0.5 rounded-lg text-[11px] bg-muted text-muted-foreground mr-1"
              >{{ tag }}</span
            >
            <span v-if="!parseTags(contact.tags).length" class="text-muted-foreground text-[13px]">-</span>
          </td>
          <td class="w-[80px] px-3.5 py-2.5 text-center text-[13px]" @click.stop>
            <div class="flex items-center justify-center gap-1">
              <button
                class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
                @click="router.push(`/contacts/${contact.id}`)"
                title="View Details"
              >
                <Eye :size="14" />
              </button>
              <button
                class="bg-transparent border-none cursor-pointer p-1 text-muted-foreground rounded hover:bg-accent/10 hover:text-accent transition-all duration-150"
                @click="emit('edit', contact)"
                title="Edit"
              >
                <Pencil :size="14" />
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
