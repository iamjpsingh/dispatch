<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../../lib/api/admin'
import type { Organization } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Skeleton from '../../components/ui/Skeleton.vue'
import { Building2, Loader2, Check, X } from 'lucide-vue-next'

const toast = useToast()
const loading = ref(true)
const org = ref<Organization | null>(null)
const orgForm = ref({ name: '' })
const savingOrg = ref(false)

// Slug
const slugInput = ref('')
const slugChecking = ref(false)
const slugAvailable = ref<boolean | null>(null)
const slugSuggestions = ref<string[]>([])
const savingSlug = ref(false)
let slugTimeout: ReturnType<typeof setTimeout>

function formatDate(d: string): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function loadOrg() {
  try {
    org.value = await adminApi.getOrg()
    orgForm.value.name = org.value.name
    slugInput.value = org.value.slug
  } catch (e: any) {
    toast.error(e.message || 'Failed to load organization')
  } finally { loading.value = false }
}

async function saveOrg() {
  savingOrg.value = true
  try {
    await adminApi.updateOrg({ name: orgForm.value.name })
    toast.success('Organization updated')
    await loadOrg()
  } catch (e: any) { toast.error(e.message) }
  finally { savingOrg.value = false }
}

function onSlugInput() {
  slugAvailable.value = null
  slugSuggestions.value = []
  clearTimeout(slugTimeout)
  if (!slugInput.value || slugInput.value === org.value?.slug) return
  slugChecking.value = true
  slugTimeout = setTimeout(async () => {
    try {
      const result = await adminApi.checkSlug(slugInput.value)
      slugAvailable.value = result.available
      slugSuggestions.value = result.suggestions || []
    } catch { slugAvailable.value = null }
    finally { slugChecking.value = false }
  }, 500)
}

async function saveSlug() {
  if (!slugInput.value || slugInput.value === org.value?.slug) return
  savingSlug.value = true
  try {
    await adminApi.updateSlug(slugInput.value)
    toast.success('Slug updated')
    await loadOrg()
    slugAvailable.value = null
  } catch (e: any) { toast.error(e.message) }
  finally { savingSlug.value = false }
}

function useSuggestion(s: string) {
  slugInput.value = s
  slugAvailable.value = true
  slugSuggestions.value = []
}

onMounted(loadOrg)
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-4"><Skeleton variant="card" :count="1" /></div>

    <div v-else class="space-y-6 max-w-xl">
      <!-- Org Info -->
      <div class="bg-card border border-border rounded-xl p-6">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Building2 :size="20" class="text-accent" />
          </div>
          <div>
            <h3 class="text-[15px] font-semibold text-foreground">Organization Settings</h3>
            <p class="text-sm text-muted-foreground">@{{ org?.slug }}</p>
          </div>
        </div>

        <form @submit.prevent="saveOrg">
          <div class="mb-5">
            <Label>Organization Name</Label>
            <Input v-model="orgForm.name" type="text" required />
          </div>

          <div class="flex items-center gap-3 p-3 bg-muted rounded-lg text-sm text-muted-foreground mb-4">
            <span>Status: <strong class="text-foreground">{{ org?.status || 'active' }}</strong></span>
            <span class="mx-2 text-border">|</span>
            <span>Created: <strong class="text-foreground">{{ org ? formatDate(org.created_at) : '-' }}</strong></span>
          </div>

          <Button type="submit" :disabled="savingOrg" :loading="savingOrg">
            Save Changes
          </Button>
        </form>
      </div>

      <!-- Slug / Username -->
      <div class="bg-card border border-border rounded-xl p-6">
        <h3 class="text-sm font-semibold text-foreground mb-1">Organization Slug</h3>
        <p class="text-xs text-muted-foreground mb-4">Unique identifier for your organization. Used in URLs and API calls.</p>

        <div class="mb-3">
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted-foreground">@</span>
            <Input
              v-model="slugInput"
              type="text"
              class="flex-1"
              placeholder="my-company"
              @input="onSlugInput"
            />
            <div class="w-6 shrink-0 flex items-center justify-center">
              <Loader2 v-if="slugChecking" :size="14" class="animate-spin text-muted-foreground" />
              <Check v-else-if="slugAvailable === true" :size="14" class="text-green-400" />
              <X v-else-if="slugAvailable === false" :size="14" class="text-red-400" />
            </div>
          </div>
        </div>

        <div v-if="slugAvailable === false && slugSuggestions.length > 0" class="mb-3">
          <p class="text-xs text-muted-foreground mb-1">Slug taken. Try:</p>
          <div class="flex gap-1.5 flex-wrap">
            <button
              v-for="s in slugSuggestions" :key="s"
              class="text-xs px-2 py-1 bg-background border border-border rounded hover:border-accent hover:text-accent transition"
              @click="useSuggestion(s)"
            >@{{ s }}</button>
          </div>
        </div>

        <Button
          size="sm"
          :disabled="!slugInput || slugInput === org?.slug || slugAvailable !== true || savingSlug"
          :loading="savingSlug"
          @click="saveSlug"
        >
          Update Slug
        </Button>
      </div>
    </div>
  </div>
</template>
