<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Mail, Clock, Eye,
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code,
  AlignLeft, AlignCenter, AlignRight,
  Link2, Unlink, ImagePlus,
  Undo2, Redo2, Minus, Highlighter, RemoveFormatting
} from 'lucide-vue-next'

const props = defineProps<{
  subject: string
  content: string
  delay: number
  columns?: string[]
}>()

const emit = defineEmits(['update:subject', 'update:content', 'update:delay', 'preview'])

const dynamicPlaceholders = computed(() => {
  if (props.columns && props.columns.length > 0) {
    return props.columns.map((col) => ({
      label: col,
      value: `{{${col}}}`,
    }))
  }
  return []
})

const showPlaceholders = computed(() => dynamicPlaceholders.value.length > 0)

const showLinkInput = ref(false)
const linkUrl = ref('')
const linkInputRef = ref<HTMLInputElement>()

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'editor-link' },
    }),
    Image,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Placeholder.configure({
      placeholder: 'Write your email content here...',
    }),
  ],
  content: props.content || '',
  onUpdate: ({ editor: e }) => {
    emit('update:content', e.getHTML())
  },
})

watch(
  () => props.content,
  (newContent) => {
    if (editor.value && newContent !== editor.value.getHTML()) {
      editor.value.commands.setContent(newContent || '', { emitUpdate: false })
    }
  }
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})

function insertPlaceholder(value: string) {
  editor.value?.chain().focus().insertContent(value).run()
}

function setLink() {
  if (linkUrl.value) {
    const url = linkUrl.value.startsWith('http') ? linkUrl.value : `https://${linkUrl.value}`
    editor.value?.chain().focus().setLink({ href: url }).run()
  }
  showLinkInput.value = false
  linkUrl.value = ''
}

function toggleLink() {
  if (editor.value?.isActive('link')) {
    editor.value.chain().focus().unsetLink().run()
    return
  }
  showLinkInput.value = true
  setTimeout(() => linkInputRef.value?.focus(), 50)
}

function addImage() {
  const url = window.prompt('Image URL:')
  if (url) {
    editor.value?.chain().focus().setImage({ src: url }).run()
  }
}

function clearFormatting() {
  editor.value?.chain().focus().clearNodes().unsetAllMarks().run()
}
</script>

