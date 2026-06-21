import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * P6 RPC-surface drift guard.
 *
 * Every Hono route module must (a) `export default` its instance and (b)
 * `export type <Name>Routes = typeof <instance>` — the per-domain type the
 * hono/client (`hc<...Routes>`) web layer types itself against. A new route
 * added without the type export silently breaks the RPC contract for its
 * frontend module; this test fails loudly instead of letting that drift in.
 *
 * Note: the type export only carries inference when the instance is built as a
 * single fluent `new Hono().get(...).post(...)` chain — separate `app.get(...)`
 * statements infer to an empty surface. We assert the chain shape too.
 */
const routesDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/routes')

const routeFiles = readdirSync(routesDir).filter((f) => f.endsWith('.ts'))

describe('P6 RPC surface', () => {
  it('discovers the route modules', () => {
    expect(routeFiles.length).toBeGreaterThan(20)
  })

  it.each(routeFiles)('%s exports a typeof-based *Routes type', (file) => {
    const src = readFileSync(join(routesDir, file), 'utf8')

    expect(src, `${file} must 'export default' its Hono instance`).toMatch(/export default \w+/)

    expect(
      src,
      `${file} must 'export type <Name>Routes = typeof <instance>' so the web layer can hc<...Routes>() against it`
    ).toMatch(/export type \w+Routes = typeof \w+/)

    expect(
      src,
      `${file} must build its routes as one fluent new Hono().method(...) chain (separate app.method() statements erase RPC inference)`
    ).toMatch(/new Hono\(\)[\s\S]*?\n\s*\.(get|post|put|delete|patch|on|use|all)\(/)
  })
})
