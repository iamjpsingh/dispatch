import { eq } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { system_settings } from '../db/pg/schema'
import { logger } from '../utils/logger'

/**
 * System settings (key/value config) — now Postgres-backed.
 *
 * Reads are SYNCHRONOUS (served from an in-memory cache) so the many sync call
 * sites (middleware, util functions, other services) keep working without an
 * async cascade. Writes are async + write-through to keep the cache consistent.
 * init() loads the cache once at boot. (Single-instance assumption; a multi-node
 * deploy would need cache invalidation — revisit then.)
 */
class SystemSettingsService {
  private cache = new Map<string, { value: string; updated_at: string }>()

  /** Load all settings into memory. Called once at boot. */
  async init(): Promise<void> {
    const rows = await getDb()
      .select({ key: system_settings.key, value: system_settings.value, updated_at: system_settings.updated_at })
      .from(system_settings)
    this.cache.clear()
    for (const r of rows) this.cache.set(r.key, { value: r.value, updated_at: r.updated_at })
  }

  get(key: string): string | null {
    return this.cache.get(key)?.value ?? null
  }

  getJson<T = unknown>(key: string): T | null {
    const val = this.get(key)
    if (!val) return null
    try {
      return JSON.parse(val) as T
    } catch {
      return null
    }
  }

  // Writes update the cache synchronously first (so an immediate get() is consistent
  // even when callers fire-and-forget), then write through to Postgres. The DB write
  // is wrapped so a failure never rejects an un-awaited caller (logs instead).
  async set(key: string, value: string, updatedBy?: string): Promise<void> {
    const updated_at = new Date().toISOString()
    this.cache.set(key, { value, updated_at })
    try {
      await getDb()
        .insert(system_settings)
        .values({ key, value, updated_by: updatedBy ?? null, updated_at })
        .onConflictDoUpdate({ target: system_settings.key, set: { value, updated_by: updatedBy ?? null, updated_at } })
    } catch (err) {
      logger.error(`systemSettings.set(${key}) failed`, err)
    }
  }

  async setJson(key: string, value: unknown, updatedBy?: string): Promise<void> {
    await this.set(key, JSON.stringify(value), updatedBy)
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.cache.delete(key)
    try {
      await getDb().delete(system_settings).where(eq(system_settings.key, key))
    } catch (err) {
      logger.error(`systemSettings.delete(${key}) failed`, err)
    }
    return existed
  }

  getAll(): Array<{ key: string; value: string; updated_at: string }> {
    return [...this.cache.entries()]
      .map(([key, v]) => ({ key, value: v.value, updated_at: v.updated_at }))
      .sort((a, b) => a.key.localeCompare(b.key))
  }
}

export const systemSettingsService = new SystemSettingsService()