<template>
  <div class="email-editor bg-card border border-border rounded-xl">
    <div class="editor-header">
      <h3>
        <Mail :size="18" class="header-icon" />
        Email Content
      </h3>
      <Button
        variant="secondary"
        size="sm"
        @click="emit('preview')"
        :disabled="!props.subject && !props.content"
      >
        <Eye :size="16" />
        Preview
      </Button>
    </div>

    <!-- Subject -->
    <div class="mb-5">
      <Label>Subject *</Label>
      <Input
        :model-value="subject"
        @update:model-value="emit('update:subject', $event)"
        type="text"
        placeholder="Enter email subject..."
      />
    </div>

    <!-- Dynamic Placeholders -->
    <div v-if="showPlaceholders" class="placeholders">
      <span class="placeholder-label">Insert placeholder:</span>
      <div class="placeholder-buttons">
        <button
          v-for="p in dynamicPlaceholders"
          :key="p.value"
          type="button"
          class="placeholder-btn"
          @click="insertPlaceholder(p.value)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- Editor -->
    <div class="editor-wrapper">
      <!-- Toolbar -->
      <div v-if="editor" class="editor-toolbar">
        <!-- History -->
        <div class="toolbar-group">
          <button type="button" class="toolbar-btn" title="Undo" :disabled="!editor.can().undo()" @click="editor.chain().focus().undo().run()">
            <Undo2 :size="15" />
          </button>
          <button type="button" class="toolbar-btn" title="Redo" :disabled="!editor.can().redo()" @click="editor.chain().focus().redo().run()">
            <Redo2 :size="15" />
          </button>
        </div>

        <div class="toolbar-divider" />

        <!-- Text formatting -->
        <div class="toolbar-group">
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('bold') }" title="Bold" @click="editor.chain().focus().toggleBold().run()">
            <Bold :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('italic') }" title="Italic" @click="editor.chain().focus().toggleItalic().run()">
            <Italic :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('underline') }" title="Underline" @click="editor.chain().focus().toggleUnderline().run()">
            <UnderlineIcon :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('strike') }" title="Strikethrough" @click="editor.chain().focus().toggleStrike().run()">
            <Strikethrough :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('highlight') }" title="Highlight" @click="editor.chain().focus().toggleHighlight().run()">
            <Highlighter :size="15" />
          </button>
        </div>

        <div class="toolbar-divider" />

        <!-- Headings -->
        <div class="toolbar-group">
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('heading', { level: 1 }) }" title="Heading 1" @click="editor.chain().focus().toggleHeading({ level: 1 }).run()">
            <Heading1 :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('heading', { level: 2 }) }" title="Heading 2" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">
            <Heading2 :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('heading', { level: 3 }) }" title="Heading 3" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()">
            <Heading3 :size="15" />
          </button>
        </div>

        <div class="toolbar-divider" />

        <!-- Lists & blocks -->
        <div class="toolbar-group">
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('bulletList') }" title="Bullet List" @click="editor.chain().focus().toggleBulletList().run()">
            <List :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('orderedList') }" title="Ordered List" @click="editor.chain().focus().toggleOrderedList().run()">
            <ListOrdered :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('blockquote') }" title="Blockquote" @click="editor.chain().focus().toggleBlockquote().run()">
            <Quote :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('codeBlock') }" title="Code Block" @click="editor.chain().focus().toggleCodeBlock().run()">
            <Code :size="15" />
          </button>
          <button type="button" class="toolbar-btn" title="Horizontal Rule" @click="editor.chain().focus().setHorizontalRule().run()">
            <Minus :size="15" />
          </button>
        </div>

        <div class="toolbar-divider" />

        <!-- Alignment -->
        <div class="toolbar-group">
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive({ textAlign: 'left' }) }" title="Align Left" @click="editor.chain().focus().setTextAlign('left').run()">
            <AlignLeft :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive({ textAlign: 'center' }) }" title="Align Center" @click="editor.chain().focus().setTextAlign('center').run()">
            <AlignCenter :size="15" />
          </button>
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive({ textAlign: 'right' }) }" title="Align Right" @click="editor.chain().focus().setTextAlign('right').run()">
            <AlignRight :size="15" />
          </button>
        </div>

        <div class="toolbar-divider" />

        <!-- Insert -->
        <div class="toolbar-group">
          <button type="button" class="toolbar-btn" :class="{ active: editor.isActive('link') }" title="Insert Link" @click="toggleLink">
            <Link2 :size="15" />
          </button>
          <button v-if="editor.isActive('link')" type="button" class="toolbar-btn" title="Remove Link" @click="editor.chain().focus().unsetLink().run()">
            <Unlink :size="15" />
          </button>
          <button type="button" class="toolbar-btn" title="Insert Image" @click="addImage">
            <ImagePlus :size="15" />
          </button>
        </div>

        <div class="toolbar-divider" />

        <!-- Clear -->
        <div class="toolbar-group">
          <button type="button" class="toolbar-btn" title="Clear Formatting" @click="clearFormatting">
            <RemoveFormatting :size="15" />
          </button>
        </div>
      </div>

      <!-- Link input popup -->
      <div v-if="showLinkInput" class="link-input-bar">
        <Link2 :size="14" class="link-input-icon" />
        <input
          ref="linkInputRef"
          v-model="linkUrl"
          type="text"
          class="link-input"
          placeholder="https://example.com"
          @keydown.enter="setLink"
          @keydown.escape="showLinkInput = false; linkUrl = ''"
        />
        <button class="link-action-btn link-add" @click="setLink">Add</button>
        <button class="link-action-btn link-cancel" @click="showLinkInput = false; linkUrl = ''">Cancel</button>
      </div>

      <!-- Editor content -->
      <EditorContent :editor="editor" class="editor-content" />
    </div>

    <!-- Delay -->
    <div class="mb-5">
      <Label class="flex items-center gap-1.5">
        <Clock :size="14" />
        Delay Between Emails (seconds)
      </Label>
      <Input
        :model-value="delay"
        @update:model-value="emit('update:delay', Number($event))"
        type="number"
        min="15"
        max="60"
      />
      <p class="text-muted text-sm mt-2">15-30 seconds recommended to avoid rate limits</p>
    </div>
  </div>
