// src/routes/plugins.ts - Plugin System Endpoints

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { success, error } from '../utils/response'
import { pluginManager } from '../services/pluginManager'
import { validateBody } from '../utils/validate'

// ============================================================================
// Schemas
// ============================================================================

const InstallPluginSchema = z.object({
  manifest: z.object({
    name: z.string().min(1, 'Plugin name is required'),
    type: z.string().min(1, 'Plugin type is required'),
    version: z.string().optional(),
    description: z.string().optional(),
  }).passthrough(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const InstallProviderSchema = z.object({
  providerName: z.string().min(1, 'providerName is required'),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const PluginSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
})

const app = new Hono()

// List installed plugins
app.get('/plugins', async (c) => {
  const user = requireAuth(c)
  const type = c.req.query('type') || undefined
  const status = c.req.query('status') || undefined
  const plugins = await pluginManager.list(user.id, { type, status })
  return success(c, { plugins })
})

// Get available (built-in) providers
app.get('/plugins/providers', async (c) => {
  requireAuth(c)
  const providers = pluginManager.getAvailableProviders()
  return success(c, { providers })
})

// Discover local plugins
app.get('/plugins/discover', async (c) => {
  requireAuth(c)
  const discovered = pluginManager.discoverLocalPlugins()
  return success(c, { plugins: discovered })
})

// Get registered hooks
app.get('/plugins/hooks', async (c) => {
  requireAuth(c)
  const hooks = pluginManager.getRegisteredHooks()
  return success(c, { hooks })
})

// Get single plugin
app.get('/plugins/:id', async (c) => {
  const user = requireAuth(c)
  const pluginId = c.req.param('id')
  const plugin = await pluginManager.get(user.id, pluginId)

  if (!plugin) return error(c, 'Plugin not found', 404)
  return success(c, plugin)
})

// Install plugin from manifest
app.post('/plugins', async (c) => {
  const user = requireAuth(c)
  const body = await validateBody(c, InstallPluginSchema)

  try {
    const plugin = await pluginManager.install(user.id, {
      manifest: body.manifest,
      settings: body.settings,
    })
    return success(c, plugin, 'Plugin installed', 201)
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return error(c, 'Plugin already installed', 409)
    }
    throw err
  }
})

// Install built-in provider plugin
app.post('/plugins/providers/install', async (c) => {
  const user = requireAuth(c)
  const { providerName, settings } = await validateBody(c, InstallProviderSchema)

  const plugin = await pluginManager.installBuiltinProvider(user.id, providerName, settings || {})

  if (!plugin) {
    return error(c, `Provider "${providerName}" not found`, 404)
  }

  return success(c, plugin, 'Provider plugin installed', 201)
})

// Activate plugin
app.post('/plugins/:id/activate', async (c) => {
  const user = requireAuth(c)
  const pluginId = c.req.param('id')

  if (!(await pluginManager.activate(user.id, pluginId))) {
    return error(c, 'Plugin not found', 404)
  }

  return success(c, null, 'Plugin activated')
})

// Disable plugin
app.post('/plugins/:id/disable', async (c) => {
  const user = requireAuth(c)
  const pluginId = c.req.param('id')

  if (!(await pluginManager.disable(user.id, pluginId))) {
    return error(c, 'Plugin not found', 404)
  }

  return success(c, null, 'Plugin disabled')
})

// Update plugin settings
app.put('/plugins/:id/settings', async (c) => {
  const user = requireAuth(c)
  const pluginId = c.req.param('id')
  const { settings } = await validateBody(c, PluginSettingsSchema)

  if (!(await pluginManager.updateSettings(user.id, pluginId, settings))) {
    return error(c, 'Plugin not found', 404)
  }

  return success(c, null, 'Plugin settings updated')
})

// Uninstall plugin
app.delete('/plugins/:id', async (c) => {
  const user = requireAuth(c)
  const pluginId = c.req.param('id')

  if (!(await pluginManager.uninstall(user.id, pluginId))) {
    return error(c, 'Plugin not found', 404)
  }

  return success(c, null, 'Plugin uninstalled')
})

export default app
