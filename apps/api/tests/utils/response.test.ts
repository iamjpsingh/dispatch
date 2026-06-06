import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { success, error, paginated, ErrorMessages } from '../../src/utils/response'

// Create a test app with routes that use the response helpers
function createResponseApp() {
  const app = new Hono()

  app.get('/success', (c) => success(c, { items: [1, 2, 3] }, 'Data loaded'))
  app.get('/success-no-data', (c) => success(c))
  app.get('/success-no-message', (c) => success(c, { ok: true }))
  app.get('/success-201', (c) => success(c, { id: '123' }, 'Created', 201))
  app.get('/error', (c) => error(c, 'Something failed'))
  app.get('/error-500', (c) => error(c, 'Server error', 500, 'Stack trace here'))
  app.get('/error-404', (c) => error(c, ErrorMessages.NOT_FOUND, 404))
  app.get('/paginated', (c) => paginated(c, [{ id: 1 }, { id: 2 }], { page: 1, limit: 10, total: 25 }))
  app.get('/paginated-empty', (c) => paginated(c, [], { page: 1, limit: 10, total: 0 }))

  return app
}

// ============================================================================
// success()
// ============================================================================

describe('success()', () => {
  const app = createResponseApp()

  it('returns success: true with data and message', async () => {
    const res = await app.fetch(new Request('http://localhost/success'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ items: [1, 2, 3] })
    expect(body.message).toBe('Data loaded')
  })

  it('returns success: true without data', async () => {
    const res = await app.fetch(new Request('http://localhost/success-no-data'))
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toBeUndefined()
    expect(body.message).toBeUndefined()
  })

  it('returns success: true with data but no message', async () => {
    const res = await app.fetch(new Request('http://localhost/success-no-message'))
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ ok: true })
    expect(body.message).toBeUndefined()
  })

  it('supports custom status code', async () => {
    const res = await app.fetch(new Request('http://localhost/success-201'))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('123')
    expect(body.message).toBe('Created')
  })
})

// ============================================================================
// error()
// ============================================================================

describe('error()', () => {
  const app = createResponseApp()

  it('returns success: false with message', async () => {
    const res = await app.fetch(new Request('http://localhost/error'))
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.message).toBe('Something failed')
    expect(body.error).toBeUndefined()
  })

  it('includes error details when provided', async () => {
    const res = await app.fetch(new Request('http://localhost/error-500'))
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.message).toBe('Server error')
    expect(body.error).toBe('Stack trace here')
  })

  it('supports 404 with constant error message', async () => {
    const res = await app.fetch(new Request('http://localhost/error-404'))
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.message).toBe('Resource not found')
  })
})

// ============================================================================
// paginated()
// ============================================================================

describe('paginated()', () => {
  const app = createResponseApp()

  it('returns paginated data with metadata', async () => {
    const res = await app.fetch(new Request('http://localhost/paginated'))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data).toEqual([{ id: 1 }, { id: 2 }])
    expect(body.meta.pagination).toBeDefined()
    expect(body.meta.pagination.page).toBe(1)
    expect(body.meta.pagination.limit).toBe(10)
    expect(body.meta.pagination.total).toBe(25)
    expect(body.meta.pagination.totalPages).toBe(3)
    expect(body.meta.pagination.hasMore).toBe(true)
  })

  it('returns hasMore: false on last page', async () => {
    const res = await app.fetch(new Request('http://localhost/paginated-empty'))
    const body = await res.json()

    expect(body.data).toEqual([])
    expect(body.meta.pagination.totalPages).toBe(0)
    expect(body.meta.pagination.hasMore).toBe(false)
  })
})

// ============================================================================
// ErrorMessages
// ============================================================================

describe('ErrorMessages', () => {
  it('contains standard error constants', () => {
    expect(ErrorMessages.UNAUTHORIZED).toBe('Authentication required')
    expect(ErrorMessages.FORBIDDEN).toBe('Access denied')
    expect(ErrorMessages.NOT_FOUND).toBe('Resource not found')
    expect(ErrorMessages.VALIDATION).toBe('Validation failed')
    expect(ErrorMessages.SERVER_ERROR).toBe('Internal server error')
    expect(ErrorMessages.SESSION_EXPIRED).toBe('Session expired')
    expect(ErrorMessages.MISSING_FIELDS).toBe('Missing required fields')
    expect(ErrorMessages.INVALID_CONFIG).toBe('Invalid configuration')
  })
})
