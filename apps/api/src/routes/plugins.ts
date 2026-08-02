// src/routes/plugins.ts - Plugin System Endpoints

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { success, error } from '../utils/response'
import { pluginManager } from '../services/pluginManager'
import { auditFromContext } from '../services/audit/context'

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

const PluginSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
})

const pluginsRoutes = new Hono()
  // List installed plugins
  .get('/plugins', async (c) => {
    const user = requireAuth(c)
    const type = c.req.query('type') || undefined
    const status = c.req.query('status') || undefined
    const plugins = await pluginManager.list(user.id, { type, status })
    return success(c, { plugins })
  })
  // Discover local plugins
  .get('/plugins/discover', async (c) => {
    requireAuth(c)
    const discovered = pluginManager.discoverLocalPlugins()
    return success(c, { plugins: discovered })
  })
  // Get registered hooks
  .get('/plugins/hooks', async (c) => {
    requireAuth(c)
    const hooks = pluginManager.getRegisteredHooks()
    return success(c, { hooks })
  })
  // Get single plugin
  .get('/plugins/:id', async (c) => {
    const user = requireAuth(c)
    const pluginId = c.req.param('id')
    const plugin = await pluginManager.get(user.id, pluginId)

    if (!plugin) return error(c, 'Plugin not found', 404)
    return success(c, plugin)
  })
  // Install plugin from manifest
  .post('/plugins', requirePermission(PERMISSIONS.SETTINGS_MANAGE), zValidator('json', InstallPluginSchema), async (c) => {
    const user = requireAuth(c)
    const body = c.req.valid('json')

    try {
      const plugin = await pluginManager.install(user.id, {
        manifest: body.manifest,
        settings: body.settings,
      })
      auditFromContext(c, { action: 'plugin.installed', entityType: 'plugin', entityId: plugin.id })
      return success(c, plugin, 'Plugin installed', 201)
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return error(c, 'Plugin already installed', 409)
      }
      throw err
    }
  })
  // Activate plugin
  .post('/plugins/:id/activate', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const pluginId = c.req.param('id')

    if (!(await pluginManager.activate(user.id, pluginId))) {
      return error(c, 'Plugin not found', 404)
    }

    auditFromContext(c, { action: 'plugin.enabled', entityType: 'plugin', entityId: pluginId })
    return success(c, null, 'Plugin activated')
  })
  // Disable plugin
  .post('/plugins/:id/disable', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const pluginId = c.req.param('id')

    if (!(await pluginManager.disable(user.id, pluginId))) {
      return error(c, 'Plugin not found', 404)
    }

    auditFromContext(c, { action: 'plugin.disabled', entityType: 'plugin', entityId: pluginId })
    return success(c, null, 'Plugin disabled')
  })
  // Update plugin settings
  .put('/plugins/:id/settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), zValidator('json', PluginSettingsSchema), async (c) => {
    const user = requireAuth(c)
    const pluginId = c.req.param('id')
    const { settings } = c.req.valid('json')

    if (!(await pluginManager.updateSettings(user.id, pluginId, settings))) {
      return error(c, 'Plugin not found', 404)
    }

    auditFromContext(c, { action: 'plugin.settings_updated', entityType: 'plugin', entityId: pluginId })
    return success(c, null, 'Plugin settings updated')
  })
  // Uninstall plugin
  .delete('/plugins/:id', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const pluginId = c.req.param('id')

    if (!(await pluginManager.uninstall(user.id, pluginId))) {
      return error(c, 'Plugin not found', 404)
    }

    auditFromContext(c, { action: 'plugin.uninstalled', entityType: 'plugin', entityId: pluginId })
    return success(c, null, 'Plugin uninstalled')
  })

export default pluginsRoutes
export type PluginsRoutes = typeof pluginsRoutes
