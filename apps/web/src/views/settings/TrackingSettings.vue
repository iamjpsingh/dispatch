<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { cloudflareApi, type CloudflareZone, type TrackingStats } from '../../lib/api/cloudflare'
import { Radio, Globe, Zap, Trash2, Loader2, Check, AlertCircle } from 'lucide-vue-next'

const loading = ref(true)
const deploying = ref<string | null>(null)
const error = ref('')
const successMsg = ref('')

const status = ref<{ connected: boolean; accountName?: string }>({ connected: false })
const zones = ref<CloudflareZone[]>([])
const stats = ref<Record<string, TrackingStats>>({})

// Deploy options per zone
const deployOptions = ref<Record<string, { useSubdomain: boolean; subdomain: string; openPath: string; clickPath: string; unsubPath: string }>>({})

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    status.value = await cloudflareApi.getStatus()
    if (status.value.connected) {
      zones.value = await cloudflareApi.listZones()
      for (const z of zones.value) {
        deployOptions.value[z.id] = deployOptions.value[z.id] || {
          useSubdomain: false,
          subdomain: 'e',
          openPath: z.deployment?.openPath || 'o',
          clickPath: z.deployment?.clickPath || 'c',
          unsubPath: z.deployment?.unsubPath || 'u',
        }
        if (z.deployed) {
          try {
            stats.value[z.name] = await cloudflareApi.getAnalytics(z.name)
          } catch { /* ignore */ }
        }
      }
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function connectCloudflare() {
  try {
    const url = await cloudflareApi.getConnectUrl()
    window.location.href = url
  } catch (e: any) {
    error.value = e.message
  }
}

async function deploy(zone: CloudflareZone) {
  deploying.value = zone.id
  error.value = ''
  successMsg.value = ''
  try {
    const opts = deployOptions.value[zone.id]
    if (!opts) return
    await cloudflareApi.deploy({
      zoneId: zone.id,
      domain: zone.name,
      openPath: opts.openPath,
      clickPath: opts.clickPath,
      unsubPath: opts.unsubPath,
      useSubdomain: opts.useSubdomain,
      subdomain: opts.useSubdomain ? opts.subdomain : undefined,
    })
    successMsg.value = `Tracking Worker deployed to ${zone.name}`
    await loadData()
  } catch (e: any) {
    error.value = e.message
  } finally {
    deploying.value = null
  }
}

async function undeploy(zone: CloudflareZone) {
  if (!confirm(`Remove tracking Worker from ${zone.name}?`)) return
  deploying.value = zone.id
  error.value = ''
  try {
    await cloudflareApi.undeploy(zone.name)
    successMsg.value = `Tracking removed from ${zone.name}`
    await loadData()
  } catch (e: any) {
    error.value = e.message
  } finally {
    deploying.value = null
  }
}

onMounted(() => {
  // Check URL params for OAuth callback results
  const params = new URLSearchParams(window.location.search)
  if (params.get('cf_success')) {
    successMsg.value = `Connected to Cloudflare (${params.get('account') || 'success'})`
  }
  if (params.get('cf_error')) {
    error.value = `Cloudflare connection failed: ${params.get('cf_error')}`
  }
  loadData()
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold text-foreground">Email Tracking</h2>
      <p class="text-sm text-muted-foreground mt-1">
        Deploy Cloudflare Workers on your own domains for first-party email tracking.
        Opens, clicks, and unsubscribes are tracked from the same domain you send from.
      </p>
    </div>

    <!-- Status messages -->
    <div v-if="error" class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
      <AlertCircle :size="16" class="mt-0.5 shrink-0" />
      {{ error }}
    </div>
    <div v-if="successMsg" class="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
      <Check :size="16" class="mt-0.5 shrink-0" />
      {{ successMsg }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" />
    </div>

    <template v-else>
      <!-- Not connected -->
      <div v-if="!status.connected" class="bg-secondary rounded-xl border border-border p-8 text-center">
        <Globe :size="40" class="mx-auto text-muted-foreground mb-4" />
        <h3 class="text-base font-medium text-foreground mb-2">Connect Cloudflare</h3>
        <p class="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
          Log in to your Cloudflare account to deploy tracking Workers on your domains.
          No API keys needed — just authorize with one click.
        </p>
        <button
          @click="connectCloudflare"
          class="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/90 transition font-medium text-sm"
        >
          <Zap :size="16" />
          Connect Cloudflare Account
        </button>
      </div>

      <!-- Connected — show zones -->
      <template v-else>
        <div class="bg-secondary rounded-xl border border-border p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check :size="16" class="text-green-400" />
              </div>
              <div>
                <div class="text-sm font-medium text-foreground">Connected to Cloudflare</div>
                <div class="text-xs text-muted-foreground">{{ status.accountName }}</div>
              </div>
            </div>
            <button @click="connectCloudflare" class="text-xs text-muted-foreground hover:text-muted-foreground transition">
              Reconnect
            </button>
          </div>
        </div>

        <!-- Zones list -->
        <div class="space-y-4">
          <h3 class="text-sm font-medium text-muted-foreground">Your Domains</h3>

          <div v-if="zones.length === 0" class="text-sm text-muted-foreground text-center py-8">
            No domains found on your Cloudflare account.
          </div>

          <div v-for="zone in zones" :key="zone.id" class="bg-secondary rounded-xl border border-border overflow-hidden">
            <div class="p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-3">
                  <Globe :size="16" class="text-muted-foreground" />
                  <span class="font-medium text-foreground text-sm">{{ zone.name }}</span>
                  <span v-if="zone.deployed" class="text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full">
                    Deployed
                  </span>
                  <span v-else class="text-xs bg-card text-muted-foreground px-2 py-0.5 rounded-full">
                    Not deployed
                  </span>
                </div>
              </div>

              <!-- Deployed — show info + stats -->
              <template v-if="zone.deployed && zone.deployment">
                <div class="text-xs text-muted-foreground space-y-1 mb-3">
                  <div>Routes: <code class="text-muted-foreground">{{ zone.name }}/{{ zone.deployment.openPath }}/*</code> · <code class="text-muted-foreground">{{ zone.name }}/{{ zone.deployment.clickPath }}/*</code> · <code class="text-muted-foreground">{{ zone.name }}/{{ zone.deployment.unsubPath }}/*</code></div>
                  <div>Deployed: {{ new Date(zone.deployment.deployedAt).toLocaleDateString() }}</div>
                </div>

                <!-- Stats -->
                <div v-if="stats[zone.name]" class="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-3">
                  <div class="bg-background rounded-lg p-3 text-center">
                    <div class="text-lg font-semibold text-foreground">{{ stats[zone.name]!.opens.toLocaleString() }}</div>
                    <div class="text-xs text-muted-foreground">Opens</div>
                  </div>
                  <div class="bg-background rounded-lg p-3 text-center">
                    <div class="text-lg font-semibold text-foreground">{{ stats[zone.name]!.clicks.toLocaleString() }}</div>
                    <div class="text-xs text-muted-foreground">Clicks</div>
                  </div>
                  <div class="bg-background rounded-lg p-3 text-center">
                    <div class="text-lg font-semibold text-foreground">{{ stats[zone.name]!.uniqueOpens.toLocaleString() }}</div>
                    <div class="text-xs text-muted-foreground">Unique Opens</div>
                  </div>
                  <div class="bg-background rounded-lg p-3 text-center">
                    <div class="text-lg font-semibold text-foreground">{{ stats[zone.name]!.uniqueClicks.toLocaleString() }}</div>
                    <div class="text-xs text-muted-foreground">Unique Clicks</div>
                  </div>
                  <div class="bg-background rounded-lg p-3 text-center">
                    <div class="text-lg font-semibold text-foreground">{{ stats[zone.name]!.unsubscribes.toLocaleString() }}</div>
                    <div class="text-xs text-muted-foreground">Unsubs</div>
                  </div>
                </div>

                <button
                  @click="undeploy(zone)"
                  :disabled="deploying === zone.id"
                  class="text-xs text-red-400 hover:text-red-300 transition flex items-center gap-1"
                >
                  <Trash2 :size="12" />
                  Remove Tracking
                </button>
              </template>

              <!-- Not deployed — show config + deploy -->
              <template v-else-if="deployOptions[zone.id]">
                <div class="space-y-3">
                  <div class="flex items-center gap-4 text-xs">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="radio" :value="false" v-model="deployOptions[zone.id]!.useSubdomain" class="accent-accent" />
                      <span class="text-muted-foreground">Same domain <span class="text-muted-foreground">(recommended)</span></span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="radio" :value="true" v-model="deployOptions[zone.id]!.useSubdomain" class="accent-accent" />
                      <span class="text-muted-foreground">Subdomain</span>
                    </label>
                  </div>

                  <div v-if="deployOptions[zone.id]!.useSubdomain" class="flex items-center gap-2">
                    <input
                      v-model="deployOptions[zone.id]!.subdomain"
                      type="text"
                      placeholder="e"
                      class="w-16 px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground"
                    />
                    <span class="text-xs text-muted-foreground">.{{ zone.name }}</span>
                  </div>

                  <div class="text-xs text-muted-foreground">
                    <template v-if="deployOptions[zone.id]!.useSubdomain">
                      {{ deployOptions[zone.id]!.subdomain || 'e' }}.{{ zone.name }}/{{ deployOptions[zone.id]!.openPath }}/* · {{ deployOptions[zone.id]!.subdomain || 'e' }}.{{ zone.name }}/{{ deployOptions[zone.id]!.clickPath }}/*
                    </template>
                    <template v-else>
                      {{ zone.name }}/{{ deployOptions[zone.id]!.openPath }}/* · {{ zone.name }}/{{ deployOptions[zone.id]!.clickPath }}/* · {{ zone.name }}/{{ deployOptions[zone.id]!.unsubPath }}/*
                    </template>
                  </div>

                  <button
                    @click="deploy(zone)"
                    :disabled="deploying === zone.id"
                    class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition text-xs font-medium disabled:opacity-50"
                  >
                    <Loader2 v-if="deploying === zone.id" :size="14" class="animate-spin" />
                    <Radio v-else :size="14" />
                    Deploy Tracking Worker
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
