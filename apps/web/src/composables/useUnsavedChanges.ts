import { watch, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

export function useUnsavedChanges(isDirty: Ref<boolean> | ComputedRef<boolean>) {
  function beforeUnloadHandler(e: BeforeUnloadEvent) {
    if (isDirty.value) {
      e.preventDefault()
      // Modern browsers show a generic message regardless of returnValue
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
    }
  }

  onMounted(() => {
    window.addEventListener('beforeunload', beforeUnloadHandler)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', beforeUnloadHandler)
  })

  // Vue Router navigation guard
  onBeforeRouteLeave(() => {
    if (isDirty.value) {
      return window.confirm('You have unsaved changes. Are you sure you want to leave?')
    }
    return true
  })

  return {
    confirmLeave: () => {
      if (!isDirty.value) return true
      return window.confirm('You have unsaved changes. Are you sure you want to leave?')
    },
  }
}
