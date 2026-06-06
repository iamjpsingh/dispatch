import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock fetch globally before importing api module
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { api } from '@/lib/api/client'

function createFetchResponse(body: unknown, options: { ok?: boolean; status?: number; contentType?: string } = {}) {
  const { ok = true, status = 200, contentType = 'application/json' } = options
  return Promise.resolve({
    ok,
    status,
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return contentType
        return null
      },
    },
    json: () => Promise.resolve(body),
  })
}

describe('ApiClient (client.ts)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('request method', () => {
    it('should include credentials: include in all requests', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.get('/test')

      const [, options] = mockFetch.mock.calls[0]
      expect(options.credentials).toBe('include')
    })
  })

  describe('CSRF token extraction', () => {
    it('should extract CSRF token from cookies for POST requests', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'session_token=abc; csrf_token=test-csrf-123',
      })

      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.post('/test', { data: 1 })

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['X-CSRF-Token']).toBe('test-csrf-123')
    })

    it('should not include CSRF token for GET requests', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'csrf_token=abc123',
      })

      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.get('/test')

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined()
    })

    it('should include CSRF token for PUT requests', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'csrf_token=put-token',
      })

      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.put('/test', { data: 1 })

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['X-CSRF-Token']).toBe('put-token')
    })

    it('should include CSRF token for DELETE requests', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'csrf_token=del-token',
      })

      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.delete('/test')

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['X-CSRF-Token']).toBe('del-token')
    })

    it('should handle missing CSRF token gracefully', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'session_token=abc',
      })

      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.post('/test', { data: 1 })

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should handle network errors and return error response', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'))

      const result = await api.get('/test')

      expect(result.success).toBe(false)
      expect(result.message).toBe('Network error - check if backend is running')
    })

    it('should handle HTTP errors with non-JSON content', async () => {
      mockFetch.mockReturnValue(createFetchResponse(null, { ok: false, status: 500, contentType: 'text/html' }))

      const result = await api.get('/test')

      expect(result.success).toBe(false)
      expect(result.message).toBe('HTTP Error: 500')
    })

    it('should handle 401 responses', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({ success: false, message: 'Unauthorized' }, { ok: false, status: 401 })
      )

      const result = await api.get('/protected')

      expect(result.success).toBe(false)
      expect(result.message).toBe('Unauthorized')
    })

    it('should handle 404 responses', async () => {
      mockFetch.mockReturnValue(createFetchResponse(null, { ok: false, status: 404, contentType: 'text/plain' }))

      const result = await api.get('/not-found')

      expect(result.success).toBe(false)
      expect(result.message).toBe('HTTP Error: 404')
    })

    it('should handle JSON parse errors', async () => {
      mockFetch.mockReturnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'application/json' : null),
          },
          json: () => Promise.reject(new SyntaxError('Unexpected token')),
        })
      )

      const result = await api.get('/bad-json')

      expect(result.success).toBe(false)
      expect(result.message).toBe('Network error - check if backend is running')
    })
  })

  describe('response normalization', () => {
    it('should pass through responses with data field', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: true,
          data: { users: [{ id: '1', name: 'Test' }] },
        })
      )

      const result = await api.get<{ users: any[] }>('/users')

      expect(result.success).toBe(true)
      expect(result.data?.users).toHaveLength(1)
    })

    it('should normalize legacy format (root-level data)', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: true,
          configs: [{ id: '1', name: 'Config' }],
        })
      )

      const result = await api.get<{ configs: any[] }>('/config/list')

      expect(result.success).toBe(true)
      expect(result.data?.configs).toHaveLength(1)
    })

    it('should preserve meta field in response', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: true,
          data: [],
          meta: {
            pagination: { page: 1, limit: 50, total: 100, totalPages: 2, hasMore: true },
          },
        })
      )

      const result = await api.get('/paginated')

      expect(result.meta?.pagination?.total).toBe(100)
      expect(result.meta?.pagination?.hasMore).toBe(true)
    })

    it('should handle legacy format with only success field', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      const result = await api.post('/action')

      expect(result.success).toBe(true)
      expect(result.data).toBeUndefined()
    })

    it('should handle legacy error format', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: false,
          message: 'Validation error',
          error: 'INVALID_INPUT',
        })
      )

      const result = await api.post('/validate', {})

      expect(result.success).toBe(false)
      expect(result.message).toBe('Validation error')
      expect(result.error).toBe('INVALID_INPUT')
    })
  })

  describe('HTTP methods', () => {
    it('should make GET requests with correct method', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.get('/endpoint')

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/endpoint')
      expect(options.method).toBe('GET')
    })

    it('should make POST requests with JSON body', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.post('/endpoint', { key: 'value' })

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/endpoint')
      expect(options.method).toBe('POST')
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect(options.body).toBe(JSON.stringify({ key: 'value' }))
    })

    it('should make POST requests without body', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.post('/endpoint')

      const [, options] = mockFetch.mock.calls[0]
      expect(options.method).toBe('POST')
      expect(options.body).toBeUndefined()
    })

    it('should make PUT requests with body', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.put('/endpoint/1', { name: 'Updated' })

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/endpoint/1')
      expect(options.method).toBe('PUT')
      expect(options.body).toBe(JSON.stringify({ name: 'Updated' }))
    })

    it('should make DELETE requests', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      await api.delete('/endpoint/1')

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/endpoint/1')
      expect(options.method).toBe('DELETE')
    })

    it('should make upload requests with FormData', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))
      const formData = new FormData()
      formData.append('file', 'content')

      await api.upload('/upload', formData)

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/upload')
      expect(options.method).toBe('POST')
      expect(options.body).toBe(formData)
      // Content-Type should NOT be set for FormData
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    })
  })

  describe('non-JSON success responses', () => {
    it('should return success for OK non-JSON responses', async () => {
      mockFetch.mockReturnValue(createFetchResponse(null, { ok: true, status: 200, contentType: 'text/html' }))

      const result = await api.get('/health')

      expect(result.success).toBe(true)
    })
  })
})
