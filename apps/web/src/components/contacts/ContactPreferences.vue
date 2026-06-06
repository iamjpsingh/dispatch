<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { contactsApi } from '../../lib/api'
import { Mail, Pause, Bell, BellOff, Clock, Loader2, Check } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  contactId: string
}>()

const loading = ref(true)
const saving = ref(false)
const preference = ref('subscribed')
const canReceive = ref(true)
const pauseDays = ref(30)
const reason = ref('')
const savedMsg = ref('')

const options = [
  { value: 'subscribed', label: 'Subscribed', desc: 'Receives all emails', icon: Mail, color: 'text-green-400' },
  { value: 'campaign_only', label: 'Campaigns Only', desc: 'No digest or automated', icon: Bell, color: 'text-blue-400' },
  { value: 'digest_weekly', label: 'Weekly Digest', desc: 'Batched weekly summary', icon: Clock, color: 'text-violet-400' },
  { value: 'digest_monthly', label: 'Monthly Digest', desc: 'Batched monthly summary', icon: Clock, color: 'text-violet-400' },
  { value: 'paused', label: 'Paused', desc: 'Temporarily paused', icon: Pause, color: 'text-amber-400' },
  { value: 'unsubscribed', label: 'Unsubscribed', desc: 'No marketing emails', icon: BellOff, color: 'text-red-400' },
]

async function load() {
  loading.value = true
  try {
    const data = await contactsApi.getPreferences(props.contactId)
    preference.value = data.preference
    canReceive.value = data.canReceiveMarketing
  } catch { /* default values */ }
  finally { loading.value = false }
}

async function save(pref: string) {
  saving.value = true
  savedMsg.value = ''
  try {
    await contactsApi.setPreferences(props.contactId, pref, reason.value || undefined, pref === 'paused' ? pauseDays.value : undefined)
    preference.value = pref
    canReceive.value = !['unsubscribed', 'paused', 'digest_weekly', 'digest_monthly'].includes(pref)
    savedMsg.value = 'Saved'
    setTimeout(() => { savedMsg.value = '' }, 2000)
  } catch { /* ignore */ }
  finally { saving.value = false }
}

watch(() => props.contactId, load)
onMounted(load)
</script>

<template>
  <div>
    <div v-if="loading" class="flex justify-center py-4">
      <Loader2 :size="18" class="animate-spin text-muted-foreground" />
    </div>

    <div v-else class="space-y-2">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-muted-foreground">Email Preference</span>
        <span v-if="savedMsg" class="text-[10px] text-green-400 flex items-center gap-1"><Check :size="10" /> {{ savedMsg }}</span>
      </div>

      <button
        v-for="opt in options"
        :key="opt.value"
        @click="save(opt.value)"
        :disabled="saving"
        class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition text-left"
        :class="preference === opt.value
          ? 'border-accent/40 bg-accent/5'
          : 'border-border hover:border-text-muted bg-background'"
      >
        <component :is="opt.icon" :size="14" :class="preference === opt.value ? 'text-accent' : opt.color" />
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium" :class="preference === opt.value ? 'text-accent' : 'text-foreground'">{{ opt.label }}</div>
          <div class="text-[10px] text-muted-foreground">{{ opt.desc }}</div>
        </div>
        <div v-if="preference === opt.value" class="w-2 h-2 rounded-full bg-accent shrink-0"></div>
      </button>

      <div v-if="preference === 'paused'" class="pt-2">
        <label class="text-[10px] text-muted-foreground">Pause for (days):</label>
        <Input type="number" :model-value="pauseDays" @update:model-value="pauseDays = Number($event)" min="1" max="365" class="text-xs mt-1 w-24" />
      </div>
    </div>
  </div>
</template>
