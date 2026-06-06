<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formsApi, type FormEndpoint, type FormSubmission, type EmbedCode } from '../lib/api'
import { useToast } from '../composables/useToast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import StatCard from '../components/ui/StatCard.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import AppPagination from '../components/ui/AppPagination.vue'
import {
  ArrowLeft, Inbox,
  Power, PowerOff, Trash2, Copy, Check, Loader2, Users, Clock,
  MousePointer,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const formId = route.params.id as string

const form = ref<FormEndpoint | null>(null)
const loading = ref(true)
const submissions = ref<FormSubmission[]>([])
const submissionsTotal = ref(0)
const submissionsLoading = ref(false)
const submissionsPage = ref(1)
const embed = ref<EmbedCode | null>(null)
const embedLoading = ref(false)
const activeTab = ref('overview')
const copied = ref<string | null>(null)
const toggling = ref(false)

async function loadForm() {
  loading.value = true
  try {
    form.value = await formsApi.get(formId)
  } catch (e: any) {
    toast.error(e.message || 'Form not found')
    router.replace('/forms')
  } finally {
    loading.value = false
  }
}

async function loadSubmissions(page = 1) {
  submissionsLoading.value = true
  try {
    const limit = 20
    const result = await formsApi.getSubmissions(formId, limit, (page - 1) * limit)
    submissions.value = result.submissions
    submissionsTotal.value = result.total
    submissionsPage.value = page
  } catch { submissions.value = [] }
  finally { submissionsLoading.value = false }
}

async function loadEmbed() {
  if (embed.value) return
  embedLoading.value = true
  try { embed.value = await formsApi.getEmbed(formId) }
  catch { embed.value = { html: '', js: '', api: '' } }
  finally { embedLoading.value = false }
}

async function toggleForm() {
  if (!form.value) return
  toggling.value = true
  try {
    const newStatus = await formsApi.toggle(formId)
    form.value.status = newStatus as any
    toast.success(`Form ${newStatus === 'active' ? 'activated' : 'paused'}`)
  } catch (e: any) { toast.error(e.message) }
  finally { toggling.value = false }
}

async function deleteForm() {
  if (!confirm('Delete this form? All submissions will be lost.')) return
  try {
    await formsApi.delete(formId)
    toast.success('Form deleted')
    router.replace('/forms')
  } catch (e: any) { toast.error(e.message) }
}

function copyText(text: string, label: string) {
  navigator.clipboard.writeText(text)
  copied.value = label
  toast.success('Copied to clipboard')
  setTimeout(() => { copied.value = null }, 2000)
}

function parseJson(json: string): Record<string, string> {
  try { return JSON.parse(json) } catch { return {} }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function onTabChange(tab: string | number) {
  activeTab.value = String(tab)
  if (tab === 'submissions' && submissions.value.length === 0) loadSubmissions()
  if (tab === 'embed') loadEmbed()
}

onMounted(loadForm)
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <Skeleton variant="text" width="200px" />
      <div class="grid grid-cols-3 gap-4"><Skeleton variant="stat-card" :count="3" /></div>
    </div>

    <template v-else-if="form">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-start gap-3">
          <Button variant="ghost" size="sm" class="mt-0.5" @click="router.push('/forms')">
            <ArrowLeft :size="16" />
          </Button>
          <div>
            <div class="flex items-center gap-2.5">
              <h1 class="text-xl font-bold text-foreground">{{ form.name }}</h1>
              <Badge :variant="form.status === 'active' ? 'default' : 'secondary'">
                {{ form.status === 'active' ? 'Active' : 'Paused' }}
              </Badge>
            </div>
            <p class="text-sm text-muted-foreground mt-1">
              Created {{ formatDate(form.created_at) }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" :disabled="toggling" @click="toggleForm">
            <Loader2 v-if="toggling" :size="14" class="animate-spin" />
            <Power v-else-if="form.status !== 'active'" :size="14" class="text-success" />
            <PowerOff v-else :size="14" class="text-warning" />
            {{ form.status === 'active' ? 'Pause' : 'Activate' }}
          </Button>
          <Button variant="ghost" size="sm" class="text-danger" @click="deleteForm">
            <Trash2 :size="14" />
          </Button>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-3 max-md:grid-cols-1 gap-4">
        <StatCard :icon="Users" :value="form.submission_count" label="Total Submissions" />
        <StatCard :icon="MousePointer" :value="form.status === 'active' ? 'Live' : 'Paused'" label="Status" :color="form.status === 'active' ? 'success' : 'warning'" />
        <StatCard :icon="Clock" :value="formatDate(form.updated_at)" label="Last Updated" />
      </div>

      <!-- Tabs -->
      <Tabs :default-value="activeTab" @update:model-value="onTabChange">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="embed">Embed Code</TabsTrigger>
        </TabsList>

        <!-- Overview Tab -->
        <TabsContent value="overview" class="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle class="text-sm">Form Configuration</CardTitle></CardHeader>
            <CardContent class="space-y-3 text-sm">
              <div class="flex justify-between"><span class="text-muted-foreground">Target List</span><span class="text-foreground">{{ form.list_id || 'Not set' }}</span></div>
              <div class="flex justify-between"><span class="text-muted-foreground">Success Message</span><span class="text-foreground">{{ form.success_message || 'Default' }}</span></div>
              <div class="flex justify-between"><span class="text-muted-foreground">Redirect URL</span><span class="text-foreground font-mono text-xs">{{ form.redirect_url || 'None' }}</span></div>
              <div class="flex justify-between"><span class="text-muted-foreground">Double Opt-in</span><span class="text-foreground">{{ form.double_optin ? 'Yes' : 'No' }}</span></div>
            </CardContent>
          </Card>

          <Card v-if="form.field_mapping">
            <CardHeader><CardTitle class="text-sm">Field Mapping</CardTitle></CardHeader>
            <CardContent>
              <div v-for="(to, from) in parseJson(form.field_mapping)" :key="String(from)" class="flex items-center gap-2 text-sm py-1">
                <code class="bg-muted px-2 py-0.5 rounded text-xs">{{ from }}</code>
                <span class="text-muted-foreground">→</span>
                <span class="text-foreground">{{ to }}</span>
              </div>
              <p v-if="Object.keys(parseJson(form.field_mapping)).length === 0" class="text-xs text-muted-foreground">No field mapping configured</p>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Submissions Tab -->
        <TabsContent value="submissions" class="mt-4">
          <Card>
            <div v-if="submissionsLoading" class="p-4"><Skeleton variant="table-row" :count="5" /></div>
            <EmptyState v-else-if="submissions.length === 0" :icon="Inbox" title="No submissions yet" description="Share your form to start collecting submissions" />
            <template v-else>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="sub in submissions" :key="sub.id">
                    <TableCell>
                      <div class="flex flex-wrap gap-1.5">
                        <Badge v-for="(val, key) in parseJson(sub.data)" :key="String(key)" variant="outline" class="text-[10px]">
                          {{ key }}: {{ val }}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell class="text-xs text-muted-foreground font-mono">{{ sub.ip_address || '-' }}</TableCell>
                    <TableCell class="text-xs text-muted-foreground">{{ formatDate(sub.created_at) }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <AppPagination
                :page="submissionsPage"
                :total-pages="Math.ceil(submissionsTotal / 20)"
                :total="submissionsTotal"
                :showing="submissions.length"
                @update:page="loadSubmissions"
              />
            </template>
          </Card>
        </TabsContent>

        <!-- Embed Code Tab -->
        <TabsContent value="embed" class="space-y-4 mt-4">
          <div v-if="embedLoading" class="py-8 text-center text-muted-foreground text-sm">Loading embed codes...</div>
          <template v-else-if="embed">
            <!-- HTML Embed -->
            <Card>
              <CardHeader>
                <div class="flex items-center justify-between">
                  <CardTitle class="text-sm">HTML Embed</CardTitle>
                  <Button variant="ghost" size="sm" @click="copyText(embed!.html, 'html')">
                    <Check v-if="copied === 'html'" :size="14" class="text-success" />
                    <Copy v-else :size="14" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p class="text-xs text-muted-foreground mb-2">Paste this into any HTML page. Works with any website.</p>
                <pre class="bg-muted rounded-lg p-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">{{ embed.html }}</pre>
              </CardContent>
            </Card>

            <!-- JavaScript Embed -->
            <Card>
              <CardHeader>
                <div class="flex items-center justify-between">
                  <CardTitle class="text-sm">JavaScript Snippet</CardTitle>
                  <Button variant="ghost" size="sm" @click="copyText(embed!.js, 'js')">
                    <Check v-if="copied === 'js'" :size="14" class="text-success" />
                    <Copy v-else :size="14" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p class="text-xs text-muted-foreground mb-2">Add this script tag. Works with React, Next.js, Vue, WordPress — any framework.</p>
                <pre class="bg-muted rounded-lg p-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">{{ embed.js }}</pre>
              </CardContent>
            </Card>

            <!-- API Endpoint -->
            <Card>
              <CardHeader>
                <div class="flex items-center justify-between">
                  <CardTitle class="text-sm">API Endpoint</CardTitle>
                  <Button variant="ghost" size="sm" @click="copyText(embed!.api, 'api')">
                    <Check v-if="copied === 'api'" :size="14" class="text-success" />
                    <Copy v-else :size="14" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p class="text-xs text-muted-foreground mb-2">Submit form data via POST request. Connect any external form or app.</p>
                <pre class="bg-muted rounded-lg p-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">{{ embed.api }}</pre>
              </CardContent>
            </Card>
          </template>
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>
