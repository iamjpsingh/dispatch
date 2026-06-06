/**
 * Contact Query Composables
 */
import { computed, type Ref, type ComputedRef } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { contactsApi, type ContactInput } from '../api'
import { queryKeys } from './keys'

export function useContactLists() {
  return useQuery({
    queryKey: queryKeys.contacts.lists(),
    queryFn: contactsApi.getLists,
    staleTime: 30 * 1000,
  })
}

export function useCreateContactList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      contactsApi.createList(name, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useUpdateContactList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description?: string }) =>
      contactsApi.updateList(id, name, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useDeleteContactList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: contactsApi.deleteList,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

type ContactFilters = {
  search?: string
  status?: string
  tags?: string
  page?: number
  limit?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

export function useContacts(listId: Ref<string>, filters?: Ref<ContactFilters> | ComputedRef<ContactFilters>) {
  const resolvedFilters = computed<ContactFilters | undefined>(() => {
    if (!filters) return undefined
    return filters.value
  })

  return useQuery({
    queryKey: computed(() => queryKeys.contacts.contacts(listId.value, resolvedFilters.value)),
    queryFn: () => contactsApi.getContacts(listId.value, resolvedFilters.value),
    staleTime: 10 * 1000,
    enabled: computed(() => !!listId.value),
  })
}

export function useAddContact() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ listId, contact }: { listId: string; contact: ContactInput }) =>
      contactsApi.addContact(listId, contact),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useUpdateContact() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<ContactInput> }) =>
      contactsApi.updateContact(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useBulkDeleteContacts() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: contactsApi.bulkDelete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useBulkTagContacts() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ ids, tags }: { ids: string[]; tags: string[] }) => contactsApi.bulkTag(ids, tags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useBulkMoveContacts() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ ids, targetListId }: { ids: string[]; targetListId: string }) =>
      contactsApi.bulkMove(ids, targetListId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useImportContacts() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      listId,
      file,
      fieldMapping,
      skipDuplicates,
    }: {
      listId: string
      file: File
      fieldMapping?: Record<string, string>
      skipDuplicates?: boolean
    }) => contactsApi.importContacts(listId, file, fieldMapping, skipDuplicates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useImportHistory() {
  return useQuery({
    queryKey: queryKeys.contacts.importHistory(),
    queryFn: contactsApi.getImportHistory,
    staleTime: 30 * 1000,
  })
}

export function useValidateEmails() {
  return useMutation({
    mutationFn: contactsApi.validateEmails,
  })
}

export function useValidateSingleEmail() {
  return useMutation({
    mutationFn: contactsApi.validateSingle,
  })
}
