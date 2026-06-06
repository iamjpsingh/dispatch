<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import grapesjs, { type Editor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import { Code2, Smartphone, Monitor, Tablet, Save, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  content?: string
  mjmlSource?: string
}>()

const emit = defineEmits<{
  save: [html: string, mjml: string]
  change: [html: string]
}>()

const editorRef = ref<HTMLDivElement>()
const editor = ref<Editor | null>(null)
const viewMode = ref<'editor' | 'code' | 'preview'>('editor')
const previewDevice = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const codeContent = ref('')
const saving = ref(false)

function initEditor() {
  if (!editorRef.value || editor.value) return

  const e = grapesjs.init({
    container: editorRef.value,
    height: '100%',
    width: 'auto',
    fromElement: false,
    storageManager: false,
    noticeOnUnload: false,
    canvas: {
      styles: [
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
      ],
    },
    panels: { defaults: [] }, // We use our own toolbar
    blockManager: {
      blocks: [
        {
          id: 'section',
          label: 'Section',
          category: 'Layout',
          content: '<section style="padding: 40px 20px; max-width: 600px; margin: 0 auto;"><p>Section content</p></section>',
        },
        {
          id: 'columns-2',
          label: '2 Columns',
          category: 'Layout',
          content: '<div style="display:flex;gap:20px;padding:20px"><div style="flex:1"><p>Column 1</p></div><div style="flex:1"><p>Column 2</p></div></div>',
        },
        {
          id: 'columns-3',
          label: '3 Columns',
          category: 'Layout',
          content: '<div style="display:flex;gap:16px;padding:20px"><div style="flex:1"><p>Col 1</p></div><div style="flex:1"><p>Col 2</p></div><div style="flex:1"><p>Col 3</p></div></div>',
        },
        {
          id: 'heading',
          label: 'Heading',
          category: 'Basic',
          content: '<h1 style="font-family:Inter,sans-serif;font-size:28px;color:#1a1a1a;margin:0 0 16px">Heading Text</h1>',
        },
        {
          id: 'text',
          label: 'Text Block',
          category: 'Basic',
          content: '<p style="font-family:Inter,sans-serif;font-size:16px;color:#555;line-height:1.6;margin:0 0 16px">Your text content here. Use placeholders like {{FirstName}} for personalization.</p>',
        },
        {
          id: 'image',
          label: 'Image',
          category: 'Basic',
          content: '<img src="https://placehold.co/600x200/f0f0f0/999?text=Your+Image" style="max-width:100%;height:auto;border-radius:8px" />',
        },
        {
          id: 'button',
          label: 'Button',
          category: 'Basic',
          content: '<div style="text-align:center;padding:20px 0"><a href="#" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-family:Inter,sans-serif;font-weight:600;font-size:16px">Click Here</a></div>',
        },
        {
          id: 'divider',
          label: 'Divider',
          category: 'Basic',
          content: '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />',
        },
        {
          id: 'spacer',
          label: 'Spacer',
          category: 'Basic',
          content: '<div style="height:32px"></div>',
        },
        {
          id: 'header',
          label: 'Email Header',
          category: 'Email',
          content: `<div style="background:#f8fafc;padding:24px;text-align:center;border-bottom:1px solid #e5e7eb">
            <img src="https://placehold.co/150x40/6366f1/fff?text=Logo" style="height:40px" />
          </div>`,
        },
        {
          id: 'hero',
          label: 'Hero Section',
          category: 'Email',
          content: `<div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:60px 30px;text-align:center;border-radius:0">
            <h1 style="font-family:Inter,sans-serif;font-size:32px;margin:0 0 16px;color:#fff">Welcome, {{FirstName}}!</h1>
            <p style="font-family:Inter,sans-serif;font-size:18px;opacity:0.9;margin:0 0 24px;color:#fff">We're excited to have you on board.</p>
            <a href="#" style="display:inline-block;background:#fff;color:#6366f1;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">Get Started</a>
          </div>`,
        },
        {
          id: 'social',
          label: 'Social Links',
          category: 'Email',
          content: `<div style="text-align:center;padding:20px">
            <a href="#" style="display:inline-block;margin:0 8px;color:#64748b;text-decoration:none;font-size:14px">Twitter</a>
            <a href="#" style="display:inline-block;margin:0 8px;color:#64748b;text-decoration:none;font-size:14px">LinkedIn</a>
            <a href="#" style="display:inline-block;margin:0 8px;color:#64748b;text-decoration:none;font-size:14px">Facebook</a>
          </div>`,
        },
        {
          id: 'footer',
          label: 'Email Footer',
          category: 'Email',
          content: `<div style="background:#f8fafc;padding:30px;text-align:center;border-top:1px solid #e5e7eb">
            <p style="font-family:Inter,sans-serif;font-size:13px;color:#94a3b8;margin:0 0 8px">{{Company}} - 123 Street, City, Country</p>
            <p style="font-family:Inter,sans-serif;font-size:13px;color:#94a3b8;margin:0">
              <a href="{{UnsubscribeLink}}" style="color:#6366f1;text-decoration:underline">Unsubscribe</a> | <a href="#" style="color:#6366f1;text-decoration:underline">View in browser</a>
            </p>
          </div>`,
        },
      ],
    },
    styleManager: {
      sectors: [
        {
          name: 'Dimension',
          open: false,
          properties: ['width', 'max-width', 'height', 'padding', 'margin'],
        },
        {
          name: 'Typography',
          open: false,
          properties: ['font-family', 'font-size', 'font-weight', 'color', 'text-align', 'line-height'],
        },
        {
          name: 'Background',
          open: false,
          properties: ['background-color', 'background-image'],
        },
        {
          name: 'Border',
          open: false,
          properties: ['border-radius', 'border'],
        },
      ],
    },
  })

  // Load initial content
  if (props.content) {
    e.setComponents(props.content)
  }

  // Track changes
  e.on('component:update', () => {
    emit('change', e.getHtml())
  })
  e.on('component:add', () => {
    emit('change', e.getHtml())
  })

  editor.value = e
}

function handleSave() {
  if (!editor.value) return
  saving.value = true
  const html = editor.value.getHtml()
  const css = editor.value.getCss() || ''
  const fullHtml = `<style>${css}</style>${html}`
  emit('save', fullHtml, '')
  setTimeout(() => { saving.value = false }, 300)
}

function switchToCode() {
  if (!editor.value) return
  const html = editor.value.getHtml()
  const css = editor.value.getCss() || ''
  codeContent.value = css ? `<style>\n${css}\n</style>\n\n${html}` : html
  viewMode.value = 'code'
}

function switchToEditor() {
  if (viewMode.value === 'code' && editor.value) {
    // Parse out style tags and apply back
    const styleMatch = codeContent.value.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
    const css = styleMatch ? styleMatch[1] : ''
    const html = codeContent.value.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim()
    editor.value.setComponents(html)
    if (css) editor.value.setStyle(css)
  }
  viewMode.value = 'editor'
}

function setDevice(device: string) {
  if (!editor.value) return
  previewDevice.value = device as any
  const canvas = editor.value.Canvas
  switch (device) {
    case 'mobile': canvas.getFrameEl()?.style.setProperty('width', '375px'); break
    case 'tablet': canvas.getFrameEl()?.style.setProperty('width', '768px'); break
    default: canvas.getFrameEl()?.style.setProperty('width', '100%'); break
  }
}

onMounted(() => {
  nextTick(initEditor)
})

onBeforeUnmount(() => {
  editor.value?.destroy()
  editor.value = null
})

defineExpose({
  getHtml: () => {
    if (!editor.value) return props.content || ''
    const html = editor.value.getHtml()
    const css = editor.value.getCss() || ''
    return css ? `<style>${css}</style>${html}` : html
  },
})
</script>

<template>
  <div class="flex flex-col h-full bg-background rounded-xl border border-border overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary shrink-0">
      <div class="flex items-center gap-1">
        <button
          :class="['px-2.5 py-1.5 rounded text-xs font-medium transition', viewMode === 'editor' ? 'bg-accent text-white' : 'text-muted-foreground hover:text-muted-foreground']"
          @click="switchToEditor"
        >Visual</button>
        <button
          :class="['px-2.5 py-1.5 rounded text-xs font-medium transition', viewMode === 'code' ? 'bg-accent text-white' : 'text-muted-foreground hover:text-muted-foreground']"
          @click="switchToCode"
        >
          <Code2 :size="12" class="inline mr-1" />Code
        </button>
      </div>

      <div class="flex items-center gap-1">
        <button
          :class="['p-1.5 rounded transition', previewDevice === 'desktop' ? 'text-accent bg-accent/10' : 'text-muted-foreground hover:text-muted-foreground']"
          @click="setDevice('desktop')" title="Desktop"
        ><Monitor :size="14" /></button>
        <button
          :class="['p-1.5 rounded transition', previewDevice === 'tablet' ? 'text-accent bg-accent/10' : 'text-muted-foreground hover:text-muted-foreground']"
          @click="setDevice('tablet')" title="Tablet"
        ><Tablet :size="14" /></button>
        <button
          :class="['p-1.5 rounded transition', previewDevice === 'mobile' ? 'text-accent bg-accent/10' : 'text-muted-foreground hover:text-muted-foreground']"
          @click="setDevice('mobile')" title="Mobile"
        ><Smartphone :size="14" /></button>
      </div>

      <button
        @click="handleSave"
        :disabled="saving"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-xs font-medium hover:bg-accent/90 transition disabled:opacity-50"
      >
        <Loader2 v-if="saving" :size="12" class="animate-spin" />
        <Save v-else :size="12" />
        Save
      </button>
    </div>

    <!-- Editor / Code View -->
    <div class="flex-1 min-h-0 relative">
      <!-- GrapesJS Editor -->
      <div v-show="viewMode === 'editor'" ref="editorRef" class="w-full h-full" />

      <!-- Code Editor -->
      <div v-if="viewMode === 'code'" class="w-full h-full">
        <textarea
          v-model="codeContent"
          class="w-full h-full bg-background text-foreground font-mono text-sm p-4 border-none outline-none resize-none"
          spellcheck="false"
        />
      </div>
    </div>
  </div>
</template>

<style>
/* GrapesJS theme overrides for dark mode */
.gjs-one-bg { background-color: var(--color-secondary) !important; }
.gjs-two-color { color: var(--color-foreground) !important; }
.gjs-three-bg { background-color: var(--color-card) !important; }
.gjs-four-color, .gjs-four-color-h:hover { color: var(--color-accent) !important; }

.gjs-block { color: var(--color-muted-foreground); border: 1px solid var(--color-border); border-radius: 6px; }
.gjs-block:hover { border-color: var(--color-accent); }
.gjs-block__media { color: var(--color-muted-foreground); }

.gjs-pn-panel { background: var(--color-secondary); border-color: var(--color-border); }
.gjs-pn-views-container { background: var(--color-secondary); border-left: 1px solid var(--color-border); }
.gjs-pn-views { border-bottom: 1px solid var(--color-border); }

.gjs-clm-tags .gjs-sm-sector .gjs-sm-sector-title { background: var(--color-card); color: var(--color-muted-foreground); }
.gjs-sm-sector-title { background: var(--color-card) !important; color: var(--color-muted-foreground) !important; }

.gjs-field { background: var(--color-background); border-color: var(--color-border); color: var(--color-foreground); }
.gjs-field input, .gjs-field select, .gjs-field textarea { color: var(--color-foreground); }

.gjs-cv-canvas { background: var(--color-background); }
.gjs-frame-wrapper { background: white; } /* Keep email canvas white */
</style>
