// P8 T5 — M2: provider-plugin settings (aws_secret_access_key, api_key, server_token) were
// stored plaintext in plugins.settings_json (no encrypt) AND returned verbatim to the browser
// by GET /plugins and /plugins/:id — a direct R9 breach. Secrets must be encrypted at rest and
// masked on read. Uses the REAL pluginManager + real crypto on PGlite.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { users, plugins } from '../../src/db/pg/schema'
import { pluginManager } from '../../src/services/pluginManager'

const SECRET = 'AKIA-super-secret-value-123'

// A provider-plugin manifest whose settings carry a secret (api_key). The encrypt-at-rest +
// keys-only mask under test lives in pluginManager.install()/maskRow(), exercised directly here.
const SENDGRID = {
  name: 'SendGrid',
  version: '1.0.0',
  description: 'Send emails via SendGrid API',
  author: 'Dispatch',
  type: 'provider' as const,
  entry: 'built-in:sendgrid',
}
const installSendgrid = () => pluginManager.install('u1', { manifest: SENDGRID, settings: { api_key: SECRET } })

describe('P8 T5 — plugin secret exposure (M2)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(users).values({ id: 'u1', email: 'u1@t.co', name: 'U1', password_hash: 'x' })
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('M2: provider secret is encrypted at rest (not plaintext in settings_json)', async () => {
    const plugin = await installSendgrid()
    const [row] = await db.select().from(plugins).where(eq(plugins.id, plugin.id)).limit(1)
    expect(row.settings_json).not.toContain(SECRET)
    expect(row.settings_json).toMatch(/^v1:/) // encrypted envelope, like whatsapp/webhook secrets
  })

  it('M2: install/get/list do NOT return the plaintext secret to callers', async () => {
    const plugin = await installSendgrid()
    expect(plugin.settings_json).not.toContain(SECRET) // install response masked

    const got = await pluginManager.get('u1', plugin.id)
    expect(got!.settings_json).not.toContain(SECRET)

    const list = await pluginManager.list('u1')
    expect(JSON.stringify(list)).not.toContain(SECRET)
  })

  it('M2: masked read still shows WHICH keys are configured (not over-hidden)', async () => {
    const plugin = await installSendgrid()
    const got = await pluginManager.get('u1', plugin.id)
    const parsed = JSON.parse(got!.settings_json)
    expect(Object.keys(parsed)).toContain('api_key')
    expect(parsed.api_key).toBe('***')
  })
})
