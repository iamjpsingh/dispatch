// src/routes/routing.ts - Smart Provider Routing Endpoints

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth } from '../middleware/auth'
import { success, error } from '../utils/response'
import { routingEngine } from '../services/routingEngine'
import { auditFromContext } from '../services/audit/context'

// ============================================================================
// Schemas
// ============================================================================

const RoutingConfigSchema = z.record(z.string(), z.unknown())

const InitProviderSchema = z.object({
  configId: z.string().min(1, 'configId is required'),
  providerType: z.string().min(1, 'providerType is required'),
  configName: z.string().optional(),
  dailyLimit: z.number().optional(),
})

const ProviderHealthSchema = z.object({
  healthy: z.boolean(),
  error: z.string().optional(),
})

const FailoverSchema = z.object({
  failedConfigId: z.string().min(1, 'failedConfigId is required'),
  reason: z.string().optional(),
})

const routingRoutes = new Hono()
  // Get provider scores and rankings
  .get('/routing/scores', async (c) => {
    const user = requireAuth(c)
    const scores = await routingEngine.scoreProviders(user.id)
    return success(c, { scores })
  })
  // Get smart provider recommendation
  .get('/routing/recommend', async (c) => {
    const user = requireAuth(c)
    const exclude = c.req.query('exclude')
    const excludeIds = exclude ? exclude.split(',') : []
    const decision = await routingEngine.selectProvider(user.id, excludeIds)

    if (!decision) {
      return error(c, 'No eligible providers available', 404)
    }

    return success(c, { decision })
  })
  // Get provider dashboard (today's stats, scores, failovers)
  .get('/routing/dashboard', async (c) => {
    const user = requireAuth(c)
    const dashboard = await routingEngine.getProviderDashboard(user.id)
    return success(c, dashboard)
  })
  // Get provider history
  .get('/routing/history', async (c) => {
    const user = requireAuth(c)
    const days = parseInt(c.req.query('days') || '30')
    const history = await routingEngine.getProviderHistory(user.id, days)
    return success(c, { history })
  })
  // Get routing config
  .get('/routing/config', async (c) => {
    const user = requireAuth(c)
    const config = await routingEngine.getRoutingConfig(user.id)
    return success(c, { config })
  })
  // Update routing config
  .put('/routing/config', zValidator('json', RoutingConfigSchema), async (c) => {
    const user = requireAuth(c)
    const body = c.req.valid('json')

    await routingEngine.updateRoutingConfig(user.id, body)
    auditFromContext(c, { action: 'routing.updated', entityType: 'routing' })
    return success(c, null, 'Routing config updated')
  })
  // Initialize a provider for routing
  .post('/routing/providers/init', zValidator('json', InitProviderSchema), async (c) => {
    const user = requireAuth(c)
    const { configId, providerType, configName, dailyLimit } = c.req.valid('json')

    await routingEngine.initializeProvider(user.id, configId, providerType, configName || '', dailyLimit)
    auditFromContext(c, { action: 'routing.provider_initialized', entityType: 'routing', entityId: configId })
    return success(c, null, 'Provider initialized for routing')
  })
  // Mark provider healthy/unhealthy
  .post('/routing/providers/:configId/health', zValidator('json', ProviderHealthSchema), async (c) => {
    const user = requireAuth(c)
    const configId = c.req.param('configId')
    const { healthy, error: errorMsg } = c.req.valid('json')

    if (healthy) {
      await routingEngine.markProviderHealthy(user.id, configId)
    } else {
      await routingEngine.markProviderUnhealthy(user.id, configId, errorMsg || 'Marked unhealthy')
    }

    auditFromContext(c, { action: 'routing.provider_health_changed', entityType: 'routing', entityId: configId })
    return success(c, null, `Provider marked ${healthy ? 'healthy' : 'unhealthy'}`)
  })
  // Trigger manual failover
  .post('/routing/failover', zValidator('json', FailoverSchema), async (c) => {
    const user = requireAuth(c)
    const { failedConfigId, reason } = c.req.valid('json')

    const decision = await routingEngine.failover(user.id, failedConfigId, reason || 'Manual failover')

    if (!decision) {
      return error(c, 'No alternative provider available', 404)
    }

    auditFromContext(c, { action: 'routing.failover_triggered', entityType: 'routing', entityId: failedConfigId })
    return success(c, { decision }, 'Failover successful')
  })

export default routingRoutes
export type RoutingRoutes = typeof routingRoutes
