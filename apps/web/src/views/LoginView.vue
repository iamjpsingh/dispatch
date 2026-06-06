<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Send, Zap, BarChart3, Clock, Loader2, AlertCircle, Eye, EyeOff, ArrowRight } from 'lucide-vue-next'

const router = useRouter()
const { login, register, loading } = useAuth()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const name = ref('')
const error = ref('')
const showPassword = ref(false)
const shakeError = ref(false)

const isFormValid = computed(() => {
  if (!email.value.trim() || !password.value.trim()) return false
  if (mode.value === 'register' && !name.value.trim()) return false
  return true
})

async function handleSubmit() {
  error.value = ''
  shakeError.value = false

  try {
    let result
    if (mode.value === 'login') {
      result = await login(email.value, password.value)
    } else {
      result = await register(name.value, email.value, password.value)
    }

    if (result.success) {
      router.replace('/')
    } else {
      error.value = result.message || 'Authentication failed'
      triggerShake()
    }
  } catch (err) {
    error.value = 'Network error — make sure backend is running on port 3000'
    triggerShake()
    console.error('Auth error:', err)
  }
}

function triggerShake() {
  shakeError.value = true
  setTimeout(() => {
    shakeError.value = false
  }, 500)
}

function toggleMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = ''
  email.value = ''
  password.value = ''
  name.value = ''
  showPassword.value = false
}
</script>

<template>
  <div class="login-page min-h-screen flex items-center justify-center p-6 relative overflow-hidden bg-background">
    <!-- Subtle radial glow -->
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] pointer-events-none bg-[radial-gradient(circle,rgba(99,102,241,0.04)_0%,transparent_70%)]"></div>

    <div class="w-full max-w-[400px] relative z-1 animate-fade-in">
      <!-- Logo -->
      <div class="text-center mb-10">
        <div class="flex items-center justify-center gap-3 mb-4">
          <div
            class="w-10 h-10 rounded-xl bg-accent flex items-center justify-center"
          >
            <Send class="text-white" :size="20" />
          </div>
        </div>
        <h1 class="text-[26px] font-bold tracking-tight text-foreground mb-1">Dispatch</h1>
        <p class="text-muted-foreground text-sm">Bulk email campaigns, simplified</p>
      </div>

      <!-- Form card -->
      <div class="bg-card border border-border rounded-xl p-8">
        <div class="mb-6">
          <h2 class="text-lg font-semibold text-foreground mb-1">
            {{ mode === 'login' ? 'Welcome back' : 'Create account' }}
          </h2>
          <p class="text-muted-foreground text-sm">
            {{ mode === 'login' ? 'Sign in to your account' : 'Get started with Dispatch' }}
          </p>
        </div>

        <form @submit.prevent="handleSubmit" class="flex flex-col gap-5">
          <!-- Error message -->
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            leave-active-class="transition-all duration-200 ease-in"
            enter-from-class="opacity-0 -translate-y-2 scale-95"
            leave-to-class="opacity-0 scale-95"
          >
            <div
              v-if="error"
              class="flex items-start gap-2.5 py-3 px-3.5 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm"
              :class="{ 'animate-shake': shakeError }"
              role="alert"
            >
              <AlertCircle :size="16" class="shrink-0 mt-0.5" />
              <span>{{ error }}</span>
            </div>
          </Transition>

          <!-- Name field (register only) -->
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            leave-active-class="transition-all duration-200 ease-in"
            enter-from-class="opacity-0 -translate-y-3"
            leave-to-class="opacity-0 -translate-y-3"
          >
            <div v-if="mode === 'register'" class="flex flex-col gap-2">
              <Label for="name-input">Full Name</Label>
              <Input
                id="name-input"
                v-model="name"
                type="text"
                placeholder="John Doe"
                autocomplete="name"
                required
              />
            </div>
          </Transition>

          <!-- Email field -->
          <div class="flex flex-col gap-2">
            <Label for="email-input">Email Address</Label>
            <Input
              id="email-input"
              v-model="email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              required
            />
          </div>

          <!-- Password field -->
          <div class="flex flex-col gap-2">
            <Label for="password-input">Password</Label>
            <div class="relative">
              <Input
                id="password-input"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                class="pr-11"
                placeholder="••••••••"
                minlength="6"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                required
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors duration-150 rounded-md"
                @click="showPassword = !showPassword"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                tabindex="-1"
              >
                <EyeOff v-if="showPassword" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
          </div>

          <!-- Submit button -->
          <Button
            type="submit"
            class="w-full h-11 group active:scale-[0.98]"
            :disabled="loading || !isFormValid"
          >
            <Loader2 v-if="loading" :size="18" class="spin" />
            <template v-else>
              <span>{{ mode === 'login' ? 'Sign In' : 'Create Account' }}</span>
              <ArrowRight :size="16" class="transition-transform duration-200 group-hover:translate-x-0.5" />
            </template>
          </Button>
        </form>

        <!-- Forgot password link -->
        <div v-if="mode === 'login'" class="flex justify-end mt-2">
          <router-link
            to="/forgot-password"
            class="text-accent text-sm font-medium hover:underline"
          >
            Forgot password?
          </router-link>
        </div>

        <!-- Toggle mode -->
        <div class="flex items-center justify-center gap-1.5 mt-6 pt-6 border-t border-border">
          <span class="text-muted-foreground text-sm">
            {{ mode === 'login' ? "Don't have an account?" : 'Already have an account?' }}
          </span>
          <button
            class="text-accent text-sm font-medium hover:underline cursor-pointer bg-transparent border-none font-sans"
            @click="toggleMode"
          >
            {{ mode === 'login' ? 'Sign Up' : 'Sign In' }}
          </button>
        </div>
      </div>

      <!-- Features -->
      <div class="flex justify-center gap-6 mt-8 max-[480px]:flex-col max-[480px]:items-center max-[480px]:gap-2.5">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Zap :size="14" class="text-muted-foreground opacity-60" />
          <span>Batch Processing</span>
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BarChart3 :size="14" class="text-muted-foreground opacity-60" />
          <span>Real-time Tracking</span>
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock :size="14" class="text-muted-foreground opacity-60" />
          <span>Scheduled Sends</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Multi-step shake animation — can't be expressed as Tailwind utility */
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
.animate-shake { animation: shake 0.4s ease-in-out; }
</style>
