import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock fetch globally before importing api module
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// The api module reads import.meta.env.VITE_API_URL at module level.
// In vitest with jsdom, import.meta.env is available. BASE_URL defaults to ''.
import { api } from '@/lib/api'

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

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    // Reset document.cookie
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET requests', () => {
    it('should make GET requests with correct method and credentials', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true, data: { items: [1, 2, 3] } }))

      const result = await api.get('/test-endpoint')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/test-endpoint')
      expect(options.method).toBe('GET')
      expect(options.credentials).toBe('include')
    })

    it('should return parsed JSON data on success', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true, data: { user: { name: 'John' } } }))

      const result = await api.get<{ user: { name: string } }>('/auth/me')

      expect(result.success).toBe(true)
      expect(result.data?.user.name).toBe('John')
    })

    it('should not include Content-Type header for GET requests', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      await api.get('/test')

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined()
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
  })

  describe('POST requests', () => {
    it('should make POST requests with JSON body', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true, data: { id: '123' } }))

      const result = await api.post('/users', { name: 'Jane', email: 'jane@test.com' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/users')
      expect(options.method).toBe('POST')
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect(options.body).toBe(JSON.stringify({ name: 'Jane', email: 'jane@test.com' }))
    })

    it('should include CSRF token for POST requests', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'session_token=xyz; csrf_token=my-csrf-token',
      })

      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      await api.post('/test', { data: 1 })

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['X-CSRF-Token']).toBe('my-csrf-token')
    })

    it('should handle POST without body', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      await api.post('/batch-pause')

      const [, options] = mockFetch.mock.calls[0]
      expect(options.body).toBeUndefined()
    })

    it('should handle FormData uploads without setting Content-Type', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true, data: { uploaded: true } }))

      const formData = new FormData()
      formData.append('file', 'test-content')

      await api.upload('/upload', formData)

      const [, options] = mockFetch.mock.calls[0]
      // Content-Type should NOT be set for FormData (browser sets it with boundary)
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined()
      expect(options.body).toBe(formData)
    })
  })

  describe('error handling', () => {
    it('should return error response for non-JSON error responses', async () => {
      mockFetch.mockReturnValue(createFetchResponse(null, { ok: false, status: 500, contentType: 'text/plain' }))

      const result = await api.get('/failing')

      expect(result.success).toBe(false)
      expect(result.message).toBe('HTTP Error: 500')
    })

    it('should return success for non-JSON 200 responses', async () => {
      mockFetch.mockReturnValue(createFetchResponse(null, { ok: true, status: 200, contentType: 'text/html' }))

      const result = await api.get('/health')

      expect(result.success).toBe(true)
    })

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'))

      const result = await api.get('/unreachable')

      expect(result.success).toBe(false)
      expect(result.message).toBe('Network error - check if backend is running')
    })

    it('should handle JSON parse errors gracefully', async () => {
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
    it('should pass through responses that already have data field', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: true,
          data: { configs: [{ id: '1', name: 'Test' }] },
          message: 'Loaded',
        })
      )

      const result = await api.get<{ configs: any[] }>('/config/list')

      expect(result.success).toBe(true)
      expect(result.data?.configs).toHaveLength(1)
      expect(result.message).toBe('Loaded')
    })

    it('should normalize legacy format responses by extracting root-level data', async () => {
      // Legacy format: { success: true, configs: [...] } -> normalized to { success: true, data: { configs: [...] } }
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: true,
          configs: [{ id: '1', name: 'SMTP Server' }],
        })
      )

      const result = await api.get<{ configs: any[] }>('/config/list')

      expect(result.success).toBe(true)
      expect(result.data?.configs).toHaveLength(1)
      expect(result.data?.configs[0].name).toBe('SMTP Server')
    })

    it('should handle legacy format with message and error fields', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: false,
          message: 'Not authorized',
          error: 'AUTH_REQUIRED',
        })
      )

      const result = await api.get('/protected')

      expect(result.success).toBe(false)
      expect(result.message).toBe('Not authorized')
      expect(result.error).toBe('AUTH_REQUIRED')
      expect(result.data).toBeUndefined()
    })

    it('should handle legacy format with no extra fields', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      const result = await api.post('/simple')

      expect(result.success).toBe(true)
      expect(result.data).toBeUndefined()
    })

    it('should preserve meta field in normalized response', async () => {
      mockFetch.mockReturnValue(
        createFetchResponse({
          success: true,
          data: [{ id: '1' }],
          meta: { pagination: { page: 1, limit: 50, total: 100, totalPages: 2, hasMore: true } },
        })
      )

      const result = await api.get('/paginated')

      expect(result.success).toBe(true)
      expect(result.meta?.pagination?.total).toBe(100)
      expect(result.meta?.pagination?.hasMore).toBe(true)
    })
  })

  describe('PUT requests', () => {
    it('should make PUT requests with body', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      await api.put('/config/smtp/1', { name: 'Updated' })

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/config/smtp/1')
      expect(options.method).toBe('PUT')
      expect(options.body).toBe(JSON.stringify({ name: 'Updated' }))
    })
  })

  describe('DELETE requests', () => {
    it('should make DELETE requests', async () => {
      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      await api.delete('/config/smtp/1')

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('/api/config/smtp/1')
      expect(options.method).toBe('DELETE')
    })

    it('should include CSRF token for DELETE requests', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'csrf_token=delete-token',
      })

      mockFetch.mockReturnValue(createFetchResponse({ success: true }))

      await api.delete('/resource/1')

      const [, options] = mockFetch.mock.calls[0]
      expect((options.headers as Record<string, string>)['X-CSRF-Token']).toBe('delete-token')
    })
  })
})
