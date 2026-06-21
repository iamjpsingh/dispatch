import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { campaignsApi } from '../../src/lib/api/campaigns'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('campaignsApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('list reads data + meta.pagination from the paginated envelope', async () => {
    const campaigns = [{ id: 'c1', name: 'Launch' }]
    const pagination = { page: 2, limit: 20, total: 25, totalPages: 2, hasMore: false }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: campaigns, meta: { pagination } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await campaignsApi.list({ page: 2, status: 'sending' })
    expect(out.campaigns).toEqual(campaigns)
    expect(out.pagination).toEqual(pagination)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/campaigns')
    expect(String(url)).toContain('status=sending')
  })

  it('create posts to /api/v1/campaigns with CSRF and returns data', async () => {
    const campaign = { id: 'c2', name: 'New' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: campaign }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await campaignsApi.create({ name: 'New', subject: 'Hi', from_name: 'Me', from_email: 'me@x.co' })
    expect(out).toEqual(campaign)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/campaigns')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('get reads /api/v1/campaigns/:id and returns the campaign', async () => {
    const campaign = { id: 'c3', name: 'One' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: campaign }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await campaignsApi.get('c3')
    expect(out).toEqual(campaign)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/campaigns/c3')
  })

  it('launch posts to /api/v1/campaigns/:id/launch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { jobId: 'j1', recipientCount: 3 } }))
    vi.stubGlobal('fetch', fetchMock)
    await campaignsApi.launch('c4')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/campaigns/c4/launch')
    expect(init?.method).toBe('POST')
  })

  it('getFrequencyCap falls back to defaults when data is null', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: null }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await campaignsApi.getFrequencyCap()
    expect(out).toEqual({ maxPerWindow: 5, windowHours: 168, enabled: false })
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/campaigns/frequency-cap')
  })

  it('get throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'gone' }, 404)))
    await expect(campaignsApi.get('missing')).rejects.toThrow(/gone/)
  })
})
