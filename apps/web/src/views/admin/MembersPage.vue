<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../../lib/api/admin'
import type { OrgMember } from '../../lib/api/admin'
import { useToast } from '../../composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Modal from '../../components/ui/Modal.vue'
import ConfirmDialog from '../../components/ui/ConfirmDialog.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import Skeleton from '../../components/ui/Skeleton.vue'
import { Users, UserPlus, UserMinus, Pencil, Loader2 } from 'lucide-vue-next'

const toast = useToast()
const loading = ref(true)
const members = ref<OrgMember[]>([])
const showAddMember = ref(false)
const addMemberForm = ref({ email: '', role: 'member' })
const addingMember = ref(false)
const memberConfirm = ref<{ show: boolean; userId: string }>({ show: false, userId: '' })
const editRoleModal = ref<{ show: boolean; userId: string; name: string; currentRole: string; newRole: string }>({
  show: false, userId: '', name: '', currentRole: '', newRole: '',
})

const roleOptions = ['readonly', 'member', 'manager', 'admin', 'owner']

function roleBadgeVariant(role: string): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline' {
  const map: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'> = {
    owner: 'default', admin: 'warning', manager: 'info',
    member: 'outline', readonly: 'outline',
  }
  return map[role] || 'outline'
}

function formatDate(d: string): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

async function loadMembers() {
  try {
    members.value = await adminApi.getMembers()
  } catch (e: any) {
    toast.error(e.message || 'Failed to load members')
  } finally {
    loading.value = false
  }
}

async function addMember() {
  addingMember.value = true
  try {
    await adminApi.addMember(addMemberForm.value.email, addMemberForm.value.role)
    toast.success('Member added')
    showAddMember.value = false
    addMemberForm.value = { email: '', role: 'member' }
    await loadMembers()
  } catch (e: any) {
    toast.error(e.message || 'Failed to add member')
  } finally {
    addingMember.value = false
  }
}

function promptEditRole(m: OrgMember) {
  editRoleModal.value = {
    show: true, userId: m.user_id,
    name: m.name || m.email || '',
    currentRole: m.role, newRole: m.role,
  }
}

async function confirmEditRole() {
  const { userId, newRole } = editRoleModal.value
  editRoleModal.value.show = false
  try {
    await adminApi.updateMemberRole(userId, newRole)
    toast.success('Role updated')
    await loadMembers()
  } catch (e: any) {
    toast.error(e.message || 'Failed to update role')
  }
}

function promptRemoveMember(userId: string) {
  memberConfirm.value = { show: true, userId }
}

async function confirmRemoveMember() {
  const userId = memberConfirm.value.userId
  memberConfirm.value = { show: false, userId: '' }
  try {
    await adminApi.removeMember(userId)
    toast.success('Member removed')
    await loadMembers()
  } catch (e: any) {
    toast.error(e.message || 'Failed to remove member')
  }
}

onMounted(loadMembers)
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-4">
      <Skeleton variant="card" :count="2" />
    </div>

    <template v-else>
      <div class="flex justify-between items-center mb-4">
        <p class="text-sm text-muted-foreground">{{ members.length }} member{{ members.length !== 1 ? 's' : '' }}</p>
        <Button size="sm" @click="showAddMember = true">
          <UserPlus :size="15" /> Add Member
        </Button>
      </div>

      <div v-if="members.length === 0" class="bg-card border border-border rounded-xl">
        <EmptyState :icon="Users" title="No members" description="Add your first team member" />
      </div>

      <div v-else class="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead class="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="m in members" :key="m.id">
              <TableCell class="font-medium text-foreground">{{ m.name || '-' }}</TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ m.email }}</TableCell>
              <TableCell>
                <Badge :variant="roleBadgeVariant(m.role)">{{ m.role }}</Badge>
              </TableCell>
              <TableCell>
                <Badge :variant="m.status === 'active' ? 'success' : 'warning'">
                  {{ m.status }}
                </Badge>
              </TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ formatDate(m.joined_at) }}</TableCell>
              <TableCell>
                <div class="flex items-center gap-1">
                  <Button variant="ghost" size="sm" @click="promptEditRole(m)" title="Change role">
                    <Pencil :size="14" />
                  </Button>
                  <Button
                    v-if="m.role !== 'owner'"
                    variant="ghost"
                    size="sm"
                    class="text-danger"
                    @click="promptRemoveMember(m.user_id)"
                    title="Remove member"
                  >
                    <UserMinus :size="14" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <!-- Add Member Modal -->
      <Modal :show="showAddMember" title="Add Member" size="sm" @close="showAddMember = false">
        <form id="add-member-form" @submit.prevent="addMember">
          <div class="flex flex-col gap-2">
            <Label>Email Address</Label>
            <Input v-model="addMemberForm.email" type="email" placeholder="user@example.com" required />
            <p class="text-xs text-muted-foreground mt-1">User must already have an account</p>
          </div>
          <div class="flex flex-col gap-2">
            <Label>Role</Label>
            <Select v-model="addMemberForm.role">
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="r in roleOptions.filter(r => r !== 'owner')" :key="r" :value="r">{{ r }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </form>
        <template #footer>
          <Button variant="ghost" @click="showAddMember = false">Cancel</Button>
          <Button type="submit" form="add-member-form" :disabled="addingMember">
            <Loader2 v-if="addingMember" :size="16" class="spin" />
            Add Member
          </Button>
        </template>
      </Modal>

      <!-- Edit Role Modal -->
      <Modal :show="editRoleModal.show" title="Change Role" size="sm" @close="editRoleModal.show = false">
        <p class="text-sm text-muted-foreground mb-4">
          Change role for <strong class="text-foreground">{{ editRoleModal.name }}</strong>
        </p>
        <div class="mb-5">
          <Label>Role</Label>
          <Select v-model="editRoleModal.newRole">
            <SelectTrigger>
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="r in roleOptions" :key="r" :value="r">{{ r }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <template #footer>
          <Button variant="ghost" @click="editRoleModal.show = false">Cancel</Button>
          <Button @click="confirmEditRole" :disabled="editRoleModal.newRole === editRoleModal.currentRole">
            Update Role
          </Button>
        </template>
      </Modal>

      <!-- Confirm Remove -->
      <ConfirmDialog
        :show="memberConfirm.show"
        title="Remove Member"
        message="Are you sure you want to remove this member from the organization?"
        confirm-text="Remove"
        variant="danger"
        @confirm="confirmRemoveMember"
        @cancel="memberConfirm = { show: false, userId: '' }"
      />
    </template>
  </div>
</template>
