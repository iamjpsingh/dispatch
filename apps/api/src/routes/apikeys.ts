// src/routes/apikeys.ts - API Key Management (Postgres via apiKeyService).

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { success, error } from '../utils/response'
import { apiKeyService } from '../services/apiKeyService'
import { auditFromContext } from '../services/audit/context'

// ============================================================================
// Schemas
// ============================================================================

const VALID_SCOPES = ['read', 'send', 'contacts', 'campaigns', 'templates', 'admin'] as const

const CreateKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(200),
  scopes: z.array(z.enum(VALID_SCOPES)).optional(),
  expires_at: z.string().optional(),
})

const ToggleSchema = z.object({
  enabled: z.boolean(),
})

const UpdateScopesSchema = z.object({
  scopes: z.array(z.enum(VALID_SCOPES)).min(1, 'At least one valid scope is required'),
})

// ============================================================================
// Routes
// ============================================================================

const apiKeysRoutes = new Hono()
  /** GET /api-keys - List API keys for the org */
  .get('/api-keys', requirePermission(PERMISSIONS.APIKEYS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const keys = await apiKeyService.list(orgId)
    return success(c, { keys })
  })
  /** POST /api-keys - Create a new API key (raw key returned once) */
  .post('/api-keys', requirePermission(PERMISSIONS.APIKEYS_MANAGE), zValidator('json', CreateKeySchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    const scopes = body.scopes || ['read']

    const { id, key, keyPrefix } = await apiKeyService.create(orgId, user.id, body.name.trim(), scopes, body.expires_at)

    auditFromContext(c, { action: 'apikey.created', entityType: 'apikey', entityId: id })
    return success(
      c,
      { id, name: body.name.trim(), key, key_prefix: keyPrefix, scopes, message: 'Save this key - it cannot be shown again' },
      'API key created',
      201
    )
  })
  /** DELETE /api-keys/:id - Revoke an API key */
  .delete('/api-keys/:id', requirePermission(PERMISSIONS.APIKEYS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const removed = await apiKeyService.revoke(orgId, c.req.param('id'))
    if (!removed) return error(c, 'API key not found', 404)
    auditFromContext(c, { action: 'apikey.revoked', entityType: 'apikey', entityId: c.req.param('id') })
    return success(c, undefined, 'API key revoked')
  })
  /** POST /api-keys/:id/toggle - Enable/disable a key */
  .post('/api-keys/:id/toggle', requirePermission(PERMISSIONS.APIKEYS_MANAGE), zValidator('json', ToggleSchema), async (c) => {
    const orgId = getOrgId(c)
    const { enabled } = c.req.valid('json')
    const ok = await apiKeyService.toggle(orgId, c.req.param('id'), enabled)
    if (!ok) return error(c, 'API key not found', 404)
    auditFromContext(c, { action: 'apikey.toggled', entityType: 'apikey', entityId: c.req.param('id') })
    return success(c, undefined, enabled ? 'Key enabled' : 'Key disabled')
  })
  /** PUT /api-keys/:id/scopes - Update key scopes */
  .put('/api-keys/:id/scopes', requirePermission(PERMISSIONS.APIKEYS_MANAGE), zValidator('json', UpdateScopesSchema), async (c) => {
    const orgId = getOrgId(c)
    const { scopes } = c.req.valid('json')
    const ok = await apiKeyService.updateScopes(orgId, c.req.param('id'), scopes)
    if (!ok) return error(c, 'API key not found', 404)
    auditFromContext(c, { action: 'apikey.scopes_updated', entityType: 'apikey', entityId: c.req.param('id'), metadata: { scopes } })
    return success(c, undefined, 'Scopes updated')
  })

// Re-exported for the auth middleware (path preserved across the PG migration).
export const validateApiKey = (key: string) => apiKeyService.validate(key)

export default apiKeysRoutes
export type ApiKeysRoutes = typeof apiKeysRoutes
