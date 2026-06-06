// src/routes/routing.ts - Smart Provider Routing Endpoints

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { success, error } from '../utils/response'
import { routingEngine } from '../services/routingEngine'
import { validateBody } from '../utils/validate'

// ============================================================================
// Schemas
// ============================================================================

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

const app = new Hono()

// Get provider scores and rankings
app.get('/routing/scores', async (c) => {
  const user = requireAuth(c)
  const scores = routingEngine.scoreProviders(user.id)
  return success(c, { scores })
})

// Get smart provider recommendation
app.get('/routing/recommend', async (c) => {
  const user = requireAuth(c)
  const exclude = c.req.query('exclude')
  const excludeIds = exclude ? exclude.split(',') : []
  const decision = routingEngine.selectProvider(user.id, excludeIds)

  if (!decision) {
    return error(c, 'No eligible providers available', 404)
  }

  return success(c, { decision })
})

// Get provider dashboard (today's stats, scores, failovers)
app.get('/routing/dashboard', async (c) => {
  const user = requireAuth(c)
  const dashboard = routingEngine.getProviderDashboard(user.id)
  return success(c, dashboard)
})

// Get provider history
app.get('/routing/history', async (c) => {
  const user = requireAuth(c)
  const days = parseInt(c.req.query('days') || '30')
  const history = routingEngine.getProviderHistory(user.id, days)
  return success(c, { history })
})

// Get routing config
app.get('/routing/config', async (c) => {
  const user = requireAuth(c)
  const config = routingEngine.getRoutingConfig(user.id)
  return success(c, { config })
})

// Update routing config
app.put('/routing/config', async (c) => {
  const user = requireAuth(c)
  const body = await validateBody(c, z.record(z.string(), z.unknown()))

  routingEngine.updateRoutingConfig(user.id, body)
  return success(c, null, 'Routing config updated')
})

// Initialize a provider for routing
app.post('/routing/providers/init', async (c) => {
  const user = requireAuth(c)
  const { configId, providerType, configName, dailyLimit } = await validateBody(c, InitProviderSchema)

  routingEngine.initializeProvider(user.id, configId, providerType, configName || '', dailyLimit)
  return success(c, null, 'Provider initialized for routing')
})

// Mark provider healthy/unhealthy
app.post('/routing/providers/:configId/health', async (c) => {
  const user = requireAuth(c)
  const configId = c.req.param('configId')
  const { healthy, error: errorMsg } = await validateBody(c, ProviderHealthSchema)

  if (healthy) {
    routingEngine.markProviderHealthy(user.id, configId)
  } else {
    routingEngine.markProviderUnhealthy(user.id, configId, errorMsg || 'Marked unhealthy')
  }

  return success(c, null, `Provider marked ${healthy ? 'healthy' : 'unhealthy'}`)
})

// Trigger manual failover
app.post('/routing/failover', async (c) => {
  const user = requireAuth(c)
  const { failedConfigId, reason } = await validateBody(c, FailoverSchema)

  const decision = routingEngine.failover(user.id, failedConfigId, reason || 'Manual failover')

  if (!decision) {
    return error(c, 'No alternative provider available', 404)
  }

  return success(c, { decision }, 'Failover successful')
})

export default app
