/**
 * Contacts API
 */
import { hc } from 'hono/client'
import type { ContactsRoutes } from '@dispatch/api/src/routes/contacts'
import { type Pagination } from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<ContactsRoutes>(rpcBase(), { fetch: rpcFetch })

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
    const res = await client.contacts.lists.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load lists')
    return (body.data as { lists: ContactList[] } | undefined)?.lists || []
  },

  createList: async (name: string, description?: string): Promise<ContactList> => {
    const res = await client.contacts.lists.$post({ json: { name, description } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create list')
    return body.data as ContactList
  },

  updateList: async (id: string, name: string, description?: string) => {
    const res = await client.contacts.lists[':id'].$put({ param: { id }, json: { name, description } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update list')
  },

  deleteList: async (id: string) => {
    const res = await client.contacts.lists[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete list')
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
    const query: Record<string, string> = {}
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          query[key] = String(value)
        }
      })
    }
    const res = await client.contacts[':listId'].$get({ param: { listId }, query })
    const body = await res.json()
    return {
      contacts: (body.data as Contact[] | undefined) || [],
      pagination: (body.meta?.pagination as Pagination | undefined) || { page: 1, limit: 50, total: 0, totalPages: 0 },
    }
  },

  addContact: async (listId: string, contact: ContactInput): Promise<Contact> => {
    const res = await client.contacts[':listId'].$post({ param: { listId }, json: contact })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to add contact')
    return body.data as Contact
  },

  updateContact: async (id: string, updates: Partial<ContactInput>) => {
    const res = await client.contacts.item[':id'].$put({ param: { id }, json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update contact')
  },

  // Bulk
  bulkDelete: async (ids: string[]): Promise<number> => {
    const res = await client.contacts.bulk.delete.$post({ json: { ids } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete contacts')
    return (body.data as { deleted: number } | undefined)?.deleted || 0
  },

  bulkTag: async (ids: string[], tags: string[]): Promise<number> => {
    const res = await client.contacts.bulk.tag.$post({ json: { ids, tags } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to tag contacts')
    return (body.data as { updated: number } | undefined)?.updated || 0
  },

  bulkMove: async (ids: string[], targetListId: string): Promise<number> => {
    const res = await client.contacts.bulk.move.$post({ json: { ids, target_list_id: targetListId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to move contacts')
    return (body.data as { moved: number } | undefined)?.moved || 0
  },

  // Search
  search: async (q: string): Promise<Contact[]> => {
    const res = await client.contacts.search.$get({ query: { q } })
    const body = await res.json()
    return (body.data as { contacts: Contact[] } | undefined)?.contacts || []
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
    const res = await rpcFetch(`${rpcBase()}/contacts/${listId}/import`, { method: 'POST', body: formData })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to import contacts')
    return body.data as ImportResult
  },

  getImportHistory: async (): Promise<ImportHistory[]> => {
    const res = await client.contacts['import-history'].$get()
    const body = await res.json()
    return (body.data as { history: ImportHistory[] } | undefined)?.history || []
  },

  // Validation
  validateEmails: async (emails: string[]): Promise<BulkValidationResult> => {
    const res = await client.contacts.validate.$post({ json: { emails } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Validation failed')
    return body.data as BulkValidationResult
  },

  validateSingle: async (email: string): Promise<ValidationResult> => {
    const res = await client.contacts['validate-single'].$post({ json: { email } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Validation failed')
    return body.data as ValidationResult
  },

  // Duplicates
  findDuplicates: async (): Promise<DuplicateGroup[]> => {
    const res = await client.contacts.duplicates.$get()
    const body = await res.json()
    return (body.data as { duplicates: DuplicateGroup[]; total: number } | undefined)?.duplicates || []
  },

  mergeContacts: async (primaryId: string, mergeIds: string[]) => {
    const res = await client.contacts.merge.$post({ json: { primary_id: primaryId, merge_ids: mergeIds } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Merge failed')
  },

  // Timeline
  getTimeline: async (contactId: string, limit = 50): Promise<TimelineEvent[]> => {
    const res = await client.contacts.timeline[':contactId'].$get({ param: { contactId }, query: { limit: String(limit) } })
    const body = await res.json()
    return (body.data as { timeline: TimelineEvent[] } | undefined)?.timeline || []
  },

  // Preferences
  getPreferences: async (contactId: string): Promise<ContactPreference> => {
    const res = await client.contacts.preferences[':contactId'].$get({ param: { contactId } })
    const body = await res.json()
    return (body.data as ContactPreference | undefined) || { preference: 'subscribed', details: null, canReceiveMarketing: true }
  },

  setPreferences: async (contactId: string, preference: string, reason?: string, pauseDays?: number) => {
    const res = await client.contacts.preferences[':contactId'].$put({ param: { contactId }, json: { preference: preference as ContactPreferenceValue, reason, pause_days: pauseDays } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  getPreferenceStats: async (): Promise<Record<string, number>> => {
    const res = await client.contacts.preferences.$get()
    const body = await res.json()
    return (body.data as { stats: Record<string, number> } | undefined)?.stats || {}
  },
}

type ContactPreferenceValue = 'subscribed' | 'campaign_only' | 'digest_weekly' | 'digest_monthly' | 'paused' | 'unsubscribed'

export interface ContactPreference {
  preference: string
  details: any
  canReceiveMarketing: boolean
}
