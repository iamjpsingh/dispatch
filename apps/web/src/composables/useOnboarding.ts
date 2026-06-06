import { ref, computed, onMounted } from 'vue'

export interface OnboardingStep {
  id: string
  title: string
  description: string
  path: string
  completed: boolean
}

const STORAGE_KEY = 'dispatch-onboarding'

function loadState(): { completed: string[]; dismissed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { completed: [], dismissed: false }
}

function saveState(completed: string[], dismissed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed, dismissed }))
  } catch { /* ignore */ }
}

export function useOnboarding() {
  const completedIds = ref<string[]>([])
  const isDismissed = ref(false)

  const defaultSteps: Omit<OnboardingStep, 'completed'>[] = [
    { id: 'delivery-server', title: 'Configure email provider', description: 'Set up SMTP or connect Gmail/Outlook via OAuth', path: '/settings' },
    { id: 'domain', title: 'Verify sending domain', description: 'Add SPF, DKIM, and DMARC records for better deliverability', path: '/settings/domains' },
    { id: 'contacts', title: 'Import your first contacts', description: 'Upload a CSV or add contacts manually', path: '/contacts' },
    { id: 'template', title: 'Create your first template', description: 'Design a reusable email template', path: '/templates' },
    { id: 'campaign', title: 'Send your first campaign', description: 'Compose and send an email to your contacts', path: '/compose' },
  ]

  const steps = computed<OnboardingStep[]>(() =>
    defaultSteps.map(s => ({
      ...s,
      completed: completedIds.value.includes(s.id),
    }))
  )

  const progress = computed(() => {
    const done = steps.value.filter(s => s.completed).length
    return Math.round((done / steps.value.length) * 100)
  })

  const isComplete = computed(() => progress.value === 100)

  function completeStep(id: string) {
    if (!completedIds.value.includes(id)) {
      completedIds.value.push(id)
      saveState(completedIds.value, isDismissed.value)
    }
  }

  function dismiss() {
    isDismissed.value = true
    saveState(completedIds.value, true)
  }

  onMounted(() => {
    const state = loadState()
    completedIds.value = state.completed
    isDismissed.value = state.dismissed
  })

  return { steps, progress, isComplete, isDismissed, completeStep, dismiss }
}
