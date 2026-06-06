<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useAuth } from './stores/auth'
import ToastContainer from './components/ui/ToastContainer.vue'

const { initializeAuth } = useAuth()

onMounted(async () => {
  await initializeAuth()
})
</script>

<template>
  <div id="app">
    <RouterView />
    <ToastContainer />
  </div>
</template>

<style>
#app {
  min-height: 100vh;
}
</style>
