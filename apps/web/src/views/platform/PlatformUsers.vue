<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { adminApi, type PlatformUser } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import ConfirmDialog from '../../components/ui/ConfirmDialog.vue'
import {
  Search, Loader2, ChevronLeft, ChevronRight, Ban, CheckCircle, Trash2, MoreVertical,
} from 'lucide-vue-next'

const toast = useToast()
const loading = ref(true)
const users = ref<PlatformUser[]>([])
const total = ref(0)
const page = ref(1)
const limit = 20
const searchQuery = ref('')
const statusFilter = ref('')
const deleteConfirm = ref<{ show: boolean; userId: string; name: string }>({ show: false, userId: '', name: '' })

const filtered = computed(() => {
  let result = users.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }
  if (statusFilter.value) {
    result = result.filter(u => u.status === statusFilter.value)
  }
  return result
})

async function loadUsers() {
  loading.value = true
  try {
    const data = await adminApi.platformListUsers(page.value, limit)
    users.value = data.users
    total.value = data.total
  } catch (e: any) { toast.error(e.message) }
  finally { loading.value = false }
}

async function updateStatus(userId: string, status: string) {
  try {
    await adminApi.platformUpdateUserStatus(userId, status)
    toast.success(`User ${status}`)
    loadUsers()
  } catch (e: any) { toast.error(e.message) }
}

async function confirmDeleteUser() {
  const userId = deleteConfirm.value.userId
  deleteConfirm.value.show = false
  try {
    await adminApi.platformDeleteUser(userId)
    toast.success('User deleted')
    loadUsers()
  } catch (e: any) { toast.error(e.message) }
}

function promptDelete(u: PlatformUser) {
  deleteConfirm.value = { show: true, userId: u.id, name: u.name }
}

function nextPage() { if (page.value * limit < total.value) { page.value++; loadUsers() } }
function prevPage() { if (page.value > 1) { page.value--; loadUsers() } }

function formatDate(d: string | null): string {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

onMounted(loadUsers)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Users</h1>
        <p class="text-sm text-muted-foreground mt-1">{{ total }} user{{ total !== 1 ? 's' : '' }} across all organizations</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-3 mb-4">
      <div class="relative flex-1 max-w-md">
        <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input v-model="searchQuery" placeholder="Search by name or email..." class="pl-10" />
      </div>
      <Select v-model="statusFilter">
        <SelectTrigger class="w-36">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <Loader2 :size="20" class="animate-spin text-muted-foreground" />
    </div>

    <!-- Table -->
    <div v-else class="bg-card border border-border rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted hover:bg-muted">
            <TableHead>User</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Login</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead class="w-12 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="u in filtered" :key="u.id">
            <TableCell>
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent text-xs font-bold shrink-0">
                  {{ u.name?.charAt(0).toUpperCase() || '?' }}
                </div>
                <span class="font-medium text-foreground">{{ u.name }}</span>
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground text-xs">{{ u.email }}</TableCell>
            <TableCell>
              <Badge
                :variant="u.status === 'active' ? 'success' : u.status === 'suspended' ? 'danger' : 'warning'"
              >{{ u.status }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground text-xs">{{ formatDate(u.last_login_at) }}</TableCell>
            <TableCell class="text-muted-foreground text-xs">{{ formatDate(u.created_at) }}</TableCell>
            <TableCell class="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon" class="h-8 w-8">
                    <MoreVertical :size="14" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    v-if="u.status === 'active'"
                    class="text-amber-400"
                    @select="updateStatus(u.id, 'suspended')"
                  >
                    <Ban :size="12" /> Suspend User
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="u.status === 'suspended'"
                    class="text-green-400"
                    @select="updateStatus(u.id, 'active')"
                  >
                    <CheckCircle :size="12" /> Activate User
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="text-red-400"
                    @select="promptDelete(u)"
                  >
                    <Trash2 :size="12" /> Delete User
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          <TableRow v-if="filtered.length === 0">
            <TableCell colspan="6" class="text-center py-12 text-muted-foreground">No users found</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <!-- Pagination -->
      <div v-if="total > limit" class="flex items-center justify-between px-4 py-3 border-t border-border">
        <span class="text-xs text-muted-foreground">Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" :disabled="page <= 1" @click="prevPage">
            <ChevronLeft :size="14" />
          </Button>
          <Button variant="ghost" size="sm" :disabled="page * limit >= total" @click="nextPage">
            <ChevronRight :size="14" />
          </Button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :show="deleteConfirm.show"
      title="Delete User"
      :message="`Delete ${deleteConfirm.name}? This will remove them from all organizations. This cannot be undone.`"
      confirmText="Delete"
      variant="danger"
      @confirm="confirmDeleteUser"
      @cancel="deleteConfirm.show = false"
    />
  </div>
</template>
