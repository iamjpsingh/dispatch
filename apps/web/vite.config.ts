/**
 * Vite Configuration
 *
 * All API routes are prefixed with /api on the backend.
 * A single proxy rule forwards /api/* to the backend server.
 * This cleanly separates frontend SPA routes from backend API routes,
 * eliminating proxy/navigation conflicts (back button, direct URL, etc.)
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const API_URL = process.env.VITE_API_URL || 'http://localhost:5500'

export default defineConfig({
  plugins: [vue(), tailwindcss()],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      // Single rule: all API requests go to the backend
      '/api': { target: API_URL, changeOrigin: true },
      // Health check (no /api prefix)
      '/health': { target: API_URL, changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
