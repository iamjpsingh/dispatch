// src/services/pluginManager.ts - Plugin System with Manifest-Based Lifecycle
// Provider plugins, hook plugins, template plugins

import Database from 'bun:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  type: 'provider' | 'hook' | 'template' | 'analytics'
  entry: string
  hooks?: string[]
  settings?: PluginSetting[]
  requires?: string[]
}

export interface PluginSetting {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  default?: any
  options?: string[]
  required?: boolean
}

export interface Plugin {
  id: string
  user_id: string
  name: string
  version: string
  description: string
  author: string
  type: 'provider' | 'hook' | 'template' | 'analytics'
  status: 'installed' | 'active' | 'disabled' | 'error'
  manifest_json: string
  settings_json: string
  entry_path: string | null
  error_message: string | null
  installed_at: string
  updated_at: string
}

export interface PluginInput {
  manifest: PluginManifest
  settings?: Record<string, any>
}

export type HookEvent = 'pre_send' | 'post_send' | 'on_bounce' | 'on_open' | 'on_click' | 'on_unsubscribe'

interface HookHandler {
  pluginId: string
  pluginName: string
  handler: (data: any) => Promise<any>
}

// ============================================================================
// Built-in Provider Plugin Definitions
// ============================================================================

const BUILT_IN_PROVIDERS: PluginManifest[] = [
  {
    name: 'Amazon SES',
    version: '1.0.0',
    description: 'Send emails via Amazon Simple Email Service',
    author: 'Dispatch',
    type: 'provider',
    entry: 'built-in:ses',
    settings: [
      { key: 'aws_region', label: 'AWS Region', type: 'string', default: 'us-east-1', required: true },
      { key: 'aws_access_key_id', label: 'Access Key ID', type: 'string', required: true },
      { key: 'aws_secret_access_key', label: 'Secret Access Key', type: 'string', required: true },
    ],
  },
  {
    name: 'SendGrid',
    version: '1.0.0',
    description: 'Send emails via SendGrid API',
    author: 'Dispatch',
    type: 'provider',
    entry: 'built-in:sendgrid',
    settings: [
      { key: 'api_key', label: 'API Key', type: 'string', required: true },
    ],
  },
  {
    name: 'Postmark',
    version: '1.0.0',
    description: 'Send emails via Postmark API',
    author: 'Dispatch',
    type: 'provider',
    entry: 'built-in:postmark',
    settings: [
      { key: 'server_token', label: 'Server Token', type: 'string', required: true },
    ],
  },
]

// ============================================================================
// Service
// ============================================================================

class PluginManager {
  private db: Database
  private hookRegistry: Map<HookEvent, HookHandler[]> = new Map()
  private pluginsDir: string = './plugins'

