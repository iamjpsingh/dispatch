<script setup lang="ts">
import { ref } from 'vue'
import { authApi } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Send, Loader2, AlertCircle, CheckCircle, ArrowLeft, Mail } from 'lucide-vue-next'

const email = ref('')
const loading = ref(false)
const error = ref('')
const success = ref('')

async function handleSubmit() {
  error.value = ''
  success.value = ''
  loading.value = true

  try {
    const msg = await authApi.forgotPassword(email.value)
    success.value = msg
  } catch (err: any) {
    error.value = err.message || 'Failed to send reset email'
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
        <h1 class="text-[26px] font-bold tracking-tight text-foreground mb-1">Reset Password</h1>
        <p class="text-muted-foreground text-sm">Enter your email to receive a reset link</p>
      </div>

      <div class="bg-card border border-border rounded-xl p-8">
        <!-- Success state -->
        <div v-if="success" class="text-center">
          <div class="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle :size="24" class="text-success" />
          </div>
          <p class="text-foreground text-sm mb-6">{{ success }}</p>
          <router-link to="/login" class="text-accent text-sm font-medium hover:underline">
            Back to Sign In
          </router-link>
        </div>

        <!-- Form -->
        <form v-else @submit.prevent="handleSubmit" class="flex flex-col gap-5">
          <div v-if="error" class="flex items-start gap-2.5 py-3 px-3.5 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm" role="alert">
            <AlertCircle :size="16" class="shrink-0 mt-0.5" />
            <span>{{ error }}</span>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="reset-email">Email Address</Label>
            <Input
              id="reset-email"
              v-model="email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              required
            />
          </div>

          <Button
            type="submit"
            class="w-full h-11"
            :disabled="loading || !email.trim()"
          >
            <Loader2 v-if="loading" :size="18" class="spin" />
            <template v-else>
              <Mail :size="16" />
              <span>Send Reset Link</span>
            </template>
          </Button>
        </form>

        <div class="flex items-center justify-center gap-1.5 mt-6 pt-6 border-t border-border">
          <router-link to="/login" class="flex items-center gap-1 text-accent text-sm font-medium hover:underline">
            <ArrowLeft :size="14" />
            Back to Sign In
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
