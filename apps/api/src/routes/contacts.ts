// src/routes/contacts.ts - Contact Management API

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import {
  CreateListSchema,
  UpdateListSchema,
  AddContactSchema,
  MergeSchema,
  ValidateBulkSchema,
  ValidateSingleSchema,
  BulkDeleteSchema,
  BulkTagSchema,
  BulkMoveSchema,
  PreferenceSchema,
  ContactsQuerySchema,
  TimelineQuerySchema,
} from '@dispatch/shared/contacts'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { contactService } from '../services/contactService'
import { validationService } from '../services/validationService'
import { scoringEngine } from '../services/scoringEngine'
import { preferenceCenterService, type PreferenceType } from '../services/preferenceCenterService'
import { FileService } from '../services/fileService'
import { storageService } from '../services/storageService'
import { success, error } from '../utils/response'
import { logger } from '../utils/logger'

const contactsRoutes = new Hono()
  // ==========================================================================
  // Contact Lists
  // ==========================================================================
  .post('/contacts/lists', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', CreateListSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const { name, description } = c.req.valid('json')

    const list = await contactService.createList(orgId, user.id, name.trim(), description)
    return success(c, list, 'Contact list created')
  })
  .get('/contacts/lists', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const lists = await contactService.getLists(orgId)
    return success(c, { lists })
  })
  .put('/contacts/lists/:id', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', UpdateListSchema), async (c) => {
    const orgId = getOrgId(c)
    const listId = c.req.param('id')
    const body = c.req.valid('json')

    const updated = await contactService.updateList(orgId, listId, body.name, body.description)
    if (!updated) return error(c, 'List not found', 404)
    return success(c, undefined, 'List updated')
  })
  .delete('/contacts/lists/:id', requirePermission(PERMISSIONS.CONTACTS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const listId = c.req.param('id')

    const deleted = await contactService.deleteList(orgId, listId)
    if (!deleted) return error(c, 'List not found', 404)
    return success(c, undefined, 'List deleted')
  })
  // ==========================================================================
  // Search (must be before :listId param route)
  // ==========================================================================
  .get('/contacts/search', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const q = c.req.query('q') || ''

    if (q.length < 2) {
      return success(c, { contacts: [] })
    }

    const contacts = await contactService.searchContacts(orgId, q)
    return success(c, { contacts })
  })
  // ==========================================================================
  // Import History (must be before :listId param route)
  // ==========================================================================
  .get('/contacts/import-history', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const history = await contactService.getImportHistory(orgId)
    return success(c, { history })
  })
  // ==========================================================================
  // Deduplication (must be before :listId param route)
  // ==========================================================================
  .get('/contacts/duplicates', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const duplicates = await contactService.findDuplicates(orgId)
    return success(c, { duplicates, total: duplicates.length })
  })
  .post('/contacts/merge', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', MergeSchema), async (c) => {
    const orgId = getOrgId(c)
    const { primary_id, merge_ids } = c.req.valid('json')

    const merged = await contactService.mergeContacts(orgId, primary_id, merge_ids)
    if (!merged) return error(c, 'Merge failed — contact not found', 404)
    return success(c, undefined, `Merged ${merge_ids.length} contact(s) into primary`)
  })
  // ==========================================================================
  // Validation (must be before :listId param route)
  // ==========================================================================
  .post('/contacts/validate', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', ValidateBulkSchema), async (c) => {
    const orgId = getOrgId(c)
    const { emails } = c.req.valid('json')

    const result = await validationService.validateBulk(emails, orgId)
    return success(c, result)
  })
  .post('/contacts/validate-single', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', ValidateSingleSchema), async (c) => {
    const orgId = getOrgId(c)
    const { email } = c.req.valid('json')

    const result = await validationService.validateEmail(email, orgId)
    return success(c, result)
  })
  // ==========================================================================
  // Bulk Operations (must be before :listId param route)
  // ==========================================================================
  .post('/contacts/bulk/delete', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', BulkDeleteSchema), async (c) => {
    const orgId = getOrgId(c)
    const { ids } = c.req.valid('json')

    const deleted = await contactService.deleteContacts(orgId, ids)
    return success(c, { deleted }, `${deleted} contact(s) deleted`)
  })
  .post('/contacts/bulk/tag', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', BulkTagSchema), async (c) => {
    const orgId = getOrgId(c)
    const { ids, tags } = c.req.valid('json')

    const updated = await contactService.tagContacts(orgId, ids, tags)
    return success(c, { updated }, `${updated} contact(s) tagged`)
  })
  .post('/contacts/bulk/move', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', BulkMoveSchema), async (c) => {
    const orgId = getOrgId(c)
    const { ids, target_list_id } = c.req.valid('json')

    const moved = await contactService.moveContacts(orgId, ids, target_list_id)
    return success(c, { moved }, `${moved} contact(s) moved`)
  })
  // ==========================================================================
  // Preference Center (specific routes before :contactId / :listId params)
  // ==========================================================================
  /** Get preference stats for the org */
  .get('/contacts/preferences', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const stats = await preferenceCenterService.getStats(orgId)
    return success(c, { stats })
  })
  /** Public: preference center page data (for tracking worker to call) */
  .get('/contacts/preferences/public/:email', async (c) => {
    // This is called by the tracking worker when a contact visits the preference page.
    // No auth required — email is the identifier.
    const email = c.req.param('email')
    const orgId = c.req.query('org') || ''
    if (!orgId || !email) return error(c, 'Missing parameters', 400)

    const pref = await preferenceCenterService.getEffectivePreference(orgId, email)
    return success(c, { email, preference: pref })
  })
  /** Public: update preference from tracking worker */
  .post('/contacts/preferences/public/:email', async (c) => {
    const email = c.req.param('email')
    const body = await c.req.json() as { org: string; preference: string; reason?: string; pause_days?: number }
    if (!body.org || !email) return error(c, 'Missing parameters', 400)

    const validPrefs = ['subscribed', 'campaign_only', 'digest_weekly', 'digest_monthly', 'paused', 'unsubscribed']
    if (!validPrefs.includes(body.preference)) return error(c, 'Invalid preference', 400)

    if (body.preference === 'paused') {
      await preferenceCenterService.pause(body.org, email, body.pause_days || 30)
    } else {
      await preferenceCenterService.setPreference(body.org, email, body.preference as PreferenceType, body.reason)
    }

    return success(c, undefined, 'Preference updated')
  })
  /** Get email preferences for a contact */
  .get('/contacts/preferences/:contactId', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const contactId = c.req.param('contactId')

    const contact = await contactService.getContact(orgId, contactId)
    if (!contact) return error(c, 'Contact not found', 404)

    const pref = await preferenceCenterService.getPreference(orgId, contact.email)
    const effective = await preferenceCenterService.getEffectivePreference(orgId, contact.email)

    return success(c, {
      preference: effective,
      details: pref,
      canReceiveMarketing: await preferenceCenterService.canReceive(orgId, contact.email, 'marketing'),
    })
  })
  /** Update email preferences for a contact */
  .put('/contacts/preferences/:contactId', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', PreferenceSchema), async (c) => {
    const orgId = getOrgId(c)
    const contactId = c.req.param('contactId')
    const body = c.req.valid('json')

    const contact = await contactService.getContact(orgId, contactId)
    if (!contact) return error(c, 'Contact not found', 404)

    if (body.preference === 'paused') {
      await preferenceCenterService.pause(orgId, contact.email, body.pause_days || 30)
    } else {
      await preferenceCenterService.setPreference(orgId, contact.email, body.preference as PreferenceType, body.reason)
    }

    return success(c, undefined, `Preference updated to ${body.preference}`)
  })
  // ==========================================================================
  // Contact Activity Timeline (must be before :listId param route)
  // ==========================================================================
  .get('/contacts/timeline/:contactId', requirePermission(PERMISSIONS.CONTACTS_VIEW), zValidator('query', TimelineQuerySchema), async (c) => {
    const orgId = getOrgId(c)
    const contactId = c.req.param('contactId')
    const limit = parseInt(c.req.query('limit') || '50')

    // Get contact first to verify access
    const contact = await contactService.getContact(orgId, contactId)
    if (!contact) return error(c, 'Contact not found', 404)

    // Aggregate events from scoring engine
    const events = await scoringEngine.getContactEvents(contactId, limit)

    // Map to timeline format
    const timeline = events.map((e: any) => ({
      id: e.id,
      type: e.event_type,
      description: formatTimelineEvent(e.event_type, e.metadata),
      metadata: e.metadata ? JSON.parse(e.metadata) : null,
      created_at: e.created_at,
    }))

    return success(c, { timeline, contact: { id: contact.id, email: contact.email, first_name: contact.first_name } })
  })
  // ==========================================================================
  // Import (signed-URL download — specific route before :listId param)
  // ==========================================================================
  /** Signed-URL download of a stored import file (owner-scoped). */
  .get('/contacts/imports/:id/file', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const id = c.req.param('id')

    const row = await contactService.getImport(orgId, id)
    if (!row || !row.file_key) return error(c, 'Import file not found', 404)

    const url = await storageService.getSignedDownloadUrl(row.file_key)
    return success(c, { url })
  })
  // ==========================================================================
  // Contacts CRUD (parameterized routes after specific routes)
  // ==========================================================================
  .get('/contacts/:listId', requirePermission(PERMISSIONS.CONTACTS_VIEW), zValidator('query', ContactsQuerySchema), async (c) => {
    const orgId = getOrgId(c)
    const listId = c.req.param('listId')

    const filters = {
      search: c.req.query('search'),
      status: c.req.query('status'),
      tags: c.req.query('tags')?.split(',').filter(Boolean),
      page: parseInt(c.req.query('page') || '1'),
      limit: parseInt(c.req.query('limit') || '50'),
      sort_by: c.req.query('sort_by'),
      sort_order: c.req.query('sort_order') as 'asc' | 'desc' | undefined,
    }

    const { contacts, total } = await contactService.getContacts(orgId, listId, filters)
    const page = filters.page || 1
    const limit = filters.limit || 50

    return c.json({
      success: true,
      data: contacts,
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total,
        },
      },
    })
  })
  .post('/contacts/:listId', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', AddContactSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const listId = c.req.param('listId')

    const body = c.req.valid('json')

    try {
      const contact = await contactService.addContact(orgId, user.id, listId, body)
      return success(c, contact, 'Contact added')
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return error(c, 'Contact with this email already exists in this list', 409)
      }
      throw err
    }
  })
  .put('/contacts/item/:id', requirePermission(PERMISSIONS.CONTACTS_MANAGE), zValidator('json', AddContactSchema.partial()), async (c) => {
    const orgId = getOrgId(c)
    const contactId = c.req.param('id')
    const body = c.req.valid('json')

    const updated = await contactService.updateContact(orgId, contactId, body)
    if (!updated) return error(c, 'Contact not found', 404)
    return success(c, undefined, 'Contact updated')
  })
  // ==========================================================================
  // Import (multipart upload — reads FormData, NOT JSON)
  // ==========================================================================
  .post('/contacts/:listId/import', requirePermission(PERMISSIONS.CONTACTS_IMPORT), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const listId = c.req.param('listId')

    const formData = await c.req.formData()
    const file = formData.get('file') as File
    const fieldMappingRaw = formData.get('fieldMapping') as string
    const skipDuplicates = formData.get('skipDuplicates') !== 'false'

    if (!file || file.size === 0) {
      return error(c, 'File is required', 400)
    }

    // Parse field mapping
    let fieldMapping: Record<string, string>
    try {
      fieldMapping = fieldMappingRaw ? JSON.parse(fieldMappingRaw) : {}
    } catch {
      return error(c, 'Invalid field mapping JSON', 400)
    }

    // Parse file in memory (no disk write)
    const fileBytes = new Uint8Array(await file.arrayBuffer())

    let rows: Record<string, string>[]
    const ext = file.name.split('.').pop()?.toLowerCase()
    const format = ext === 'csv' ? 'csv' : 'excel'

    try {
      const contacts = await FileService.parseExcelBuffer(fileBytes)
      // Convert Contact[] to Record<string, string>[]
      rows = contacts.map((c) => {
        const row: Record<string, string> = {}
        for (const [key, value] of Object.entries(c)) {
          row[key] = String(value ?? '')
        }
        return row
      })
    } catch (err: any) {
      return error(c, `Failed to parse file: ${err.message}`, 400)
    }

    // Auto-detect field mapping if not provided
    if (Object.keys(fieldMapping).length === 0) {
      fieldMapping = autoDetectFieldMapping(rows[0] || {})
    }

    // Import
    const result = await contactService.importContacts(orgId, user.id, listId, rows, fieldMapping, {
      skipDuplicates,
      source: `import_${format}`,
    })

    // Persist the original upload to object storage (best-effort).
    let fileKey: string | null = null
    try {
      fileKey = `imports/${orgId}/${Date.now()}_${file.name}`
      await storageService.put(fileKey, fileBytes, file.type || 'application/octet-stream')
    } catch (err) {
      logger.error('Failed to persist import file:', err)
      fileKey = null
    }

    // Record history
    await contactService.recordImport(orgId, user.id, listId, file.name, format, result, fieldMapping, fileKey)

    return success(
      c,
      result,
      `Imported ${result.imported} contacts (${result.duplicates} duplicates, ${result.invalid} invalid)`
    )
  })

