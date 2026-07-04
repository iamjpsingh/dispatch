// Net — every mutating route is classified in the audit manifest (two-way), so a new
// un-audited mutation fails CI. Reads the pre-mount router array (no /api prefix).
import { describe, it, expect } from 'vitest'
import { routes } from '../../src/app'
import { AUDIT_MANIFEST } from './manifest'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function liveMutatingRoutes(): string[] {
  const keys = new Set<string>()
  for (const r of routes) {
    for (const e of (r as any).routes as Array<{ method: string; path: string }>) {
      if (MUTATING.has(e.method)) keys.add(`${e.method} ${e.path}`)
    }
  }
  return [...keys].sort()
}

describe('audit coverage', () => {
  it('every mutating route is present in the manifest', () => {
    const missing = liveMutatingRoutes().filter((k) => !(k in AUDIT_MANIFEST))
    expect(missing, `Unclassified mutating routes — add an AuditAction or { exempt } entry:\n${missing.join('\n')}`).toEqual([])
  })

  it('every manifest entry maps to a real route (no stale entries)', () => {
    const live = new Set(liveMutatingRoutes())
    const stale = Object.keys(AUDIT_MANIFEST).filter((k) => !live.has(k))
    expect(stale, `Stale manifest entries — remove or fix:\n${stale.join('\n')}`).toEqual([])
  })
})
