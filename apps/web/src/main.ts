import { createApp } from 'vue'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'
import router from './router'
import App from './App.vue'
import './styles/tailwind.css'   // Design system (single source of truth)

// Create query client with better error handling
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: false, // Don't retry failed requests
      refetchOnWindowFocus: false,
      throwOnError: false // Don't throw errors, handle them gracefully
    }
  }
})

const app = createApp(App)
app.use(VueQueryPlugin, { queryClient })
app.use(router)
app.mount('#app')
