<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import ContactFormModal from '../components/contacts/ContactFormModal.vue'
import ImportModal from '../components/contacts/ImportModal.vue'
import ContactFilters from '../components/contacts/ContactFilters.vue'
import ValidateModal from '../components/contacts/ValidateModal.vue'
import ListFormModal from '../components/contacts/ListFormModal.vue'
import BulkActionsModal from '../components/contacts/BulkActionsModal.vue'
import ContactsTable from '../components/contacts/ContactsTable.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import AppPagination from '../components/ui/AppPagination.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { useToast } from '../composables/useToast'
import {
  useContactLists,
  useCreateContactList,
  useUpdateContactList,
  useDeleteContactList,
  useContacts,
  useAddContact,
  useUpdateContact,
  useBulkDeleteContacts,
  useBulkTagContacts,
  useBulkMoveContacts,
  useImportContacts,
  useValidateEmails,
} from '../lib/query'
import type { Contact, ContactInput, ContactList, DuplicateGroup } from '../lib/api'
import { contactsApi } from '../lib/api'
import Modal from '../components/ui/Modal.vue'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Tag,
  FolderInput,
  Shield,
  GitMerge,
  Loader2,
} from 'lucide-vue-next'

const activeListId = ref('')
const searchQuery = ref('')
const currentPage = ref(1)
const selectedIds = ref<string[]>([])

// Modals
const showNewListModal = ref(false)
const showEditListModal = ref(false)
const showAddContactModal = ref(false)
const showEditContactModal = ref(false)
const showImportModal = ref(false)
const showBulkTagModal = ref(false)
const showBulkMoveModal = ref(false)
const showValidateModal = ref(false)
const showDuplicatesModal = ref(false)
const contactRouter = useRouter()
const duplicates = ref<DuplicateGroup[]>([])
const duplicatesLoading = ref(false)
const mergingId = ref<string | null>(null)
const deleteConfirm = ref<{ show: boolean; type: 'list' | 'bulk'; listName: string }>({ show: false, type: 'list', listName: '' })
const deleteListRef = ref<ContactList | null>(null)

// Forms
const editListData = ref({ id: '', name: '', description: '' })
const editContactData = ref<{ id: string } & Partial<ContactInput> & { status?: string }>({ id: '', email: '' })

// Toast
const toast = useToast()

// Validate modal ref
const validateModalRef = ref<InstanceType<typeof ValidateModal> | null>(null)

const { data: lists, isLoading: listsLoading } = useContactLists()

const contactFilters = computed(() => ({
  search: searchQuery.value || undefined,
  page: currentPage.value,
  limit: 50,
}))

const { data: contactsData, isLoading: contactsLoading } = useContacts(activeListId, contactFilters)

const contacts = computed(() => contactsData.value?.contacts || [])
const pagination = computed(() => contactsData.value?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 })

const createListMutation = useCreateContactList()
const updateListMutation = useUpdateContactList()
const deleteListMutation = useDeleteContactList()
const addContactMutation = useAddContact()
const updateContactMutation = useUpdateContact()
const bulkDeleteMutation = useBulkDeleteContacts()
const bulkTagMutation = useBulkTagContacts()
const bulkMoveMutation = useBulkMoveContacts()
const importMutation = useImportContacts()
const validateMutation = useValidateEmails()

// Auto-select first list
watch(
  lists,
  (val) => {
    if (val && val.length > 0 && !activeListId.value && val[0]) {
      activeListId.value = val[0].id
    }
  },
  { immediate: true }
)

// Reset page when list changes
watch(activeListId, () => {
  currentPage.value = 1
  selectedIds.value = []
})

