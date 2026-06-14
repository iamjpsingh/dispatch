import { describe, it, expect } from 'vitest'
import app from '../../src/app'

const text = (res: Response) => res.clone().text()

describe('P6 /api/v1 versioning', () => {
  it('serves the same handler under /api and /api/v1 (public login path reachable, not auth-walled)', async () => {
    const base = await app.fetch(
      new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    )
    const v1 = await app.fetch(
      new Request('http://x/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    )
    // Version-path normalization makes /api/v1/auth/login behave identically to /api/auth/login.
    // Neither is rejected by the global auth guard ("Authentication required"); both clear it
    // as PUBLIC and are then handled by the downstream stack (CSRF/validator/handler).
    expect(base.status).toBe(v1.status)
    expect(await text(v1)).not.toContain('Authentication required')
    expect(await text(v1)).toBe(await text(base))
  })

  it('keeps PUBLIC paths public under /api/v1 (GET /oauth/status not auth-walled)', async () => {
    // GET bypasses CSRF, so this directly exercises the global auth guard. Without
    // version normalization PUBLIC_PATHS misses /api/v1/oauth/status and the guard 401s it.
    const base = await app.fetch(new Request('http://x/api/oauth/status'))
    const v1 = await app.fetch(new Request('http://x/api/v1/oauth/status'))
    expect(base.status).toBe(200)
    expect(v1.status).toBe(200)
    expect(await text(v1)).toBe(await text(base))
  })

  it('treats /api/v1 protected routes as protected (no session -> 401)', async () => {
    const res = await app.fetch(new Request('http://x/api/v1/campaigns'))
    expect(res.status).toBe(401)
    expect(await text(res)).toContain('Authentication required')
  })
})
