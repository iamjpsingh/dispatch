<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { pagesApi, formsApi, type LandingPage, type FormEndpoint } from '../lib/api'
import { useToast } from '../composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import StatCard from '../components/ui/StatCard.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import {
  ArrowLeft, Globe, GlobeLock, Eye,
  Trash2, Copy, Loader2, MousePointer, Users, Save,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const pageId = route.params.id as string

const page = ref<LandingPage | null>(null)
const forms = ref<FormEndpoint[]>([])
const loading = ref(true)
const saving = ref(false)
const activeTab = ref('overview')
const copied = ref(false)

// Editable form state
const editForm = ref({
  title: '',
  slug: '',
  html_content: '',
  css_content: '',
  meta_description: '',
  meta_image: '',
  form_id: '',
  tracking_enabled: true,
})

async function loadPage() {
  loading.value = true
  try {
    const [p, f] = await Promise.all([
      pagesApi.get(pageId),
      formsApi.list().catch(() => []),
    ])
    page.value = p
    forms.value = f
    editForm.value = {
      title: p.title,
      slug: p.slug,
      html_content: p.html_content,
      css_content: p.css_content,
      meta_description: p.meta_description || '',
      meta_image: p.meta_image || '',
      form_id: p.form_id || '',
      tracking_enabled: !!p.tracking_enabled,
    }
  } catch (e: any) {
    toast.error(e.message || 'Page not found')
    router.replace('/pages')
  } finally {
    loading.value = false
  }
}

async function savePage() {
  saving.value = true
  try {
    await pagesApi.update(pageId, editForm.value)
    toast.success('Page saved')
    await loadPage()
  } catch (e: any) { toast.error(e.message) }
  finally { saving.value = false }
}

async function publishPage() {
  try {
    await pagesApi.publish(pageId)
    toast.success('Page published')
    await loadPage()
  } catch (e: any) { toast.error(e.message) }
}

async function unpublishPage() {
  try {
    await pagesApi.unpublish(pageId)
    toast.success('Page unpublished')
    await loadPage()
  } catch (e: any) { toast.error(e.message) }
}

async function deletePage() {
  if (!confirm('Delete this page? This cannot be undone.')) return
  try {
    await pagesApi.delete(pageId)
    toast.success('Page deleted')
    router.replace('/pages')
  } catch (e: any) { toast.error(e.message) }
}

function copyUrl() {
  const url = `${window.location.origin}/p/${page.value?.slug}`
  navigator.clipboard.writeText(url)
  copied.value = true
  toast.success('URL copied')
  setTimeout(() => { copied.value = false }, 2000)
}

function openPreview() {
  window.open(pagesApi.getPreviewUrl(pageId), '_blank')
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

onMounted(loadPage)
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <Skeleton variant="text" width="200px" />
      <div class="grid grid-cols-3 gap-4"><Skeleton variant="stat-card" :count="3" /></div>
    </div>

    <template v-else-if="page">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-start gap-3">
          <Button variant="ghost" size="sm" class="mt-0.5" @click="router.push('/pages')">
            <ArrowLeft :size="16" />
          </Button>
          <div>
            <div class="flex items-center gap-2.5">
              <h1 class="text-xl font-bold text-foreground">{{ page.title }}</h1>
              <Badge :variant="page.published ? 'default' : 'secondary'">
                {{ page.published ? 'Published' : 'Draft' }}
              </Badge>
            </div>
            <div class="flex items-center gap-3 mt-1">
              <span class="text-sm text-muted-foreground font-mono">/p/{{ page.slug }}</span>
              <button v-if="page.published" class="text-xs text-accent hover:underline cursor-pointer bg-transparent border-none" @click="copyUrl">
                <Copy :size="11" class="inline" /> Copy URL
              </button>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" @click="openPreview">
            <Eye :size="14" /> Preview
          </Button>
          <Button v-if="!page.published" size="sm" @click="publishPage">
            <Globe :size="14" /> Publish
          </Button>
          <Button v-else variant="secondary" size="sm" @click="unpublishPage">
            <GlobeLock :size="14" /> Unpublish
          </Button>
          <Button variant="ghost" size="sm" class="text-danger" @click="deletePage">
            <Trash2 :size="14" />
          </Button>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-3 max-md:grid-cols-1 gap-4">
        <StatCard :icon="Eye" :value="page.visit_count" label="Total Views" />
        <StatCard :icon="MousePointer" :value="page.published ? 'Live' : 'Draft'" label="Status" :color="page.published ? 'success' : 'warning'" />
        <StatCard :icon="Users" :value="page.form_id ? 'Connected' : 'None'" label="Form" :color="page.form_id ? 'accent' : 'default'" />
      </div>

      <!-- Tabs -->
      <Tabs :default-value="activeTab" @update:model-value="activeTab = $event as string">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <!-- Overview -->
        <TabsContent value="overview" class="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle class="text-sm">Page Details</CardTitle></CardHeader>
            <CardContent class="space-y-3 text-sm">
              <div class="flex justify-between"><span class="text-muted-foreground">URL</span><span class="text-foreground font-mono text-xs">/p/{{ page.slug }}</span></div>
              <div class="flex justify-between"><span class="text-muted-foreground">Template</span><span class="text-foreground">{{ page.template || 'Custom' }}</span></div>
              <div class="flex justify-between"><span class="text-muted-foreground">Tracking</span><span class="text-foreground">{{ page.tracking_enabled ? 'Enabled' : 'Disabled' }}</span></div>
              <div class="flex justify-between"><span class="text-muted-foreground">Created</span><span class="text-foreground">{{ formatDate(page.created_at) }}</span></div>
              <div class="flex justify-between"><span class="text-muted-foreground">Updated</span><span class="text-foreground">{{ formatDate(page.updated_at) }}</span></div>
            </CardContent>
          </Card>

          <Card v-if="page.meta_description">
            <CardHeader><CardTitle class="text-sm">SEO</CardTitle></CardHeader>
            <CardContent class="text-sm text-muted-foreground">{{ page.meta_description }}</CardContent>
          </Card>
        </TabsContent>

        <!-- Editor -->
        <TabsContent value="editor" class="mt-4">
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between">
                <CardTitle class="text-sm">HTML Content</CardTitle>
                <Button size="sm" :disabled="saving" @click="savePage">
                  <Loader2 v-if="saving" :size="14" class="animate-spin" />
                  <Save v-else :size="14" />
                  Save
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <textarea
                v-model="editForm.html_content"
                class="w-full h-[400px] bg-muted border border-border rounded-lg font-mono text-sm p-4 text-foreground resize-y outline-none focus:border-accent"
                spellcheck="false"
              />
              <div class="mt-3">
                <Label class="mb-2 block text-xs text-muted-foreground">CSS (optional)</Label>
                <textarea
                  v-model="editForm.css_content"
                  class="w-full h-[150px] bg-muted border border-border rounded-lg font-mono text-sm p-4 text-foreground resize-y outline-none focus:border-accent"
                  spellcheck="false"
                  placeholder="body { font-family: sans-serif; }"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Settings -->
        <TabsContent value="settings" class="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle class="text-sm">Page Settings</CardTitle></CardHeader>
            <CardContent class="space-y-4">
              <div class="flex flex-col gap-2">
                <Label>Title</Label>
                <Input v-model="editForm.title" />
              </div>
              <div class="flex flex-col gap-2">
                <Label>Slug</Label>
                <div class="flex items-center gap-1">
                  <span class="text-muted-foreground text-sm">/p/</span>
                  <Input v-model="editForm.slug" class="flex-1" />
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <Label>Linked Form</Label>
                <Select v-model="editForm.form_id">
                  <SelectTrigger><SelectValue placeholder="No form linked" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    <SelectItem v-for="f in forms" :key="f.id" :value="f.id">{{ f.name }}</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">Link a form to embed it on this page and track conversions</p>
              </div>
              <div class="flex flex-col gap-2">
                <Label>Meta Description</Label>
                <Input v-model="editForm.meta_description" placeholder="SEO description" />
              </div>
              <div class="flex items-center gap-3">
                <Switch v-model:checked="editForm.tracking_enabled" />
                <span class="text-sm text-muted-foreground">Enable visit tracking</span>
              </div>
              <Button :disabled="saving" @click="savePage">
                <Loader2 v-if="saving" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                Save Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>
