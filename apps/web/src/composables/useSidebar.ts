import { ref, watch } from 'vue'

const STORAGE_KEY = 'dispatch-sidebar-collapsed'

const collapsed = ref(
  typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY) === 'true'
    : false
)

const mobileOpen = ref(false)

watch(collapsed, (val) => {
  try { localStorage.setItem(STORAGE_KEY, String(val)) } catch {}
})

export function useSidebar() {
  function toggle() {
    collapsed.value = !collapsed.value
  }

  function openMobile() {
    mobileOpen.value = true
  }

  function closeMobile() {
    mobileOpen.value = false
  }

  function toggleMobile() {
    mobileOpen.value = !mobileOpen.value
  }

  return { collapsed, mobileOpen, toggle, openMobile, closeMobile, toggleMobile }
}
