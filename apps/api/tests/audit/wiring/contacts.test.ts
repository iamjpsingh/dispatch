// Behavioral spot-tests — contacts routes fire the right audit/activity action on the
// success path for lists, bulk-delete, and import (audit-only).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))
vi.mock('../../../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))

vi.mock('../../../src/services/contactService', () => ({
  contactService: {
    createList: vi.fn(),
    getLists: vi.fn(),
    updateList: vi.fn(),
    deleteList: vi.fn(),
    getContacts: vi.fn(),
    addContact: vi.fn(),
    updateContact: vi.fn(),
    deleteContacts: vi.fn(),
    tagContacts: vi.fn(),
    moveContacts: vi.fn(),
    mergeContacts: vi.fn(),
    searchContacts: vi.fn(),
    importContacts: vi.fn(),
    recordImport: vi.fn(),
    getImportHistory: vi.fn(),
    getContact: vi.fn(),
  },
}))
vi.mock('../../../src/services/validationService', () => ({
  validationService: { validateBulk: vi.fn(), validateEmail: vi.fn() },
}))
vi.mock('../../../src/services/scoringEngine', () => ({
  scoringEngine: { getContactEvents: vi.fn() },
}))
vi.mock('../../../src/services/preferenceCenterService', () => ({
  preferenceCenterService: {
    getStats: vi.fn(),
    getEffectivePreference: vi.fn(),
    setPreference: vi.fn(),
    pause: vi.fn(),
    getPreference: vi.fn(),
    canReceive: vi.fn(),
  },
}))
vi.mock('../../../src/services/fileService', () => ({
  FileService: { parseExcelBuffer: vi.fn() },
}))
vi.mock('../../../src/services/storageService', () => ({
  storageService: { put: vi.fn(), getSignedDownloadUrl: vi.fn() },
}))

import { auditService } from '../../../src/services/auditService'
import { contactService } from '../../../src/services/contactService'
import { FileService } from '../../../src/services/fileService'
import { storageService } from '../../../src/services/storageService'
import contactsRoutes from '../../../src/routes/contacts'

function appFor() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = { id: 'u1', email: 'u@t.co' } as any
    c.set('orgId', 'org1')
    await next()
  })
  app.route('/', contactsRoutes)
  app.onError((_e, c) => c.json({ success: false }, 500))
  return app
}

const json = (m: string, p: string, b?: object) =>
  new Request(`http://localhost${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  })

describe('contacts audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(auditService, 'log').mockResolvedValue()
    vi.spyOn(auditService, 'logActivity').mockResolvedValue()
  })

  it('lists POST fires list.created (audit) + list.created (activity)', async () => {
    vi.mocked(contactService.createList).mockResolvedValue({ id: 'list-1', name: 'VIPs' } as any)

    const res = await appFor().fetch(json('POST', '/contacts/lists', { name: 'VIPs' }))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'list.created', entityType: 'list', entityId: 'list-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'list.created', entityType: 'list', entityId: 'list-1' })
    )
  })

  it('bulk/delete fires contacts.deleted with metadata.count matching the deleted count', async () => {
    vi.mocked(contactService.deleteContacts).mockResolvedValue(3 as any)

    const res = await appFor().fetch(json('POST', '/contacts/bulk/delete', { ids: ['c1', 'c2', 'c3'] }))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contacts.deleted', entityType: 'contact', metadata: { count: 3 } })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contact.deleted', entityType: 'contact', metadata: { count: 3 } })
    )
  })

  it('import fires contacts.imported (audit only) with the imported count in metadata', async () => {
    vi.mocked(FileService.parseExcelBuffer).mockResolvedValue([{ email: 'a@example.com' }] as any)
    vi.mocked(contactService.importContacts).mockResolvedValue({ total: 1, imported: 1, duplicates: 0, invalid: 0, errors: [] } as any)
    vi.mocked(contactService.recordImport).mockResolvedValue(undefined as any)
    vi.mocked(storageService.put).mockResolvedValue(undefined as any)

    const formData = new FormData()
    formData.append('file', new File(['email\na@example.com'], 'contacts.csv', { type: 'text/csv' }))

    const res = await appFor().fetch(
      new Request('http://localhost/contacts/list-1/import', { method: 'POST', body: formData })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contacts.imported',
        entityType: 'contact',
        entityId: 'list-1',
        metadata: { imported: 1, listId: 'list-1' },
      })
    )
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })
})
