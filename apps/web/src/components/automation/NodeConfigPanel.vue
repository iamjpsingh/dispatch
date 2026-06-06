<script setup lang="ts">
import { computed } from 'vue'
import type { Node } from '@vue-flow/core'
import { NODE_TYPES, OPERATORS, CONTACT_FIELDS, getNodeSummary, type NodeTypeName, type NodeFieldDef } from './nodes'
import { X, Trash2, Settings, Clock } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const props = defineProps<{
  node: Node | null
}>()

const emit = defineEmits<{
  close: []
  delete: [nodeId: string]
  update: [nodeId: string, data: Record<string, any>]
}>()

const nodeType = computed(() => props.node?.type as NodeTypeName | undefined)
const nodeDef = computed(() => nodeType.value ? NODE_TYPES[nodeType.value] : null)
const config = computed(() => props.node?.data?.config || {})

function updateConfig(key: string, value: any) {
  if (!props.node) return
  const newConfig = { ...config.value, [key]: value }
  const updated = {
    ...props.node.data,
    config: newConfig,
    summary: getNodeSummary(props.node.type as string, newConfig),
  }
  emit('update', props.node.id, updated)
}

function getFieldValue(field: NodeFieldDef): any {
  return config.value[field.key] ?? ''
}
</script>

<template>
  <div v-if="node && nodeDef" class="bg-card border border-border rounded-xl w-80 shadow-lg overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border" :style="{ backgroundColor: nodeDef.color + '08' }">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: nodeDef.color + '20' }">
          <component :is="nodeDef.icon" :size="14" :style="{ color: nodeDef.color }" />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-semibold text-foreground truncate">{{ nodeDef.label }}</div>
          <div class="text-[10px] text-muted-foreground">{{ nodeDef.description }}</div>
        </div>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <button
          v-if="node.type !== 'trigger'"
          @click="emit('delete', node.id)"
          class="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition cursor-pointer"
          title="Delete node"
        >
          <Trash2 :size="14" />
        </button>
        <button
          @click="emit('close')"
          class="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition cursor-pointer"
        >
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- Trigger info -->
    <template v-if="node.type === 'trigger'">
      <div class="p-4">
        <p class="text-xs text-muted-foreground">Trigger type is set when creating the automation. Contacts enter the flow through this node.</p>
        <div v-if="node.data?.triggerType" class="mt-3 px-3 py-2 bg-secondary rounded-lg">
          <span class="text-xs font-medium text-foreground">{{ node.data.triggerType }}</span>
        </div>
      </div>
    </template>

    <!-- End info -->
    <template v-else-if="node.type === 'end'">
      <div class="p-4">
        <p class="text-xs text-muted-foreground">Contacts reaching this node will complete and exit the automation.</p>
      </div>
    </template>

    <!-- Dynamic config fields -->
    <template v-else-if="nodeDef.fields.length > 0">
      <div class="p-4 space-y-3.5 max-h-[60vh] overflow-y-auto">
        <div v-for="field in nodeDef.fields" :key="field.key">
          <Label class="text-xs mb-1.5 block">
            {{ field.label }}
            <span v-if="field.required" class="text-danger">*</span>
          </Label>

          <!-- Text input -->
          <Input
            v-if="field.type === 'text'"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
            :placeholder="field.placeholder"
            class="text-sm"
          />

          <!-- Number input -->
          <Input
            v-else-if="field.type === 'number'"
            type="number"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, Number($event))"
            :placeholder="field.placeholder"
            class="text-sm"
          />

          <!-- Textarea -->
          <Textarea
            v-else-if="field.type === 'textarea'"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
            :placeholder="field.placeholder"
            rows="3"
            class="text-sm resize-none"
          />

          <!-- DateTime -->
          <Input
            v-else-if="field.type === 'datetime'"
            type="datetime-local"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
            class="text-sm"
          />

          <!-- Select with static options -->
          <Select
            v-else-if="field.type === 'select' && field.options"
            :model-value="getFieldValue(field) || field.options[0]?.value"
            @update:model-value="updateConfig(field.key, $event)"
          >
            <SelectTrigger class="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</SelectItem>
            </SelectContent>
          </Select>

          <!-- Operator select -->
          <Select
            v-else-if="field.type === 'operator-select'"
            :model-value="getFieldValue(field) || 'equals'"
            @update:model-value="updateConfig(field.key, $event)"
          >
            <SelectTrigger class="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="op in OPERATORS" :key="op.value" :value="op.value">{{ op.label }}</SelectItem>
            </SelectContent>
          </Select>

          <!-- Field picker (contact fields) -->
          <Select
            v-else-if="field.type === 'field-picker'"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
          >
            <SelectTrigger class="text-sm"><SelectValue placeholder="Select field..." /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="f in CONTACT_FIELDS" :key="f.value" :value="f.value">{{ f.label }}</SelectItem>
            </SelectContent>
          </Select>

          <!-- Tag picker (text input for now — can be enhanced to autocomplete) -->
          <Input
            v-else-if="field.type === 'tag-picker'"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
            placeholder="Enter tag name..."
            class="text-sm"
          />

          <!-- List picker (text input for now — can be enhanced to fetch real lists) -->
          <Input
            v-else-if="field.type === 'list-picker'"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
            placeholder="Enter list ID..."
            class="text-sm"
          />

          <!-- Template picker (text input for now — can be enhanced to fetch real templates) -->
          <Input
            v-else-if="field.type === 'template-picker'"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
            placeholder="Template ID..."
            class="text-sm"
          />

          <!-- WhatsApp template picker -->
          <Input
            v-else-if="field.type === 'wa-template-picker'"
            :model-value="getFieldValue(field)"
            @update:model-value="updateConfig(field.key, $event)"
            placeholder="Template name (must be Meta-approved)..."
            class="text-sm"
          />

          <!-- Duration (two fields: number + unit) -->
          <template v-else-if="field.type === 'duration'">
            <div class="flex gap-2">
              <Input type="number" min="1" :model-value="config[field.key + '_value'] || 1" @update:model-value="updateConfig(field.key + '_value', Number($event))" class="text-sm flex-1" />
              <Select :model-value="config[field.key + '_unit'] || 'days'" @update:model-value="updateConfig(field.key + '_unit', $event)">
                <SelectTrigger class="text-sm w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Min</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                  <SelectItem value="weeks">Weeks</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </template>

          <!-- Help text -->
          <p v-if="field.helpText" class="text-[10px] text-muted-foreground mt-1">{{ field.helpText }}</p>
        </div>
      </div>
    </template>

    <!-- Footer: Node ID -->
    <div class="px-4 py-2.5 border-t border-border bg-muted/30">
      <span class="text-[9px] text-muted-foreground font-mono">{{ node.id }}</span>
    </div>
  </div>
</template>
