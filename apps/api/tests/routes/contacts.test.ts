import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock dependencies before importing routes
vi.mock('../../src/services/contactService', () => ({
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
    searchContacts: vi.fn(),
    importContacts: vi.fn(),
    recordImport: vi.fn(),
    getImportHistory: vi.fn(),
  },
}))

vi.mock('../../src/services/validationService', () => ({
  validationService: {
    validateBulk: vi.fn(),
    validateEmail: vi.fn(),
  },
}))

vi.mock('../../src/services/fileService', () => ({
  FileService: {},
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

// Bypass RBAC permission gates in route-handler unit tests.
vi.mock('../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))

import { contactService } from '../../src/services/contactService'
import { validationService } from '../../src/services/validationService'
import contactRoutes from '../../src/routes/contacts'

const TEST_USER = { id: 'user-1', email: 'test@test.com', name: 'Test User' }

function createApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = TEST_USER as any
    c.set('orgId', 'org-1')
    await next()
  })
  app.route('/', contactRoutes)
  app.onError((err: any, c) => {
    if (err?.name === 'AppError' && 'status' in err) {
      return c.json({ success: false, message: err.message }, err.status)
    }
    return c.json({ success: false, message: 'Internal Server Error' }, 500)
  })
  return app
}

function jsonRequest(method: string, path: string, body?: object) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) init.body = JSON.stringify(body)
  return new Request(`http://localhost${path}`, init)
}

