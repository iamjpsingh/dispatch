<script setup lang="ts">
import { useOnboarding } from '../../composables/useOnboarding'
import { useRouter } from 'vue-router'
import ProgressBar from './ProgressBar.vue'
import { Check, ChevronRight, X, Rocket, Settings, Globe, Users, FileText, Send } from 'lucide-vue-next'

const router = useRouter()
const { steps, progress, isComplete, dismiss } = useOnboarding()

const stepIcons: Record<string, any> = {
  'delivery-server': Settings,
  'domain': Globe,
  'contacts': Users,
  'template': FileText,
  'campaign': Send,
}

function goToStep(path: string) {
  router.push(path)
}
</script>

<template>
  <div class="bg-card border border-border rounded-xl p-5 mb-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2.5">
        <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10">
          <Rocket :size="16" class="text-accent" />
        </div>
        <div>
          <h3 class="text-sm font-semibold text-foreground">Get started with Dispatch</h3>
          <p class="text-xs text-muted-foreground">Complete these steps to set up your account</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs font-medium text-muted-foreground">{{ progress }}%</span>
        <button
          class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
          @click="dismiss"
          aria-label="Dismiss checklist"
        >
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- Progress bar -->
    <ProgressBar :value="progress" variant="accent" size="sm" class="mb-4" />

    <!-- Steps -->
    <div class="space-y-1">
      <button
        v-for="step in steps"
        :key="step.id"
        class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer"
        :class="step.completed ? 'bg-success/5' : 'hover:bg-secondary'"
        @click="goToStep(step.path)"
      >
        <!-- Check circle -->
        <div
          class="flex items-center justify-center shrink-0 w-6 h-6 rounded-full border-2 transition-colors"
          :class="step.completed
            ? 'bg-success border-success'
            : 'border-border'"
        >
          <Check v-if="step.completed" :size="12" class="text-white" />
        </div>

        <!-- Icon -->
        <div class="flex items-center justify-center shrink-0 w-8 h-8 rounded-md bg-secondary">
          <component :is="stepIcons[step.id]" :size="14" class="text-muted-foreground" />
        </div>

        <!-- Text -->
        <div class="flex-1 min-w-0">
          <div
            class="text-sm font-medium"
            :class="step.completed ? 'text-muted-foreground line-through' : 'text-foreground'"
          >
            {{ step.title }}
          </div>
          <div class="text-xs text-muted-foreground truncate">{{ step.description }}</div>
        </div>

        <!-- Arrow -->
        <ChevronRight :size="14" class="text-muted-foreground shrink-0" />
      </button>
    </div>

    <!-- Completion message -->
    <div v-if="isComplete" class="mt-4 pt-3 border-t border-border text-center">
      <p class="text-sm text-success font-medium">All set! You're ready to send campaigns.</p>
      <button
        class="mt-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        @click="dismiss"
      >
        Dismiss this checklist
      </button>
    </div>
  </div>
</template>