// ============================================================================
// Helpers
// ============================================================================

function formatTimelineEvent(type: string, metadataJson: string | null): string {
  const meta = metadataJson ? JSON.parse(metadataJson) : {}
  switch (type) {
    case 'email_sent': return `Email sent: ${meta.subject || 'Unknown'}`
    case 'email_opened': return `Opened email: ${meta.subject || 'Unknown'}`
    case 'link_clicked': return `Clicked link: ${meta.url || 'Unknown'}`
    case 'form_submitted': return `Submitted form: ${meta.form_name || 'Unknown'}`
    case 'tag_added': return `Tag added: ${meta.tag || 'Unknown'}`
    case 'tag_removed': return `Tag removed: ${meta.tag || 'Unknown'}`
    case 'score_changed': return `Score changed by ${meta.amount > 0 ? '+' : ''}${meta.amount || 0}`
    case 'automation_enrolled': return `Enrolled in automation: ${meta.automation_name || 'Unknown'}`
    case 'automation_completed': return `Completed automation: ${meta.automation_name || 'Unknown'}`
    case 'unsubscribed': return 'Unsubscribed from emails'
    case 'bounced': return `Email bounced: ${meta.reason || 'Unknown'}`
    default: return type.replace(/_/g, ' ')
  }
}

function autoDetectFieldMapping(firstRow: Record<string, string>): Record<string, string> {
  const mapping: Record<string, string> = {}
  const keys = Object.keys(firstRow)

  for (const key of keys) {
    const lower = key.toLowerCase().replace(/[_\-\s]/g, '')
    if (lower.includes('email') || lower === 'emailaddress') {
      mapping[key] = 'email'
    } else if (lower === 'firstname' || lower === 'first') {
      mapping[key] = 'first_name'
    } else if (lower === 'lastname' || lower === 'last' || lower === 'surname') {
      mapping[key] = 'last_name'
    } else if (lower === 'company' || lower === 'organization' || lower === 'org') {
      mapping[key] = 'company'
    } else if (lower === 'phone' || lower === 'telephone' || lower === 'mobile') {
      mapping[key] = 'phone'
    } else if (lower === 'name' || lower === 'fullname') {
      mapping[key] = 'first_name' // Will be split later if needed
    }
  }

  return mapping
}

export default contactsRoutes
export type ContactsRoutes = typeof contactsRoutes