async function handleCreateList(data: { name: string; description: string }) {
  if (!data.name.trim()) return
  try {
    await createListMutation.mutateAsync({ name: data.name, description: data.description || undefined })
    toast.success('List created')
    showNewListModal.value = false
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function handleUpdateList(data: { id?: string; name: string; description: string }) {
  if (!data.name.trim() || !data.id) return
  try {
    await updateListMutation.mutateAsync({ id: data.id, name: data.name, description: data.description || undefined })
    toast.success('List updated')
    showEditListModal.value = false
  } catch (e: any) {
    toast.error(e.message)
  }
}

function handleDeleteList(list: ContactList) {
  deleteListRef.value = list
  deleteConfirm.value = { show: true, type: 'list', listName: list.name }
}

async function confirmDeleteList() {
  const list = deleteListRef.value
  deleteConfirm.value.show = false
  if (!list) return
  try {
    await deleteListMutation.mutateAsync(list.id)
    toast.success('List deleted')
    if (activeListId.value === list.id) activeListId.value = ''
  } catch (e: any) {
    toast.error(e.message)
  }
  deleteListRef.value = null
}

function openEditList(list: ContactList) {
  editListData.value = { id: list.id, name: list.name, description: list.description || '' }
  showEditListModal.value = true
}

async function handleAddContact(data: { id?: string } & Partial<ContactInput>) {
  if (!data.email?.trim()) return
  try {
    await addContactMutation.mutateAsync({
      listId: activeListId.value,
      contact: {
        email: data.email || '',
        first_name: data.first_name,
        last_name: data.last_name,
        company: data.company,
        phone: data.phone,
      },
    })
    toast.success('Contact added')
    showAddContactModal.value = false
  } catch (e: any) {
    toast.error(e.message)
  }
}

function openEditContact(contact: Contact) {
  editContactData.value = {
    id: contact.id,
    email: contact.email,
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    company: contact.company || '',
    phone: contact.phone || '',
    status: contact.status,
  }
  showEditContactModal.value = true
}

async function handleUpdateContact(data: { id?: string } & Partial<ContactInput> & { status?: string }) {
  if (!data.id) return
  const { id, ...updates } = data
  try {
    await updateContactMutation.mutateAsync({ id, updates })
    toast.success('Contact updated')
    showEditContactModal.value = false
  } catch (e: any) {
    toast.error(e.message)
  }
}

function openTimeline(contact: Contact) {
  contactRouter.push(`/contacts/${contact.id}`)
}

function handleBulkDelete() {
  if (!selectedIds.value.length) return
  deleteConfirm.value = { show: true, type: 'bulk', listName: '' }
}

async function confirmBulkDelete() {
  deleteConfirm.value.show = false
  try {
    const deleted = await bulkDeleteMutation.mutateAsync(selectedIds.value)
    toast.success(`${deleted} contact(s) deleted`)
    selectedIds.value = []
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function handleBulkTag(tags: string[]) {
  if (!tags.length || !selectedIds.value.length) return
  try {
    const updated = await bulkTagMutation.mutateAsync({ ids: selectedIds.value, tags })
    toast.success(`${updated} contact(s) tagged`)
    showBulkTagModal.value = false
    selectedIds.value = []
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function handleBulkMove(targetListId: string) {
  if (!targetListId || !selectedIds.value.length) return
  try {
    const moved = await bulkMoveMutation.mutateAsync({ ids: selectedIds.value, targetListId })
    toast.success(`${moved} contact(s) moved`)
    showBulkMoveModal.value = false
    selectedIds.value = []
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function handleImport(file: File) {
  try {
    const result = await importMutation.mutateAsync({ listId: activeListId.value, file })
    toast.success(`Imported ${result.imported} contacts (${result.duplicates} duplicates, ${result.invalid} invalid)`)
    showImportModal.value = false
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function handleValidate(emails: string[]) {
  try {
    const results = await validateMutation.mutateAsync(emails)
    validateModalRef.value?.setResults(results)
  } catch (e: any) {
    toast.error(e.message)
  }
}

// Duplicates
async function findDuplicates() {
  duplicatesLoading.value = true
  showDuplicatesModal.value = true
  try {
    duplicates.value = await contactsApi.findDuplicates()
  } catch (e: any) {
    toast.error(e.message || 'Failed to find duplicates')
  } finally {
    duplicatesLoading.value = false
  }
}

async function mergeDuplicate(group: DuplicateGroup) {
  if (group.ids.length < 2) return
  mergingId.value = group.email
  try {
    const [primaryId, ...mergeIds] = group.ids
    await contactsApi.mergeContacts(primaryId ?? '', mergeIds)
    toast.success(`Merged ${mergeIds.length} duplicate(s) for ${group.email}`)
    duplicates.value = duplicates.value.filter(d => d.email !== group.email)
  } catch (e: any) {
    toast.error(e.message || 'Merge failed')
  } finally {
    mergingId.value = null
  }
}

// Selection
function toggleSelect(id: string) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(id)
}

function toggleSelectAll() {
  if (selectedIds.value.length === contacts.value.length) selectedIds.value = []
  else selectedIds.value = contacts.value.map((c) => c.id)
}
</script>

<template>
  <div>
    <div class="relative">
      <PageHeader title="Contacts">
        <template #actions>
          <Button variant="ghost" @click="findDuplicates">
            <GitMerge :size="16" /> Duplicates
          </Button>
          <Button variant="ghost" @click="showValidateModal = true">
            <Shield :size="16" /> Validate
          </Button>
          <Button @click="showNewListModal = true">
            <Plus :size="16" /> New List
          </Button>
        </template>
      </PageHeader>

      <div class="flex max-md:flex-col gap-6 min-h-[calc(100vh-160px)]">
        <!-- Sidebar: Lists -->
        <div class="w-[260px] max-md:w-full shrink-0 bg-card border border-border rounded-xl">
          <div class="px-4 py-3.5 border-b border-border">
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lists</h3>
          </div>
          <div v-if="listsLoading" class="p-3 flex flex-col gap-2">
            <Skeleton variant="text" :count="4" height="40px" />
          </div>
          <EmptyState v-else-if="!lists?.length" :icon="Users" title="No lists yet" />
          <div v-else class="p-1.5">
            <div
              v-for="list in lists"
              :key="list.id"
              class="group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150"
              :class="
                activeListId === list.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-foreground hover:bg-muted'
              "
              @click="activeListId = list.id"
            >
              <div class="flex items-center gap-2.5 flex-1 min-w-0">
                <span class="text-sm font-medium truncate">{{ list.name }}</span>
                <span
                  class="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                  :class="
                    activeListId === list.id
                      ? 'bg-accent/20 text-accent'
                      : 'bg-muted text-muted-foreground'
                  "
                >{{ list.contact_count }}</span>
              </div>
              <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click.stop="openEditList(list)" title="Edit">
                  <Pencil :size="13" />
                </Button>
                <Button variant="ghost" size="sm" class="h-7 w-7 p-0 hover:text-red-500 hover:bg-red-500/10" @click.stop="handleDeleteList(list)" title="Delete">
                  <Trash2 :size="13" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- Main: Contacts -->
        <div class="flex-1 min-w-0">
          <template v-if="activeListId">
            <ContactFilters
              v-model:searchQuery="searchQuery"
              @search-input="currentPage = 1"
              @import="showImportModal = true"
              @add="showAddContactModal = true"
            />

            <!-- Bulk actions bar -->
            <div
              v-if="selectedIds.length > 0"
              class="flex items-center justify-between bg-accent/[0.06] border border-accent/20 rounded-xl px-5 py-3 mb-4 text-sm"
            >
              <span class="font-semibold text-accent">{{ selectedIds.length }} selected</span>
              <div class="flex gap-1.5">
                <Button variant="ghost" size="sm" @click="showBulkTagModal = true">
                  <Tag :size="14" /> Tag
                </Button>
                <Button variant="ghost" size="sm" @click="showBulkMoveModal = true">
                  <FolderInput :size="14" /> Move
                </Button>
                <Button variant="ghost" size="sm" class="text-red-500 hover:bg-red-500/[0.08]" @click="handleBulkDelete">
                  <Trash2 :size="14" /> Delete
                </Button>
              </div>
            </div>

            <!-- Table -->
            <ContactsTable
              :contacts="contacts"
              :loading="contactsLoading"
              :selectedIds="selectedIds"
              @toggle-select="toggleSelect"
              @toggle-select-all="toggleSelectAll"
              @edit="openEditContact"
              @timeline="openTimeline"
            />

            <!-- Pagination -->
            <AppPagination
              v-if="pagination.totalPages > 1"
              :page="currentPage"
              :total-pages="pagination.totalPages"
              :total="pagination.total"
              :showing="contacts.length"
              @update:page="currentPage = $event"
              class="mt-4"
            />
          </template>

          <EmptyState
            v-else
            :icon="Users"
            title="Select a list"
            description="Choose a contact list from the sidebar, or create a new one"
          />
        </div>
      </div>

      <!-- Modals -->
      <ListFormModal
        :show="showNewListModal"
        mode="create"
        :saving="createListMutation.isPending.value"
        @close="showNewListModal = false"
        @save="handleCreateList"
      />
      <ListFormModal
        :show="showEditListModal"
        mode="edit"
        :listData="editListData"
        :saving="updateListMutation.isPending.value"
        @close="showEditListModal = false"
        @save="handleUpdateList"
      />
      <ContactFormModal
        :show="showAddContactModal"
        mode="create"
        :saving="addContactMutation.isPending.value"
        @close="showAddContactModal = false"
        @save="handleAddContact"
      />
      <ContactFormModal
        :show="showEditContactModal"
        mode="edit"
        :contact="editContactData"
        :saving="updateContactMutation.isPending.value"
        @close="showEditContactModal = false"
        @save="handleUpdateContact"
      />
      <ImportModal
        :show="showImportModal"
        :importing="importMutation.isPending.value"
        :importResult="importMutation.data.value ?? undefined"
        @close="showImportModal = false"
        @import="handleImport"
      />
      <BulkActionsModal
        :show="showBulkTagModal"
        mode="tag"
        :selectedCount="selectedIds.length"
        :saving="bulkTagMutation.isPending.value"
        @close="showBulkTagModal = false"
        @tag="handleBulkTag"
      />
      <BulkActionsModal
        :show="showBulkMoveModal"
        mode="move"
        :selectedCount="selectedIds.length"
        :lists="lists"
        :activeListId="activeListId"
        :saving="bulkMoveMutation.isPending.value"
        @close="showBulkMoveModal = false"
        @move="handleBulkMove"
      />
      <ValidateModal
        ref="validateModalRef"
        :show="showValidateModal"
        :validating="validateMutation.isPending.value"
        @close="showValidateModal = false"
        @validate="handleValidate"
      />
      <ConfirmDialog
        :show="deleteConfirm.show"
        :title="deleteConfirm.type === 'list' ? 'Delete List' : 'Delete Contacts'"
        :message="deleteConfirm.type === 'list' ? `Delete &quot;${deleteConfirm.listName}&quot; and all its contacts? This cannot be undone.` : `Delete ${selectedIds.length} contact(s)? This cannot be undone.`"
        confirmText="Delete"
        variant="danger"
        @confirm="deleteConfirm.type === 'list' ? confirmDeleteList() : confirmBulkDelete()"
        @cancel="deleteConfirm.show = false"
      />
      <!-- Duplicates Modal -->
      <Modal :show="showDuplicatesModal" title="Duplicate Contacts" size="lg" @close="showDuplicatesModal = false">
        <div v-if="duplicatesLoading" class="flex justify-center py-12">
          <Loader2 :size="24" class="spin text-accent" />
        </div>
        <div v-else-if="duplicates.length === 0" class="py-12 text-center text-muted-foreground text-sm">
          No duplicates found
        </div>
        <div v-else class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          <div
            v-for="group in duplicates"
            :key="group.email"
            class="bg-card rounded-lg p-4"
          >
            <div class="flex justify-between items-center mb-2">
              <div>
                <span class="text-sm font-semibold text-foreground">{{ group.email }}</span>
                <span class="text-xs text-muted-foreground ml-2">{{ group.count }} copies</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                :disabled="mergingId === group.email"
                @click="mergeDuplicate(group)"
              >
                <Loader2 v-if="mergingId === group.email" :size="12" class="spin" />
                <GitMerge v-else :size="12" />
                Merge
              </Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground mt-2 m-0">
            Merging keeps the newest data and combines tags. The primary contact is preserved.
          </p>
        </div>
      </Modal>
    </div>
  </div>
</template>
