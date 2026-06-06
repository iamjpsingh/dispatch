<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'
import { adminApi } from '../lib/api'
import { Send, Loader2, AlertCircle, CheckCircle, Users, Building2 } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { isAuthenticated, switchOrg } = useAuth()
const token = route.params.token as string

const loading = ref(true)
const accepting = ref(false)
const error = ref('')
const accepted = ref(false)
const invitation = ref<{ orgName: string; inviterName: string; role: string; email: string } | null>(null)

onMounted(async () => {
  try {
    const res = await adminApi.getInvitationByToken(token)
    invitation.value = res
  } catch (err: any) {
    error.value = err.message || 'Invalid or expired invitation'
  } finally {
    loading.value = false
  }
})

async function handleAccept() {
  if (!isAuthenticated.value) {
    // Redirect to login with return URL
    router.push({ path: '/login', query: { redirect: route.fullPath } })
    return
  }

  accepting.value = true
  error.value = ''

  try {
    const result = await adminApi.acceptInvitation(token)
    accepted.value = true
    // Switch to the new org
    if (result.orgId) {
      await switchOrg(result.orgId)
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to accept invitation'
  } finally {
    accepting.value = false
  }
}

function goToDashboard() {
  router.replace('/')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6 bg-background">
    <div class="w-full max-w-[440px]">
      <!-- Logo -->
      <div class="text-center mb-10">
        <div class="flex items-center justify-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
            <Send class="text-white" :size="20" />
          </div>
        </div>
        <h1 class="text-[26px] font-bold tracking-tight text-foreground mb-1">Team Invitation</h1>
      </div>

      <div class="bg-card border border-border rounded-xl p-8">
        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center py-8">
          <Loader2 :size="24" class="spin text-accent" />
        </div>

        <!-- Error (invalid token) -->
        <div v-else-if="error && !invitation" class="text-center">
          <div class="w-12 h-12 rounded-full bg-danger/15 flex items-center justify-center mx-auto mb-4">
            <AlertCircle :size="24" class="text-danger" />
          </div>
          <p class="text-foreground text-sm mb-6">{{ error }}</p>
          <router-link to="/login" class="text-accent text-sm font-medium hover:underline">
            Go to Sign In
          </router-link>
        </div>

        <!-- Accepted -->
        <div v-else-if="accepted" class="text-center">
          <div class="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle :size="24" class="text-success" />
          </div>
          <p class="text-foreground text-sm mb-2">You've joined <strong>{{ invitation?.orgName }}</strong></p>
          <p class="text-muted-foreground text-xs mb-6">Role: {{ invitation?.role }}</p>
          <button
            class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent/90 transition-all"
            @click="goToDashboard"
          >
            Go to Dashboard
          </button>
        </div>

        <!-- Invitation details -->
        <div v-else-if="invitation">
          <div class="flex flex-col items-center gap-4 mb-6">
            <div class="w-14 h-14 rounded-xl bg-accent/15 flex items-center justify-center">
              <Building2 :size="28" class="text-accent" />
            </div>
            <div class="text-center">
              <p class="text-muted-foreground text-sm">You've been invited to join</p>
              <h2 class="text-xl font-bold text-foreground mt-1">{{ invitation.orgName }}</h2>
              <div class="flex items-center justify-center gap-2 mt-2">
                <span class="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-accent/15 text-accent capitalize">{{ invitation.role }}</span>
                <span class="text-muted-foreground text-xs">by {{ invitation.inviterName }}</span>
              </div>
            </div>
          </div>

          <div v-if="error" class="flex items-start gap-2.5 py-3 px-3.5 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm mb-4" role="alert">
            <AlertCircle :size="16" class="shrink-0 mt-0.5" />
            <span>{{ error }}</span>
          </div>

          <div v-if="!isAuthenticated" class="bg-card rounded-lg p-4 mb-4">
            <p class="text-muted-foreground text-sm text-center">
              Please sign in with <strong>{{ invitation.email }}</strong> to accept this invitation.
            </p>
          </div>

          <button
            class="flex items-center justify-center gap-2 w-full h-11 bg-accent text-white text-sm font-semibold rounded-lg transition-all duration-150 hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="accepting"
            @click="handleAccept"
          >
            <Loader2 v-if="accepting" :size="18" class="spin" />
            <template v-else>
              <Users :size="16" />
              <span>{{ isAuthenticated ? 'Accept Invitation' : 'Sign In to Accept' }}</span>
            </template>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
