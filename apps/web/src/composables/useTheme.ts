import { ref, watch, onMounted } from 'vue'

type Theme = 'light' | 'dark' | 'system'

const theme = ref<Theme>('dark')

function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  } else {
    root.classList.toggle('dark', t === 'dark')
  }
}

export function useTheme() {
  onMounted(() => {
    const saved = localStorage.getItem('dispatch-theme') as Theme | null
    if (saved) {
      theme.value = saved
      applyTheme(saved)
    }
  })

  watch(theme, (t) => {
    localStorage.setItem('dispatch-theme', t)
    applyTheme(t)
  })

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function setTheme(t: Theme) {
    theme.value = t
  }

  return {
    theme,
    toggleTheme,
    setTheme,
    isDark: () => theme.value === 'dark' || (theme.value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  }
}
