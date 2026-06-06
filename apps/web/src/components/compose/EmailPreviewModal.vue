<script setup lang="ts">
import { Eye, X, Mail } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

defineProps<{
  show: boolean
  contacts: any[]
  contactIndex: number
  fromName: string
  fromEmail: string
  toName: string
  toEmail: string
  previewSubject: string
  previewContent: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 bg-[rgba(0,0,0,0.85)] backdrop-blur-[8px] flex items-center justify-center z-[2000] p-5 animate-fade-in"
      @click.self="emit('close')"
    >
      <div
        class="preview-modal w-full max-w-[800px] max-h-[90vh] bg-secondary rounded-[var(--radius-lg)] border border-border flex flex-col overflow-hidden"
      >
        <div class="flex justify-between items-center px-6 py-5 border-b border-border bg-background">
          <h2 class="flex items-center gap-2.5 text-lg m-0 text-foreground">
            <Eye :size="20" />
            Email Preview
          </h2>
          <Button variant="ghost" size="sm" @click="emit('close')">
            <X :size="20" />
          </Button>
        </div>

        <!-- Contact selector -->
        <div
          v-if="contacts.length > 0"
          class="flex items-center justify-center gap-4 px-6 py-3 bg-background border-b border-border"
        >
          <Button variant="ghost" size="sm" @click="emit('prev')" :disabled="contacts.length <= 1">&larr;</Button>
          <span class="flex items-center gap-2 text-sm">
            <strong>{{ toName || toEmail || 'Contact' }}</strong>
            <span class="text-muted-foreground">({{ contactIndex + 1 }} of {{ contacts.length }})</span>
          </span>
          <Button variant="ghost" size="sm" @click="emit('next')" :disabled="contacts.length <= 1">&rarr;</Button>
        </div>
        <div v-else class="flex items-center justify-center gap-4 px-6 py-4 bg-background border-b border-border">
          <span class="text-muted-foreground">Using sample data (upload contacts to preview with real data)</span>
        </div>

        <!-- Email preview -->
        <div class="flex-1 overflow-y-auto bg-white">
          <div class="px-6 py-5 border-b border-[#e5e7eb] bg-[#f9fafb]">
            <div class="flex gap-3 mb-2 text-sm text-[#374151]">
              <span class="font-semibold text-[#6b7280] min-w-[60px]">From:</span>
              <span>{{ fromName }} &lt;{{ fromEmail }}&gt;</span>
            </div>
            <div class="flex gap-3 mb-2 text-sm text-[#374151]">
              <span class="font-semibold text-[#6b7280] min-w-[60px]">To:</span>
              <span v-if="toEmail">
                <template v-if="toName"> {{ toName }} &lt;{{ toEmail }}&gt; </template>
                <template v-else>{{ toEmail }}</template>
              </span>
              <span v-else class="text-muted-foreground">(No email found in contact)</span>
            </div>
            <div class="flex gap-3 text-sm text-[#374151]">
              <span class="font-semibold text-[#6b7280] min-w-[60px]">Subject:</span>
              <span class="font-semibold text-[#111827]">{{ previewSubject || '(No subject)' }}</span>
            </div>
          </div>

          <div class="preview-email-body">
            <div v-if="previewContent" v-html="previewContent"></div>
            <div v-else class="flex flex-col items-center justify-center h-[300px] text-[#9ca3af]">
              <Mail :size="48" />
              <p class="mt-4 text-[#9ca3af]">No content yet. Start writing your email!</p>
            </div>
          </div>
        </div>

        <div class="px-6 py-4 border-t border-border bg-background flex justify-end">
          <Button variant="secondary" @click="emit('close')">Close Preview</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.preview-modal {
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.preview-email-body {
  padding: 24px;
  min-height: 300px;
  color: #111827;
  font-size: 15px;
  line-height: 1.6;
}

.preview-email-body :deep(h1),
.preview-email-body :deep(h2),
.preview-email-body :deep(h3),
.preview-email-body :deep(h4),
.preview-email-body :deep(h5),
.preview-email-body :deep(h6) {
  color: #111827;
  margin-bottom: 12px;
}

.preview-email-body :deep(p) {
  margin-bottom: 12px;
  color: #374151;
}

.preview-email-body :deep(a) {
  color: #2563eb;
}

.preview-email-body :deep(img) {
  max-width: 100%;
  height: auto;
}

.preview-email-body :deep(ul),
.preview-email-body :deep(ol) {
  margin-bottom: 12px;
  padding-left: 24px;
}

.preview-email-body :deep(blockquote) {
  border-left: 4px solid #e5e7eb;
  padding-left: 16px;
  margin: 16px 0;
  color: #6b7280;
}
</style>
