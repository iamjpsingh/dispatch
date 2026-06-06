import { db } from '../db/connection'

class SystemSettingsService {
  get(key: string): string | null {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | null
    return row?.value ?? null
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

  set(key: string, value: string, updatedBy?: string): void {
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')
    `).run(key, value, updatedBy ?? null)
  }

  setJson(key: string, value: unknown, updatedBy?: string): void {
    this.set(key, JSON.stringify(value), updatedBy)
  }

  delete(key: string): boolean {
    const result = db.prepare('DELETE FROM system_settings WHERE key = ?').run(key)
    return result.changes > 0
  }

  getAll(): Array<{ key: string; value: string; updated_at: string }> {
    return db.prepare('SELECT key, value, updated_at FROM system_settings ORDER BY key').all() as any[]
  }
}

export const systemSettingsService = new SystemSettingsService()
