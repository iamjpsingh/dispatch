// Net — audit_logs / activity_logs are append-only via the API: no code mutates them
// except auditService.cleanup() (the retention purge). A new mutating path fails here.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

const FORBIDDEN = /\.(update|delete)\(\s*(audit_logs|activity_logs)\b/
const ALLOWED_FILE = 'services/auditService.ts' // cleanup() lives here

describe('audit tables are append-only via the API', () => {
  it('no update/delete on audit tables outside auditService.cleanup', () => {
    const offenders: string[] = []
    for (const file of walk(join(process.cwd(), 'src'))) {
      if (file.replace(/\\/g, '/').endsWith(ALLOWED_FILE)) continue
      if (FORBIDDEN.test(readFileSync(file, 'utf8'))) offenders.push(file)
    }
    expect(offenders, `Mutating writes to audit tables found outside cleanup:\n${offenders.join('\n')}`).toEqual([])
  })
})
