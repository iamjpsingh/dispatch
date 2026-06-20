import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { pagesApi } from '../../src/lib/api/pages'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('pagesApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('list gets /api/v1/pages and returns pages array', async () => {
    const pages = [{ id: 'p1', title: 'Home' }]
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { pages } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await pagesApi.list()
    expect(out).toEqual(pages)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/pages')
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('get fetches /api/v1/pages/:id and returns data', async () => {
    const page = { id: 'p9', title: 'Landing' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: page }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await pagesApi.get('p9')
    expect(out).toEqual(page)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/pages/p9')
  })

  it('create posts to /api/v1/pages with CSRF and returns data', async () => {
    const page = { id: 'new', title: 'N' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: page }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await pagesApi.create({ title: 'N', slug: 'n', html_content: '<p>hi</p>' })
    expect(out).toEqual(page)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/pages')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('delete deletes /api/v1/pages/:id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)
    await pagesApi.delete('p7')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/pages/p7')
    expect(init?.method).toBe('DELETE')
  })

  it('publish posts to /api/v1/pages/:id/publish and returns url', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { url: '/p/slug' } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await pagesApi.publish('p3')
    expect(out).toBe('/p/slug')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/pages/p3/publish')
    expect(init?.method).toBe('POST')
  })

  it('create throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'nope' }, 400)))
    await expect(pagesApi.create({ title: 'x', slug: 'y', html_content: 'z' })).rejects.toThrow(/nope/)
  })
})
