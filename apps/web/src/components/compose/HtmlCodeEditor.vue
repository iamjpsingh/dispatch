<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import loader from '@monaco-editor/loader'
import { useTheme } from '../../composables/useTheme'

const props = defineProps<{ content: string }>()
const emit = defineEmits<{ (e: 'update:content', value: string): void }>()

const editorEl = ref<HTMLDivElement | null>(null)
const { theme, isDark } = useTheme()
let editorInstance: any = null
let monacoRef: any = null

function getMonacoTheme(): string {
  return isDark() ? 'vs-dark' : 'vs'
}

onMounted(async () => {
  if (!editorEl.value) return
  monacoRef = await loader.init()
  editorInstance = monacoRef.editor.create(editorEl.value, {
    value: props.content || '',
    language: 'html',
    automaticLayout: true,
    theme: getMonacoTheme(),
    minimap: { enabled: false },
    wordWrap: 'on',
    fontSize: 13,
    fontFamily: 'JetBrains Mono, Consolas, monospace',
    lineDecorationsWidth: 8,
    lineNumbersMinChars: 3,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
  })

  editorInstance.onDidChangeModelContent(() => {
    const val = editorInstance.getValue()
    emit('update:content', val)
  })
})

// React to theme changes — watch the reactive theme ref, not the isDark function
watch(theme, () => {
  if (monacoRef && editorInstance) {
    monacoRef.editor.setTheme(getMonacoTheme())
  }
})

watch(
  () => props.content,
  (val) => {
    if (editorInstance && val !== editorInstance.getValue()) {
      editorInstance.setValue(val || '')
    }
  }
)

onBeforeUnmount(() => {
  if (editorInstance) {
    editorInstance.dispose()
  }
  editorInstance = null
})
</script>

<template>
  <div class="code-editor" ref="editorEl"></div>
</template>

<style scoped>
.code-editor {
  height: 380px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-secondary);
}
</style>
