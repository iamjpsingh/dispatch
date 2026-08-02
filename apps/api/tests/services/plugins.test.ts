// P2 net — pluginManager on real (PGlite) Postgres. CRUD, user_id scoping,
// lifecycle status gates, settings update, built-in providers, hook registry,
// and a Postgres landing cross-check on the persisted plugins row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, plugins } from '../../src/db/pg/schema'
import { pluginManager, type PluginManifest } from '../../src/services/pluginManager'

const ORG = 'org_p'
const USER = 'usr_p'
const USER2 = 'usr_p2'

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  name: 'My Provider',
  version: '2.1.0',
  description: 'A test provider',
  author: 'Tester',
  type: 'provider',
  entry: 'built-in:test',
  ...over,
})

describe('P2 — pluginManager (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([{ id: ORG, name: 'Org P', slug: 'org-p' }])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('installs a plugin and reads it back with the persisted shape', async () => {
    const m = manifest({ hooks: ['pre_send'] })
    const p = await pluginManager.install(USER, { manifest: m, settings: { api_key: 'k' } })

    expect(p.id).toMatch(/^plg_/)
    expect(p.user_id).toBe(USER)
    expect(p.name).toBe('My Provider')
    expect(p.version).toBe('2.1.0')
    expect(p.description).toBe('A test provider')
    expect(p.author).toBe('Tester')
    expect(p.type).toBe('provider')
    expect(p.status).toBe('installed') // DB default
    expect(p.entry_path).toBe('built-in:test')
    expect(p.error_message).toBeNull()
    expect(typeof p.installed_at).toBe('string')
    expect(typeof p.updated_at).toBe('string')
    // JSON stored as text
    expect(JSON.parse(p.manifest_json)).toEqual(m)
    expect(JSON.parse(p.settings_json)).toEqual({ api_key: '***' }) // masked on read (M2)

    const got = await pluginManager.get(USER, p.id)
    expect(got?.id).toBe(p.id)
  })

  it('defaults settings_json to {} when no settings provided', async () => {
    const p = await pluginManager.install(USER, { manifest: manifest() })
    expect(JSON.parse(p.settings_json)).toEqual({})
  })

  it('scopes get/list to the owning user_id', async () => {
    const mine = await pluginManager.install(USER, { manifest: manifest({ name: 'Mine' }) })
    await pluginManager.install(USER2, { manifest: manifest({ name: 'Theirs' }) })

    // cross-user get returns null
    expect(await pluginManager.get(USER2, mine.id)).toBeNull()
    expect((await pluginManager.get(USER, mine.id))?.name).toBe('Mine')

    const list = await pluginManager.list(USER)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Mine')
  })

  it('filters list by type and status', async () => {
    await pluginManager.install(USER, { manifest: manifest({ name: 'P1', type: 'provider' }) })
    const hookP = await pluginManager.install(USER, { manifest: manifest({ name: 'H1', type: 'hook' }) })
    await pluginManager.activate(USER, hookP.id) // -> status 'active'

    expect(await pluginManager.list(USER, { type: 'hook' })).toHaveLength(1)
    expect(await pluginManager.list(USER, { type: 'provider' })).toHaveLength(1)
    expect(await pluginManager.list(USER, { status: 'active' })).toHaveLength(1)
    expect(await pluginManager.list(USER, { status: 'installed' })).toHaveLength(1)
    expect(await pluginManager.list(USER, { type: 'hook', status: 'active' })).toHaveLength(1)
    expect(await pluginManager.list(USER, { type: 'hook', status: 'installed' })).toHaveLength(0)
  })

  it('orders list by installed_at descending', async () => {
    const a = await pluginManager.install(USER, { manifest: manifest({ name: 'A' }) })
    // force a strictly later installed_at on the second row so ordering is deterministic
    const b = await pluginManager.install(USER, { manifest: manifest({ name: 'B' }) })
    await db.update(plugins).set({ installed_at: new Date(Date.now() + 1000).toISOString() }).where(eq(plugins.id, b.id))

    const list = await pluginManager.list(USER)
    expect(list.map((p) => p.id)).toEqual([b.id, a.id])
  })

  it('activate flips status to active, clears error_message, and is user-scoped', async () => {
    const p = await pluginManager.install(USER, { manifest: manifest({ name: 'Activatable', hooks: ['post_send', 'on_bounce'] }) })
    // seed an error to prove activate clears it
    await db.update(plugins).set({ status: 'error', error_message: 'boom' }).where(eq(plugins.id, p.id))

    // wrong user cannot activate
    expect(await pluginManager.activate(USER2, p.id)).toBe(false)

    expect(await pluginManager.activate(USER, p.id)).toBe(true)
    const got = await pluginManager.get(USER, p.id)
    expect(got?.status).toBe('active')
    expect(got?.error_message).toBeNull()

    // hooks from the manifest got registered
    const hooks = pluginManager.getRegisteredHooks()
    expect(hooks.post_send).toContain('Activatable')
    expect(hooks.on_bounce).toContain('Activatable')
  })

  it('disable flips status to disabled and unregisters hooks', async () => {
    // Unique name + hook event so the module-level (singleton) hook registry,
    // which persists across tests in this file, can't yield a false match.
    const p = await pluginManager.install(USER, { manifest: manifest({ name: 'Disablable', hooks: ['on_click'] }) })
    await pluginManager.activate(USER, p.id)
    expect(pluginManager.getRegisteredHooks().on_click).toContain('Disablable')

    expect(await pluginManager.disable(USER2, p.id)).toBe(false)
    expect(await pluginManager.disable(USER, p.id)).toBe(true)
    expect((await pluginManager.get(USER, p.id))?.status).toBe('disabled')
    expect(pluginManager.getRegisteredHooks().on_click ?? []).not.toContain('Disablable')
  })

  it('updateSettings persists settings_json and is user-scoped', async () => {
    const p = await pluginManager.install(USER, { manifest: manifest() })
    expect(await pluginManager.updateSettings(USER2, p.id, { x: 1 })).toBe(false)
    expect(await pluginManager.updateSettings(USER, p.id, { region: 'eu', n: 3 })).toBe(true)
    const got = await pluginManager.get(USER, p.id)
    expect(JSON.parse(got!.settings_json)).toEqual({ region: '***', n: '***' }) // masked on read (M2)
  })

  it('uninstall deletes only the owning user row', async () => {
    const p = await pluginManager.install(USER, { manifest: manifest() })
    expect(await pluginManager.uninstall(USER2, p.id)).toBe(false)
    expect(await pluginManager.get(USER, p.id)).not.toBeNull()
    expect(await pluginManager.uninstall(USER, p.id)).toBe(true)
    expect(await pluginManager.get(USER, p.id)).toBeNull()
  })

  it('lifecycle methods on a missing plugin return false', async () => {
    expect(await pluginManager.activate(USER, 'plg_nope')).toBe(false)
    expect(await pluginManager.disable(USER, 'plg_nope')).toBe(false)
    expect(await pluginManager.uninstall(USER, 'plg_nope')).toBe(false)
    expect(await pluginManager.updateSettings(USER, 'plg_nope', {})).toBe(false)
  })

  it('Postgres landing cross-check: install writes exactly one durable row matching the return shape', async () => {
    const p = await pluginManager.install(USER, { manifest: manifest({ name: 'Durable' }) })

    // Query the raw table directly (not via the service) to confirm persistence + scoping column.
    const rows = await db.select().from(plugins).where(eq(plugins.user_id, USER))
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.id).toBe(p.id)
    expect(row.name).toBe('Durable')
    expect(row.status).toBe('installed')
    expect(row.version).toBe('2.1.0')
    expect(row.settings_json).toMatch(/^v1:/) // encrypted at rest (M2)
    // timestamps are ISO strings (mode: 'string')
    expect(typeof row.installed_at).toBe('string')
    expect(row.installed_at).toBe(p.installed_at)
  })
})
