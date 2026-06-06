<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { authApi } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Send, Loader2, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-vue-next'

const route = useRoute()
const token = route.params.token as string

const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const loading = ref(false)
const validating = ref(true)
const tokenValid = ref(false)
const error = ref('')
const success = ref(false)

onMounted(async () => {
  try {
    tokenValid.value = await authApi.validateResetToken(token)
  } catch {
    tokenValid.value = false
  } finally {
    validating.value = false
  }
})

async function handleSubmit() {
  error.value = ''
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters'
    return
  }

  loading.value = true
  try {
    await authApi.resetPassword(token, password.value)
    success.value = true
  } catch (err: any) {
    error.value = err.message || 'Failed to reset password'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6 bg-background">
    <div class="w-full max-w-[400px]">
      <!-- Logo -->
      <div class="text-center mb-10">
        <div class="flex items-center justify-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
            <Send class="text-white" :size="20" />
          </div>
        </div>
        <h1 class="text-[26px] font-bold tracking-tight text-foreground mb-1">Set New Password</h1>
      </div>

      <div class="bg-card border border-border rounded-xl p-8">
        <!-- Loading validation -->
        <div v-if="validating" class="flex items-center justify-center py-8">
          <Loader2 :size="24" class="spin text-accent" />
        </div>

        <!-- Invalid token -->
        <div v-else-if="!tokenValid" class="text-center">
          <div class="w-12 h-12 rounded-full bg-danger/15 flex items-center justify-center mx-auto mb-4">
            <AlertCircle :size="24" class="text-danger" />
          </div>
          <p class="text-foreground text-sm mb-2">Invalid or expired reset link</p>
          <p class="text-muted-foreground text-xs mb-6">Please request a new password reset.</p>
          <router-link to="/forgot-password" class="text-accent text-sm font-medium hover:underline">
            Request new reset link
          </router-link>
        </div>

        <!-- Success -->
        <div v-else-if="success" class="text-center">
          <div class="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle :size="24" class="text-success" />
          </div>
          <p class="text-foreground text-sm mb-6">Your password has been reset successfully.</p>
          <router-link to="/login" class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent/90 transition-all">
            Sign In
          </router-link>
        </div>

        <!-- Form -->
        <form v-else @submit.prevent="handleSubmit" class="flex flex-col gap-5">
          <div v-if="error" class="flex items-start gap-2.5 py-3 px-3.5 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm" role="alert">
            <AlertCircle :size="16" class="shrink-0 mt-0.5" />
            <span>{{ error }}</span>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="new-password">New Password</Label>
            <div class="relative">
              <Input
                id="new-password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                class="pr-11"
                placeholder="••••••••"
                minlength="8"
                autocomplete="new-password"
                required
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md"
                @click="showPassword = !showPassword"
                tabindex="-1"
              >
                <EyeOff v-if="showPassword" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              v-model="confirmPassword"
              :type="showPassword ? 'text' : 'password'"
              placeholder="••••••••"
              minlength="8"
              autocomplete="new-password"
              required
            />
          </div>

          <Button
            type="submit"
            class="w-full h-11"
            :disabled="loading || !password || !confirmPassword"
          >
            <Loader2 v-if="loading" :size="18" class="spin" />
            <span v-else>Reset Password</span>
          </Button>
        </form>
      </div>
    </div>
  </div>
</template>