</template>

<style scoped>
.email-editor {
  padding: 24px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.editor-header h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-foreground);
}

.header-icon {
  color: var(--color-accent);
}

/* Placeholders */
.placeholders {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--color-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.placeholder-label {
  font-size: 13px;
  color: var(--color-muted-foreground);
  font-weight: 500;
}

.placeholder-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.placeholder-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-accent);
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-mono);
}

.placeholder-btn:hover {
  background: rgba(99, 102, 241, 0.2);
  border-color: var(--color-accent);
}

/* Editor wrapper */
.editor-wrapper {
  margin-bottom: 24px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-secondary);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.editor-wrapper:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}

/* Toolbar */
.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 6px 8px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 1px;
}

.toolbar-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-muted-foreground);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
}

.toolbar-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.1);
  color: var(--color-foreground);
}

.toolbar-btn.active {
  background: rgba(99, 102, 241, 0.15);
  color: var(--color-accent);
}

.toolbar-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--color-border);
  margin: 0 4px;
  flex-shrink: 0;
}

/* Link input bar */
.link-input-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
}

.link-input-icon {
  color: var(--color-muted-foreground);
  flex-shrink: 0;
}

.link-input {
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--color-foreground);
  background: var(--color-secondary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease;
}

.link-input:focus {
  border-color: var(--color-accent);
}

.link-action-btn {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.link-add {
  background: var(--color-accent);
  color: #fff;
}

.link-add:hover {
  opacity: 0.9;
}

.link-cancel {
  background: transparent;
  color: var(--color-muted-foreground);
}

.link-cancel:hover {
  color: var(--color-foreground);
}

/* Editor content area */
.editor-content {
  min-height: 300px;
}

.editor-content :deep(.tiptap) {
  min-height: 300px;
  padding: 20px;
  color: var(--color-foreground);
  font-size: 15px;
  line-height: 1.7;
  outline: none;
}

.editor-content :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--color-muted-foreground);
  pointer-events: none;
  height: 0;
}

.editor-content :deep(.tiptap h1),
.editor-content :deep(.tiptap h2),
.editor-content :deep(.tiptap h3),
.editor-content :deep(.tiptap h4),
.editor-content :deep(.tiptap h5),
.editor-content :deep(.tiptap h6) {
  color: var(--color-foreground);
  margin-bottom: 12px;
  line-height: 1.3;
}

.editor-content :deep(.tiptap h1) { font-size: 1.875em; }
.editor-content :deep(.tiptap h2) { font-size: 1.5em; }
.editor-content :deep(.tiptap h3) { font-size: 1.25em; }

.editor-content :deep(.tiptap p) {
  margin-bottom: 12px;
}

.editor-content :deep(.tiptap a),
.editor-content :deep(.tiptap .editor-link) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.editor-content :deep(.tiptap mark) {
  background: rgba(250, 204, 21, 0.4);
  border-radius: 2px;
  padding: 0 2px;
}

.editor-content :deep(.tiptap blockquote) {
  border-left: 3px solid var(--color-accent);
  padding: 12px 16px;
  margin: 16px 0;
  color: var(--color-muted-foreground);
  background: rgba(99, 102, 241, 0.04);
  border-radius: 0 8px 8px 0;
}

.editor-content :deep(.tiptap pre) {
  background: var(--color-background);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  overflow-x: auto;
}

.editor-content :deep(.tiptap pre code) {
  color: inherit;
  background: none;
  padding: 0;
  font-size: inherit;
}

.editor-content :deep(.tiptap ul),
.editor-content :deep(.tiptap ol) {
  padding-left: 24px;
  margin-bottom: 12px;
}

.editor-content :deep(.tiptap ul) { list-style-type: disc; }
.editor-content :deep(.tiptap ol) { list-style-type: decimal; }

.editor-content :deep(.tiptap li) {
  margin-bottom: 4px;
}

.editor-content :deep(.tiptap img) {
  max-width: 100%;
  border-radius: 8px;
}

.editor-content :deep(.tiptap hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
}
</style>
