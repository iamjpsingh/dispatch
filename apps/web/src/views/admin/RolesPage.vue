<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../../lib/api/admin'
import type { SystemRole } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import EmptyState from '../../components/ui/EmptyState.vue'
import Skeleton from '../../components/ui/Skeleton.vue'
import { Shield } from 'lucide-vue-next'

const toast = useToast()
const loading = ref(true)
const roles = ref<SystemRole[]>([])

async function loadRoles() {
  try {
    roles.value = await adminApi.getRoles()
  } catch (e: any) {
    toast.error(e.message || 'Failed to load roles')
  } finally {
    loading.value = false
  }
}

onMounted(loadRoles)
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-4">
      <Skeleton variant="card" :count="2" />
    </div>

    <template v-else>
      <div v-if="roles.length === 0" class="bg-card border border-border rounded-xl">
        <EmptyState :icon="Shield" title="No roles defined" description="System roles are created during setup" />
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="role in roles"
          :key="role.id"
          class="bg-card border border-border rounded-xl p-5"
        >
          <div class="flex items-center gap-3 mb-3">
            <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
              <Shield :size="18" class="text-accent" />
            </div>
            <div>
              <h3 class="text-[15px] font-semibold text-foreground">{{ role.name }}</h3>
              <p v-if="role.description" class="text-sm text-muted-foreground">{{ role.description }}</p>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="perm in role.permissions.slice(0, 12)"
              :key="perm"
              class="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono"
            >
              {{ perm }}
            </span>
            <span
              v-if="role.permissions.length > 12"
              class="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground"
            >
              +{{ role.permissions.length - 12 }} more
            </span>
            <span
              v-if="role.permissions.includes('*')"
              class="text-xs px-2 py-0.5 rounded-md bg-accent/10 text-accent font-semibold"
            >
              Full Access
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
