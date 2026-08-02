import { describe, it, expect } from 'vitest'
import app, { startBackgroundWorkers, stopBackgroundWorkers } from '../src/app'

describe('app boot surface', () => {
  it('default export exposes fetch (Bun server object)', () => {
    expect(typeof app.fetch).toBe('function')
  })
  it('exposes worker lifecycle without starting it at import', () => {
    expect(typeof startBackgroundWorkers).toBe('function')
    expect(typeof stopBackgroundWorkers).toBe('function')
  })
})

describe('API docs surface (P9 T5)', () => {
  it('GET /docs serves a self-contained Swagger UI page pointing at /openapi.yaml', async () => {
    const res = await app.fetch(new Request('http://localhost/docs'))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('swagger-ui')
    expect(html).toContain('/openapi.yaml')
    expect(html).toContain('/docs-assets/swagger-ui-bundle.js') // same-origin asset, no CDN
  })

  it('GET /openapi.yaml serves the spec from docs/', async () => {
    const res = await app.fetch(new Request('http://localhost/openapi.yaml'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('yaml')
    expect(await res.text()).toContain('openapi: 3.0.3')
  })

  it('GET /docs-assets/swagger-ui-bundle.js serves the vendored bundle', async () => {
    const res = await app.fetch(new Request('http://localhost/docs-assets/swagger-ui-bundle.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect((await res.text()).length).toBeGreaterThan(1000)
  })
})
