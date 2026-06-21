import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { contactsApi } from '../../src/lib/api/contacts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('contactsApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('getLists gets /api/v1/contacts/lists and returns lists', async () => {
    const lists = [{ id: 'l1', name: 'Main' }]
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { lists } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await contactsApi.getLists()
    expect(out).toEqual(lists)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/contacts/lists')
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('createList posts to /api/v1/contacts/lists with CSRF and returns data', async () => {
    const list = { id: 'l2', name: 'New' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: list }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await contactsApi.createList('New', 'desc')
    expect(out).toEqual(list)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/contacts/lists')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('getContacts reads data + meta.pagination from the paginated envelope', async () => {
    const contacts = [{ id: 'c1', email: 'a@b.c' }]
    const pagination = { page: 2, limit: 25, total: 30, totalPages: 2, hasMore: false }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: contacts, meta: { pagination } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await contactsApi.getContacts('list-9', { page: 2, limit: 25 })
    expect(out.contacts).toEqual(contacts)
    expect(out.pagination).toEqual(pagination)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/contacts/list-9')
  })

  it('bulkDelete posts to /api/v1/contacts/bulk/delete and returns the count', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { deleted: 4 } }))
    vi.stubGlobal('fetch', fetchMock)
    const n = await contactsApi.bulkDelete(['a', 'b', 'c', 'd'])
    expect(n).toBe(4)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/contacts/bulk/delete')
    expect(init?.method).toBe('POST')
  })

  it('importContacts posts multipart FormData to /api/v1/contacts/:id/import', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { imported: 2, duplicates: 0, invalid: 0, total: 2, errors: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['email\na@b.c'], 'contacts.csv', { type: 'text/csv' })
    const out = await contactsApi.importContacts('list-7', file)
    expect(out.imported).toBe(2)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/contacts/list-7/import')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
  })

  it('createList throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'nope' }, 400)))
    await expect(contactsApi.createList('x')).rejects.toThrow(/nope/)
  })
})
