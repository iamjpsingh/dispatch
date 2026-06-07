// src/services/pluginManager.ts - Plugin System with Manifest-Based Lifecycle
// Provider plugins, hook plugins, template plugins (Postgres/Drizzle, async)

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { and, eq, desc } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { plugins } from '../db/pg/schema'
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

const now = () => new Date().toISOString()
const PLUGINS_DIR = './plugins'

// ============================================================================
// Service
// ============================================================================

class PluginManager {
  private hookRegistry: Map<HookEvent, HookHandler[]> = new Map()

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async install(userId: string, input: PluginInput): Promise<Plugin> {
    const db = getDb()
    const id = generateId('plg')

    await db.insert(plugins).values({
      id,
      user_id: userId,
      name: input.manifest.name,
      version: input.manifest.version,
      description: input.manifest.description,
      author: input.manifest.author,
      type: input.manifest.type,
      manifest_json: JSON.stringify(input.manifest),
      settings_json: JSON.stringify(input.settings || {}),
      entry_path: input.manifest.entry || null,
    })

    const [row] = await db.select().from(plugins).where(eq(plugins.id, id)).limit(1)
    return row as Plugin
  }

  async get(userId: string, pluginId: string): Promise<Plugin | null> {
    const [row] = await getDb()
      .select()
      .from(plugins)
      .where(and(eq(plugins.id, pluginId), eq(plugins.user_id, userId)))
      .limit(1)
    return (row as Plugin) ?? null
  }

  async list(userId: string, filters?: { type?: string; status?: string }): Promise<Plugin[]> {
    const conditions = [eq(plugins.user_id, userId)]
    if (filters?.type) conditions.push(eq(plugins.type, filters.type))
    if (filters?.status) conditions.push(eq(plugins.status, filters.status))

    const rows = await getDb()
      .select()
      .from(plugins)
      .where(and(...conditions))
      .orderBy(desc(plugins.installed_at))
    return rows as Plugin[]
  }

  async activate(userId: string, pluginId: string): Promise<boolean> {
    const plugin = await this.get(userId, pluginId)
    if (!plugin) return false

    const res = await getDb()
      .update(plugins)
      .set({ status: 'active', error_message: null, updated_at: now() })
      .where(and(eq(plugins.id, pluginId), eq(plugins.user_id, userId)))
      .returning({ id: plugins.id })

    if (res.length > 0) {
      this.registerPluginHooks(plugin)
    }

    return res.length > 0
  }

  async disable(userId: string, pluginId: string): Promise<boolean> {
    const plugin = await this.get(userId, pluginId)
    if (!plugin) return false

    const res = await getDb()
      .update(plugins)
      .set({ status: 'disabled', updated_at: now() })
      .where(and(eq(plugins.id, pluginId), eq(plugins.user_id, userId)))
      .returning({ id: plugins.id })

    if (res.length > 0) {
      this.unregisterPluginHooks(pluginId)
    }

    return res.length > 0
  }

  async uninstall(userId: string, pluginId: string): Promise<boolean> {
    this.unregisterPluginHooks(pluginId)
    const res = await getDb()
      .delete(plugins)
      .where(and(eq(plugins.id, pluginId), eq(plugins.user_id, userId)))
      .returning({ id: plugins.id })
    return res.length > 0
  }

  async updateSettings(userId: string, pluginId: string, settings: Record<string, any>): Promise<boolean> {
    const res = await getDb()
      .update(plugins)
      .set({ settings_json: JSON.stringify(settings), updated_at: now() })
      .where(and(eq(plugins.id, pluginId), eq(plugins.user_id, userId)))
      .returning({ id: plugins.id })
    return res.length > 0
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
        await getDb()
          .update(plugins)
          .set({ status: 'error', error_message: err instanceof Error ? err.message : 'Hook execution failed', updated_at: now() })
          .where(eq(plugins.id, handler.pluginId))
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

  async installBuiltinProvider(userId: string, providerName: string, settings: Record<string, any>): Promise<Plugin | null> {
    const manifest = BUILT_IN_PROVIDERS.find(p => p.name === providerName)
    if (!manifest) return null

    return this.install(userId, { manifest, settings })
  }

  // --------------------------------------------------------------------------
  // Plugin Discovery (pure filesystem helper — no DB)
  // --------------------------------------------------------------------------

  discoverLocalPlugins(): PluginManifest[] {
    const discovered: PluginManifest[] = []

    if (!existsSync(PLUGINS_DIR)) return discovered

    const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const manifestPath = join(PLUGINS_DIR, entry.name, 'manifest.json')
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
