<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../../lib/api/admin'
import StatCard from '../../components/ui/StatCard.vue'
import { Building2, Users, Mail, Activity, Loader2 } from 'lucide-vue-next'

const loading = ref(true)
const stats = ref({ orgs: 0, users: 0, totalOrgs: 0, totalUsers: 0 })
const recentOrgs = ref<any[]>([])
const recentUsers = ref<any[]>([])
const mailerStatus = ref<{ configured: boolean; config: any }>({ configured: false, config: null })
const webhookStatus = ref<{ registered: boolean; status: any }>({ registered: false, status: null })

async function loadData() {
  loading.value = true
  try {
    const [orgsData, usersData, mailer, webhook] = await Promise.all([
      adminApi.platformListOrgs(1, 10),
      adminApi.platformListUsers(1, 10),
      adminApi.getSystemMailer().catch(() => ({ configured: false, config: null })),
      adminApi.getWebhookStatus().catch(() => ({ registered: false, status: null })),
    ])
    stats.value = {
      orgs: orgsData.orgs.length,
      users: usersData.users.length,
      totalOrgs: orgsData.total,
      totalUsers: usersData.total,
    }
    recentOrgs.value = orgsData.orgs.slice(0, 5)
    recentUsers.value = usersData.users.slice(0, 5)
    mailerStatus.value = mailer
    webhookStatus.value = webhook
  } catch { /* ignore */ }
  finally { loading.value = false }
}

function formatDate(d: string): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

onMounted(loadData)
</script>

<template>
  <div>
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-foreground">Platform Dashboard</h1>
      <p class="text-sm text-muted-foreground mt-1">System overview and health monitoring</p>
    </div>

    <div v-if="loading" class="flex justify-center py-20"><Loader2 :size="24" class="animate-spin text-muted-foreground" /></div>

    <template v-else>
      <!-- Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard :icon="Building2" :value="stats.totalOrgs" label="Organizations" />
        <StatCard :icon="Users" :value="stats.totalUsers" label="Total Users" />
        <StatCard :icon="Mail" :value="mailerStatus.configured ? 'Active' : 'Not Set'" label="System Mailer" :color="mailerStatus.configured ? 'success' : 'danger'" />
        <StatCard :icon="Activity" :value="webhookStatus.registered ? 'Active' : 'Inactive'" label="Bounce Webhooks" :color="webhookStatus.registered ? 'success' : 'warning'" />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Recent Organizations -->
        <div class="bg-card border border-border rounded-xl">
          <div class="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 class="text-sm font-semibold text-foreground">Recent Organizations</h2>
            <router-link to="/platform/organizations" class="text-xs text-accent hover:text-accent/80">View All</router-link>
          </div>
          <div class="divide-y divide-border">
            <div v-for="org in recentOrgs" :key="org.id" class="px-5 py-3 flex items-center justify-between">
              <div>
                <div class="text-sm font-medium text-foreground">{{ org.name }}</div>
                <div class="text-xs text-muted-foreground">@{{ org.slug }} — {{ org.status }}</div>
              </div>
              <div class="text-xs text-muted-foreground">{{ formatDate(org.created_at) }}</div>
            </div>
            <div v-if="recentOrgs.length === 0" class="px-5 py-8 text-center text-sm text-muted-foreground">No organizations yet</div>
          </div>
        </div>

        <!-- Recent Users -->
        <div class="bg-card border border-border rounded-xl">
          <div class="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 class="text-sm font-semibold text-foreground">Recent Users</h2>
            <router-link to="/platform/users" class="text-xs text-accent hover:text-accent/80">View All</router-link>
          </div>
          <div class="divide-y divide-border">
            <div v-for="u in recentUsers" :key="u.id" class="px-5 py-3 flex items-center justify-between">
              <div>
                <div class="text-sm font-medium text-foreground">{{ u.name }}</div>
                <div class="text-xs text-muted-foreground">{{ u.email }}</div>
              </div>
              <div class="text-xs text-muted-foreground">{{ u.status }}</div>
            </div>
            <div v-if="recentUsers.length === 0" class="px-5 py-8 text-center text-sm text-muted-foreground">No users yet</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
