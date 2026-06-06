/**
 * Contacts API
 */
import { api, type Pagination } from './client'

// ============================================================================
// Contact Types
// ============================================================================

export interface ContactList {
  id: string
  user_id: string
  name: string
  description: string | null
  contact_count: number
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  user_id: string
  list_id: string
  email: string
  first_name: string | null
  last_name: string | null
  company: string | null
  phone: string | null
  tags: string
  custom_fields: string
  status: 'active' | 'unsubscribed' | 'bounced' | 'complained'
  engagement_score: number
  source: string | null
  created_at: string
  updated_at: string
}

export interface ContactInput {
  email: string
  first_name?: string
  last_name?: string
  company?: string
  phone?: string
  tags?: string[]
  custom_fields?: Record<string, string>
  status?: string
  source?: string
}

export interface ImportResult {
  total: number
  imported: number
  duplicates: number
  invalid: number
  errors: { row: number; email: string; reason: string }[]
}

export interface ImportHistory {
  id: string
  list_id: string
  filename: string
  format: string
  total_rows: number
  imported: number
  duplicates: number
  invalid: number
  created_at: string
}

export interface ValidationResult {
  email: string
  valid: boolean
  score: number
  checks: { syntax: boolean; mx: boolean; disposable: boolean; suppressed: boolean }
  reason?: string
}

export interface BulkValidationResult {
  total: number
  valid: number
  invalid: number
  risky: number
  suppressed: number
  results: ValidationResult[]
}

export interface DuplicateGroup {
  email: string
  count: number
  ids: string[]
  lists: string[]
}

export interface TimelineEvent {
  id: string
  type: string
  description: string
  metadata: Record<string, unknown> | null
  created_at: string
}

// ============================================================================
// Contacts API
// ============================================================================

export const contactsApi = {
  // Lists
  getLists: async (): Promise<ContactList[]> => {
    const res = await api.get<{ lists: ContactList[] }>('/contacts/lists')
    if (!res.success) throw new Error(res.message || 'Failed to load lists')
    return res.data?.lists || []
  },

  createList: async (name: string, description?: string): Promise<ContactList> => {
    const res = await api.post<ContactList>('/contacts/lists', { name, description })
    if (!res.success) throw new Error(res.message || 'Failed to create list')
    return res.data!
  },

  updateList: async (id: string, name: string, description?: string) => {
    const res = await api.put(`/contacts/lists/${id}`, { name, description })
    if (!res.success) throw new Error(res.message || 'Failed to update list')
  },

  deleteList: async (id: string) => {
    const res = await api.delete(`/contacts/lists/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete list')
  },

  // Contacts
  getContacts: async (
    listId: string,
    params?: {
      search?: string
      status?: string
      tags?: string
      page?: number
      limit?: number
      sort_by?: string
      sort_order?: 'asc' | 'desc'
    }
  ): Promise<{ contacts: Contact[]; pagination: Pagination }> => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          qs.set(key, String(value))
        }
      })
    }
    const res = await api.get<Contact[]>(`/contacts/${listId}?${qs}`)
    return {
      contacts: (res as any).data || [],
      pagination: (res as any).meta?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 },
    }
  },

  addContact: async (listId: string, contact: ContactInput): Promise<Contact> => {
    const res = await api.post<Contact>(`/contacts/${listId}`, contact)
    if (!res.success) throw new Error(res.message || 'Failed to add contact')
    return res.data!
  },

  updateContact: async (id: string, updates: Partial<ContactInput>) => {
    const res = await api.put(`/contacts/item/${id}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update contact')
  },

  // Bulk
  bulkDelete: async (ids: string[]): Promise<number> => {
    const res = await api.post<{ deleted: number }>('/contacts/bulk/delete', { ids })
    if (!res.success) throw new Error(res.message || 'Failed to delete contacts')
    return res.data?.deleted || 0
  },

  bulkTag: async (ids: string[], tags: string[]): Promise<number> => {
    const res = await api.post<{ updated: number }>('/contacts/bulk/tag', { ids, tags })
    if (!res.success) throw new Error(res.message || 'Failed to tag contacts')
    return res.data?.updated || 0
  },

  bulkMove: async (ids: string[], targetListId: string): Promise<number> => {
    const res = await api.post<{ moved: number }>('/contacts/bulk/move', { ids, target_list_id: targetListId })
    if (!res.success) throw new Error(res.message || 'Failed to move contacts')
    return res.data?.moved || 0
  },

  // Search
  search: async (q: string): Promise<Contact[]> => {
    const res = await api.get<{ contacts: Contact[] }>(`/contacts/search?q=${encodeURIComponent(q)}`)
    return res.data?.contacts || []
  },

  // Import
  importContacts: async (
    listId: string,
    file: File,
    fieldMapping?: Record<string, string>,
    skipDuplicates = true
  ): Promise<ImportResult> => {
    const formData = new FormData()
    formData.append('file', file)
    if (fieldMapping) formData.append('fieldMapping', JSON.stringify(fieldMapping))
    formData.append('skipDuplicates', String(skipDuplicates))
    const res = await api.upload<ImportResult>(`/contacts/${listId}/import`, formData)
    if (!res.success) throw new Error(res.message || 'Failed to import contacts')
    return res.data!
  },

  getImportHistory: async (): Promise<ImportHistory[]> => {
    const res = await api.get<{ history: ImportHistory[] }>('/contacts/import-history')
    return res.data?.history || []
  },

  // Validation
  validateEmails: async (emails: string[]): Promise<BulkValidationResult> => {
    const res = await api.post<BulkValidationResult>('/contacts/validate', { emails })
    if (!res.success) throw new Error(res.message || 'Validation failed')
    return res.data!
  },

  validateSingle: async (email: string): Promise<ValidationResult> => {
    const res = await api.post<ValidationResult>('/contacts/validate-single', { email })
    if (!res.success) throw new Error(res.message || 'Validation failed')
    return res.data!
  },

  // Duplicates
  findDuplicates: async (): Promise<DuplicateGroup[]> => {
    const res = await api.get<{ duplicates: DuplicateGroup[]; total: number }>('/contacts/duplicates')
    return res.data?.duplicates || []
  },

  mergeContacts: async (primaryId: string, mergeIds: string[]) => {
    const res = await api.post('/contacts/merge', { primary_id: primaryId, merge_ids: mergeIds })
    if (!res.success) throw new Error(res.message || 'Merge failed')
  },

  // Timeline
  getTimeline: async (contactId: string, limit = 50): Promise<TimelineEvent[]> => {
    const res = await api.get<{ timeline: TimelineEvent[] }>(`/contacts/timeline/${contactId}?limit=${limit}`)
    return res.data?.timeline || []
  },

  // Preferences
  getPreferences: async (contactId: string): Promise<ContactPreference> => {
    const res = await api.get<ContactPreference>(`/contacts/preferences/${contactId}`)
    return res.data || { preference: 'subscribed', details: null, canReceiveMarketing: true }
  },

  setPreferences: async (contactId: string, preference: string, reason?: string, pauseDays?: number) => {
    const res = await api.put(`/contacts/preferences/${contactId}`, { preference, reason, pause_days: pauseDays })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  getPreferenceStats: async (): Promise<Record<string, number>> => {
    const res = await api.get<{ stats: Record<string, number> }>('/contacts/preferences')
    return res.data?.stats || {}
  },
}

export interface ContactPreference {
  preference: string
  details: any
  canReceiveMarketing: boolean
}