describe('Contacts Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Contact Lists
  // ==========================================================================
  describe('POST /contacts/lists', () => {
    it('creates a contact list', async () => {
      const app = createApp()
      const mockList = { id: 'list-1', name: 'My List', description: '' }
      vi.mocked(contactService.createList).mockReturnValue(mockList)

      const res = await app.fetch(
        jsonRequest('POST', '/contacts/lists', {
          name: 'My List',
          description: 'A test list',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('list-1')
    })

    it('returns 400 when name is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/lists', { description: 'no name' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('name')
    })

    it('returns 400 when name is empty string', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/lists', { name: '   ' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('GET /contacts/lists', () => {
    it('returns contact lists', async () => {
      const app = createApp()
      vi.mocked(contactService.getLists).mockReturnValue([
        { id: 'list-1', name: 'List A' },
        { id: 'list-2', name: 'List B' },
      ])

      const res = await app.fetch(new Request('http://localhost/contacts/lists'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.lists).toHaveLength(2)
    })
  })

  describe('PUT /contacts/lists/:id', () => {
    it('updates a contact list', async () => {
      const app = createApp()
      vi.mocked(contactService.updateList).mockReturnValue(true)

      const res = await app.fetch(jsonRequest('PUT', '/contacts/lists/list-1', { name: 'Updated' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('updated')
    })

    it('returns 404 when list not found', async () => {
      const app = createApp()
      vi.mocked(contactService.updateList).mockReturnValue(false)

      const res = await app.fetch(jsonRequest('PUT', '/contacts/lists/nonexistent', { name: 'Updated' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('DELETE /contacts/lists/:id', () => {
    it('deletes a contact list', async () => {
      const app = createApp()
      vi.mocked(contactService.deleteList).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/contacts/lists/list-1', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('returns 404 when list not found', async () => {
      const app = createApp()
      vi.mocked(contactService.deleteList).mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/contacts/lists/nonexistent', { method: 'DELETE' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // Contacts CRUD
  // ==========================================================================
  describe('GET /contacts/:listId', () => {
    it('returns contacts in a list with pagination', async () => {
      const app = createApp()
      vi.mocked(contactService.getContacts).mockReturnValue({
        contacts: [{ id: 'c1', email: 'alice@example.com' }],
        total: 1,
      })

      const res = await app.fetch(new Request('http://localhost/contacts/list-1?page=1&limit=25'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.meta.pagination.total).toBe(1)
      expect(body.meta.pagination.page).toBe(1)
    })

    it('passes filter params to service', async () => {
      const app = createApp()
      vi.mocked(contactService.getContacts).mockReturnValue({
        contacts: [],
        total: 0,
      })

      await app.fetch(
        new Request('http://localhost/contacts/list-1?search=alice&status=active&sort_by=email&sort_order=asc')
      )

      expect(contactService.getContacts).toHaveBeenCalledWith(
        'org-1',
        'list-1',
        expect.objectContaining({
          search: 'alice',
          status: 'active',
          sort_by: 'email',
          sort_order: 'asc',
        })
      )
    })
  })

  describe('POST /contacts/:listId', () => {
    it('adds a contact to a list', async () => {
      const app = createApp()
      const mockContact = { id: 'c1', email: 'alice@example.com', first_name: 'Alice' }
      vi.mocked(contactService.addContact).mockReturnValue(mockContact)

      const res = await app.fetch(
        jsonRequest('POST', '/contacts/list-1', {
          email: 'alice@example.com',
          first_name: 'Alice',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.email).toBe('alice@example.com')
    })

    it('returns 400 when email is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/list-1', { first_name: 'Alice' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('email')
    })

    it('returns 409 for duplicate email', async () => {
      const app = createApp()
      vi.mocked(contactService.addContact).mockImplementation(() => {
        throw new Error('UNIQUE constraint failed')
      })

      const res = await app.fetch(jsonRequest('POST', '/contacts/list-1', { email: 'dup@example.com' }))

      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('already exists')
    })
  })

  describe('PUT /contacts/item/:id', () => {
    it('updates a contact', async () => {
      const app = createApp()
      vi.mocked(contactService.updateContact).mockReturnValue(true)

      const res = await app.fetch(jsonRequest('PUT', '/contacts/item/c1', { first_name: 'Updated' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('returns 404 when contact not found', async () => {
      const app = createApp()
      vi.mocked(contactService.updateContact).mockReturnValue(false)

      const res = await app.fetch(jsonRequest('PUT', '/contacts/item/nonexistent', { first_name: 'X' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================
  describe('POST /contacts/bulk/delete', () => {
    it('bulk deletes contacts', async () => {
      const app = createApp()
      vi.mocked(contactService.deleteContacts).mockReturnValue(3)

      const res = await app.fetch(
        jsonRequest('POST', '/contacts/bulk/delete', {
          ids: ['c1', 'c2', 'c3'],
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.deleted).toBe(3)
    })

    it('returns 400 when ids are missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/bulk/delete', {}))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when ids is empty', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/bulk/delete', { ids: [] }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /contacts/bulk/tag', () => {
    it('tags contacts', async () => {
      const app = createApp()
      vi.mocked(contactService.tagContacts).mockReturnValue(2)

      const res = await app.fetch(
        jsonRequest('POST', '/contacts/bulk/tag', {
          ids: ['c1', 'c2'],
          tags: ['vip'],
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.updated).toBe(2)
    })

    it('returns 400 when ids or tags are missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/bulk/tag', { ids: ['c1'] }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /contacts/bulk/move', () => {
    it('moves contacts to another list', async () => {
      const app = createApp()
      vi.mocked(contactService.moveContacts).mockReturnValue(2)

      const res = await app.fetch(
        jsonRequest('POST', '/contacts/bulk/move', {
          ids: ['c1', 'c2'],
          target_list_id: 'list-2',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.moved).toBe(2)
    })

    it('returns 400 when target_list_id is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/bulk/move', { ids: ['c1'] }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // Search
  // ==========================================================================
  describe('GET /contacts/search', () => {
    it('returns search results', async () => {
      const app = createApp()
      vi.mocked(contactService.searchContacts).mockReturnValue([{ id: 'c1', email: 'alice@example.com' }])

      const res = await app.fetch(new Request('http://localhost/contacts/search?q=alice'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.contacts).toHaveLength(1)
    })

    it('returns empty results for short query', async () => {
      const app = createApp()

      const res = await app.fetch(new Request('http://localhost/contacts/search?q=a'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.contacts).toEqual([])
      expect(contactService.searchContacts).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Validation
  // ==========================================================================
  describe('POST /contacts/validate', () => {
    it('validates a batch of emails', async () => {
      const app = createApp()
      const mockResult = {
        results: [
          { email: 'a@b.com', valid: true },
          { email: 'bad', valid: false },
        ],
        valid: 1,
        invalid: 1,
      }
      vi.mocked(validationService.validateBulk).mockResolvedValue(mockResult)

      const res = await app.fetch(
        jsonRequest('POST', '/contacts/validate', {
          emails: ['a@b.com', 'bad'],
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.valid).toBe(1)
    })

    it('returns 400 when emails array is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/validate', {}))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when emails is empty', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/validate', { emails: [] }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /contacts/validate-single', () => {
    it('validates a single email', async () => {
      const app = createApp()
      vi.mocked(validationService.validateEmail).mockResolvedValue({
        email: 'test@example.com',
        valid: true,
      })

      const res = await app.fetch(
        jsonRequest('POST', '/contacts/validate-single', {
          email: 'test@example.com',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.valid).toBe(true)
    })

    it('returns 400 when email is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/contacts/validate-single', {}))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // Import History
  // ==========================================================================
  describe('GET /contacts/import-history', () => {
    it('returns import history', async () => {
      const app = createApp()
      vi.mocked(contactService.getImportHistory).mockReturnValue([
        { id: 'imp-1', filename: 'contacts.csv', imported: 100 },
      ])

      const res = await app.fetch(new Request('http://localhost/contacts/import-history'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.history).toHaveLength(1)
    })
  })
})