  constructor() {
    const dbPath = './data/plugins.db'
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        description TEXT,
        author TEXT,
        type TEXT NOT NULL CHECK (type IN ('provider', 'hook', 'template', 'analytics')),
        status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'active', 'disabled', 'error')),
        manifest_json TEXT NOT NULL,
        settings_json TEXT DEFAULT '{}',
        entry_path TEXT,
        error_message TEXT,
        installed_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_user ON plugins(user_id);
      CREATE INDEX IF NOT EXISTS idx_plugin_type ON plugins(type);
      CREATE INDEX IF NOT EXISTS idx_plugin_status ON plugins(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_name_user ON plugins(user_id, name);
    `)

    logger.info('Plugin manager initialized (data/plugins.db)')
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  install(userId: string, input: PluginInput): Plugin {
    const id = generateId('plg')

    this.db.prepare(`
      INSERT INTO plugins (id, user_id, name, version, description, author, type, manifest_json, settings_json, entry_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId,
      input.manifest.name,
      input.manifest.version,
      input.manifest.description,
      input.manifest.author,
      input.manifest.type,
      JSON.stringify(input.manifest),
      JSON.stringify(input.settings || {}),
      input.manifest.entry || null
    )

    return this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as Plugin
  }

  get(userId: string, pluginId: string): Plugin | null {
    return this.db.prepare(`
      SELECT * FROM plugins WHERE id = ? AND user_id = ?
    `).get(pluginId, userId) as Plugin | null
  }

  list(userId: string, filters?: { type?: string; status?: string }): Plugin[] {
    const conditions: string[] = ['user_id = ?']
    const params: any[] = [userId]

    if (filters?.type) {
      conditions.push('type = ?')
      params.push(filters.type)
    }
    if (filters?.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    }

    return this.db.prepare(`
      SELECT * FROM plugins WHERE ${conditions.join(' AND ')} ORDER BY installed_at DESC
    `).all(...params) as Plugin[]
  }

  activate(userId: string, pluginId: string): boolean {
    const plugin = this.get(userId, pluginId)
    if (!plugin) return false

    const result = this.db.prepare(`
      UPDATE plugins SET status = 'active', error_message = NULL, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(pluginId, userId)

    if (result.changes > 0) {
      this.registerPluginHooks(plugin)
    }

    return result.changes > 0
  }

  disable(userId: string, pluginId: string): boolean {
    const plugin = this.get(userId, pluginId)
    if (!plugin) return false

    const result = this.db.prepare(`
      UPDATE plugins SET status = 'disabled', updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(pluginId, userId)

    if (result.changes > 0) {
      this.unregisterPluginHooks(pluginId)
    }

    return result.changes > 0
  }

  uninstall(userId: string, pluginId: string): boolean {
    this.unregisterPluginHooks(pluginId)
    const result = this.db.prepare(`
      DELETE FROM plugins WHERE id = ? AND user_id = ?
    `).run(pluginId, userId)
    return result.changes > 0
  }

  updateSettings(userId: string, pluginId: string, settings: Record<string, any>): boolean {
    const result = this.db.prepare(`
      UPDATE plugins SET settings_json = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(JSON.stringify(settings), pluginId, userId)
    return result.changes > 0
  }

  // --------------------------------------------------------------------------
  // Hook System
  // --------------------------------------------------------------------------

  private registerPluginHooks(plugin: Plugin) {
    const manifest: PluginManifest = JSON.parse(plugin.manifest_json)
    if (!manifest.hooks) return

    for (const hookName of manifest.hooks) {
      const event = hookName as HookEvent
      if (!this.hookRegistry.has(event)) {
        this.hookRegistry.set(event, [])
      }

      this.hookRegistry.get(event)!.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        handler: async (data: any) => data, // Default passthrough
      })
    }
  }

  private unregisterPluginHooks(pluginId: string) {
    for (const [event, handlers] of this.hookRegistry.entries()) {
      this.hookRegistry.set(event, handlers.filter(h => h.pluginId !== pluginId))
    }
  }

  /**
   * Execute all registered hooks for an event
   */
  async executeHooks(event: HookEvent, data: any): Promise<any> {
    const handlers = this.hookRegistry.get(event) || []
    let result = data

    for (const handler of handlers) {
      try {
        result = await handler.handler(result)
      } catch (err) {
        logger.error(`Plugin hook error (${handler.pluginName}/${event}):`, err)
        this.db.prepare(`
          UPDATE plugins SET status = 'error', error_message = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(err instanceof Error ? err.message : 'Hook execution failed', handler.pluginId)
      }
    }

    return result
  }

  getRegisteredHooks(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    for (const [event, handlers] of this.hookRegistry.entries()) {
      result[event] = handlers.map(h => h.pluginName)
    }
    return result
  }

  // --------------------------------------------------------------------------
  // Built-in Providers
  // --------------------------------------------------------------------------

  getAvailableProviders(): PluginManifest[] {
    return BUILT_IN_PROVIDERS
  }

  installBuiltinProvider(userId: string, providerName: string, settings: Record<string, any>): Plugin | null {
    const manifest = BUILT_IN_PROVIDERS.find(p => p.name === providerName)
    if (!manifest) return null

    return this.install(userId, { manifest, settings })
  }

  // --------------------------------------------------------------------------
  // Plugin Discovery
  // --------------------------------------------------------------------------

  discoverLocalPlugins(): PluginManifest[] {
    const discovered: PluginManifest[] = []

    if (!existsSync(this.pluginsDir)) return discovered

    const entries = readdirSync(this.pluginsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const manifestPath = join(this.pluginsDir, entry.name, 'manifest.json')
      if (!existsSync(manifestPath)) continue

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest
        discovered.push(manifest)
      } catch {
        // Skip invalid manifests
      }
    }

    return discovered
  }
}

export const pluginManager = new PluginManager()
